/* ---------------------------------------------------------------------------
   The cues as a sound track, made after the fact: for each cue the coach's
   own voice at its moment and the tone the app plays with it, mixed the way
   the page's own graph mixes them (voice at full, tones at their level), over
   the film's own sound where there is one, turned down while the voice
   speaks. Rendered offline in one pass. The coach's page uses it to voice a
   film whose cues were spoken by the phone's voice, which no film can carry;
   the Review page uses it under a film it draws afresh.

   render({ cues, durationSec, sampleRate, original, client, tones, onProgress })
     cues        [{ id, text, t }] with t in milliseconds on the film's clock
     original    the film's bytes (ArrayBuffer) to lay the cues over, or null
     client      the voice (speech.js Client), or null for tones alone
     tones       false when the film already carries them
   → { pcm: Float32Array of durationSec at sampleRate, voiced, original }
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Mixdown = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  async function render(o) {
    const sr = o.sampleRate || 44100, dur = Math.max(1, o.durationSec || 1);
    const cues = (o.cues || []).slice().sort((a, b) => a.t - b.t).filter((c) => c.t >= 0 && c.t / 1000 < dur);
    const oac = new OfflineAudioContext(1, Math.ceil((dur + 1) * sr), sr);
    const tones = oac.createGain(); tones.gain.value = Sound.OUT_GAIN; tones.connect(oac.destination);
    const speech = oac.createGain(); speech.connect(oac.destination);
    const own = oac.createGain(); own.connect(oac.destination);
    let original = false;
    if (o.original) {
      try {
        const buf = await oac.decodeAudioData(o.original.slice(0));
        const src = oac.createBufferSource(); src.buffer = buf; src.connect(own); src.start(0); original = true;
      } catch { original = false; }
    }
    const client = o.client && o.client.ready ? o.client : null;
    let voiced = 0;
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i], at = c.t / 1000, next = cues[i + 1] ? cues[i + 1].t / 1000 : null;
      if (o.tones !== false) Sound.tone(oac, tones, Sound.toneFor(c.id), at);
      const pcm = client ? await client.synth(c.text) : null;
      if (o.onProgress) o.onProgress(i + 1, cues.length);
      if (!pcm) continue;
      const b = oac.createBuffer(1, pcm.data.length, pcm.rate); b.copyToChannel(pcm.data, 0);
      const src = oac.createBufferSource(); src.buffer = b; src.connect(speech); src.start(at);
      /* a cue said while the last is still being said cuts it off, as it does live */
      const end = next != null && next < at + b.duration ? next : at + b.duration;
      if (end < at + b.duration) src.stop(end);
      own.gain.setTargetAtTime(0.1, at, 0.015); own.gain.setTargetAtTime(1, end + 0.1, 0.05);
      voiced += 1;
    }
    const rendered = await oac.startRendering();
    return { pcm: rendered.getChannelData(0).slice(0, Math.ceil(dur * sr)), voiced, original, cues: cues.length };
  }
  /* how loud the sound is around a moment: for the tests, and for a note */
  function rmsAt(pcm, sr, sec, span) {
    const a = Math.max(0, Math.round(sec * sr)), b = Math.min(pcm.length, a + Math.round((span || 1) * sr)); let s = 0;
    for (let i = a; i < b; i++) s += pcm[i] * pcm[i];
    return Math.sqrt(s / Math.max(1, b - a));
  }
  return { render, rmsAt };
});
