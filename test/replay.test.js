/* The replay reads a set's recording (landmarks per frame + the coach's events) and turns it
   into bands: reps, fault spans, cues. Those are what the review, the exported report and the
   video all draw from, so they are checked here without a browser. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Replay = require('../client/coach/replay.js');

/* a small set: 2 s of positioning, a count-in, then three reps at 30 fps with one fault burst */
function fakeRec() {
  const frames = [], events = []; let t = 0;
  const lm = () => Array.from({ length: 33 }, () => [0.5, 0.5, 0, 0.9]);
  for (let i = 0; i < 60; i++, t += 33) frames.push({ t, s: 'position', lm: lm() });
  for (let i = 0; i < 30; i++, t += 33) frames.push({ t, s: 'countdown', lm: lm() });
  const tActive = t;
  events.push({ t, type: 'calibrate', side: 'L' });
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 40; i++, t += 33) {
      const p = Math.sin(Math.PI * i / 40) * (r === 1 ? 0.6 : 1.0);
      const f = { t, s: 'active', lm: i === 20 && r === 2 ? null : lm(), p: +p.toFixed(3) };
      if (r === 0 && i >= 15 && i <= 25) f.f = ['lean'];
      if (r === 0 && i >= 18 && i <= 22) f.f = ['lean', 'hike'];
      frames.push(f);
      if (r === 0 && i === 17) events.push({ t, type: 'cue', fault: 'lean', cue: 'Stand tall' });
    }
    events.push({ t, type: 'rep', full: r !== 1, n: r === 1 ? 0 : r === 0 ? 1 : 2, peak: r === 1 ? 0.6 : 1.0, duration: 1320, faults: r === 0 ? ['lean'] : [] });
  }
  events.push({ t, type: 'finish' });
  return { rec: { version: 1, exercise: 'hipabd', aspect: 16 / 9, facing: 'user', started: '2026-09-14T10:00:00Z', frames, events, opts: { side: 'left' } }, tActive };
}

test('timeline: reps become blocks, faults become spans, cues become ticks', () => {
  const { rec, tActive } = fakeRec();
  const tl = Replay.timeline(rec);
  assert.equal(tl.t0, tActive, 'the replay starts where the set did, not with the positioning');
  assert.equal(tl.reps.length, 3);
  assert.deepEqual(tl.reps.map((r) => [r.n, r.full, r.faults]), [[1, true, ['lean']], [0, false, []], [2, true, []]]);
  assert.equal(tl.reps[1].t0, tl.reps[0].t1, 'each rep starts where the last one ended');
  /* lean was on for frames 15..25 of rep 1 (one span), hike for 18..22 inside it */
  assert.deepEqual(tl.spans.map((s) => s.id), ['lean', 'hike']);
  assert.ok(tl.spans[0].t0 < tl.spans[1].t0 && tl.spans[0].t1 > tl.spans[1].t1, 'the hike span sits inside the lean span');
  assert.equal(tl.cues.length, 1); assert.equal(tl.cues[0].text, 'Stand tall');
  assert.equal(tl.lost, 1, 'one frame without a person');
  assert.ok(tl.curve.length > 100 && tl.curve.every(([, p]) => p >= 0 && p <= 1), 'the range curve covers the active frames');
  assert.deepEqual(tl.phases.map((p) => p.s), ['position', 'countdown', 'active']);
  assert.equal(Replay.timeline(rec, { all: true }).t0, 0, 'all: true keeps the run-up');
});

test('frameAt picks the frame showing at a time', () => {
  const { rec } = fakeRec();
  assert.equal(Replay.frameAt(rec.frames, -5), rec.frames[0]);
  assert.equal(Replay.frameAt(rec.frames, 1e9), rec.frames[rec.frames.length - 1]);
  const f = Replay.frameAt(rec.frames, 1000); assert.ok(f.t <= 1000 && rec.frames[rec.frames.indexOf(f) + 1].t > 1000);
});

test('the report is one self-contained page carrying the recording and the player', () => {
  const { rec } = fakeRec();
  const meta = { name: 'Standing hip abduction', type: 'reps', target: 10, side: 'left leg', faults: { lean: { label: 'Leaning away', tip: 'Stay tall.', landmarks: [11, 12] } } };
  const review = { score: 78, headline: 'Good set', type: 'reps', target: 10, reps: 2, partials: 1, avgTempo: 1320, avgROM: 0.95, faults: { lean: { n: 1, fault: { label: 'Leaning away', tip: 'Stay tall.', weight: 2 } } } };
  const html = Replay.reportHtml(rec, meta, review, 'var Replay = { mount: function () {} }; /* </script> inside a string must not end the tag */');
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /Standing hip abduction/);
  assert.match(html, /Leaning away/);
  assert.match(html, /Rep 1 at [\d.]+ s — Leaning away/);
  assert.match(html, /"exercise":"hipabd"/, 'the recording is inlined');
  assert.ok(!/"video"/.test(html), 'but never the set\u2019s video');
  assert.match(html, /Replay\.mount\(document\.getElementById\('replay'\)/, 'and the player runs from it');
  /* the source and the JSON both ride inside script tags; neither may close a tag early */
  const body = html.slice(html.indexOf('<script id="set-data"'));
  assert.equal((body.match(/<\/script>/g) || []).length, 3, 'exactly the three script tags close');
  assert.ok(!html.includes('</script> inside a string'), 'a </script> in the source is escaped');
});

