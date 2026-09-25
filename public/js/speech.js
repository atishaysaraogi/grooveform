/* ---------------------------------------------------------------------------
   The coach's own voice. The browser's speech engine (speechSynthesis) speaks
   straight to the speaker and hands the page nothing: it cannot be put on the
   film. The one voice that can is one the page makes itself, as samples, and
   plays through its own audio graph — where the film is listening. That is
   what this is: eSpeak, compiled to JavaScript (js/vendor/mespeak), turned
   into a small engine that gives a text as PCM, cached by text so a cue that
   has been said once costs nothing the next time, with the move's cues made
   ahead of the set so the first saying of each is as quick as the rest.

   The engine runs in a thread of its own (speech-worker.js) so making a cue
   never holds the page's drawing or the film's frames; where a worker cannot
   be had it runs on the page's thread instead. Either way the page sees one
   client: `get` for a cue already made, `synth` for one that is not yet.

   The engine is renewed every so often: each run of eSpeak's main keeps what
   it allocated, and one instance dies at about its eightieth call. A fresh
   instance costs a few tens of milliseconds and is made well before that.

   Only the engine and the WAV reading live here; app.js owns the graph, the
   ducking of the microphone while the voice plays, and the choice between this
   voice and the phone's.
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Speech = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const G = typeof globalThis !== 'undefined' ? globalThis : this;

  /* a 16-bit PCM WAV, as the engine writes one, read into samples in [-1, 1] */
  function wavToPcm(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b.length < 44 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'RIFF') throw new Error('not a WAV');
    let p = 12, rate = 0, channels = 1, bits = 16, data = null;
    while (p + 8 <= b.length) {
      const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]), len = dv.getUint32(p + 4, true);
      if (id === 'fmt ') { channels = dv.getUint16(p + 10, true); rate = dv.getUint32(p + 12, true); bits = dv.getUint16(p + 22, true); }
      else if (id === 'data') { data = { start: p + 8, len: Math.min(len, b.length - p - 8) }; break; }
      p += 8 + len + (len & 1);
    }
    if (!data || !rate) throw new Error('WAV without sound');
    if (bits !== 16) throw new Error('WAV not 16-bit');
    const n = Math.floor(data.len / (2 * channels)), out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = dv.getInt16(data.start + i * 2 * channels, true) / 32768;
    return { rate, data: out };
  }
  /* the engine is quiet; brought up to a set peak so it carries like the tones do */
  function normalise(data, peak) {
    let m = 0; for (let i = 0; i < data.length; i++) m = Math.max(m, Math.abs(data[i]));
    if (m > 0) { const g = (peak || 0.9) / m; for (let i = 0; i < data.length; i++) data[i] *= g; }
    return data;
  }

  /* everything a move might say in a set, to be made before it starts: each
     cue's words and its stronger words, the counts, the time calls, the ends */
  function texts(move, cfg, shared) {
    const out = new Set();
    const cues = Object.assign({}, shared || {}, move.cues || {});
    for (const c of Object.values(cues)) { if (c.text) out.add(c.text); if (c.deep) out.add(c.deep); }
    if (move.start) out.add(move.start);
    const fast = cues.fast && cues.fast.text;
    if (move.reps) {
      const n = Math.max(1, Math.min(60, (cfg && cfg.repCount) || 10));
      for (let i = 1; i < n; i++) { out.add(String(i)); if (fast) out.add(`${i} — ${fast}`); }
      out.add(`${n} reps — done`); if (fast) out.add(`${n} reps — done — ${fast}`);
    } else if (cfg && cfg.holdTargetSec) out.add(`${cfg.holdTargetSec} seconds — done`);
    for (const s of (cfg && cfg.callAtSec) || []) out.add(`${s} seconds left`);
    return [...out];
  }

  /* ---- the engine itself: synchronous, and the same in a worker, on the page, or in node ---- */
  const OPTS = { speed: 160, pitch: 42, amplitude: 100, wordgap: 1, voice: 'en/en-us' };
  const RENEW_AT = 40;   // calls per instance; one dies at about eighty
  class Engine {
    /* factory: gives a fresh meSpeak (the bundle's meSpeakFactory); config and voice: its data */
    constructor(factory, config, voice) {
      this.factory = factory; this.config = config; this.voice = voice;
      this.m = null; this.calls = 0; this.made = 0; this.why = null;
      this.fresh();
    }
    fresh() {
      this.m = this.factory();
      this.m.loadConfig(this.config); this.m.loadVoice(this.voice);
      this.calls = 0; this.made += 1;
      if (!(this.m.isConfigLoaded() && this.m.isVoiceLoaded(OPTS.voice))) { this.why = new Error('the voice did not load'); this.m = null; }
    }
    get ready() { return !!this.m; }
    once(text) {
      this.calls += 1;
      const bytes = this.m.speak(text, Object.assign({ rawdata: 'array' }, OPTS));
      if (!bytes || !bytes.length) throw new Error('the engine gave nothing');
      const pcm = wavToPcm(bytes); normalise(pcm.data, 0.9);
      return pcm;
    }
    /* the text as { rate, data: Float32Array }, or null if the engine could not */
    synth(text) {
      if (!this.m) return null;
      if (this.calls >= RENEW_AT) this.fresh();
      try { return this.once(String(text)); }
      catch (e) {
        /* an instance gone wrong is replaced and the text tried once more */
        this.why = e;
        try { this.fresh(); return this.m ? this.once(String(text)) : null; }
        catch (e2) { this.why = e2; return null; }
      }
    }
  }

  /* ---- the page's side: a cache in front of the engine, wherever it runs ---- */
  class Client {
    constructor() { this.cache = new Map(); this.ready = false; this.kind = ''; this.why = null; this.pending = new Map(); this.seq = 0; }
    /* a cue already made, or undefined */
    get(text) { return this.cache.get(String(text)); }
    has(text) { return this.cache.has(String(text)); }
    /* a cue made, now or soon: a promise of { rate, data } or null */
    synth(text) {
      const key = String(text);
      if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
      if (this.pending.has(key)) return this.pending.get(key);
      const p = this.make(key).then((pcm) => { this.cache.set(key, pcm || null); this.pending.delete(key); return pcm || null; },
        (e) => { this.why = e; this.pending.delete(key); return null; });
      this.pending.set(key, p);
      return p;
    }
    /* a list made ahead of time, in order, one after another, with a breath
       between them: on a phone with few cores the engine's thread and the page's
       share a processor, and a set is under way */
    warm(list) {
      const todo = (list || []).filter((t) => !this.cache.has(String(t)) && !this.pending.has(String(t)));
      const next = () => setTimeout(step, 40);
      const step = () => { const t = todo.shift(); if (t != null) this.synth(t).then(next, next); };
      step();
    }
  }
  /* in a thread of its own */
  class WorkerClient extends Client {
    constructor(worker) {
      super(); this.kind = 'worker'; this.w = worker; this.waiting = new Map();
      worker.onmessage = (e) => {
        const d = e.data || {};
        if (d.type === 'pcm') { const r = this.waiting.get(d.id); if (r) { this.waiting.delete(d.id); r(d.data ? { rate: d.rate, data: d.data } : null); } }
      };
    }
    make(text) {
      return new Promise((res, rej) => {
        const id = ++this.seq; this.waiting.set(id, res);
        try { this.w.postMessage({ type: 'say', id, text }); } catch (e) { this.waiting.delete(id); rej(e); }
      });
    }
  }
  /* on the page's thread: the same, only the making holds the page for its moment */
  class InlineClient extends Client {
    constructor(engine) { super(); this.kind = 'inline'; this.engine = engine; }
    make(text) { return new Promise((res) => setTimeout(() => res(this.engine.synth(text)), 0)); }
  }

  /* ---- loading, in a browser: the worker first, the page's thread if not ---- */
  const q = (ver) => (ver ? `?v=${encodeURIComponent(ver)}` : '');
  function script(url) {
    return new Promise((res, rej) => {
      if (G.meSpeakFactory) return res(G.meSpeakFactory);
      const s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = () => (G.meSpeakFactory ? res(G.meSpeakFactory) : rej(new Error('the engine did not load')));
      s.onerror = () => rej(new Error('the engine could not be fetched'));
      document.head.appendChild(s);
    });
  }
  const json = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); });
  function viaWorker(base, ver, workerUrl) {
    return new Promise((res, rej) => {
      let w = null;
      try { w = new Worker(workerUrl); } catch (e) { return rej(e); }
      const fail = (e) => { try { w.terminate(); } catch { } rej(e instanceof Error ? e : new Error((e && e.message) || 'the voice\'s thread failed')); };
      const timer = setTimeout(() => fail(new Error('the voice\'s thread did not answer')), 60000);
      w.onerror = fail;
      w.onmessage = (e) => {
        const d = e.data || {};
        if (d.type === 'ready') { clearTimeout(timer); const c = new WorkerClient(w); c.ready = true; res(c); }
        else if (d.type === 'error') { clearTimeout(timer); fail(new Error(d.message)); }
      };
      w.postMessage({ type: 'load', base, ver });
    });
  }
  function viaPage(base, ver) {
    return Promise.all([script(`${base}mespeak.js${q(ver)}`), json(`${base}mespeak_config.json${q(ver)}`), json(`${base}en-us.json${q(ver)}`)])
      .then(([factory, config, voice]) => {
        const e = new Engine(factory, config, voice);
        if (!e.ready) throw e.why || new Error('the voice did not load');
        const c = new InlineClient(e); c.ready = true; return c;
      });
  }
  /* base: the directory of the engine's files; workerUrl: the worker script; ver: the cache stamp */
  function load(base, ver, workerUrl) {
    if (typeof document === 'undefined') return Promise.reject(new Error('no document'));
    const abs = new URL(base, document.baseURI).href;
    const inline = () => viaPage(abs, ver);
    if (!workerUrl || typeof Worker === 'undefined') return inline();
    return viaWorker(abs, ver, workerUrl + q(ver)).catch((e) => inline().then((c) => { c.why = e; c.fellBack = true; return c; }));
  }

  return { wavToPcm, normalise, texts, Engine, Client, WorkerClient, InlineClient, load, OPTS, RENEW_AT };
});
