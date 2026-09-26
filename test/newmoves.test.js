'use strict';
/* The eight exercises built from published form standards (docs/standards.md),
   each held to a body posed to its own numbers: the start is the start, the top
   is in position, and each fault fires on the pose that is that fault, in the
   file's order. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const Moves = require('../public/js/moves.js');

const D = Math.PI / 180;
/* A side-on body from joint angles, in a frame `aspect` wide. Angles follow the
   figure's own convention: torso from vertical (+ the way the body faces), thigh
   and shin from straight down (+ forward), foot from horizontal-forward (+ toes
   up), arms from straight down. Both legs are given, near (the side measured is
   whichever the move picks) and far. facing +1 = the body faces the image right. */
function body(o) {
  const f = o.facing == null ? 1 : o.facing, aspect = o.aspect || 16 / 9;
  const L = { torso: 0.24, thigh: 0.19, shin: 0.19, foot: 0.07, heel: 0.02, uarm: 0.14, farm: 0.13 };
  const hip = { x: o.hipAt ? o.hipAt[0] : 1.0, y: o.hipAt ? o.hipAt[1] : 0.5 };
  const down = (p, a, len) => ({ x: p.x + f * Math.sin(a * D) * len, y: p.y + Math.cos(a * D) * len });
  const up = (p, a, len) => ({ x: p.x + f * Math.sin(a * D) * len, y: p.y - Math.cos(a * D) * len });
  const shoulder = up(hip, o.torso || 0, L.torso);
  const ear = up(shoulder, (o.torso || 0) + (o.neck || 0), 0.08);
  const elbow = down(shoulder, o.uarm == null ? 5 : o.uarm, L.uarm), wrist = down(elbow, o.farm == null ? 5 : o.farm, L.farm);
  const leg = (th, sh, ft) => {
    const knee = down(hip, th, L.thigh), ankle = down(knee, sh, L.shin);
    /* the heel a little below the ankle along the shin's line, the toe along the foot's own line */
    const heel = down(ankle, sh, L.heel);
    const toe = { x: heel.x + f * Math.cos(ft * D) * L.foot, y: heel.y - Math.sin(ft * D) * L.foot };
    return { knee, ankle, heel, toe };
  };
  const near = leg(o.thigh || 0, o.shin == null ? (o.thigh || 0) : o.shin, o.foot || 0);
  const far = leg(o.thighF == null ? (o.thigh || 0) : o.thighF, o.shinF == null ? (o.thighF == null ? (o.shin == null ? (o.thigh || 0) : o.shin) : o.thighF) : o.shinF, o.footF == null ? (o.foot || 0) : o.footF);
  const sides = { R: Object.assign({ shoulder, ear, elbow, wrist, hip }, near), L: Object.assign({ shoulder, ear, elbow, wrist, hip }, far) };
  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  for (const s of ['L', 'R']) for (const [name, i] of Object.entries(Core.SIDE[s])) { const p = sides[s][name]; if (p) lm[i] = { x: p.x / aspect, y: p.y, z: 0, visibility: 0.95 }; }
  return lm;
}
const run = (m, o, over) => {
  const cfg = Object.assign({}, Core.COMMON, m.defaults, over);
  const r = m.read(body(o), o.aspect || 16 / 9, cfg);
  return { r, v: m.judge(r, cfg), cfg };
};
const firstFault = (m, v) => m.faults.find((id) => v.faults[id] != null) || null;

/* lying on the back, head to the right: torso 90; a leg along the floor is -90 */
const SUPINE = { torso: 90, thigh: -90, shin: -90, foot: 90, thighF: -150, shinF: -30, footF: 90, uarm: -90, farm: -90, hipAt: [1.0, 0.7] };

