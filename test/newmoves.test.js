'use strict';
/* The eight exercises built from published form standards (docs/standards.md),
   each held to a body posed to its own numbers: the start is the start, the top
   is in position, and each fault fires on the pose that is that fault, in the
   file's order. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const Moves = require('../public/js/moves.js');
const Spec = require('../public/js/spec.js');

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
    const fl = o.footLen == null ? L.foot : o.footLen;   // the foot's length in the picture: long when seen in profile
    const toe = { x: heel.x + f * Math.cos(ft * D) * fl, y: heel.y - Math.sin(ft * D) * fl };
    return { knee, ankle, heel, toe };
  };
  const near = leg(o.thigh || 0, o.shin == null ? (o.thigh || 0) : o.shin, o.foot || 0);
  const far = leg(o.thighF == null ? (o.thigh || 0) : o.thighF, o.shinF == null ? (o.thighF == null ? (o.shin == null ? (o.thigh || 0) : o.shin) : o.thighF) : o.shinF, o.footF == null ? (o.foot || 0) : o.footF);
  const sides = { R: Object.assign({ shoulder, ear, elbow, wrist, hip }, near), L: Object.assign({ shoulder, ear, elbow, wrist, hip }, far) };
  const hide = new Set(o.hide || []);
  /* `tilt` turns the whole body about the hip, as a phone not laid level would */
  const t = (o.tilt || 0) * D, turn = (p) => (!t ? p : { x: hip.x + (p.x - hip.x) * Math.cos(t) - (p.y - hip.y) * Math.sin(t), y: hip.y + (p.x - hip.x) * Math.sin(t) + (p.y - hip.y) * Math.cos(t) });
  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  for (const s of ['L', 'R']) for (const [name, i] of Object.entries(Core.SIDE[s])) { const p = sides[s][name]; if (p) { const q = turn(p); lm[i] = { x: q.x / aspect, y: q.y, z: 0, visibility: hide.has(name) || hide.has(s + '.' + name) ? 0.1 : 0.95 }; } }
  return lm;
}
const run = (m, o, over) => {
  if (m.reset) m.reset();   // each posed body is a session of its own: no side held from the last
  const cfg = Object.assign({}, Core.COMMON, m.defaults, over);
  const r = m.read(body(o), o.aspect || 16 / 9, cfg);
  return { r, v: m.judge(r, cfg), cfg };
};
const firstFault = (m, v) => m.faults.find((id) => v.faults[id] != null) || null;

/* lying on the back, head to the right: torso 90; a leg along the floor is -90 */
const SUPINE = { torso: 90, thigh: -90, shin: -90, foot: 90, thighF: -90, shinF: -90, footF: 90, uarm: -90, farm: -90, hipAt: [1.0, 0.7] };
/* the foot turns with a lifted leg: toes toward the shin is 90 less the lift */
const lifted = (deg, over) => Object.assign({}, SUPINE, { thigh: -90 - deg, shin: -90 - deg, foot: 90 - deg }, over);

