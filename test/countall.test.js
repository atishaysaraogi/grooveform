'use strict';
/* The studio counts every rep in a recording; the live coach stops at the set's number.
   Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const Trace = require('../public/js/trace.js');
const Moves = require('../public/js/moves.js');
const Rig = require('./fixtures/rig.js');

/* a recording: the start held, then five reps the way the rig makes one (held, lowered, rested) */
function frames() {
  const parts = [[Rig.REST, 3000]];
  for (let i = 0; i < 5; i++) parts.push(...Rig.rep());
  return Rig.take(parts);
}

test('the studio counts and judges every rep, however many a set asks for', () => {
  const M = Moves.bridge;
  const tuned = { repCount: 3, readyMs: 2000, holdTargetSec: 2 };   // the rig holds the top 3.5 s, the bridge asks 3 after a settle
  const live = Trace.run(M, tuned, frames(), Rig.ASPECT);
  const studio = Trace.run(M, Object.assign({ countAll: true }, tuned), frames(), Rig.ASPECT);
  const counted = (res) => Trace.reps(res, M).filter((r) => r.counted).length;
  assert.equal(counted(live), 3, 'the live coach: the set is three, then done');
  assert.equal(counted(studio), 5, 'the studio: all five');
  assert.ok(!studio.rows.some((r) => r.out && r.out.phase === 'done'), 'and it is never done');
  assert.ok(studio.cues.some((c) => c.id === 'count5'), 'the fifth rep is counted out loud: ' + studio.cues.map((c) => c.id).join(','));
});

/* two sets of three in one film, the second with the feet planted differently (the foot's resting slant
   14° more): between them the person out of sight, or still in the picture but away from the start */
function twoSets(gap) {
  const shifted = (p) => Object.assign({}, p, { foot: p.foot + 14 });
  const set2 = [[shifted(Rig.REST), 3000]];
  for (let i = 0; i < 3; i++) set2.push([shifted(Rig.TOP), 3500], [shifted(Rig.HALF), 1300], [shifted(Rig.REST), 2600]);
  const set1 = [[Rig.REST, 3000]];
  for (let i = 0; i < 3; i++) set1.push(...Rig.rep());
  return Rig.take(set1.concat([gap], set2));
}

test('the studio starts a new set after a break: the set-up wait and its references again, the count carrying on', () => {
  const M = Moves.bridge, tuned = { countAll: true, repCount: 3, readyMs: 2000, holdTargetSec: 2 };
  for (const [what, gap] of [['out of sight', [Object.assign({}, Rig.REST, { vis: 0.05 }), 10000]], ['away from the start, in the picture', [Rig.HALF, 10000]]]) {
    const res = Trace.run(M, tuned, twoSets(gap), Rig.ASPECT);
    const reps = Trace.reps(res, M);
    assert.equal(reps.filter((r) => r.counted).length, 6, `${what}: all six counted — ${reps.map((r) => (r.counted ? 'rep' : 'x') + '[' + r.faults.map((f) => f.id) + ']').join(' ')}`);
    assert.ok(reps.filter((r) => r.counted).every((r) => !r.faults.length), `${what}: the second set read against its own start, so no fault`);
    assert.ok(res.rows.some((r) => r.out && r.out.set === 2), `${what}: the second set is set 2`);
    assert.equal(res.cues.filter((c) => c.id === 'done').length, 2, `${what}: "done" where each set of three ends: ${res.cues.map((c) => c.id).join(',')}`);
  }
  /* reps back to back are one set however many there are */
  const parts = [[Rig.REST, 3000]]; for (let i = 0; i < 7; i++) parts.push(...Rig.rep());
  const one = Trace.run(M, tuned, Rig.take(parts), Rig.ASPECT);
  assert.equal(Trace.reps(one, M).filter((r) => r.counted).length, 7);
  assert.ok(!one.rows.some((r) => r.out && r.out.set === 2), 'no break, no second set');
});