test('straight leg raise: lying is the start, the height of the other knee is the top, the knee and the toes are coached first', () => {
  const M = Moves.slr;
  let { r, v } = run(M, SUPINE);
  assert.ok(r.ok && r.side === 'R', 'the straight leg is the one measured, whichever side: ' + r.side);
  assert.ok(Math.abs(r.knee - 180) < 1 && Math.abs(r.lift - 180) < 1, `lying flat: knee ${r.knee}, lift ${r.lift}`);
  assert.equal(v.atStart, true); assert.equal(v.raised, false);
  assert.ok(M.ready(r, v), 'and it is the start position');
  /* lifted 40 degrees: in position */
  /* the toes stay pulled toward the shin as the leg comes up, so the foot turns with it: 90 less the lift */
  ({ r, v } = run(M, Object.assign({}, SUPINE, { thigh: -130, shin: -130, foot: 50 })));
  assert.ok(Math.abs(r.lift - 140) < 1, 'a lift of forty reads 140 at the hip: ' + r.lift);
  assert.equal(v.raised, true); assert.equal(v.inPosition, true); assert.equal(firstFault(M, v), null);
  /* too high: 60 */
  ({ v } = run(M, Object.assign({}, SUPINE, { thigh: -150, shin: -150, foot: 30 })));
  assert.equal(firstFault(M, v), 'liftHigh');
  /* fifteen is not yet a rep; twenty two is under way, and short of the other knee */
  ({ v } = run(M, Object.assign({}, SUPINE, { thigh: -105, shin: -105, foot: 75 })));
  assert.equal(v.raised, false, 'fifteen is not yet under way');
  ({ v } = run(M, Object.assign({}, SUPINE, { thigh: -112, shin: -112, foot: 68 })));
  assert.equal(v.raised, true, 'twenty two is under way'); assert.equal(firstFault(M, v), 'liftLow');
  /* the knee bent on the way up, and the toes pointing: the knee comes first */
  ({ r, v } = run(M, Object.assign({}, SUPINE, { thigh: -130, shin: -105, foot: 175 })));
  assert.ok(r.knee < 160, 'a bent knee: ' + r.knee);
  assert.equal(firstFault(M, v), 'kneeBend');
  assert.ok(v.faults.toesDown != null, 'and the toes are on view too');
  assert.deepEqual(M.setup, ['kneeBend', 'toesDown'], 'both coached before the lift');
});

/* on the side facing the camera, head to the right: the same angles read as a side view of a body lying on its front-ish; the lift is the leg against the trunk */
test('side-lying leg raise: forty five is the top, past it is too high, the knee stays straight', () => {
  const M = Moves.sideraise;
  const LYING = { torso: 90, thigh: -90, shin: -90, foot: 0, thighF: -90, shinF: -90, footF: 0, uarm: -90, farm: -90, hipAt: [1.0, 0.7] };
  let { r, v } = run(M, LYING);
  assert.ok(r.ok && v.atStart && !v.raised, 'lying in line is the start: ' + JSON.stringify(v));
  ({ r, v } = run(M, Object.assign({}, LYING, { thigh: -135, shin: -135 })));
  assert.ok(r.side === 'R', 'the higher ankle is the leg measured');
  assert.ok(Math.abs(r.lift - 135) < 1, 'forty five reads 135: ' + r.lift);
  assert.equal(v.inPosition, true); assert.equal(firstFault(M, v), null);
  ({ v } = run(M, Object.assign({}, LYING, { thigh: -155, shin: -155 })));
  assert.equal(firstFault(M, v), 'liftHigh', 'sixty five is past the hip\'s own limit');
  ({ v } = run(M, Object.assign({}, LYING, { thigh: -135, shin: -110 })));
  assert.equal(firstFault(M, v), 'kneeBend');
});

test('prone leg raise: a hand\'s width is the top, higher is too high, the chest coming up is the back arching', () => {
  const M = Moves.proneraise;
  const PRONE = { torso: 90, thigh: -90, shin: -90, foot: -90, thighF: -90, shinF: -90, footF: -90, uarm: 140, farm: 60, hipAt: [1.0, 0.7] };
  let { r, v } = run(M, PRONE);
  assert.ok(r.ok && v.atStart && !v.raised && M.ready(r, v), 'flat is the start');
  ({ r, v } = run(M, Object.assign({}, PRONE, { thigh: -105, shin: -105 })));
  assert.ok(Math.abs(r.lift - 165) < 1, 'fifteen degrees reads 165: ' + r.lift);
  assert.equal(v.raised, true); assert.equal(v.inPosition, true); assert.equal(firstFault(M, v), null);
  ({ v } = run(M, Object.assign({}, PRONE, { thigh: -130, shin: -130 })));
  assert.equal(firstFault(M, v), 'liftHigh', 'forty is far too high');
  /* the shoulders lifted 20 degrees above the hips with a good lift: arching */
  ({ r, v } = run(M, Object.assign({}, PRONE, { torso: 70, thigh: -105, shin: -105 })));
  assert.ok(r.back > 12, 'the shoulders up: ' + r.back);
  assert.equal(firstFault(M, v), 'archBack');
});