test('straight leg raise: both legs straight, the lift measured against the resting leg, feet to shoulders in the picture', () => {
  const M = Moves.slr;
  let { r, v } = run(M, SUPINE);
  assert.ok(r.ok, 'read');
  assert.ok(Math.abs(r.knee - 180) < 1 && Math.abs(r.lift) < 1 && Math.abs(r.rest - 180) < 1, `both flat: knee ${r.knee}, lift ${r.lift}, rest ${r.rest}`);
  assert.equal(v.atStart, true); assert.equal(v.raised, false);
  assert.ok(M.ready(r, v), 'and it is the start position');
  /* forty degrees: in position; the lifted leg is the one measured, whichever side */
  ({ r, v } = run(M, lifted(40)));
  assert.equal(r.side, 'R', 'the higher knee');
  assert.ok(Math.abs(r.lift - 40) < 1, 'a lift of forty reads forty against the other leg: ' + r.lift);
  assert.equal(v.raised, true); assert.equal(v.inPosition, true); assert.equal(firstFault(M, v), null);
  assert.ok(Math.abs(r.foot - 90) < 1, 'toes up reads the same lifted: ' + r.foot);
  /* the edges: thirty and forty five are in, twenty and fifty five are not */
  assert.equal(firstFault(M, run(M, lifted(30)).v), null); assert.equal(firstFault(M, run(M, lifted(45)).v), null);
  assert.equal(firstFault(M, run(M, lifted(25)).v), 'liftLow'); assert.equal(firstFault(M, run(M, lifted(55)).v), 'liftHigh');
  assert.equal(firstFault(M, run(M, lifted(47)).v), null, 'a couple of degrees past forty five is the model\'s wobble, not a fault');
  /* at rest the model reads the two knees a little apart: twelve is still the start; twenty five is under way */
  assert.equal(run(M, lifted(12)).v.atStart, true, 'twelve is the start'); assert.equal(run(M, lifted(12)).v.raised, false);
  assert.equal(run(M, lifted(25)).v.raised, true, 'twenty five is under way');
  /* the knee bent on the way up, and the toes pointing: the knee comes first */
  ({ r, v } = run(M, lifted(40, { shin: -105, foot: 175 })));
  assert.ok(r.knee < 160, 'a bent knee: ' + r.knee);
  assert.equal(firstFault(M, v), 'kneeBend');
  assert.ok(v.faults.toesDown != null, 'and the toes are on view too');
  assert.deepEqual(M.setup, ['kneeBend', 'toesDown', 'restBend'], 'all three coached before the lift');
  /* the resting leg bending or lifting is called */
  ({ r, v } = run(M, lifted(40, { thighF: -120, shinF: -60 })));
  assert.ok(r.rest < 160, 'the other knee bent: ' + r.rest);
  assert.equal(firstFault(M, v), 'restBend');
  /* the shoulders out of the picture: feet to shoulders have to be in, so the frame is refused rather than judged */
  ({ r, v } = run(M, lifted(40, { hide: ['shoulder', 'ear', 'elbow', 'wrist'] })));
  assert.ok(!r.ok && !v.ok, 'not judged without the shoulders: ' + JSON.stringify({ ok: r.ok, why: r.why }));
  /* and the phone not level: the whole body turned ten degrees reads the same lift */
  ({ r, v } = run(M, lifted(40, { tilt: 10 })));
  assert.ok(Math.abs(r.lift - 40) < 1, 'the lift against the other leg does not move with the phone: ' + r.lift);
  /* both legs down, the far knee hidden behind the near one (the far side is L): still the start, not a lost frame */
  ({ r, v } = run(M, Object.assign({}, SUPINE, { hide: ['L.knee'] })));
  assert.ok(r.ok, 'the frame stands without the far knee');
  assert.equal(r.lift, 0, 'a leg the camera cannot see beside its twin is lying on it: ' + r.lift);
  assert.equal(v.atStart, true); assert.ok(M.ready(r, v), 'and it is the start');
  /* a lift with the far knee hidden is not a lift: the reference has to be seen */
  ({ r, v } = run(M, lifted(40, { hide: ['L.knee'] })));
  assert.equal(r.lift, 0); assert.equal(v.raised, false);
});

test('the side measured is held: level knees wobbling do not flip it, a real lift on the other side takes it within five frames', () => {
  const M = Moves.slr; M.reset();
  const cfg = Object.assign({}, Core.COMMON, M.defaults);
  const sideOf = (o) => M.read(body(o), 16 / 9, cfg).side;
  const first = sideOf(SUPINE);
  const other = first === 'R' ? 'L' : 'R';
  /* the other knee a few degrees up one frame and down the next: the model's wobble, not a new side */
  let flips = 0, prev = first;
  for (let i = 0; i < 20; i++) {
    const o = other === 'L' ? { thighF: -90 - (i % 2 ? 4 : -4) } : { thigh: -90 - (i % 2 ? 4 : -4), shin: -90 - (i % 2 ? 4 : -4) };
    const s = sideOf(Object.assign({}, SUPINE, o)); if (s !== prev) flips++; prev = s;
  }
  assert.equal(flips, 0, 'held through the wobble');
  /* the other leg lifted forty degrees: measured from the fifth frame */
  const up = other === 'L' ? { thighF: -130, shinF: -130, footF: 50 } : { thigh: -130, shin: -130, foot: 50 };
  const seen = [];
  for (let i = 0; i < 7; i++) seen.push(sideOf(Object.assign({}, SUPINE, up)));
  assert.deepEqual(seen.slice(0, 4), [first, first, first, first], 'four frames of lead are not yet a switch: ' + seen.join(''));
  assert.deepEqual(seen.slice(4), [other, other, other], 'the fifth is: ' + seen.join(''));
  /* a new coach starts the move afresh: the other knee a little higher is picked at once */
  new Core.Coach(M);
  const fresh = other === 'L' ? { thighF: -94 } : { thigh: -94, shin: -94 };
  assert.equal(sideOf(Object.assign({}, SUPINE, fresh)), first === 'L' ? 'R' : 'L', 'nothing held from before');
  assert.ok(M.spec.side.hold && M.spec.side.hold.frames === 5, 'from the file');
});

