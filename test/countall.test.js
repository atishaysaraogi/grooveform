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
