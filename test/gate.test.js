'use strict';
/* Before the coaching: the opening words, the set-up wait, and "I can't see
   you" on its own slow clock. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');

/* a move whose verdict is handed in ready-made, so the rules can be watched on their own */
const HOLD = { id: 'fake', name: 'Fake hold', faults: ['lost', 'bad'], cues: { bad: { text: 'Fix it' } }, bands: [], read: (x) => x, judge: (v) => v, defaults: {} };
const REPS = Object.assign({}, HOLD, { id: 'fakereps', reps: true, prompts: ['raise'], faults: ['lost', 'raise', 'bad'], cues: { bad: { text: 'Fix it' }, raise: { text: 'Lift' }, lower: { text: 'Lower' }, early: { text: 'Early' } }, defaults: { holdTargetSec: 1, repCount: 3 } });
const SEEN_BAD = { ok: true, inPosition: false, faults: { bad: 20 }, good: {} };
const SEEN_GOOD = { ok: true, inPosition: true, faults: {}, good: {} };
const UNSEEN = { ok: false, inPosition: false, faults: {}, good: {} };
function run(coach, script, from) {
  const said = []; let t = from || 0;
  for (const [v, ms] of script) for (const end = t + ms; t < end; t += 33) { const o = coach.step(v, t); if (o.cue) said.push(Object.assign({ at: t }, o.cue)); }
  return { said, t };
}

test('a hold says nothing but the opening words until the person has been seen for the set-up wait', () => {
  const c = new Core.Coach(HOLD);
  const { said } = run(c, [[SEEN_BAD, 4000]]);
  assert.ok(said.length >= 1 && said[0].id === 'bad', 'the fault is said in the end: ' + JSON.stringify(said));
  assert.ok(said[0].at >= 2000 + 500, 'but not before the wait and the persist time: ' + said[0].at);
  assert.ok(said[0].at < 3200, 'and not long after: ' + said[0].at);
  assert.equal(c.step(SEEN_BAD, 0).ready, true, 'the coach reports itself ready');
  const fresh = new Core.Coach(HOLD);
  assert.equal(fresh.step(SEEN_GOOD, 0).ready, false, 'and not before');
  assert.equal(fresh.step(SEEN_GOOD, 500).holding, false, 'no clock runs during the wait');
});

test('the opening words are not talked over: quiet until they are done', () => {
  const c = new Core.Coach(HOLD);
  c.quiet(5000);
  const { said } = run(c, [[SEEN_BAD, 7000]]);
  assert.ok(said.length && said[0].at >= 5000, 'the first cue waits for the opening: ' + JSON.stringify(said[0]));
  /* a time call or a count is true at one moment only, and is said over the opening rather than lost */
  const d = new Core.Coach(HOLD); d.quiet(5000);
  assert.ok(d.offer('call5', 100, '5 seconds left', true), 'urgent words go through');
  assert.equal(d.offer('bad', 200, 'Fix it'), null, 'a correction does not');
});

test('nobody in the frame: "I can\'t see you" once the frame has been empty a moment, then every fifteen seconds', () => {
  const c = new Core.Coach(HOLD);
  const { said } = run(c, [[UNSEEN, 40000]]);
  const lost = said.filter((x) => x.id === 'lost');
  assert.equal(lost.length, said.length, 'nothing else is said to an empty frame');
  assert.equal(lost.length, 3, 'at half a second, fifteen and thirty: ' + lost.map((x) => x.at).join(', '));
  assert.ok(lost[0].at >= 500 && lost[0].at < 700, 'the first after the persist time: ' + lost[0].at);
  assert.ok(lost[1].at - lost[0].at >= 15000 && lost[1].at - lost[0].at < 15100, 'fifteen seconds apart: ' + (lost[1].at - lost[0].at));
  assert.match(lost[0].text, /can.t see you/i);
  assert.match(lost[0].text, /step into the camera/i);
  /* it is said during the set-up wait too, and the wait only counts while seen */
  const d = new Core.Coach(HOLD);
  const first = run(d, [[UNSEEN, 1000], [SEEN_GOOD, 1500], [UNSEEN, 1000], [SEEN_GOOD, 1500]]);
  assert.ok(first.said.some((x) => x.id === 'lost'), 'said while getting set');
  assert.equal(d.ready, false, 'a second and a half seen, twice, is not two seconds seen');
  run(d, [[SEEN_GOOD, 600]], first.t);   // the clock carries on
  assert.equal(d.ready, true);
  /* once coaching, the same slow clock: a correction every few seconds, this only every fifteen */
  const e = new Core.Coach(HOLD, { readyMs: 0 });
  const later = run(e, [[SEEN_BAD, 3000], [UNSEEN, 20000]]);
  const again = later.said.filter((x) => x.id === 'lost');
  assert.equal(again.length, 2, 'twice in twenty seconds out of sight: ' + again.map((x) => x.at).join(', '));
});

test('a rep move waits at its start position, and a move can say what that position is', () => {
  const c = new Core.Coach(REPS);
  const AT_START = { ok: true, inPosition: false, raised: false, atStart: true, faults: {}, good: {} };
  const UP = { ok: true, inPosition: true, raised: true, atStart: false, faults: {}, good: {} };
  let out = null;
  for (let t = 0; t < 1500; t += 33) out = c.step(UP, t);
  assert.equal(out.phase, 'setup', 'up in the air is not the start');
  for (let t = 1500; t < 3600; t += 33) out = c.step(AT_START, t);
  assert.equal(out.ready, true, 'two seconds at the start and the coaching begins');
  /* a move's own idea of its start position */
  const M = Object.assign({}, REPS, { ready: (r, v) => v.atStart && r.kneeBent });
  const d = new Core.Coach(M);
  const straight = Object.assign({ kneeBent: false }, AT_START), bent = Object.assign({ kneeBent: true }, AT_START);
  for (let t = 0; t < 3000; t += 33) out = d.step(straight, t);
  assert.equal(out.ready, false, 'lying down with the legs straight is not the start');
  for (let t = 3000; t < 5100; t += 33) out = d.step(bent, t);
  assert.equal(out.ready, true, 'knees bent, and it is');
});
