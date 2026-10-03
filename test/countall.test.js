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

test('a slow rep after a pause is not a break, and "done" falls at the end of each set, not at multiples of the running count', () => {
  const M = Moves.bridge, tuned = { countAll: true, repCount: 3, readyMs: 2000, holdTargetSec: 2 };
  /* three reps, then ten seconds hovering above the start line before the fourth goes up: one set of four */
  const s1 = [[Rig.REST, 3000]]; for (let i = 0; i < 3; i++) s1.push(...Rig.rep());
  const slow = Trace.run(M, tuned, Rig.take(s1.concat([[Rig.HALF, 10000]], Rig.rep())), Rig.ASPECT);
  assert.equal(Trace.reps(slow, M).filter((r) => r.counted).length, 4, 'the slow fourth rep is counted');
  assert.ok(!slow.rows.some((r) => r.out && r.out.set === 2), 'and no second set began');
  /* two reps, a break out of sight, three reps: the set of three ends on the fifth, the first set never reached three */
  const a = [[Rig.REST, 3000]]; for (let i = 0; i < 2; i++) a.push(...Rig.rep());
  const b = [[Rig.REST, 3000]]; for (let i = 0; i < 3; i++) b.push(...Rig.rep());
  const two = Trace.run(M, tuned, Rig.take(a.concat([[Object.assign({}, Rig.REST, { vis: 0.05 }), 10000]], b)), Rig.ASPECT);
  assert.equal(Trace.reps(two, M).filter((r) => r.counted).length, 5);
  const done = two.cues.filter((c) => c.id === 'done');
  assert.equal(done.length, 1, 'one "done": ' + two.cues.map((c) => c.id).join(','));
  assert.ok(/^5 reps|^3 reps/.test(done[0].text) || /done/.test(done[0].text), done[0].text);
});

test('set breaks in the studio: a prompt second set, a lone unseen frame, a rep out of sight, a rest that reads as raised', () => {
  const M = Moves.bridge, base = { countAll: true, repCount: 10, holdTargetSec: 2 };
  const unseen = (p) => Object.assign({}, p, { vis: 0.05 });
  const reps = (n) => { const out = []; for (let i = 0; i < n; i++) out.push(...Rig.rep()); return out; };
  const counted = (res) => Trace.reps(res, M).filter((r) => r.counted).length;
  const sets = (res) => Math.max(...res.rows.map((r) => (r.out && r.out.set) || 1));
  /* the set-up wait left at its three seconds: after a break the second set starts a second and a half after lying back down */
  const prompt = Trace.run(M, base, Rig.take([[Rig.REST, 4000], ...reps(3), [unseen(Rig.REST), 30000], [Rig.REST, 1500], ...reps(3)]), Rig.ASPECT);
  assert.equal(counted(prompt), 6, 'a second set started promptly is counted');
  assert.equal(sets(prompt), 2);
  /* ten seconds hovering above the start, then one frame unseen, then a rep: still one set, the rep counted */
  const lone = Trace.run(M, base, Rig.take([[Rig.REST, 4000], ...reps(3), [Rig.HALF, 10000], [unseen(Rig.HALF), 40], ...reps(1)]), Rig.ASPECT);
  assert.equal(counted(lone), 4, 'a lone unseen frame does not cut the pending break short');
  assert.equal(sets(lone), 1);
  /* out of sight for eight and a half seconds at the top of a rep: the rep carries on and counts */
  const top = Trace.run(M, base, Rig.take([[Rig.REST, 4000], ...reps(3), [Rig.TOP, 1000], [unseen(Rig.TOP), 8500], [Rig.TOP, 3000], [Rig.HALF, 1300], [Rig.REST, 2600]]), Rig.ASPECT);
  assert.equal(counted(top), 4, 'a rep out of sight at the top still counts');
  assert.equal(sets(top), 1);
  /* between sets the hips rest half up (read as raised, never in position) with the feet re-planted: a break all the same */
  const shifted = (p) => Object.assign({}, p, { foot: p.foot + 14 });
  const s2 = [[shifted(Rig.REST), 3000]]; for (let i = 0; i < 3; i++) s2.push([shifted(Rig.TOP), 3500], [shifted(Rig.HALF), 1300], [shifted(Rig.REST), 2600]);
  const raisedRest = Object.assign({}, Rig.REST, { dip: 30, hipAng: 150 });
  const half = Trace.run(M, base, Rig.take([[Rig.REST, 4000], ...reps(3), [raisedRest, 20000], ...s2]), Rig.ASPECT);
  const hr = Trace.reps(half, M);
  assert.equal(sets(half), 2, 'a rest that reads as raised is a break once back at the start');
  assert.equal(hr.filter((r) => r.counted).length, 6, hr.map((r) => (r.counted ? 'rep' : 'x') + '[' + r.faults.map((f) => f.id) + ']').join(' '));
  assert.ok(hr.filter((r) => r.counted).every((r) => !r.faults.some((f) => f.id === 'heelsUp')), 'the second set against its own start');
});

test('long attempts held up but out of position, and a dropout while lowering, are not breaks between sets', () => {
  const M = Moves.bridge, unseen = (p) => Object.assign({}, p, { vis: 0.05 });
  const sets = (res) => Math.max(...res.rows.map((r) => (r.out && r.out.set) || 1));
  const hipLow = Object.assign({}, Rig.REST, { dip: 30, hipAng: 150 });   // raised, but the hips too low to be in position
  /* a ten-second hold asked; two attempts held ten and a half seconds with the hips low, between good reps */
  const goodRep = [[Rig.TOP, 11500], [Rig.HALF, 1300], [Rig.REST, 2600]], tryLow = [[hipLow, 10500], [Rig.HALF, 1300], [Rig.REST, 2600]];
  const long = Trace.run(M, { countAll: true, repCount: 4, readyMs: 2000, holdTargetSec: 10 }, Rig.take([[Rig.REST, 3000], ...goodRep, ...tryLow, ...tryLow, ...goodRep]), Rig.ASPECT);
  assert.equal(sets(long), 1, 'one set');
  const lr = Trace.reps(long, M);
  assert.equal(lr.filter((r) => r.counted).length, 2, 'the two good reps counted: ' + lr.map((r) => (r.counted ? 'rep' : 'x')).join(' '));
  /* five reps back to back, one of them out of sight for six seconds on the way down */
  const parts = [[Rig.REST, 3000], ...Rig.rep(), ...Rig.rep(), [Rig.TOP, 3500], [unseen(Rig.HALF), 6000], [Rig.HALF, 800], [Rig.REST, 2600], ...Rig.rep(), ...Rig.rep()];
  const drop = Trace.run(M, { countAll: true, repCount: 10, readyMs: 2000, holdTargetSec: 2 }, Rig.take(parts), Rig.ASPECT);
  assert.equal(sets(drop), 1, 'a dropout while lowering is no break');
});