/* on the side facing the camera, head to the right: the same angles read as a side view of a body lying on its front-ish; the lift is the leg against the trunk */
test('side-lying leg raise: forty five is the top, past it is too high, the knee stays straight', () => {
  const M = Moves.sideraise;
  /* the foot short in the picture, as a foot pointing at the phone shows: a fifth of the shin */
  const LYING = { torso: 90, thigh: -90, shin: -90, foot: 0, thighF: -90, shinF: -90, footF: 0, uarm: -90, farm: -90, hipAt: [1.0, 0.7], footLen: 0.04 };
  let { r, v } = run(M, LYING);
  assert.ok(r.ok && v.atStart && !v.raised, 'lying in line is the start: ' + JSON.stringify(v));
  ({ r, v } = run(M, Object.assign({}, LYING, { thigh: -135, shin: -135 })));
  assert.ok(r.side === 'R', 'the higher ankle is the leg measured');
  assert.ok(Math.abs(r.lift - 135) < 1, 'forty five reads 135: ' + r.lift);
  assert.equal(v.inPosition, true); assert.equal(firstFault(M, v), null);
  ({ v } = run(M, Object.assign({}, LYING, { thigh: -155, shin: -155 })));
  assert.equal(firstFault(M, v), 'liftHigh', 'sixty five is past the hip\'s own limit');
  ({ v } = run(M, Object.assign({}, LYING, { thigh: -135, shin: -110 })));
  assert.equal(firstFault(M, v), null, 'twenty five off straight reads 155: the edge, and from the front the model reads this knee a few degrees under');
  ({ v } = run(M, Object.assign({}, LYING, { thigh: -135, shin: -100 })));
  assert.equal(firstFault(M, v), 'kneeBend', 'thirty five off straight is a bend');
  /* the toes, during a rep: judged by how long the foot shows against the shin — short is
     pointing at the phone (pulled back), long is laid along the leg (pointing away) */
  const UP = Object.assign({}, LYING, { thigh: -135, shin: -135 });
  ({ r, v } = run(M, Object.assign({}, UP, { footLen: 0.12 })));
  assert.ok(Math.abs(r.footlen - 63) < 2, 'twelve over nineteen: ' + r.footlen);
  assert.ok(v.faults.toesAway > 0, 'long in the picture: toes away');
  assert.equal(v.inPosition, true, 'and the position is still the lift and the knee: the count goes on');
  ({ r, v } = run(M, Object.assign({}, UP, { footLen: 0.07 })));
  assert.ok(Math.abs(r.footlen - 37) < 2 && v.faults.toesAway > 0, 'thirty seven is past thirty');
  ({ r, v } = run(M, UP));
  assert.ok(r.footlen < 30 && v.faults.toesAway == null, 'a fifth of the shin: pointing at the phone, nothing called');
  assert.equal(r.foot, null, 'the angle at the heel is drawn only once the foot is in profile');
  ({ r } = run(M, Object.assign({}, UP, { footLen: 0.12 })));
  assert.ok(r.foot != null, 'and then it is: ' + r.foot);
  assert.ok(M.spec.defaults.footLenMax === 30 && M.spec.defaults.kneeMin === 155);
  assert.deepEqual(M.setup, ['kneeBend'], 'the toes are a rep fault, not a set-up one');
  assert.ok(!M.setup.includes('toesAway') && M.faults.includes('toesAway'));
  /* through the smoothing, a closed gate is still null — the last value is not held — and it starts afresh when it opens */
  const sm = new Core.Smoother(0.35); const cfg2 = Object.assign({}, Core.COMMON, M.defaults);
  const long = sm.apply(M.read(body(Object.assign({}, UP, { footLen: 0.12 })), 16 / 9, cfg2));
  assert.ok(long.foot != null, 'read: ' + long.foot);
  const short = sm.apply(M.read(body(UP), 16 / 9, cfg2));
  assert.equal(short.foot, null, 'gate closed: null, not the last reading');
});

