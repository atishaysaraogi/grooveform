#!/usr/bin/env node
/* The care server: the app's static files and, under /api, the care logic
   (public/js/care-core.js) with one JSON file as its store and a folder for
   the clips. Nothing but node.

     node scripts/care-server.js                  → http://localhost:8000, data in ./data
     CARE_DATA=/var/ontrack CARE_PORT=8000 CARE_ADMIN_PHONES=+919876543210 node scripts/care-server.js

   Messages (codes, invitations, reminders, replies) go out through MSG91 when
   its keys are in the environment, and otherwise land in the outbox the admin
   page shows — which is how the pilot runs before DLT registration is through,
   and how the tests read what was sent.

     MSG91_AUTHKEY        the account's key
     MSG91_SMS_TEMPLATE   the DLT template id for the one-variable message ("##text##")
     MSG91_SENDER         the six-letter sender id
     MSG91_WA_NUMBER      the WhatsApp number, with the country code, for utility templates
     MSG91_WA_TEMPLATE    the approved WhatsApp template's name (one body variable)
     CARE_DEMO_CODE       a fixed sign-in code (123456), for a demo or a test — never in production
     CARE_LOCAL           "1" lets a person set their own role (the sandbox)
     CARE_BASE_URL        the address links are written with (https://app.example.in/)
     CARE_TZ              Asia/Kolkata

   The scheduler runs inside the process: every minute it asks the logic what is
   due (exercise and visit reminders) and once a night it does the housekeeping.
   Run one process. */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Core = require('../public/js/core.js');
const Moves = require('../public/js/moves.js');
const Plans = require('../public/js/plans.js');
const { CareServer, CareError } = require('../public/js/care-core.js');

const ROOT = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.gz': 'application/gzip', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.ico': 'image/x-icon' };
const MAX_BODY = 40 * 1024 * 1024;   // a clip and its record, base64, with room

