'use strict';
/* When a fault is judged: at the top of the rep, through the rep, or at all times. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const Spec = require('../public/js/spec.js');

const REPS = { id: 'fakereps', name: 'Fake', reps: true, prompts: ['raise'], faults: ['lost', 'always1', 'raise', 'top1', 'rep1'], setup: ['always1'], when: { top1: 'top', rep1: 'rep', always1: 'always' },
  cues: { top1: { text: 'Top' }, rep1: { text: 'Rep' }, always1: { text: 'Always' }, raise: { text: 'Lift' }, lower: { text: 'Lower' }, early: { text: 'Early' } }, bands: [], read: (x) => x, judge: (v) => v, defaults: { holdTargetSec: 1, repCount: 3 } };
const F = { top1: 5, rep1: 5, always1: 5 };
const DOWN = { ok: true, inPosition: false, raised: false, atStart: true, faults: F, good: {} };
const UP = { ok: true, inPosition: true, raised: true, atStart: false, faults: F, good: {} };
const BETWEEN = { ok: true, inPosition: false, raised: false, atStart: false, faults: F, good: {} };
function run(coach, script, from) { const seen = {}; let t = from || 0; for (const [v, ms] of script) for (const end = t + ms; t < end; t += 33) { const o = coach.step(v, t); const ph = o.phase; seen[ph] = seen[ph] || new Set(); for (const id of o.active || []) seen[ph].add(id); } return { seen, t }; }

test('at the top, through the rep, or at all times: each fault is judged in its own phases', () => {
  const c = new Core.Coach(REPS, { readyMs: 0 });
  const { seen } = run(c, [[DOWN, 1000], [UP, 2500], [BETWEEN, 800], [DOWN, 1000]]);
  assert.deepEqual([...seen.down].sort(), ['always1'], 'between reps only the always fault: ' + [...seen.down]);
  assert.deepEqual([...seen.up].sort(), ['always1', 'rep1', 'top1'], 'at the top all three');
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
