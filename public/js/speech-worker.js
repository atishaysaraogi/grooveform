/* ---------------------------------------------------------------------------
   The coach's own voice, in a thread of its own. Making a cue as sound takes
   the engine some tens of milliseconds, or a few hundred on a phone: done on
   the page's thread that is a frame not drawn and a frame of the film late.
   Here the page asks for a text and is handed the samples when they are ready.

   Messages in:  { type: 'load', base, ver }   the engine's files are at base
                 { type: 'say', id, text }
   Messages out: { type: 'ready' } | { type: 'error', message }
                 { type: 'pcm', id, rate, data: Float32Array | null }
   --------------------------------------------------------------------------- */
'use strict';
let engine = null;
const q = (ver) => (ver ? `?v=${encodeURIComponent(ver)}` : '');
const json = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); });

self.onmessage = async (e) => {
  const d = e.data || {};
  if (d.type === 'load') {
    try {
      importScripts(new URL('speech.js' + q(d.ver), self.location.href).href, `${d.base}mespeak.js${q(d.ver)}`);
      const [config, voice] = await Promise.all([json(`${d.base}mespeak_config.json${q(d.ver)}`), json(`${d.base}en-us.json${q(d.ver)}`)]);
      engine = new self.Speech.Engine(self.meSpeakFactory, config, voice);
      if (!engine.ready) throw engine.why || new Error('the voice did not load');
      self.postMessage({ type: 'ready' });
    } catch (err) {
      engine = null;
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  } else if (d.type === 'say') {
    let pcm = null;
    try { pcm = engine ? engine.synth(d.text) : null; } catch { pcm = null; }
    if (pcm) self.postMessage({ type: 'pcm', id: d.id, rate: pcm.rate, data: pcm.data }, [pcm.data.buffer]);
    else self.postMessage({ type: 'pcm', id: d.id, rate: 0, data: null });
  }
};
