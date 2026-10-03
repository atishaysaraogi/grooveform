'use strict';
/* The floor as a reference, and a reading taken since the rep began. The floor is the level
   of the lowest point of the body the model is sure of; it can be what a height is measured
   over, or the second line of an angle between two lines. "rep" reads a measurement less its
   value when the rep began, taken afresh at every rep. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const Spec = require('../public/js/spec.js');
const Moves = require('../public/js/moves.js');
const Rig = require('./fixtures/rig.js');

const cfg = { vis: 0.5 };
const at = (x, y) => ({ x, y, v: 1 });
const read = (m, P, facing) => Spec.measure(m, { P, both: { L: P, R: {} }, cfg, facing: facing == null ? 1 : facing, Core, values: {}, side: 'L' }).x;

test('a height over the floor: the lowest point of the body seen is the floor', () => {
  const P = { heel: at(0.5, 0.9), toe: at(0.6, 0.9), knee: at(0.5, 0.7), hip: at(0.5, 0.5) };
  const m = { key: 'hipup', kind: 'distance', axis: 'y', a: 'floor', b: 'hip', per: ['hip', 'knee'], times: 100 };
  assert.equal(Math.round(read(m, P)), 200, 'the hip two thighs over the floor');
  /* a landmark the model is not sure of is not the floor */
  const Q = Object.assign({}, P, { wrist: { x: 0.4, y: 0.99, v: 0.1 } });
  assert.equal(Math.round(read(m, Q)), 200, 'an unsure wrist below the heel does not move the floor');
});

test('the floor as the second line: level the way the body faces is 0, square 90, back 180', () => {
  const m = { key: 'thighfloor', kind: 'lines', a: 'hip', b: 'knee', c: 'floor' };
  const ang = (dx, dy, facing) => Math.round(read(m, { hip: at(0.5, 0.5), knee: at(0.5 + dx, 0.5 + dy) }, facing));
  assert.equal(ang(0.2, 0), 0, 'level, pointing forward');
  assert.equal(ang(0, 0.2), 90, 'straight down');
  assert.equal(ang(0, -0.2), 90, 'straight up');
  assert.equal(ang(-0.2, 0), 180, 'level, pointing back');
  assert.equal(ang(-0.2, 0, -1), 0, 'facing the other way, level pointing that way is 0');
  assert.equal(ang(0.2, -0.2), 45);
});

test('the file says where the floor may go, and the words name it', () => {
  const f = JSON.parse(JSON.stringify(Moves.bridge.spec));
  f.measurements.push({ key: 'thighfloor', kind: 'lines', a: 'hip', b: 'knee', c: 'floor', label: 'Thigh', hud: 'T', role: 'reading' });
  f.measurements.push({ key: 'hipup', kind: 'distance', axis: 'y', a: 'floor', b: 'hip', per: ['hip', 'knee'], times: 100, label: 'Hip', hud: 'H', role: 'reading' });
  assert.deepEqual(Spec.check(f).filter((p) => p.level === 'error'), [], 'a height over the floor and a line against it check clean');
  const W = Spec.words;
  assert.match(W.describe(f.measurements.at(-2), f).what, /the floor$/);
  assert.match(W.describe(f.measurements.at(-1), f).what, /height of the hip over the floor/);
  const g = JSON.parse(JSON.stringify(Moves.bridge.spec));
  g.measurements.push({ key: 'bad', kind: 'angle', a: 'floor', b: 'knee', c: 'ankle', label: 'Bad', hud: 'B', role: 'reading' });
  assert.ok(Spec.check(g).some((p) => p.level === 'error' && p.at.endsWith('.a')), 'the floor is not one end of an angle');
  /* the floor is never a landmark the picture must hold */
  const M = Spec.compile(f, Core);
  assert.ok(!(M.joints || []).includes('floor') && !(M.needed || []).includes('floor'));
});