/* ---- the store: one JSON file, written whole after every change, atomically ---- */
function fileStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'care.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = {}; }
  let writing = null, again = false;
  const write = () => {
    if (writing) { again = true; return writing; }
    writing = fs.promises.writeFile(file + '.tmp', JSON.stringify(data)).then(() => fs.promises.rename(file + '.tmp', file)).finally(() => { writing = null; if (again) { again = false; write(); } });
    return writing;
  };
  return { data, save: write, file };
}
/* ---- the files: clips, records, screenshots, under data/files ---- */
function fileStoreFiles(dir) {
  const base = path.join(dir, 'files');
  const safe = (p) => { const f = path.normalize(path.join(base, p)); if (!f.startsWith(base + path.sep)) throw new CareError(400, 'bad path'); return f; };
  return {
    async put(p, bytes, type) { const f = safe(p); await fs.promises.mkdir(path.dirname(f), { recursive: true }); await fs.promises.writeFile(f, Buffer.from(bytes)); await fs.promises.writeFile(f + '.type', type || 'application/octet-stream'); },
    async get(p) { const f = safe(p); try { const bytes = await fs.promises.readFile(f); let type = 'application/octet-stream'; try { type = (await fs.promises.readFile(f + '.type', 'utf8')).trim(); } catch { } return { bytes, type }; } catch { return null; } },
    async del(p) { const f = safe(p); for (const x of [f, f + '.type']) { try { await fs.promises.unlink(x); } catch { } } },
  };
}
/* ---- the transport: MSG91 when configured, the outbox always ---- */
function transport(env, log) {
  const key = env.MSG91_AUTHKEY;
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authkey: key }, body: JSON.stringify(body) }).then(async (r) => { if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`); return r.json().catch(() => ({})); });
  return (m) => {
    if (m.to === 'admin' || m.channel === 'email') { log(`[report] ${m.text}`); return; }
    if (!key) { log(`[outbox ${m.channel}] ${m.to}: ${m.text}`); return; }
    const to = String(m.to).replace(/^\+/, '');
    const wa = (m.channel === 'whatsapp' || m.channel === 'push') && env.MSG91_WA_NUMBER && env.MSG91_WA_TEMPLATE;
    const p = wa
      ? post('https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', { integrated_number: env.MSG91_WA_NUMBER, content_type: 'template', payload: { messaging_product: 'whatsapp', type: 'template', template: { name: env.MSG91_WA_TEMPLATE, language: { code: 'en', policy: 'deterministic' }, to_and_components: [{ to: [to], components: { body_1: { type: 'text', value: m.text } } }] } } })
      : post('https://control.msg91.com/api/v5/flow', { template_id: env.MSG91_SMS_TEMPLATE, sender: env.MSG91_SENDER, short_url: '0', recipients: [{ mobiles: to, text: m.text }] });
    p.then(() => log(`[sent ${wa ? 'whatsapp' : 'sms'}] ${m.to} ${m.kind}`)).catch((e) => log(`[send failed] ${m.to} ${m.kind}: ${e.message}`));
  };
}

function make(env, log) {
  env = env || process.env; log = log || ((s) => console.log(new Date().toISOString().slice(11, 19), s));
  const dir = env.CARE_DATA || path.join(__dirname, '..', 'data');
  const store = fileStore(dir), files = fileStoreFiles(dir);
  const care = CareServer(store, {
    random: (n) => crypto.randomBytes(n).toString('hex'), send: transport(env, log), files, Plans, Moves,
    demoCode: env.CARE_DEMO_CODE || null, local: env.CARE_LOCAL === '1', adminPhones: String(env.CARE_ADMIN_PHONES || '').split(/[,\s]+/).filter(Boolean).map((p) => (p.startsWith('+') ? p : '+' + p.replace(/\D/g, ''))),
    baseUrl: env.CARE_BASE_URL || '', tz: env.CARE_TZ || 'Asia/Kolkata',
  });
  /* the scheduler: a minute's grain, inside the process */
  let timers = [];
  function startClock() {
    let lastNight = '';
    timers.push(setInterval(async () => {
      try { const out = await care.tick(); if (out.length) { await store.save(); log(`[tick] ${out.length} sent`); } } catch (e) { log('[tick] ' + e.message); }
      const d = care.localTime(Date.now());
      if (d.hour === 3 && lastNight !== d.date) { lastNight = d.date; try { const n = await care.nightly(); await store.save(); log(`[nightly] ${JSON.stringify(n)}`); } catch (e) { log('[nightly] ' + e.message); } }
    }, 60 * 1000));
  }
  const readBody = (req) => new Promise((res, rej) => { const chunks = []; let n = 0; req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { rej(new CareError(413, 'too big')); req.destroy(); } else chunks.push(c); }); req.on('end', () => res(Buffer.concat(chunks))); req.on('error', rej); });
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const headers = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY' };
  const tokenOf = (req, url) => { const h = req.headers.authorization || ''; const m = h.match(/^Bearer (\S+)$/); return m ? m[1] : url.searchParams.get('token') || null; };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    try {
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      /* a file of the store (a clip, a record): the token must be able to read the review it belongs to */
      if (url.pathname === '/api/file') {
        const p = url.searchParams.get('path') || ''; const rm = p.match(/^reviews\/([a-z0-9]+)\//);
        if (!rm) return json(res, 404, { error: 'no such file' });
        await care.call('review', tokenOf(req, url), { id: rm[1] });   // the same rule as reading the review, and the same audit row
        const f = await files.get(p); if (!f) return json(res, 404, { error: 'no such file' });
        res.writeHead(200, { 'content-type': f.type, 'content-length': f.bytes.length, 'cache-control': 'private, max-age=600' }); return res.end(f.bytes);
      }
      /* the api: one door, POST /api/<method> with a JSON body, the token as a bearer */
      let m;
      if ((m = url.pathname.match(/^\/api\/([a-zA-Z]+)$/))) {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST' });
        const raw = await readBody(req);
        let args = {}; try { args = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch { return json(res, 400, { error: 'not JSON' }); }
        const out = await care.call(m[1], tokenOf(req, url), args, { ip: req.socket.remoteAddress });
        return json(res, 200, out);
      }
      /* the page's configuration: this server is the api, with a demo code if one is set */
      if (url.pathname === '/care-config.js') { res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' }); return res.end(`window.CARE = ${JSON.stringify({ api: '/api', demoCode: env.CARE_DEMO_CODE || null, local: env.CARE_LOCAL === '1' })};\n`); }
      if (url.pathname === '/exercises/index.json') {
        const d = path.join(ROOT, 'exercises'); const list = fs.readdirSync(d).filter((f) => /\.json$/.test(f) && f !== 'index.json').sort();
        res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' }); return res.end(JSON.stringify({ v: 1, files: list, live: true }));
      }
      if (url.pathname === '/health') return json(res, 200, { ok: true, v: Core.VER });
      /* the static app */
      let file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname));
      if (!file.startsWith(ROOT)) return json(res, 403, { error: 'no' });
      let st = null; try { st = fs.statSync(file); } catch { }
      if (st && st.isDirectory()) { file = path.join(file, 'index.html'); try { st = fs.statSync(file); } catch { st = null; } }
      if (!st) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': /\.html$/.test(file) ? 'no-store' : 'public, max-age=3600' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      const status = e instanceof CareError ? e.status : 500;
      if (status === 500) log('[error] ' + (e.stack || e));
      json(res, status, { error: e.message || String(e) });
    }
  });
  const close = () => { for (const t of timers) clearInterval(t); timers = []; server.close(); };
  return { server, care, store, files, startClock, close, dir };
}

if (require.main === module) {
  const S = make();
  const port = Number(process.env.CARE_PORT || process.env.PORT || 8000);
  S.server.listen(port, () => { console.log(`OnTrack care on http://localhost:${port} — data in ${S.dir}${process.env.CARE_DEMO_CODE ? ' — demo code ' + process.env.CARE_DEMO_CODE : ''}${process.env.MSG91_AUTHKEY ? '' : ' — messages to the outbox (no MSG91 key)'}`); S.startClock(); });
}
module.exports = { make };