test('a set\u2019s video never reaches the report, which says so', () => {
  const { rec } = fakeRec();
  rec.video = { fake: 'blob' }; rec.videoMime = 'video/webm'; rec.videoOffset = 120;
  const meta = { name: 'X', type: 'reps', target: 10, faults: {} };
  const review = { score: 80, headline: 'x', type: 'reps', target: 10, reps: 2, partials: 1, faults: {} };
  const html = Replay.reportHtml(rec, meta, review, 'var Replay={mount:function(){}};');
  assert.ok(!html.includes('fake'), 'the video is stripped from the inlined recording');
  assert.match(html, /stayed on the device/, 'and the page says why it is not here');
  assert.equal(Replay.videoTimeOf(rec, 1000), 1.12, 'a moment of the recording maps into the video by its offset');
});

test('the bone list matches the engine so the replay draws the same skeleton', () => {
  const E = require('../client/coach/engine.js');
  assert.deepEqual(Replay.BONES, E.CONNECTIONS);
});

test('the replay smooths the recording exactly as the coach smoothed the live picture', () => {
  const E = require('../client/coach/engine.js');
  let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const frames = []; for (let t = 0; t < 2000; t += 33) {
    if (t === 660) { frames.push({ t, lm: null }); continue; }                                   // a frame without a person
    frames.push({ t, lm: Array.from({ length: 33 }, (_, i) => [0.3 + i * 0.01 + rnd() * 0.05, 0.4 + rnd() * 0.05, rnd() * 0.1, i % 4 === 0 ? 0.42 : i % 4 === 1 ? 0.7 : 0.99]) });
  }
  /* then a second of stillness, so the stable points lock, then a shift, so they let go */
  for (let t = 2000; t < 3000; t += 33) frames.push({ t, lm: Array.from({ length: 33 }, (_, i) => [0.3 + i * 0.01, 0.4, 0, 0.99]) });
  for (let t = 3000; t < 3400; t += 33) frames.push({ t, lm: Array.from({ length: 33 }, (_, i) => [0.3 + i * 0.01 + 0.1, 0.4 + 0.1, 0, 0.99]) });
  const stable = [11, 25, 26, 31];
  const aspect = 16 / 9; const sm = new E.PoseSmoother({ stable }); const want = [];
  for (const f of frames) want.push(f.lm ? sm.update(f.lm.map((l) => ({ x: l[0], y: l[1], z: l[2], visibility: l[3] })), f.t, aspect) : null);
  assert.ok(want.some((fr) => fr && fr[25].locked), 'the stable knee locked during the still second');
  const got = Replay.smoothFrames(frames, { aspect, stable });
  assert.equal(got.length, want.length); assert.equal(got[20], null, 'no person, nothing drawn');
  for (let k = 0; k < frames.length; k++) {
    if (!want[k]) continue;
    for (let i = 0; i < 33; i++) {
      const w = want[k][i], g = got[k][i];
      assert.ok(Math.abs(g[0] - w.x / aspect) < 1e-9 && Math.abs(g[1] - w.y) < 1e-9 && Math.abs(g[3] - w.v) < 1e-9, `frame ${k} joint ${i}: ${JSON.stringify(g)} vs ${JSON.stringify(w)}`);
      assert.equal(g[4], w.seen, `frame ${k} joint ${i} seen`);
    }
  }
  assert.equal(Replay.frameIndexAt(frames, 700), frames.findIndex((f) => f.t === 693));
});

/* ---------------------------------------------------------------------------
   The exported video runs on the wall clock.
   MediaRecorder stamps every frame it is handed by the clock, and the set's own
   video plays underneath on that same clock, so the skeleton has to be on it
   too. Counting timer ticks instead — t += one frame each time the timer fires
   — makes the skeleton's clock run at whatever rate the drawing manages: a real
   glute-bridge export took 74.8 s of wall time to draw 63.3 s of skeleton, and
   the picture ended eleven seconds ahead of the figure standing on it. Drawn
   slower than real time, the export must drop frames, not slow down.
   --------------------------------------------------------------------------- */
test('the exported video keeps the skeleton on the clock, dropping frames when the drawing is slow', async () => {
  const { rec } = fakeRec();
  const tl = Replay.timeline(rec);
  const SLOW = 50;                                  // ms of work per drawn frame, against a 33 ms frame
  const burn = (ms) => { const until = Date.now() + ms; while (Date.now() < until); };
  let draws = 0;
  const ctx = new Proxy({}, { get: (_, k) => {
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'canvas') return { width: 0, height: 0 };
    return () => { };
  }, set: () => true });
  const track = { requestFrame: () => { draws++; burn(SLOW); } };
  const saved = { MediaRecorder: global.MediaRecorder, document: global.document };
  global.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; if (this.onstop) this.onstop(); }
  };
  global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, captureStream: () => ({ getVideoTracks: () => [track] }) }) };
  global.Blob = global.Blob || class { constructor(parts, o) { this.type = o && o.type; } };
  const seen = [];
  try {
    await Replay.record(rec, { name: 'Test', type: 'reps', target: 3, faults: {} }, { width: 320, fps: 30, onProgress: (p) => seen.push(p) });
  } finally { global.MediaRecorder = saved.MediaRecorder; global.document = saved.document; }
  const nominal = (tl.duration + 800) / (1000 / 30);
  assert.ok(seen[seen.length - 1] >= 1, 'it still plays the set out to the end: ' + seen[seen.length - 1]);
  assert.ok(draws < nominal * 0.8, `drawn at ${SLOW} ms a frame it drops frames rather than stretching the set — ${draws} drawn, ${Math.round(nominal)} would be one per tick`);
  assert.ok(draws > 4, 'and it still draws: ' + draws);
});