test('inner thigh raise: the straight bottom leg is measured, a small lift is the top', () => {
  const M = Moves.innerraise;
  /* the top leg (far) bent with the foot planted in front; the bottom leg straight */
  const LYING = { torso: 90, thigh: -90, shin: -90, foot: 0, thighF: -130, shinF: -50, footF: 0, uarm: -90, farm: -90, hipAt: [1.0, 0.7] };
  let { r, v } = run(M, LYING);
  assert.ok(r.ok && r.side === 'R', 'the straight leg, not the bent one: ' + r.side);
  assert.ok(v.atStart && !v.raised);
  ({ r, v } = run(M, Object.assign({}, LYING, { thigh: -110, shin: -110 })));
  assert.ok(Math.abs(r.lift - 160) < 1, 'twenty degrees reads 160: ' + r.lift);
  assert.equal(v.inPosition, true); assert.equal(firstFault(M, v), null);
  ({ v } = run(M, Object.assign({}, LYING, { thigh: -130, shin: -130 })));
  assert.equal(firstFault(M, v), 'liftHigh');
});

test('forward lunge: the front leg is the one measured, a right angle over the ankle is the bottom, the knee past the toes and the trunk are called', () => {
  const M = Moves.lunge;
  const STAND = { torso: 0, thigh: 0, shin: 0, foot: 0, thighF: 0, shinF: 0, footF: 0 };
  let { r, v } = run(M, STAND, {}, 9 / 16);
  assert.ok(r.ok && v.atStart && !v.raised && M.ready(r, v), 'standing is the start: ' + JSON.stringify(v));
  /* the bottom: front thigh level, shin plumb; back thigh behind, back shin along the floor */
  const BOTTOM = { torso: 3, thigh: 90, shin: 0, foot: 0, thighF: -35, shinF: -110, footF: 60 };
  ({ r, v } = run(M, BOTTOM));
  assert.equal(r.side, 'R', 'the leg reaching forward is the front leg');
  assert.ok(Math.abs(r.knee - 90) < 1 && Math.abs(r.shin) < 1, `a right angle over the ankle: knee ${r.knee}, shin ${r.shin}`);
  assert.equal(v.raised, true); assert.equal(v.inPosition, true); assert.equal(firstFault(M, v), null);
  /* the knee drifting past the toes: the shin leans forward 30 */
  ({ r, v } = run(M, Object.assign({}, BOTTOM, { thigh: 60, shin: -30 })));
  assert.ok(r.shin > 25, 'the shin well forward: ' + r.shin);
  assert.equal(firstFault(M, v), 'kneeOver');
  /* leaning over the front leg, with a good knee */
  ({ v } = run(M, Object.assign({}, BOTTOM, { torso: 25 })));
  assert.equal(firstFault(M, v), 'leanFwd');
  /* not low enough: front knee at 130 */
  ({ r, v } = run(M, Object.assign({}, BOTTOM, { thigh: 50, shin: 0 })));
  assert.ok(Math.abs(r.knee - 130) < 1);
  assert.equal(v.raised, false, 'a shallow bend is not yet a rep');
  ({ r, v } = run(M, Object.assign({}, BOTTOM, { thigh: 70, shin: 0 })));
  assert.equal(v.raised, true); assert.equal(firstFault(M, v), 'kneeShallow');
});

test('static quads: pulling the toes up starts the contraction, letting go ends it, a bent knee is the fault', () => {
  const M = Moves.quadset;
  const RELAXED = Object.assign({}, SUPINE, { foot: 115 });   // a foot fallen away from the head by 25 degrees
  let { r, v } = run(M, RELAXED);
  assert.ok(r.ok && v.atStart && !v.raised && M.ready(r, v), 'relaxed is the start: foot ' + r.foot);
  ({ r, v } = run(M, Object.assign({}, SUPINE, { foot: 95 })));
  assert.ok(r.foot < 98, 'toes pulled up: ' + r.foot);
  assert.equal(v.raised, true); assert.equal(v.inPosition, true); assert.equal(firstFault(M, v), null);
  ({ r, v } = run(M, Object.assign({}, SUPINE, { foot: 95, shin: -75 })));
  assert.ok(r.knee < 170, 'a knee not pressed down: ' + r.knee);
  assert.equal(firstFault(M, v), 'kneeBend');
});

