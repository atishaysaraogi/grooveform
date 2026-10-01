'use strict';
/* The muscle figure's front: which side of the hip→shoulder line the belly is drawn on.
   The pose says (the knee leads the front), but once per figure, from the keyframe where
   the leg leads more clearly — not frame by frame, which flipped the torso's muscles
   mid-animation when a leg lying almost in line with the body at one end of the movement
   was lifted at the other. A figure may carry `belly` and settle it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ctx = { matchMedia: () => ({ matches: true }), requestAnimationFrame() {}, document: { createElement: () => ({ getContext: () => null }) } };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'anatomy.js'), 'utf8'), ctx);
const A = ctx.OnTrackAnatomy;
const Spec = require('../public/js/spec.js');
const file = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'exercises', id + '.json'), 'utf8'));
const keyframes = (id) => { const p = file(id).figure.points; return [A.unify(p.A, 'side'), A.unify(p.B || p.A, 'side'), p]; };

test('the prone leg raise: the knee says one side at the start and the other at the top, and the figure is decided once, face down', () => {
  const [a, b, p] = keyframes('proneraise');
  const leans = [];
  for (let k = 0; k <= 1.001; k += 0.25) leans.push(Math.sign(A.bellyLean(A.tween(a, b, k, 'side'))));
  assert.ok(leans.includes(1) && leans.includes(-1), 'frame by frame the knee changes sides: ' + leans.join(' '));
  assert.equal(A.bellyOf(a, b), 1, 'the lifted leg at B leads more clearly than the resting one at A');
  assert.equal(p.belly, 1, 'and the file says so outright: the belly toward the floor');
});

test('the belly is the side the leg leads more clearly on, whichever keyframe that is', () => {
  const torso = { hip: { x: 100, y: 100 }, sh: { x: 160, y: 100 } };   // pointing right: +1 is down
  const nearLine = Object.assign({ kn: { x: 70, y: 98 } }, torso);     // 2 above
  const lifted = Object.assign({ kn: { x: 70, y: 115 } }, torso);      // 15 below
  assert.equal(A.bellyOf(nearLine, lifted), 1);
  assert.equal(A.bellyOf(lifted, nearLine), 1, 'the same the other way round');
  assert.equal(A.bellyOf(nearLine, null), -1, 'alone, the near one says');
  assert.equal(A.bellyOf(torso, null), 1, 'nothing to say: the default');
});

test('every lying or kneeling side-view figure in the library faces the floor or the ceiling as its position says', () => {
  const faces = (id) => { const [a, b, p] = keyframes(id); const s = p.belly === 1 || p.belly === -1 ? p.belly : A.bellyOf(a, b); const tdx = a.sh.x - a.hip.x, tdy = a.sh.y - a.hip.y, L = Math.hypot(tdx, tdy); const vy = (tdx / L) * s; return vy > 0.5 ? 'down' : vy < -0.5 ? 'up' : 'level'; };
  assert.equal(faces('proneraise'), 'down');
  assert.equal(faces('plank'), 'down');
  assert.equal(faces('quadset'), 'up');
  assert.equal(faces('bridge'), 'up');
  assert.equal(faces('wallsit'), 'level');
});

test('the checker takes belly as 1 or -1 only', () => {
  const f = file('proneraise');
  assert.equal(Spec.check(f).filter((p) => p.at === 'figure').length, 0);
  f.figure.points.belly = 2;
  assert.match(Spec.check(f).find((p) => p.at === 'figure').message, /1 or -1/);
  delete f.figure.points.belly;
  assert.equal(Spec.check(f).filter((p) => p.at === 'figure').length, 0, 'left out is the pose\'s call');
});
