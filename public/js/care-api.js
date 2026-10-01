/* ---------------------------------------------------------------------------
   The care page's way to the server. Two modes, one shape:

     http   — POST /api/<method> on the care server (scripts/care-server.js),
              the token as a bearer; clips and records fetched from /api/file.
     local  — the same logic (care-core.js) run inside this browser, its store
              in localStorage and its files in IndexedDB: a sandbox on one
              phone, where one person can be the physio and the patient in
              turn. The default when no server is configured, so the page
              works on GitHub Pages.

   `call(method, args)` is the whole interface. What cannot be sent now (no
   signal, the server down) is queued in localStorage and sent when it can be,
   for the calls that are safe to repeat.
   --------------------------------------------------------------------------- */
(function (root) {
  'use strict';
  const TOKEN = 'ontrack.care.token', DB = 'ontrack.care.db', QUEUE = 'ontrack.care.queue';
  const LATER = new Set(['saveSession', 'thumbs', 'report', 'consent', 'setReminders']);   // idempotent enough to send twice
  const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { } }, del(k) { try { localStorage.removeItem(k); } catch { } } };

  /* a small file store on IndexedDB, for the local mode */
  function idbFiles() {
    const open = () => new Promise((res, rej) => { const r = indexedDB.open('ontrack-care-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('files', mode), s = t.objectStore('files'); const q = fn(s); t.oncomplete = () => { db.close(); res(q && q.result); }; t.onerror = () => { db.close(); rej(t.error); }; }); };
    const mem = {};   // where IndexedDB is not there (a private window), the files live for the page's life
    const has = typeof indexedDB !== 'undefined';
    return {
      async put(p, bytes, type) { const v = { bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), type }; if (!has) { mem[p] = v; return; } try { await tx('readwrite', (s) => s.put(v, p)); } catch { mem[p] = v; } },
      async get(p) { if (mem[p]) return mem[p]; if (!has) return null; try { return (await tx('readonly', (s) => s.get(p))) || null; } catch { return null; } },
      async del(p) { delete mem[p]; if (!has) return; try { await tx('readwrite', (s) => s.delete(p)); } catch { } },
    };
  }

  function make(cfg) {
    cfg = cfg || root.CARE || {};
    const mode = cfg.api && cfg.api !== 'local' ? 'http' : 'local';
    let token = ls.get(TOKEN) || null;
    const api = { mode, demoCode: cfg.demoCode || (mode === 'local' ? '123456' : null), local: mode === 'local' || !!cfg.local, get token() { return token; }, set token(t) { token = t; if (t) ls.set(TOKEN, t); else ls.del(TOKEN); } };

    let local = null, files = null;
    if (mode === 'local') {
      files = idbFiles();
      const store = { data: (() => { try { return JSON.parse(ls.get(DB) || '{}') || {}; } catch { return {}; } })(), save() { ls.set(DB, JSON.stringify(store.data)); } };
      const random = (n) => { const a = new Uint8Array(n); (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); }); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); };
      local = root.CareCore.CareServer(store, { random, files, Plans: root.Plans, Moves: root.Moves, demoCode: api.demoCode, local: true, baseUrl: location.origin + location.pathname.replace(/[^/]*$/, ''), send: () => { } });
      api.store = store;
      /* in the sandbox the clock is the page's: reminders due are worked out on each open */
      api.tick = () => local.tick();
    }
    api.call = async function (method, args) {
      args = args || {};
      if (mode === 'local') {
        try { return await local.call(method, token, args); }
        catch (e) { const err = new Error(e.message); err.status = e.status || 500; throw err; }
      }
      let r;
      try { r = await fetch(cfg.api.replace(/\/$/, '') + '/' + method, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: JSON.stringify(args) }); }
      catch (e) { const err = new Error('no connection'); err.status = 0; throw err; }
      let body = null; try { body = await r.json(); } catch { body = null; }
      if (!r.ok) { const err = new Error((body && body.error) || `the server said ${r.status}`); err.status = r.status; throw err; }
      return body;
    };
    /* a call that may wait: tried now, kept for later when the connection is the problem */
    api.later = async function (method, args) {
      try { return await api.call(method, args); }
      catch (e) {
        if (e.status === 0 && LATER.has(method)) { const q = queue(); q.push({ method, args, at: Date.now() }); ls.set(QUEUE, JSON.stringify(q.slice(-100))); return { queued: true }; }
        throw e;
      }
    };
    const queue = () => { try { return JSON.parse(ls.get(QUEUE) || '[]') || []; } catch { return []; } };
    api.pending = () => queue().length;
    api.flush = async function () {
      const q = queue(); if (!q.length) return 0;
      const left = []; let sent = 0;
      for (const it of q) { try { await api.call(it.method, it.args); sent += 1; } catch (e) { if (e.status === 0) left.push(it); } }
      ls.set(QUEUE, JSON.stringify(left)); return sent;
    };
    /* a stored file as something a <video> or a fetch can take */
    api.fileUrl = async function (p) {
      if (!p) return null;
      if (mode === 'local') { const f = await files.get(p); return f ? URL.createObjectURL(new Blob([f.bytes], { type: f.type })) : null; }
      return cfg.api.replace(/\/$/, '') + '/file?path=' + encodeURIComponent(p) + '&token=' + encodeURIComponent(token || '');
    };
    api.fileBytes = async function (p) {
      if (mode === 'local') { const f = await files.get(p); return f ? { bytes: f.bytes, type: f.type } : null; }
      const r = await fetch(await api.fileUrl(p)); if (!r.ok) return null; return { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get('content-type') || '' };
    };
    api.signOut = async function () { try { if (token) await api.call('signOut'); } catch { } api.token = null; };
    if (typeof addEventListener === 'function') addEventListener('online', () => { api.flush().catch(() => { }); });
    return api;
  }
  root.CareApi = { make, idbFiles };
})(typeof globalThis !== 'undefined' ? globalThis : this);