test('read since the rep began: the reference is taken afresh at the start of every rep', () => {
  const run = (how) => {
    const f = JSON.parse(JSON.stringify(Moves.bridge.spec));
    f.defaults.holdTargetSec = 1;
    f.measurements.push({ key: 'hipup', kind: 'distance', axis: 'y', a: 'floor', b: 'hip', per: ['hip', 'knee'], times: 100, fromStart: how, label: 'Hip', hud: 'H', role: 'reading' });
    assert.deepEqual(Spec.check(f).filter((p) => p.level === 'error'), [], 'checks clean: ' + how);
    const M = Spec.compile(f, Core); if (M.reset) M.reset();
    const c = new Core.Coach(M, {});
    /* at rest, a rep, a rest with the hips a little higher, and another rep */
    const LOW2 = Object.assign({}, Rig.REST, { dip: 42 });
    const out = []; let last = 0;
    for (const { t, lm } of Rig.take([[Rig.REST, 4000], [Rig.TOP, 2500], [Rig.REST, 2000], [LOW2, 2000], [Rig.TOP, 2500], [Rig.REST, 1500]])) {
      const r = M.read(lm, Rig.ASPECT, c.cfg);
      const o = c.step(r, t); out.push({ t, x: r.hipup, reps: o.reps }); last = o.reps;
    }
    const near = (t0) => out.filter((o) => o.t >= t0 - 300 && o.t < t0).map((o) => o.x).filter((x) => x != null);
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    return { top1: mean(near(6500)), low2: mean(near(10500)), top2: mean(near(13000)), reps: last };
  };
  const rep = run('rep'), change = run('change');
  assert.ok(rep.reps >= 2 && change.reps >= 2, 'two reps counted: ' + rep.reps);
  assert.ok(rep.top1 > 20, 'the hip risen at the top of the first rep: ' + rep.top1.toFixed(1));
  assert.ok(Math.abs(rep.low2) < 1, 'back at the start, a little higher: 0 since the reference follows there — ' + rep.low2.toFixed(1));
  assert.ok(change.low2 > 3, 'read since the set began, the higher rest shows: ' + change.low2.toFixed(1));
  assert.ok(rep.top2 < change.top2 - 3, 'the second rep measured from where it began, not from the set\'s start: ' + rep.top2.toFixed(1) + ' vs ' + change.top2.toFixed(1));
  assert.ok(Math.abs(rep.top1 - change.top1) < 1, 'the first rep began where the set did');
});

test('a fault flagged at once, after its own time, or after the shared wait', () => {
  /* the bridge's foot check: a slant past its band; flagged when it has been seen this long */
  const firstSaid = (afterSec) => {
    const f = JSON.parse(JSON.stringify(Moves.bridge.spec));
    const x = f.faults.find((q) => q.measure === 'shin') || f.faults[0];
    if (afterSec != null) x.afterSec = afterSec;
    assert.deepEqual(Spec.check(f).filter((p) => p.level === 'error'), [], 'checks clean');
    const M = Spec.compile(f, Core); if (M.reset) M.reset();
    const c = new Core.Coach(M, { cooldownMs: 0, gapMs: 0 });
    /* ready at rest, then the fault's own reading pushed out of its band at the start position */
    const bad = Object.assign({}, Rig.REST, { shin: 150 });
    let from = null, said = null;
    for (const { t, lm } of Rig.take([[Rig.REST, 3500], [bad, 3000]])) {
      const o = c.step(M.read(lm, Rig.ASPECT, c.cfg), t);
      if (from == null && o.active && o.active.includes(x.id)) from = t;
      if (said == null && o.cue && o.cue.id === x.id) said = t;
    }
    return { id: x.id, after: from == null || said == null ? null : said - from };
  };
  const shared = firstSaid(), now = firstSaid(0), slow = firstSaid(2);
  assert.ok(shared.after != null, 'the fault is seen and said: ' + shared.id);
  assert.ok(shared.after >= 500 && shared.after < 700, 'the shared wait, half a second: ' + shared.after);
  assert.ok(now.after < 100, 'at once: ' + now.after);
  assert.ok(slow.after >= 2000 && slow.after < 2200, 'two seconds: ' + slow.after);
  const f = JSON.parse(JSON.stringify(Moves.bridge.spec)); f.faults[0].afterSec = -1;
  assert.ok(Spec.check(f).some((p) => p.level === 'error' && p.at.endsWith('.afterSec')), 'a negative wait is an error');
});
