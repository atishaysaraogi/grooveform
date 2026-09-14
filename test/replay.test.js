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
  assert.match(html, /Replay\.mount\(document\.getElementById\('replay'\)/, 'and the player runs from it');
  /* the source and the JSON both ride inside script tags; neither may close a tag early */
  const body = html.slice(html.indexOf('<script id="set-data"'));
  assert.equal((body.match(/<\/script>/g) || []).length, 3, 'exactly the three script tags close');
  assert.ok(!html.includes('</script> inside a string'), 'a </script> in the source is escaped');
});

test('the bone list matches the engine so the replay draws the same skeleton', () => {
  const E = require('../client/coach/engine.js');
  assert.deepEqual(Replay.BONES, E.CONNECTIONS);
});
