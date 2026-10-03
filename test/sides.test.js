'use strict';
/* Which side is measured, and a point named by where it is: the side picked by a joint's
   height, its lead the way the body faces, or its travel; a point from whichever side is
   higher, lower, in front or behind; the angle between two lines. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const Spec = require('../public/js/spec.js');
const W = Spec.words;

const A = 16 / 9;
/* a body as landmarks: each side's joints placed outright (x in the square space, y a share
   of the height), the points not given left off-screen and unsure */
function body(sides) {
  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  for (const s of ['L', 'R']) for (const [name, i] of Object.entries(Core.SIDE[s])) { const p = sides[s] && sides[s][name]; if (p) lm[i] = { x: p[0] / A, y: p[1], z: 0, visibility: 0.95 }; }
  return lm;
}
/* standing, facing the phone: the left side at x 0.9, the right at 1.1; the right is to the picture's right */
const stand = (x, over) => Object.assign({ shoulder: [x, 0.3], hip: [x, 0.5], knee: [x, 0.7], ankle: [x, 0.9] }, over || {});
const BOTH = () => ({ L: stand(0.9), R: stand(1.1) });
const file = (over) => Object.assign({
  id: 't', name: 'T', type: 'hold', position: 'standing', phone: { view: 'front', orientation: 'tall' }, facing: { from: 'L.hip', to: 'R.hip' },
  measurements: [{ key: 'kn', kind: 'angle', a: 'hip', b: 'knee', c: 'ankle', band: { min: 'knMin' }, scale: [0, 180], settings: [{ key: 'knMin', label: 'k', min: 0, max: 180 }] }],
  faults: [{ id: 'bent', measure: 'kn', side: 'below', label: 'Bent', text: 'Straighten' }],
  defaults: { knMin: 160, holdTargetSec: 5 }, words: { start: 'Stand facing the phone.' }, landmarks: { joints: ['hip', 'knee', 'ankle'], needed: ['hip', 'knee', 'ankle'], bones: [['hip', 'knee']], dots: [] },
}, over || {});
const compiled = (over) => { const f = file(over); assert.deepEqual(Spec.check(f).filter((p) => p.level === 'error'), [], 'the test file checks clean'); return Spec.compile(f, Core); };
const read = (M, sides) => M.read(body(sides), A, Object.assign({}, Core.COMMON, M.defaults));

test('the side is picked by where a joint is: higher, lower, in front, behind', () => {
  const raisedR = { L: stand(0.9), R: stand(1.1, { knee: [1.15, 0.5], ankle: [1.2, 0.6] }) };
  assert.equal(read(compiled({ side: { pick: 'highest', joint: 'knee' } }), raisedR).side, 'R', 'the raised knee');
  assert.equal(read(compiled({ side: { pick: 'lowest', joint: 'knee' } }), raisedR).side, 'L', 'the planted leg');
  /* the right side is the way the body faces here (L.hip → R.hip); an ankle out that way is the front one */
  const stepR = { L: stand(0.9), R: stand(1.1, { ankle: [1.3, 0.9] }) };
  assert.equal(read(compiled({ side: { pick: 'front', joint: 'ankle' } }), stepR).side, 'R', 'the front foot');
  assert.equal(read(compiled({ side: { pick: 'back', joint: 'ankle' } }), stepR).side, 'L', 'the back foot');
  /* the same body facing the other way: front and back swap, highest does not */
  const faced = compiled({ side: { pick: 'front', joint: 'ankle' }, facing: { from: 'R.hip', to: 'L.hip' } });
  assert.equal(read(faced, stepR).side, 'L');
  assert.equal(read(compiled({ side: { pick: 'highest', joint: 'knee' }, facing: { from: 'R.hip', to: 'L.hip' } }), raisedR).side, 'R');
});

test('the side is picked by which joint moves, and held until the other leads', () => {
  const M = compiled({ side: { pick: 'moving', joint: 'ankle', hold: { margin: 0.2, frames: 3 } } });
  M.reset();
  const still = BOTH();
  for (let i = 0; i < 4; i++) assert.equal(read(M, still).side, 'L', 'nothing moving: the first side, and held');
  /* the right ankle swings out a little each frame; the left stays */
  const sides = [];
  for (let i = 1; i <= 8; i++) sides.push(read(M, { L: stand(0.9), R: stand(1.1, { ankle: [1.1 + 0.06 * i, 0.9 - 0.02 * i] }) }).side);
  assert.ok(sides.slice(0, 2).every((s) => s === 'L') && sides.slice(-3).every((s) => s === 'R'), 'the moving leg takes over after the hold: ' + sides.join(''));
  /* and stays measured for a while once it stops: travel is over the last fifteen frames */
  assert.equal(read(M, { L: stand(0.9), R: stand(1.1, { ankle: [1.58, 0.74] }) }).side, 'R');
});

