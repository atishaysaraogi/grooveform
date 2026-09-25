'use strict';
/* The coach's own voice: the engine the page carries gives a text as sound,
   the WAV it writes is read right, and the set's cues are all in the list made
   ahead of it. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Core = require('../public/js/core.js');
const Moves = require('../public/js/moves.js');
const Speech = require('../public/js/speech.js');

const V = path.join(__dirname, '..', 'public', 'js', 'vendor', 'mespeak');
function engine() {
  /* the bundle announces itself in node; not a test's business */
  const warn = console.warn; console.warn = () => { };
  try {
    require(path.join(V, 'mespeak.js'));
    return new Speech.Engine(globalThis.meSpeakFactory, JSON.parse(fs.readFileSync(path.join(V, 'mespeak_config.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(V, 'en-us.json'), 'utf8')));
  } finally { console.warn = warn; }
}
const rms = (d) => Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length);

test('a WAV is read into samples, whatever chunks sit in front of the sound', () => {
  const rate = 8000, n = 4, bytes = new Uint8Array(12 + 24 + 12 + 8 + n * 2);
  const dv = new DataView(bytes.buffer);
  const tag = (at, s) => { for (let i = 0; i < 4; i++) bytes[at + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); dv.setUint32(4, bytes.length - 8, true); tag(8, 'WAVE');
  tag(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  tag(36, 'LIST'); dv.setUint32(40, 4, true); tag(44, 'INFO');   // a chunk in the way
  tag(48, 'data'); dv.setUint32(52, n * 2, true);
  [16384, -16384, 32767, 0].forEach((v, i) => dv.setInt16(56 + i * 2, v, true));
  const pcm = Speech.wavToPcm(bytes);
  assert.equal(pcm.rate, rate);
  assert.deepEqual([...pcm.data].map((x) => +x.toFixed(3)), [0.5, -0.5, 1, 0]);
  assert.throws(() => Speech.wavToPcm(new Uint8Array(10)), /not a WAV/);
  const loud = Speech.normalise(new Float32Array([0.1, -0.2, 0.05]), 0.9);
  assert.ok(Math.abs(loud[1] + 0.9) < 1e-6 && Math.abs(loud[0] - 0.45) < 1e-6, 'brought up to the peak');
});

test('the engine the page carries says a cue as sound, once, and remembers it', () => {
  const e = engine();
  assert.ok(e.ready, 'the voice loaded: ' + (e.why && e.why.message));
  const t0 = Date.now();
  const pcm = e.synth('Lift your hips');
  const took = Date.now() - t0;
  assert.ok(pcm && pcm.rate === 22050, 'PCM at the engine\'s rate');
  const secs = pcm.data.length / pcm.rate;
  assert.ok(secs > 0.7 && secs < 2.5, 'three words take about a second: ' + secs.toFixed(2));
  assert.ok(rms(pcm.data) > 0.08, 'and are not silence: ' + rms(pcm.data).toFixed(3));
  let peak = 0; for (const x of pcm.data) peak = Math.max(peak, Math.abs(x));
  assert.ok(Math.abs(peak - 0.9) < 0.01, 'peaks where the tones do: ' + peak.toFixed(3));
  assert.ok(took < 5000, 'made in reasonable time: ' + took + ' ms');
  /* a count, a time call, the stronger words */
  for (const t of ['1', '10 seconds left', 'Lower your hips — they are well above your knees']) {
    const p = e.synth(t); assert.ok(p && p.data.length > pcm.rate * 0.3, t + ' is said');
  }
});

test('the engine is renewed before it wears out, and a set of a hundred cues comes through whole', () => {
  /* one instance of eSpeak dies at about its eightieth call; the engine makes a
     fresh one well before that, and a hundred cues in a row all come back */
  const e = engine();
  let ok = 0;
  for (let i = 0; i < 100; i++) { const p = e.synth(`Cue ${i} — hips no higher than your knees`); if (p && p.data.length > 1000) ok += 1; }
  assert.equal(ok, 100, 'every cue made');
  assert.ok(e.made >= 3, 'the instance was renewed along the way: ' + e.made + ' made');
  assert.ok(e.calls <= Speech.RENEW_AT, 'and the current one is young: ' + e.calls);
});

test('the client keeps what was made, and makes a list ahead without making anything twice', async () => {
  const e = engine();
  const c = new Speech.InlineClient(e); c.ready = true;
  assert.equal(c.get('Lift your hips'), undefined, 'not made yet');
  const p1 = c.synth('Lift your hips'), p2 = c.synth('Lift your hips');
  assert.equal(p1, p2, 'asked twice at once, made once');
  const pcm = await p1;
  assert.ok(pcm && pcm.rate === 22050);
  assert.equal(c.get('Lift your hips'), pcm, 'and kept');
  const calls = e.calls;
  c.warm(['Lift your hips', 'That is it \u2014 hold', '1']);
  await c.synth('1');
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(c.has('That is it \u2014 hold') && c.has('1'), 'the list was made');
  assert.equal(e.calls, calls + 2, 'the one already made was not made again');
});

test('the set\'s cues are all in the list made ahead of it', () => {
  const M = Moves.bridge, cfg = Object.assign({}, Core.COMMON, M.defaults);
  const list = Speech.texts(M, cfg, Core.SHARED_CUES);
  for (const t of [M.start, M.cues.raise.text, M.cues.hipHigh.text, M.cues.hipHigh.deep, Core.SHARED_CUES.hold.text, '1', String(cfg.repCount - 1), `${cfg.repCount} reps — done`, `1 — ${Core.SHARED_CUES.fast.text}`]) {
    assert.ok(list.includes(t), 'in the list: ' + t);
  }
  assert.ok(!list.includes(String(cfg.repCount)), 'the last count is the done cue, not a number');
  const W = Moves.wallsit, wc = Object.assign({}, Core.COMMON, W.defaults);
  const hold = Speech.texts(W, wc, Core.SHARED_CUES);
  assert.ok(hold.includes(`${wc.holdTargetSec} seconds — done`) && hold.includes(`${wc.callAtSec[0]} seconds left`), 'a hold has its end and its time calls');
  assert.ok(!hold.includes('1'), 'and no counts');
});