test('prone leg raise: a hand\'s width is the top, higher is too high, the chest coming up is the back arching', () => {
  const M = Moves.proneraise;
  /* one frame at a time: the foot's length against its peak needs a run, so its fault is left to the run below */
  const single = (v) => M.faults.find((id) => v.faults[id] != null && id !== 'legDiagonal') || null;
  /* face down, head to the right; the toes pointed straight back along the floor (the foot's angle is absolute, so a lifted leg's toes stay pointed) */
  const PRONE = { torso: 90, thigh: -90, shin: -90, foot: -180, thighF: -90, shinF: -90, footF: -180, uarm: 140, farm: 60, hipAt: [1.0, 0.7] };
  let { r, v } = run(M, PRONE);
  assert.ok(r.ok && v.atStart && !v.raised && M.ready(r, v), 'flat is the start');
  ({ r, v } = run(M, Object.assign({}, PRONE, { thigh: -105, shin: -105 })));
  assert.ok(Math.abs(r.lift - 165) < 1, 'fifteen degrees reads 165: ' + r.lift);
  assert.equal(v.raised, true); assert.equal(v.inPosition, true); assert.equal(single(v), null);
  ({ v } = run(M, Object.assign({}, PRONE, { thigh: -130, shin: -130 })));
  assert.equal(single(v), 'liftHigh', 'forty is far too high');
  /* the shoulders lifted 20 degrees above the hips with a good lift: arching */
  ({ r, v } = run(M, Object.assign({}, PRONE, { torso: 70, thigh: -105, shin: -105 })));
  assert.ok(r.back > 12, 'the shoulders up: ' + r.back);
  assert.equal(single(v), 'archBack');
  /* through the rep: the hip coming off the floor, the toes pulled up, the leg swinging out of the camera's plane */
  const topOnly = (v) => M.faults.find((id) => v.faults[id] != null && M.when[id] !== 'between' && id !== 'legDiagonal') || null;
  ({ r, v } = run(M, Object.assign({}, PRONE, { torso: 100, thigh: -115, shin: -115 })));
  assert.ok(r.hip > 6, 'the hip above the shoulder: ' + r.hip);
  assert.ok(v.faults.hipLift != null, 'hip lifting'); assert.equal(M.when.hipLift, 'rep');
  ({ r, v } = run(M, Object.assign({}, PRONE, { thigh: -105, shin: -105, foot: -90 })));
  assert.ok(r.foot < 140, 'toes pulled up toward the shin: ' + r.foot);
  assert.equal(topOnly(v), 'toesBent');
  assert.deepEqual(M.needed, ['shoulder', 'hip', 'knee', 'ankle', 'heel', 'toe'], 'feet to shoulders in the picture');
  for (const id of ['slr', 'quadset']) assert.ok(Moves[id].needed.includes('shoulder') && Moves[id].needed.includes('toe'), id + ' needs feet to shoulders');
  /* the foot's length against the most it has been: the same leg lifted with the toe pulled in toward the heel by a fifth reads 80% — the leg has gone diagonal */
  const Trace = require('../public/js/trace.js');
  const frames = []; let t = 0;
  const push = (o, ms, shrink) => { for (const end = t + ms; t < end; t += 33) { const lm = body(o); if (shrink) { const he = lm[Core.SIDE.R.heel], to = lm[Core.SIDE.R.toe]; lm[Core.SIDE.R.toe] = Object.assign({}, to, { x: he.x + (to.x - he.x) * shrink, y: he.y + (to.y - he.y) * shrink }); } frames.push({ t, lm }); } };
  push(PRONE, 3000); push(Object.assign({}, PRONE, { thigh: -105, shin: -105 }), 1500); push(Object.assign({}, PRONE, { thigh: -105, shin: -105 }), 1500, 0.8);
  const res = Trace.run(M, {}, frames, 16 / 9);
  const late = res.rows.filter((row) => row.t >= 5000 && row.reading && row.reading.ok);
  assert.ok(late.length && late.every((row) => row.reading.footlen < 85), 'the foot four fifths of its longest: ' + late.map((row) => Math.round(row.reading.footlen)).slice(0, 3));
  assert.ok(late.some((row) => row.verdict.faults.legDiagonal != null), 'and the leg is called diagonal');
  const early = res.rows.filter((row) => row.t > 500 && row.t < 4400 && row.reading && row.reading.ok);
  assert.ok(early.every((row) => row.reading.footlen > 95), 'in line, the foot keeps its length: ' + early.map((row) => Math.round(row.reading.footlen)).slice(0, 3));
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

test('static quads over a roll: the knee bent at rest, straight with the heel up and the toes pulled at the top, the roll judged between reps', () => {
  const M = Moves.quadset;
  /* the verdict holds every fault; the coach judges the rest ones between reps and the others at the top */
  const topFault = (v) => M.faults.find((id) => v.faults[id] != null && M.when[id] !== 'between') || null;
  /* the working leg over the roll: the knee up a little, bent to about 150; the other leg straight on the floor */
  const REST = Object.assign({}, SUPINE, { thigh: -105, shin: -75, foot: 95 });
  let { r, v } = run(M, REST);
  assert.ok(r.ok && r.knee > 140 && r.knee < 160, 'bent over the roll: ' + r.knee);
  assert.equal(r.side, 'R', 'the leg over the roll — the higher knee — is the one measured');
  assert.ok(v.atStart && !v.raised && M.ready(r, v), 'and that is the start');
  assert.equal(v.faults.propLow, undefined, 'the roll is right at rest');   // the knee is not straight, but that is judged at the top only
  /* the leg nearly straight at rest: the roll is too low — said between reps, and not the start */
  ({ r, v } = run(M, Object.assign({}, SUPINE, { thigh: -94, shin: -86, foot: 95 })));
  assert.ok(r.knee > 160, 'nearly straight: ' + r.knee);
  assert.equal(firstFault(M, v), 'propLow');
  assert.equal(M.when.propLow, 'between', 'judged only at rest');
  assert.ok(!M.ready(r, v), 'not the start: the coach asks for the roll instead');
  assert.match(M.cues.notready.text, /prop the knee higher/i);
  /* the top: straight, heel off the floor, toes pulled up */
  ({ r, v } = run(M, Object.assign({}, SUPINE, { thigh: -100, shin: -100, foot: 65 })));
  assert.ok(r.knee > 175 && r.foot < 100, `straight with the toes up: ${r.knee}, ${r.foot}`);
  assert.equal(v.raised, true); assert.equal(v.inPosition, true); assert.equal(topFault(v), null);
  /* straight but the toes not pulled up; or not quite straight */
  ({ r, v } = run(M, Object.assign({}, SUPINE, { thigh: -100, shin: -100, foot: 110 })));
  assert.equal(topFault(v), 'toesLoose');
  ({ r, v } = run(M, Object.assign({}, SUPINE, { thigh: -102, shin: -90, foot: 65 })));
  assert.ok(r.knee > 160 && r.knee < 170, 'not locked out: ' + r.knee);
  assert.equal(v.raised, true); assert.equal(topFault(v), 'kneeBend');
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

test('a measurement read against the start: no change until the set-up wait ends, then the change or the percent of it', () => {
  /* a length seen by the camera, as a share of the shin: the foot at the start, then three times longer */
  const file = Spec.blank();
  file.id = 'reach'; file.name = 'Reach'; file.position = 'lying';
  file.landmarks = { joints: ['hip', 'knee', 'ankle', 'heel', 'toe'], needed: ['hip', 'knee', 'ankle', 'heel', 'toe'], bones: [['hip', 'knee'], ['knee', 'ankle']], dots: ['hip', 'knee', 'ankle'], limb: {} };
  file.measurements = [{ key: 'foot', label: 'foot length, % of its start', hud: 'FOOT', kind: 'distance', a: 'toe', b: 'heel', per: ['knee', 'ankle'], times: 100, fromStart: 'ratio', band: { lo: 'footMin', hi: 'footMax' }, scale: [0, 400], settings: [{ key: 'footMin', label: 'at the top, at least', min: 100, max: 400 }, { key: 'footMax', label: 'at the top, at most', min: 100, max: 500 }] }];
  file.progress = { measure: 'foot', raiseAt: 'raiseAt', downAt: 'downAt', direction: 'up' };
  file.prompt = { id: 'raise', text: 'Reach' };
  file.faults = [{ id: 'footShort', measure: 'foot', side: 'below', label: 'Short', text: 'Further', tone: 'up' }];
  file.draw = []; file.settings = [];
  file.defaults = { footMin: 250, footMax: 400, raiseAt: 180, downAt: 130, holdTargetSec: 0, callAtSec: [], repCount: 10, setCount: 1, lowerSec: 0, restSec: 0, deepAt: 10 };
  assert.deepEqual(Spec.check(file).filter((p) => p.level === 'error'), [], 'a whole file');
  const M = Spec.compile(file, Core);
  assert.deepEqual(M.fromStart, [{ key: 'foot', how: 'ratio' }]);
  const c = new Core.Coach(M), sm = new Core.Smoother(1);
  const at = (o, t) => c.step(sm.apply(M.read(body(o), 16 / 9, c.cfg)), t);
  /* a long foot to begin with: the reading is 100 — no change — whatever the length, so the wait can end */
  let out; for (let t = 0; t < 2600; t += 33) out = at(Object.assign({}, SUPINE, { footLen: 0.06 }), t);
  assert.equal(out.ready, true, 'the wait ended on a reading of no change');
  assert.ok(Math.abs(out.reading.foot - 100) < 0.01, 'at the start: ' + out.reading.foot);
  /* then the foot three times longer in the picture: three hundred percent of its start */
  for (let t = 2600; t < 3600; t += 33) out = at(Object.assign({}, SUPINE, { footLen: 0.18 }), t);
  assert.ok(Math.abs(out.reading.foot - 300) < 0.01, 'three times: ' + out.reading.foot);
  assert.equal(out.phase, 'lower', 'past raiseAt and within the band: the top, and no hold asked for');
  for (let t = 3600; t < 4600; t += 33) out = at(Object.assign({}, SUPINE, { footLen: 0.06 }), t);
  assert.equal(c.reps, 1, 'back to the start: a rep');
  /* "change" is the difference */
  file.measurements[0].fromStart = 'change'; file.defaults.raiseAt = 150; file.defaults.downAt = 30; file.defaults.footMin = 150; file.defaults.footMax = 300;
  const M2 = Spec.compile(file, Core), c2 = new Core.Coach(M2), sm2 = new Core.Smoother(1);
  for (let t = 0; t < 2600; t += 33) out = c2.step(sm2.apply(M2.read(body(Object.assign({}, SUPINE, { footLen: 0.06 })), 16 / 9, c2.cfg)), t);
  assert.ok(Math.abs(out.reading.foot) < 0.01, 'no change at the start');
  for (let t = 2633; t < 2800; t += 33) out = c2.step(sm2.apply(M2.read(body(Object.assign({}, SUPINE, { footLen: 0.18 })), 16 / 9, c2.cfg)), t);   // three frames: the median of three needs them
  assert.ok(Math.abs(out.reading.foot - (0.18 - 0.06) / 0.19 * 100) < 3, 'the change, in the measurement\'s own units (percent points of the shin): ' + out.reading.foot);
});
