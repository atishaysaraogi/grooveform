'use strict';
/* When a fault is judged: at the top of the rep, through the rep, or at all times. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const Spec = require('../public/js/spec.js');

const REPS = { id: 'fakereps', name: 'Fake', reps: true, prompts: ['raise'], faults: ['lost', 'always1', 'raise', 'top1', 'rep1', 'rest1'], setup: ['always1'], when: { top1: 'top', rep1: 'rep', always1: 'always', rest1: 'between' },
  cues: { top1: { text: 'Top' }, rep1: { text: 'Rep' }, always1: { text: 'Always' }, rest1: { text: 'Rest' }, raise: { text: 'Lift' }, lower: { text: 'Lower' }, early: { text: 'Early' } }, bands: [], read: (x) => x, judge: (v) => v, defaults: { holdTargetSec: 1, repCount: 3 } };
const F = { top1: 5, rep1: 5, always1: 5, rest1: 5 };
const DOWN = { ok: true, inPosition: false, raised: false, atStart: true, faults: F, good: {} };
const UP = { ok: true, inPosition: true, raised: true, atStart: false, faults: F, good: {} };
const BETWEEN = { ok: true, inPosition: false, raised: false, atStart: false, faults: F, good: {} };
function run(coach, script, from) { const seen = {}; let t = from || 0; for (const [v, ms] of script) for (const end = t + ms; t < end; t += 33) { const o = coach.step(v, t); const ph = o.phase; seen[ph] = seen[ph] || new Set(); for (const id of o.active || []) seen[ph].add(id); } return { seen, t }; }

test('at the top, through the rep, or at all times: each fault is judged in its own phases', () => {
  const c = new Core.Coach(REPS, { readyMs: 0 });
  const { seen } = run(c, [[DOWN, 1000], [UP, 2500], [BETWEEN, 800], [DOWN, 1000]]);
  assert.deepEqual([...seen.down].sort(), ['always1', 'rest1'], 'between reps the always fault and the between one: ' + [...seen.down]);
  assert.deepEqual([...seen.up].sort(), ['always1', 'rep1', 'top1'], 'at the top all but the between one');
  assert.ok(seen.lower, 'the rep went to lowering');
  assert.deepEqual([...seen.lower].sort(), ['always1', 'rep1'], 'lowering: through-the-rep and always, not the top-only one: ' + [...seen.lower]);
});

test('the file spells it `when`, and `setup: true` still means at all times', () => {
  const f = Spec.blank(); f.type = 'reps';
  const m = Spec.compile(Object.assign({}, f, { faults: [
    { id: 'a', measure: f.measurements[0].key, side: 'above', label: 'A', text: 'a', when: 'always' },
    { id: 'b', measure: f.measurements[0].key, side: 'below', label: 'B', text: 'b', setup: true },
    { id: 'c', measure: f.measurements[0].key, side: 'above', label: 'C', text: 'c', when: 'rep' },
    { id: 'd', measure: f.measurements[0].key, side: 'below', label: 'D', text: 'd' }] }), Core);
  assert.deepEqual(m.setup, ['a', 'b']);
  assert.deepEqual(m.when, { a: 'always', b: 'always', c: 'rep', d: 'top' });
  assert.ok(m.faults.indexOf('a') < m.faults.indexOf('c') && m.faults.indexOf('b') < m.faults.indexOf('d'), 'the always faults come first in the order');
  const bad = Spec.check(Object.assign({}, f, { faults: [{ id: 'x', measure: f.measurements[0].key, side: 'above', label: 'X', text: 'x', when: 'sometimes' }] }));
  assert.ok(bad.some((p) => p.level === 'error' && /when/.test(p.at)), JSON.stringify(bad.filter((p) => p.level === 'error')));
});

test('seen but not at the start for a while: the file\'s words about the start, once, then on the slow clock', () => {
  const M = Object.assign({}, REPS, { cues: Object.assign({}, REPS.cues, { notready: { text: 'Prop the knee higher' } }) });
  const c = new Core.Coach(M);
  const said = []; let t = 0;
  for (const end = 40000; t < end; t += 33) { const o = c.step(BETWEEN, t); if (o.cue) said.push(o.cue); }
  const nudges = said.filter((x) => x.id === 'notready');
  assert.equal(nudges.length, 3, 'at six seconds, then every fifteen: ' + nudges.map((x) => x.t).join(', '));
  assert.ok(nudges[0].t >= 6000 && nudges[0].t < 6100, 'after the wait: ' + nudges[0].t);
  assert.equal(c.ready, false, 'never at the start, never ready');
  /* at the start: no nudge, and the coaching begins */
  const d = new Core.Coach(M); const quiet = [];
  for (let s = 0; s < 8000; s += 33) { const o = d.step(DOWN, s); if (o.cue) quiet.push(o.cue.id); }
  assert.ok(!quiet.includes('notready') && d.ready);
  assert.ok(Core.SYSTEM.includes('notready'), 'not a fault of the person\'s');
});

test('a reading from rest: the reference follows the rest slowly, and only while the reading is near it', () => {
  const M = { id: 'fakerest', name: 'Fake', reps: true, prompts: ['raise'], faults: ['lost', 'raise'], when: {}, fromStart: [{ key: 'x', how: 'rest' }],
    cues: { raise: { text: 'Lift' }, lower: { text: 'Lower' }, early: { text: 'Early' } }, bands: [], read: (v) => v, judge: (r) => ({ ok: true, inPosition: false, raised: false, atStart: true, faults: {}, good: {} }), defaults: { holdTargetSec: 0, repCount: 3 } };
  const c = new Core.Coach(M); const seen = [];
  const feed = (x, ms) => { for (const end = (seen.length ? seen[seen.length - 1].t : 0) + ms, t0 = seen.length ? seen[seen.length - 1].t + 33 : 0; ; ) { let t = seen.length ? seen[seen.length - 1].t + 33 : 0; if (t >= end) break; const r = { ok: true, angles: ['x'], x }; c.step(r, t); seen.push({ t, x: r.x }); } };
  feed(172, 4000);                        // lying at 172: no change, so the start is held and the coaching begins
  assert.ok(c.ready && Math.abs(seen[seen.length - 1].x) < 1e-9, 'at rest reads 0: ' + seen[seen.length - 1].x);
  feed(158, 1000);                        // a lift: fourteen under rest, and the reference stays where it was
  assert.ok(Math.abs(seen[seen.length - 1].x + 14) < 0.01, 'a lift of fourteen: ' + seen[seen.length - 1].x);
  feed(176, 6000);                        // the rest settles four degrees flatter: the reference follows, slowly
  assert.ok(Math.abs(seen[seen.length - 1].x) < 0.2, 'the settled rest reads 0 again: ' + seen[seen.length - 1].x);
  feed(162, 500);
  assert.ok(Math.abs(seen[seen.length - 1].x + 14) < 0.3, 'and a lift from the new rest is fourteen again: ' + seen[seen.length - 1].x);
});