test('a point named by where it is resolves each frame, on either side', () => {
  const M = compiled({ measurements: [
    { key: 'kn', kind: 'angle', a: 'hip', b: 'knee', c: 'ankle', band: { min: 'knMin' }, scale: [0, 180], settings: [{ key: 'knMin', label: 'k', min: 0, max: 180 }] },
    { key: 'up', kind: 'rise', a: 'lower.knee', b: 'upper.knee' },
    { key: 'gap', kind: 'distance', axis: 'x', a: 'back.ankle', b: 'front.ankle', per: ['hip', 'knee'], times: 100 },
  ] });
  let r = read(M, { L: stand(0.9), R: stand(1.1, { knee: [1.15, 0.5], ankle: [1.2, 0.6] }) });
  assert.ok(r.up > 30, 'the higher knee over the lower, whichever side: ' + r.up);
  r = read(M, { L: stand(0.9, { knee: [0.85, 0.5], ankle: [0.8, 0.6] }), R: stand(1.1) });
  assert.ok(r.up > 30, 'and the same with the other leg raised: ' + r.up);
  r = read(M, { L: stand(0.9), R: stand(1.1, { ankle: [1.3, 0.9] }) });
  assert.ok(r.gap > 0 && Math.abs(r.gap - 200) < 1, 'the front ankle ahead of the back one, as % of the thigh: ' + r.gap);
  r = read(M, { L: stand(0.9, { ankle: [0.7, 0.9] }), R: stand(1.1) });
  assert.ok(r.gap > 0, 'still positive with the other foot forward: the names follow the feet, not the sides');
  /* the words say which */
  assert.equal(W.pointWords('upper.knee'), 'the higher knee');
  assert.equal(W.pointWords('front.ankle', true), 'front ankle');
  assert.equal(W.describe(M.spec.measurements[1], M.spec).what, 'the higher knee over the lower knee (the line between the knees off level)');
});

test('the angle between two lines: parallel is zero, square is ninety, and it needs no facing', () => {
  const M = compiled({ measurements: [
    { key: 'kn', kind: 'angle', a: 'hip', b: 'knee', c: 'ankle', band: { min: 'knMin' }, scale: [0, 180], settings: [{ key: 'knMin', label: 'k', min: 0, max: 180 }] },
    { key: 'par', kind: 'lines', a: 'ankle', b: 'knee', c: 'hip', d: 'shoulder', band: { max: 'parMax' }, scale: [0, 180], settings: [{ key: 'parMax', label: 'p', min: 0, max: 90 }] },
  ], defaults: { knMin: 160, parMax: 15, holdTargetSec: 5 }, side: { pick: 'right' }, faults: [{ id: 'bent', measure: 'kn', side: 'below', label: 'Bent', text: 'Straighten' }, { id: 'lean', measure: 'par', side: 'above', label: 'Lean', text: 'x' }] });
  assert.ok(Math.abs(read(M, BOTH()).par) < 0.01, 'shin and trunk both upright: parallel');
  const leaning = { L: stand(0.9), R: stand(1.1, { shoulder: [1.3, 0.3] }) };   // the trunk leaning 45° on the right side
  const r = read(M, leaning);
  assert.ok(Math.abs(r.par - 45) < 0.01, 'the trunk at forty five to the shin: ' + r.par);
  const sq = { L: stand(0.9), R: stand(1.1, { shoulder: [1.3, 0.5] }) };
  assert.ok(Math.abs(read(M, sq).par - 90) < 0.01, 'square');
  const d = W.describe(M.spec.measurements[1], M.spec);
  assert.equal(d.what, 'the angle between the shin line (ankle to knee) and the trunk line (hip to shoulder)');
  assert.equal(d.unit, '°');
  assert.deepEqual(W.faultTemplate(M.spec, M.spec.measurements[1], 'above'), { label: 'Shin off the trunk', text: 'Keep the shin and the trunk parallel' });
  assert.match(W.ruleWords(M.spec, M.spec.measurements[1], null, M.spec.defaults), /must be at most 15°\.$/);
});

test('the checks: a pick by a joint names a plain joint, a lines measurement has four points, facing is never a point picked by where it is', () => {
  const at = (over) => Spec.check(file(over)).filter((p) => p.level === 'error').map((p) => p.at);
  assert.ok(at({ side: { pick: 'lowest' } }).includes('side.joint'), 'no joint');
  assert.ok(at({ side: { pick: 'moving', joint: 'upper.knee' } }).includes('side.joint'), 'a point by where it is cannot pick the side');
  assert.deepEqual(at({ side: { pick: 'front', joint: 'ankle', hold: { margin: 0.3, frames: 4 } } }), []);
  assert.ok(at({ measurements: [{ key: 'par', kind: 'lines', a: 'ankle', b: 'knee', c: 'hip' }], faults: [] }).includes('measurements[0].d'));
  assert.ok(at({ facing: { from: 'front.hip', to: 'back.hip' } }).includes('facing'));
  assert.deepEqual(at({ measurements: [{ key: 'up', kind: 'rise', a: 'lower.knee', b: 'upper.knee' }], faults: [] }), [], 'upper and lower are landmark names');
  assert.ok(Spec.PICKS.includes('moving') && Spec.KINDS.includes('lines'));
});
