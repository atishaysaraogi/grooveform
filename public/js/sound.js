/* ---------------------------------------------------------------------------
   The tones. Every cue gets a short one: something to hear from across the
   room that is not words, at the moment the words start. The table is here so
   the coach's page and a film rendered after the fact play the same sounds,
   and so the tests can hold them to the same shape.
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Sound = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DOWN = [[660, 0.1], [440, 0.14]], UP = [[440, 0.1], [660, 0.14]];
  const TONES = {
    high: DOWN, low: UP, hipup: DOWN, hipdown: UP,
    forward: [[300, 0.16]], back: [[300, 0.16]],
    feetback: [[520, 0.09], [392, 0.09], [330, 0.13]],   // walking back: a falling run
    feetfwd: [[330, 0.09], [392, 0.09], [520, 0.13]],    // walking out: the same run, rising
    stackback: [[330, 0.09], [392, 0.09], [520, 0.13]],
    stackfwd: [[520, 0.09], [392, 0.09], [330, 0.13]],
    hold: [[880, 0.09], [1175, 0.13]],
    call: [[988, 0.07], [988, 0.09]],                    // the clock, twice, out of the way
    done: [[784, 0.1], [988, 0.1], [1319, 0.22]],
    lost: [[350, 0.08]],
  };
  /* every call shares one tone, so `call30` and `call5` do not each need an entry */
  const toneFor = (id) => TONES[id] || (/^call\d/.test(id) ? TONES.call : TONES.lost);
  const GAP = 0.02, ATTACK = 0.012, RELEASE = 0.03;
  const OUT_GAIN = 0.18;   // the tones' level against a voice at full

  /* a sequence played into `dest` of an AudioContext (live or offline) from
     time `at`; returns when the last note ends */
  function tone(ac, dest, seq, at) {
    for (const [hz, dur] of seq) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = hz;
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(1, at + ATTACK);
      g.gain.setValueAtTime(1, at + dur - RELEASE); g.gain.linearRampToValueAtTime(0, at + dur);
      o.connect(g); g.connect(dest); o.start(at); o.stop(at + dur);
      at += dur + GAP;
    }
    return at;
  }
  /* the same sequence as samples, for a mix made without an audio context */
  function samples(seq, rate) {
    const parts = [];
    for (const [hz, dur] of seq) {
      const n = Math.round(dur * rate), d = new Float32Array(n + Math.round(GAP * rate));
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const env = t < ATTACK ? t / ATTACK : t > dur - RELEASE ? Math.max(0, (dur - t) / RELEASE) : 1;
        d[i] = Math.sin(2 * Math.PI * hz * t) * env;
      }
      parts.push(d);
    }
    const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
    let off = 0; for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  return { TONES, toneFor, tone, samples, OUT_GAIN, GAP };
});