test('dynamic quads: sitting is the start, locked out is the top, the thigh lifting and leaning back are called', () => {
  const M = Moves.kneeext;
  const SIT = { torso: 0, thigh: 90, shin: 0, foot: 0, thighF: 90, shinF: 0, footF: 0, uarm: 10, farm: 30 };
  let { r, v } = run(M, SIT, {}, 9 / 16);
  assert.ok(r.ok && Math.abs(r.knee - 90) < 1 && v.atStart && !v.raised && M.ready(r, v), 'sitting: ' + r.knee);
  ({ r, v } = run(M, Object.assign({}, SIT, { shin: 90, foot: 80 })));
  assert.equal(r.side, 'R', 'the straightened leg is measured');
  assert.ok(Math.abs(r.knee - 180) < 1 && Math.abs(r.thigh) < 1, `locked out with the thigh level: ${r.knee}, ${r.thigh}`);
  assert.equal(v.raised, true); assert.equal(v.inPosition, true); assert.equal(firstFault(M, v), null);
  /* the thigh lifting off the seat: the knee 20 above the hip */
  ({ r, v } = run(M, Object.assign({}, SIT, { thigh: 110, shin: 110, foot: 80 })));
  assert.ok(r.thigh > 12, 'the knee above the hip: ' + r.thigh);
  assert.equal(firstFault(M, v), 'thighLift');
  /* leaning back to help */
  ({ v } = run(M, Object.assign({}, SIT, { torso: -25, shin: 90, foot: 80 })));
  assert.equal(firstFault(M, v), 'leanBack');
  /* not straightened fully */
  ({ r, v } = run(M, Object.assign({}, SIT, { shin: 60, foot: 80 })));
  assert.ok(Math.abs(r.knee - 150) < 1);
  assert.equal(v.raised, true); assert.equal(firstFault(M, v), 'kneeShort');
});

test('step-up: the leg on the step is measured, standing tall on it is the top, folding forward and a knee past the toes are called', () => {
  const M = Moves.stepup;
  /* the near foot on a knee-high step: thigh 60 forward, shin near plumb; the far leg on the floor */
  const START = { torso: 8, thigh: 65, shin: 5, foot: 0, thighF: 0, shinF: 0, footF: 0 };
  let { r, v } = run(M, START, {}, 9 / 16);
  assert.equal(r.side, 'R', 'the raised thigh is the leg on the step');
  assert.ok(r.knee > 110 && r.knee < 130 && v.atStart && !v.raised && M.ready(r, v), `bent on the step: knee ${r.knee}, ${JSON.stringify(v)}`);
  const TOP = { torso: 0, thigh: 0, shin: 0, foot: 0, thighF: 0, shinF: 0, footF: 0 };
  ({ r, v } = run(M, TOP));
  assert.equal(v.raised, true); assert.equal(v.inPosition, true); assert.equal(firstFault(M, v), null);
  /* stood up but still bent forward at the hip */
  ({ r, v } = run(M, Object.assign({}, TOP, { torso: 15, thigh: 10 })));
  assert.ok(r.hip < 160, 'the hip short: ' + r.hip);
  assert.equal(firstFault(M, v), 'hipBent');
  /* at the start, throwing the trunk at the step, with the knee well past the toes */
  ({ r, v } = run(M, Object.assign({}, START, { torso: 30, thigh: 60, shin: -40 })));
  assert.equal(firstFault(M, v), 'kneeOver', 'the shin first: it is the base');
  assert.ok(v.faults.leanFwd != null, 'and the lean is on view');
  assert.deepEqual(M.setup, ['kneeOver', 'leanFwd']);
});

test('every new exercise carries what the page and the voice need', () => {
  for (const id of ['slr', 'sideraise', 'proneraise', 'innerraise', 'lunge', 'quadset', 'kneeext', 'stepup']) {
    const m = Moves[id];
    assert.ok(m, id + ' is in the library');
    assert.ok(m.reps && m.prompts.length === 1 && m.cues.lower && m.cues.early, id + ': a rep move');
    assert.ok(m.start.length <= 160, id + ': the opening words are short enough');
    assert.ok(m.howto.length >= 3 && m.cannot && m.about && m.safety, id + ': the words');
    assert.ok(m.pose || m.figure, id + ': a figure');
    assert.ok(m.tags.length >= 3, id + ': tags for the search');
    for (const f of m.faults) if (f !== 'lost' && !m.prompts.includes(f)) assert.ok(m.cues[f].label.length <= 26, id + ': ' + f + ' label');
  }
});
