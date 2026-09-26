'use strict';
/* The move, drawn: keyframes from joint angles, the planted foot held still,
   the wall on the right side, and a hold that does not move. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Figure = require('../public/js/figure.js');
const Moves = require('../public/js/moves.js');

test('a standing body from angles: head over hips, feet on the floor, limbs their own lengths', () => {
  const p = Figure.sidePose({ torso: 0, thigh: 0, shin: 0 });
  assert.ok(Math.abs(p.sh.x - p.hip.x) < 1e-9 && p.sh.y < p.hip.y, 'shoulder straight above the hip');
  assert.ok(Math.abs(Math.hypot(p.kn.x - p.hip.x, p.kn.y - p.hip.y) - Figure.L.thigh) < 1e-9, 'a thigh is a thigh long');
  assert.ok(Math.abs(Math.hypot(p.an.x - p.kn.x, p.an.y - p.kn.y) - Figure.L.shin) < 1e-9);
  assert.ok(p.ft.x > p.an.x, 'the toes point the way the body faces');
  const left = Figure.sidePose({ face: 'left', thigh: 40 });
  assert.ok(left.kn.x < left.hip.x, 'facing left, a forward thigh goes left');
});

test('the knee raise: the standing foot stays where it is while the other comes up', () => {
  const r = Figure.fromAngles(Moves.kneeraise.pose);
  assert.equal(r.anchor, 'ftF', 'the far foot is the one on the floor in both keyframes');
  assert.deepEqual(r.A.ftF, r.B.ftF, 'and it does not move');
  assert.ok(r.B.kn[1] < r.A.kn[1] - 20, 'the near knee comes up: ' + r.A.kn[1] + ' to ' + r.B.kn[1]);
  assert.ok(Math.abs(r.B.kn[1] - r.B.hip[1]) < 3, 'to hip height, a right angle');
  assert.ok(r.A.ft[1] > 155 && r.B.ftF[1] > 155, 'the floor is the floor');
  assert.equal(r.hold, false);
});

test('the wall sit: seated in the air, the wall behind, and it holds still', () => {
  /* the wall sit as angles: the file carries hand-set points now, but the angle form with a wall is still what a new file starts from */
  const WALLSIT_POSE = { A: { torso: 0, thigh: 90, shin: 0, uarm: 8, farm: 8 }, wall: 'behind', hold: true };
  const r = Figure.fromAngles(WALLSIT_POSE);
  assert.ok(Math.abs(r.A.kn[1] - r.A.hip[1]) < 3, 'thighs level');
  assert.ok(r.wall != null && r.wall < r.A.hip[0], 'the wall is behind a body facing right: ' + r.wall);
  assert.ok(r.wall < Math.min(r.A.sh[0], r.A.hip[0], r.A.ft[0]), 'and clear of every point');
  assert.equal(r.hold, true);
  const s = Figure.svg({ id: 'wallsit', name: 'Wall sit', pose: WALLSIT_POSE });
  assert.ok(!/animate/.test(s), 'a hold does not move');
  assert.match(s, /hold still/);
  assert.match(s, /x1="\d+" y1="30" x2="\d+" y2="162" stroke-width="4"/, 'the wall is drawn');
});

test('the plank faces left and lies low; the bridge comes as points and moves', () => {
  /* the plank as angles, facing left (its file carries hand-set points, which say the same) */
  const p = Figure.fromAngles({ A: { face: 'left', torso: 72, neck: -15, thigh: -80, shin: -80, foot: -60, uarm: -20, farm: 70 }, hold: true });
  assert.ok(p.A.h[0] < p.A.hip[0], 'head to the left of the hips');
  assert.ok(Figure.box(p).h < 100, 'a lying figure gets a low box');
  const pf = Figure.figureOf(Moves.plank);
  assert.ok(pf && pf.A.h[0] < pf.A.hip[0] && pf.hold, 'and the file\'s figure faces left and holds');
  const b = Figure.figureOf(Moves.bridge);
  assert.ok(b && b.A.hip && b.B.hip);
  assert.ok(b.B.hip[1] < b.A.hip[1], 'hips up in the second keyframe');
  const s = Figure.svg(Moves.bridge);
  assert.match(s, /<animate attributeName="d"/, 'and it moves');
  assert.match(s, /repeat slowly/);
  assert.match(s, /class="ink far"/, 'with the far limbs behind');
});

test('every move has a figure', () => {
  for (const m of Moves.list) assert.ok(Figure.svg(m).startsWith('<svg'), m.id);
});
