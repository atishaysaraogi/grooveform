'use strict';
// The spec compiler is what turns a Studio session into a move. These tests hold that a declarative
// spec compiles into a move the library accepts, counts reps and fires faults the way the numbers say.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const library = require(path.join(ROOT, 'client', 'coach', 'exercise-library.js'));
const E = require(path.join(ROOT, 'client', 'coach', 'engine.js'));
const SPEC = require(path.join(ROOT, 'client', 'coach', 'spec.js'));
const K = library.kinematics;

/* A standing side leg raise, facing the camera: thigh swings out to the side, measured as the
   hip→knee segment's angle from hanging straight down. Faults: pelvis hiking, trunk leaning. */
const sideLegRaise = {
  id: 'side_leg_raise', name: 'Side leg raise', group: 'Hip strength', type: 'reps', view: 'front',
  sided: { limb: 'leg', by: 'pick' }, summary: 'Straight-leg raise out to the side.', setup: 'Face the camera, 2.5 m away, hip height.', why: 'The leg swings across the camera plane.',
  defaultTarget: 10, targets: [6, 8, 10, 12], options: [{ key: 'rom', label: 'Raise target', values: [20, 30, 40], unit: '°', default: 30 }],
  progress: { metric: { kind: 'vertical', pts: ['HIP', 'KNEE'] }, start: 'calibrated', target: 'opt:rom' },
  faults: [
    { id: 'hike', label: 'Hip hiking', cue: 'Hip down', tip: 'Keep both hip bones level.', severity: 3, metric: { kind: 'pelvis', pts: [] }, rel: 'change', op: '>', threshold: 6, minP: 0.3, persist: 300 },
    { id: 'lean', label: 'Leaning away', cue: 'Stay tall', tip: 'Do not tip the trunk.', severity: 2, metric: { kind: 'lean', pts: [] }, rel: 'change', op: '<', threshold: -8, minP: 0.3, persist: 300 },
    { id: 'shallow', rule: 'shallow', label: 'Not reaching the target', cue: 'A little higher', tip: 'Aim for the target.', severity: 1 },
    { id: 'fast', rule: 'fast', label: 'Too fast', cue: 'Slower', tip: 'Two up, three down.', severity: 1, minMs: 1500 },
  ],
  guide: { surface: 'Firm floor.', cannotSee: 'Foot turn-out.', stop: 'Groin pain.', regions: [{ name: 'Trunk', points: [{ t: 'Stand tall.', tracked: true }] }] },
};

function frame(map, vis = 0.95) {
  const pts = []; for (let i = 0; i < 33; i++) pts.push({ x: 0.5, y: 0.5, z: 0, visibility: vis });
  for (const k in map) { const [x, y] = map[k]; pts[+k] = { x, y, z: 0, visibility: vis }; }
  return pts;
}
/* Person facing the camera; their right leg (landmarks 24/26/28) is on the image left and swings out to the left.
   + lean shifts the shoulders to the image right — away from the working leg. */
function pose(raise, hike = 0, lean = 0) {
  const hipY = 0.55, hipL = [0.54, hipY + hike * 0.002], hipR = [0.46, hipY - hike * 0.002];   // + hike lifts the working (right) hip
  const shMid = [0.5 + Math.tan(lean * Math.PI / 180) * 0.25, 0.30];
  const knR = [hipR[0] - Math.sin(raise * Math.PI / 180) * 0.2, hipR[1] + Math.cos(raise * Math.PI / 180) * 0.2];
  const anR = [knR[0] - Math.sin(raise * Math.PI / 180) * 0.2, knR[1] + Math.cos(raise * Math.PI / 180) * 0.2];
  return frame({ 0: [shMid[0], 0.18], 7: [shMid[0] + 0.02, 0.2], 8: [shMid[0] - 0.02, 0.2], 11: [shMid[0] + 0.08, shMid[1]], 12: [shMid[0] - 0.08, shMid[1]], 13: [shMid[0] + 0.1, 0.42], 14: [shMid[0] - 0.1, 0.42], 15: [shMid[0] + 0.1, 0.52], 16: [shMid[0] - 0.1, 0.52],
    23: hipL, 24: hipR, 25: [hipL[0], hipL[1] + 0.2], 26: knR, 27: [hipL[0], hipL[1] + 0.4], 28: anR, 29: [hipL[0], 0.96], 30: [anR[0], anR[1] + 0.01], 31: [hipL[0] + 0.02, 0.96], 32: [anR[0] - 0.02, anR[1] + 0.01] });
}
function run(ex, frames, opts, fps = 30) {
  const sess = new E.SetSession(ex, { target: 100, ...opts }); const sm = new E.PoseSmoother();
  let t = 0; const events = []; const fired = new Set();
  const first = sm.update(frames[0], t, 1); sess.calibrate(first, 'R');
  for (const f of frames) { t += 1000 / fps; const r = sess.step(sm.update(f, t, 1), t); for (const c of r.cues) { sess.ackCue(c.id, t); fired.add(c.id); } if (r.repEvent) events.push(r.repEvent); }
  return { sess, events, fired, review: sess.review() };
}
function takes(raise, reps, hike = 0, lean = 0, frames = 90) {
  const out = []; for (let i = 0; i < 40; i++) out.push(pose(0));
  for (let r = 0; r < reps; r++) for (let i = 0; i < frames; i++) { const k = Math.sin(Math.PI * i / frames); out.push(pose(raise * k, k > 0.5 ? hike : 0, k > 0.5 ? lean : 0)); }
  for (let i = 0; i < 20; i++) out.push(pose(0));
  return out;
}

test('checkSpec lists what is missing, in the physio\'s words', () => {
  const bad = JSON.parse(JSON.stringify(sideLegRaise)); delete bad.guide.cannotSee; bad.faults[0].cue = 'one two three four five six seven eight nine'; bad.faults[1].threshold = undefined;
  const problems = SPEC.checkSpec(bad);
  assert.ok(problems.some((p) => /cannot see/.test(p)), problems.join('; '));
  assert.ok(problems.some((p) => /longer than 8 words/.test(p)), problems.join('; '));
  assert.ok(problems.some((p) => /Leaning away.*threshold/.test(p)), problems.join('; '));
  assert.deepEqual(SPEC.checkSpec(sideLegRaise), []);
});

test('a spec compiles into a move the library validator accepts', () => {
  const ex = SPEC.compile(sideLegRaise, K);
  assert.doesNotThrow(() => library.validate(ex));
  assert.equal(ex.id, 'side_leg_raise'); assert.equal(ex.sided.limb, 'leg');
  assert.ok(ex.required.includes(26) && ex.required.includes(24), 'landmarks the metrics read are required');
  assert.ok(ex.options.some((o) => o.key === 'rom') && !ex.options.some((o) => o.key === 'band'), 'options come from the spec');
  assert.equal(ex.faults.length, 4); assert.equal(ex.faults[0].weight, 3);
});

test('clean reps count, and no fault fires on them', () => {
  const ex = SPEC.compile(sideLegRaise, K);
  const r = run(ex, takes(32, 4), { rom: 30, work: 'R' });
  assert.equal(r.review.reps, 4, `counted ${r.review.reps}`);
  assert.deepEqual([...r.fired], []);
  assert.equal(Object.keys(r.review.faults).length, 0, JSON.stringify(Object.keys(r.review.faults)));
});

test('the target follows the user\'s range option', () => {
  const ex = SPEC.compile(sideLegRaise, K);
  const low = run(ex, takes(22, 3), { rom: 20, work: 'R' }); assert.equal(low.review.reps, 3);
  const short = run(ex, takes(22, 3), { rom: 40, work: 'R' }); assert.equal(short.review.reps, 0); assert.ok(short.review.partials >= 1);
});

test('faults fire when the numbers say so: pelvis hike, trunk lean, too fast', () => {
  const ex = SPEC.compile(sideLegRaise, K);
  const hike = run(ex, takes(32, 3, 12), { rom: 30, work: 'R' }); assert.ok(hike.fired.has('hike'), [...hike.fired].join());
  const lean = run(ex, takes(32, 3, 0, 14), { rom: 30, work: 'R' }); assert.ok(lean.fired.has('lean'), [...lean.fired].join());
  const fast = run(ex, takes(32, 3, 0, 0, 30), { rom: 30, work: 'R' }); assert.ok(fast.review.faults.fast, Object.keys(fast.review.faults).join());
});

test('a hold spec counts seconds in position', () => {
  const hold = {
    id: 'leg_hold', name: 'Side leg hold', group: 'Hip strength', type: 'hold', view: 'front', summary: 's', setup: 's', why: 'w', defaultTarget: 10, targets: [10, 20],
    hold: { conditions: [{ metric: { kind: 'vertical', pts: ['HIP', 'KNEE'] }, min: 25, max: 60, rel: 'abs' }] },
    faults: [{ id: 'lean', label: 'Leaning', cue: 'Stay tall', tip: 't', severity: 2, metric: { kind: 'lean', pts: [] }, rel: 'change', op: '<', threshold: -8, persist: 300 }],
    guide: { surface: 's', cannotSee: 'c', stop: 'x', regions: [{ name: 'Trunk', points: [{ t: 'Tall.', tracked: true }] }] },
  };
  const ex = SPEC.compile(hold, K); library.validate(ex);
  const frames = []; for (let i = 0; i < 30; i++) frames.push(pose(0)); for (let i = 0; i < 90; i++) frames.push(pose(35)); for (let i = 0; i < 30; i++) frames.push(pose(0));
  const r = run(ex, frames, {});
  assert.ok(r.review.holdSec >= 2.5 && r.review.holdSec <= 3.5, 'held ' + r.review.holdSec);
});

/* ---- The second-generation measurements: each one, on a frame built to read a known value ---- */
test('the new measurement kinds read what they say: rise, height, ratio, gap, rotation, near, headTilt', () => {
  const k = K;
  const base = frame({ 7: [0.47, 0.15], 8: [0.53, 0.15], 11: [0.59, 0.30], 12: [0.41, 0.30], 13: [0.61, 0.42], 14: [0.39, 0.42], 15: [0.62, 0.53], 16: [0.38, 0.53], 23: [0.56, 0.55], 24: [0.44, 0.55], 25: [0.56, 0.75], 26: [0.44, 0.75], 27: [0.56, 0.95], 28: [0.44, 0.95], 29: [0.55, 0.97], 30: [0.45, 0.97], 31: [0.58, 0.97], 32: [0.42, 0.97], 0: [0.50, 0.14] });
  const metrics = [
    { kind: 'rise', pts: ['HEEL'], per: ['KNEE', 'ANK'] }, { kind: 'height', pts: ['WR', 'SH'] }, { kind: 'ratio', pts: ['KNEE', 'ANK'] },
    { kind: 'gap', pts: ['EL', 'SH'], per: ['SH', 'EL'] }, { kind: 'rotation', pts: ['WR', 'EL'], per: ['SH', 'EL'] }, { kind: 'near', pts: ['WR', 'HIP', 'KNEE'] },
    { kind: 'headTilt', pts: [] }, { kind: 'gap', pts: ['KNEE', 'ANK'], sign: 'forward', per: ['KNEE', 'ANK'] },
  ];
  const ref = SPEC.calibrateRef(metrics, base, k, {});
  const at = (m, pts, S = 'L') => SPEC.evalMetric(m, pts, S, k, ref, {});
  const moved = frame({ 7: [0.47, 0.15], 8: [0.53, 0.18], 11: [0.59, 0.30], 12: [0.41, 0.30], 13: [0.67, 0.42], 14: [0.39, 0.42], 15: [0.66, 0.20], 16: [0.38, 0.53], 23: [0.56, 0.55], 24: [0.44, 0.55], 25: [0.56, 0.75], 26: [0.44, 0.75], 27: [0.56, 0.85], 28: [0.44, 0.95], 29: [0.55, 0.93], 30: [0.45, 0.97], 31: [0.58, 0.97], 32: [0.42, 0.97], 0: [0.50, 0.14] });
  assert.equal(Math.round(at(metrics[0], base)), 0, 'rise reads 0 at calibration');
  assert.equal(Math.round(at(metrics[0], moved)), 20, 'heel up 0.04 on a 0.20 shin = 20 %');
  assert.equal(Math.round(at(metrics[1], moved)), 40, 'wrist 0.10 above the shoulder, torso 0.25 = 40 %');
  assert.equal(Math.round(at(metrics[2], base)), 100, 'ratio reads 100 at calibration');
  assert.equal(Math.round(at(metrics[2], moved)), 50, 'a shin that looks half as long reads 50');
  assert.equal(Math.round(at(metrics[3], base)), 16, 'elbow 0.02 outside the shoulder on a 0.122 upper arm');
  assert.ok(at(metrics[3], moved) > at(metrics[3], base) + 40, 'elbow drifting out reads higher');
  assert.ok(Math.abs(at(metrics[4], base)) < 20 && at(metrics[4], moved) < at(metrics[4], base), 'rotation is signed and changes as the forearm swings');
  assert.ok(at(metrics[5], base) > 0, 'near: the wrist is off the thigh');
  assert.equal(Math.round(at(metrics[6], base)), 0, 'head level at calibration');
  assert.ok(at(metrics[6], moved) > 20, 'right ear dropping = positive tilt for the left side');
  assert.ok(Math.abs(at(metrics[6], moved, 'R') + at(metrics[6], moved, 'L')) < 1e-9, 'headTilt flips sign with the working side');
  assert.equal(Math.round(at(metrics[7], base)), 0, 'knee over the ankle reads 0');
  assert.equal(SPEC.metricLandmarks(metrics[7], 'L', k).includes(31), true, 'a forward-signed gap needs the foot to know which way is forward');
});

test('gates, scaled thresholds and the return rule compile and fire as written', () => {
  const spec = {
    ...sideLegRaise, id: 'gated_raise', sided: { limb: 'leg', by: 'pick', auto: true },
    options: [...sideLegRaise.options, { key: 'variant', label: 'Variant', values: ['a', 'b'], default: 'a' }],
    faults: [
      { id: 'hike', label: 'Hip hiking', cue: 'Hip down', tip: 'Level.', severity: 3, metric: { kind: 'pelvis', pts: [] }, rel: 'change', op: '>', threshold: 5, minP: 0.3, persist: 300, scale: { metric: 'progress', times: 0.5 } },
      { id: 'onlyb', label: 'Only in variant b', cue: 'B only', tip: 'B.', severity: 1, metric: { kind: 'pelvis', pts: [] }, rel: 'change', op: '>', threshold: -999, persist: 100, when: [{ option: 'variant', is: 'b' }] },
      { id: 'return', rule: 'return', label: 'Not returning', cue: 'All the way down', tip: 'Back to the start.', severity: 1, threshold: 0.2 },
    ],
  };
  const ex = SPEC.compile(spec, K); library.validate(ex);
  assert.equal(typeof ex.faults.find((f) => f.id === 'return').check, 'function');
  /* variant a: the option-gated fault never fires however far the pelvis tilts; scaled hike needs tilt > 2 + 0.5 × raise */
  const seq = (hike, opts) => { const frames = []; for (let i = 0; i < 30; i++) frames.push(pose(0)); for (let r = 0; r < 3; r++) for (let i = 0; i < 60; i++) { const k2 = Math.sin(Math.PI * i / 60); frames.push(pose(30 * k2, hike * k2)); } for (let i = 0; i < 30; i++) frames.push(pose(0)); return run(ex, frames, { rom: 30, ...opts }); };
  const a = seq(6, { variant: 'a' }); assert.ok(!a.review.faults.onlyb, 'option gate holds'); assert.ok(!a.review.faults.hike, 'a small hike at a 30° raise is under 5 + 15');
  const b = seq(25, { variant: 'b' }); assert.ok(b.review.faults.onlyb, 'option gate opens'); assert.ok(b.review.faults.hike, 'a big hike is over 5 + 15');
  assert.equal(b.review.reps, 3, 'side followed automatically: ' + JSON.stringify(b.review.faults));
});

/* Foot on the floor: the shared names resolve to a heel / toes / whole-foot rise since calibration,
   and the ready-made fault fires on a lifted heel but not on a foot that stays planted. */
test('heel_lift / toes_lift / foot_lift read a foot leaving the floor, and heel_up fires on it', () => {
  const E = require('../client/coach/engine.js');
  const shared = require('../client/data/shared.json');
  for (const name of ['heel_lift', 'toes_lift', 'foot_lift']) assert.ok(shared.measurements[name], name + ' is a shared measurement');
  const metrics = [shared.measurements.heel_lift, shared.measurements.toes_lift, shared.measurements.foot_lift];
  const planted = frame({ 11: [0.59, 0.30], 12: [0.41, 0.30], 23: [0.56, 0.55], 24: [0.44, 0.55], 25: [0.56, 0.75], 26: [0.44, 0.75], 27: [0.56, 0.95], 28: [0.44, 0.95], 29: [0.55, 0.97], 30: [0.45, 0.97], 31: [0.58, 0.97], 32: [0.42, 0.97], 0: [0.50, 0.14], 7: [0.47, 0.15], 8: [0.53, 0.15] });
  const ref = SPEC.calibrateRef(metrics, planted, K, {});
  const at = (m, pts) => SPEC.evalMetric(m, pts, 'L', K, ref, {});
  /* heel up 0.03 on a 0.20 shin, toes still down */
  const heelUp = frame({ 11: [0.59, 0.30], 12: [0.41, 0.30], 23: [0.56, 0.55], 24: [0.44, 0.55], 25: [0.56, 0.75], 26: [0.44, 0.75], 27: [0.56, 0.93], 28: [0.44, 0.95], 29: [0.55, 0.94], 30: [0.45, 0.97], 31: [0.58, 0.97], 32: [0.42, 0.97], 0: [0.50, 0.14], 7: [0.47, 0.15], 8: [0.53, 0.15] });
  assert.equal(Math.round(at(metrics[0], heelUp)), 15, 'heel 0.03 up on a 0.20 shin = 15 %');
  assert.equal(Math.round(at(metrics[1], heelUp)), 0, 'toes have not moved');
  assert.equal(Math.round(at(metrics[2], heelUp)), 10, 'the ankle rose 0.02 = 10 %');
  /* the template, compiled into a move: every form move that watches the heel got it from here */
  const ws = E.EXERCISES.find((e) => e.id === 'wallsit'); const f = ws.faults.find((x) => x.id === 'heels');
  assert.ok(f && typeof f.check === 'function', 'wall sit watches the heels');
  const hs = E.EXERCISES.find((e) => e.id === 'heelslide'); const hf = hs.faults.find((x) => x.id === 'heel');
  assert.ok(hf && !hf.onRep && hf.weight === 3, 'heel slide keeps its own words and severity on the shared measurement');
});

/* A demonstrated target: the person holds the end of the range once, without the band, and what it
   reads replaces the number in the file — but only if the demonstration is plausible. */
test('show: a held end position becomes the target, and an implausible one is refused', () => {
  const E = require('../client/coach/engine.js');
  const ex = E.EXERCISES.find((e) => e.id === 'pullapart');
  assert.ok(ex.show && ex.show.ask, 'the band pull-apart asks for the end position');
  /* arms forward, wrists a hand apart: the start. Torso 0.25, so the reading is a % of that. */
  const wrists = (gap) => frame({ 0: [0.50, 0.14], 7: [0.47, 0.15], 8: [0.53, 0.15], 11: [0.59, 0.30], 12: [0.41, 0.30], 13: [0.61, 0.40], 14: [0.39, 0.40], 15: [0.5 + gap / 2, 0.45], 16: [0.5 - gap / 2, 0.45], 23: [0.56, 0.55], 24: [0.44, 0.55], 25: [0.56, 0.75], 26: [0.44, 0.75], 27: [0.56, 0.95], 28: [0.44, 0.95] });
  const fresh = () => { const ref = ex.calibrate(wrists(0.10), 'L', {}); return ref; };
  const ref = fresh();
  assert.equal(Math.round(ref.dataTarget), 280, 'the file target is kept as the fallback');
  const start = ref.start;
  /* opened wide: about 240 % of torso, most of the way to the file's 280 */
  const v = ex.showTarget(wrists(0.60), ref);
  assert.ok(v !== null, 'a real demonstration is taken');
  assert.equal(Math.round(ref.target), Math.round(v), 'and becomes the target');
  assert.notEqual(Math.round(ref.target), 280, 'replacing the number in the file');
  assert.equal(Math.round(ref.dataTarget), 280, 'which is still there as the fallback');
  assert.equal(Math.round(ref.start), Math.round(start), 'the start is untouched');
  /* barely moved: refused, and the target is left alone */
  const r2 = fresh(); assert.equal(ex.showTarget(wrists(0.14), r2), null, 'a pose that barely left the start is refused');
  assert.equal(Math.round(r2.target), 280, 'so the file target stands');
  /* nonsense: refused too */
  const r3 = fresh(); assert.equal(ex.showTarget(wrists(2.40), r3), null, 'and so is a wild reading');
  assert.equal(Math.round(r3.target), 280);
  /* a move that asks for nothing has nothing to show */
  const hs = E.EXERCISES.find((e) => e.id === 'heelslide');
  assert.equal(hs.show, null, 'a move only asks when its file says to');
});

/* ---- a fault checked on the start position, before the set ---- */
test('phase "start": the same detectors, read once on the position being held', () => {
  const spec = JSON.parse(JSON.stringify(sideLegRaise));
  /* the knee should be straight before the first raise: the hip→knee→ankle angle, judged at the start */
  spec.faults.push({ id: 'bentknee', label: 'Knee already bent', cue: 'Straighten the leg', tip: 'Start with the working leg straight.', severity: 2, phase: 'start', metric: { kind: 'angle', pts: ['HIP', 'KNEE', 'ANK'] }, op: '<', threshold: 170 });
  assert.deepEqual(SPEC.checkSpec(spec), []);
  const ex = SPEC.compile(spec, K);
  const f = ex.faults.find((x) => x.id === 'bentknee');
  assert.equal(f.atStart, true); assert.equal(f.phase, 'start');
  /* the smoother's confidence in a landmark warms up over a few frames, and a fault reading
     landmarks it is unsure of is held back (see fault.unsure), so the still start position is
     fed in the way the coach feeds it: a second of it */
  const still = (p) => { const s = new E.PoseSmoother(); let out; for (let t = 0; t <= 1000; t += 33) out = s.update(p, t, 1); return out; };
  /* a straight leg at the start: nothing to say */
  const straight = still(pose(0));
  assert.deepEqual(ex.checkStart(straight, 'R', {}).map((x) => x.id), []);
  /* the same position with the knee bent: the fault is found before anything has been calibrated */
  const bentFrame = (() => { const p = pose(0); p[26] = { x: p[24].x - 0.06, y: (p[24].y + p[28].y) / 2, z: 0, visibility: 0.95 }; return p; })();
  const bent = still(bentFrame);
  assert.deepEqual(ex.checkStart(bent, 'R', {}).map((x) => x.id), ['bentknee'], 'the bent knee is caught on the start position');
  /* and it is never raised during the set itself, however the leg moves */
  const r = run(ex, takes(30, 3), { rom: 30 });
  assert.ok(!r.fired.has('bentknee'), 'a start fault does not fire mid-set');
  /* a session counts what was still wrong when the set began, so the review says it */
  const sess = new E.SetSession(ex, { target: 10, rom: 30 });
  assert.deepEqual(sess.startCheck(bent, 'R').map((x) => x.id), ['bentknee']);
  sess.calibrate(bent, 'R'); sess.noteStart(['bentknee'], 0);
  assert.ok(sess.review().faults.bentknee, 'and the review lists it');
});

test('a start check cannot be a built-in rule, nor measure the change from the start', () => {
  const bad = (f) => { const s = JSON.parse(JSON.stringify(sideLegRaise)); s.faults.push({ id: 'x', label: 'X', cue: 'Fix it', tip: 'Fix it.', severity: 2, phase: 'start', ...f }); return SPEC.checkSpec(s).join(' '); };
  assert.match(bad({ rule: 'fast', minMs: 1500 }), /no rep yet/);
  assert.match(bad({ metric: { kind: 'lean', pts: [] }, rel: 'change', op: '>', threshold: 5 }), /change from the start/);
  assert.deepEqual(SPEC.checkSpec((() => { const s = JSON.parse(JSON.stringify(sideLegRaise)); s.faults[0].phase = ''; return s; })()), [], 'an empty phase is simply no phase');
});

/* ---- a movement measured by more than one angle ---- */
test('progress: "and" adds measurements, and the rep is only as far through as its least-finished part', () => {
  const spec = JSON.parse(JSON.stringify(sideLegRaise));
  /* the raise now also needs the knee to stay straight-ish: a second measurement with its own target */
  spec.progress.and = [{ metric: { kind: 'angle', pts: ['HIP', 'KNEE', 'ANK'] }, start: 'calibrated', target: 120 }];
  assert.deepEqual(SPEC.checkSpec(spec), []);
  const ex = SPEC.compile(spec, K);
  const sm = new E.PoseSmoother();
  const first = sm.update(pose(0), 0, 1);
  const ref = ex.calibrate(first, 'R', { rom: 30 });
  assert.equal(ref.parts.length, 2, 'both measurements get a start and a target');
  const m = ex.measure(sm.update(pose(15), 33, 1), 'R', ref);
  assert.equal(m.parts.length, 2);
  /* the leg stays straight, so the second part never moves: min holds the whole rep at zero */
  assert.ok(Math.abs(m.parts[1].p) < 0.1, 'the knee part has not moved: ' + m.parts[1].p);
  assert.ok(m.p <= m.parts[0].p + 1e-9, 'combined progress is the smaller of the two');
  /* mean averages them instead, so a half-done part still counts for half */
  const meanEx = SPEC.compile({ ...spec, progress: { ...spec.progress, combine: 'mean' } }, K);
  const mRef = meanEx.calibrate(sm.update(pose(0), 66, 1), 'R', { rom: 30 });
  const m2 = meanEx.measure(sm.update(pose(15), 99, 1), 'R', mRef);
  assert.ok(m2.p > m.p, 'mean sits above min when one part leads: ' + m2.p + ' vs ' + m.p);
  /* one measurement behaves exactly as before */
  const one = SPEC.compile(sideLegRaise, K);
  const oneRef = one.calibrate(sm.update(pose(0), 132, 1), 'R', { rom: 30 });
  const m3 = one.measure(sm.update(pose(15), 165, 1), 'R', oneRef);
  assert.equal(m3.parts.length, 1); assert.ok(Math.abs(m3.p - m3.parts[0].p) < 1e-9);
});

test('a second progress measurement is checked like the first', () => {
  const bad = (and) => { const s = JSON.parse(JSON.stringify(sideLegRaise)); s.progress.and = and; return SPEC.checkSpec(s).join(' '); };
  assert.match(bad([{ metric: { kind: 'angle', pts: ['HIP', 'KNEE', 'ANK'] }, start: 'calibrated' }]), /and\[0\]: target value/);
  assert.match(bad([{ metric: { kind: 'angle', pts: ['HIP'] }, start: 'calibrated', target: 90 }]), /and\[0\]/);
  assert.deepEqual(SPEC.checkSpec((() => { const s = JSON.parse(JSON.stringify(sideLegRaise)); s.progress.and = []; return s; })()), [], 'an empty list is simply no second measurement');
  assert.match(bad('hip'), /"and" must be a list/);
  const combo = JSON.parse(JSON.stringify(sideLegRaise)); combo.progress.combine = 'median';
  assert.match(SPEC.checkSpec(combo).join(' '), /combine must be min, mean or max/);
});

/* A hand weight is offered like a band: the steps come from settings.json and the last one lets
   the person type their own. */
test('weight offers the kilogram bubble, with a step for a typed value', () => {
  const s = JSON.parse(JSON.stringify(sideLegRaise)); s.weight = 2;
  const ex = SPEC.compile(s, K); const w = ex.options.find((o) => o.key === 'weight');
  assert.ok(w && w.default === 2 && w.values.includes('custom') && w.custom === true && w.customUnit === 'kg', JSON.stringify(w));
  s.weight = true; assert.equal(SPEC.compile(s, K).options.find((o) => o.key === 'weight').default, 'none');
  s.weight = 'heavy'; assert.match(SPEC.checkSpec(s).join(' '), /weight must be true, "none" or a number/);
});

/* A rep with a hold at the top only counts once the top has been held for repHold seconds; a rep
   that reaches the top and comes straight back down is a partial, and the shortHold rule says why. */
test('repHold: the top must be held before the rep counts', () => {
  const s = JSON.parse(JSON.stringify(sideLegRaise)); s.repHold = 0.5;
  s.faults.push({ id: 'short_hold', rule: 'shortHold', label: 'Not held at the top', cue: 'Hold it there', tip: 'Pause at the top.', severity: 1 });
  assert.deepEqual(SPEC.checkSpec(s), []);
  const quick = SPEC.compile(s, K); assert.equal(quick.repHold, 0.5);
  /* a 3 s sine rep sits at or above 85 % of the target for about a second */
  const a = run(quick, takes(30, 3), { rom: 30 });
  assert.equal(a.review.reps, 3, 'held for half a second: every rep counts'); assert.equal(a.review.partials, 0);
  s.repHold = 2; const slow = SPEC.compile(s, K);
  const b = run(slow, takes(30, 3), { rom: 30 });
  assert.equal(b.review.reps, 0, 'a two-second hold was never made'); assert.equal(b.review.partials, 3);
  assert.ok(b.events.every((e) => e.rep.shortHold && e.rep.topMs > 500 && e.rep.topMs < 2000), JSON.stringify(b.events.map((e) => e.rep.topMs)));
  assert.equal((b.review.faults.short_hold || {}).n, 3, 'the shortHold rule fires on each of them');
  const hold = JSON.parse(JSON.stringify(s)); hold.type = 'hold'; hold.hold = { conditions: [{ metric: { kind: 'vertical', pts: ['HIP', 'KNEE'] }, min: 20 }] };
  assert.match(SPEC.checkSpec(hold).join(' '), /repHold .* is for a counted move/);
  s.repHold = 45; assert.match(SPEC.checkSpec(s).join(' '), /at most 30/);
});

/* A % of the person's height is the same on a tall body and a short one; in inches or centimetres
   it is that share of the height they gave the app. */
test('per: "height" reads a share of stature, and unit turns it into inches or centimetres', () => {
  const pts = pose(0);
  const m = { kind: 'dist', pts: ['HIP', 'KNEE'], per: 'height' };
  const ref = SPEC.calibrateRef([m], pts, K, {});
  const stature = SPEC.stature(pts, K);
  assert.ok(Math.abs(stature - (0.25 + 0.2 + 0.2) / 0.779) < 1e-6, 'trunk + thigh + shin is 77.9 % of stature: ' + stature);
  const pct = SPEC.evalMetric(m, pts, 'R', K, ref, {});
  assert.ok(Math.abs(pct - 100 * 0.2 / stature) < 1e-6, 'thigh as % of height: ' + pct);
  const inches = { ...m, unit: 'in' }, cm = { ...m, unit: 'cm' };
  const at71 = SPEC.evalMetric(inches, pts, 'R', K, ref, { heightIn: 71 }), at60 = SPEC.evalMetric(inches, pts, 'R', K, ref, { heightIn: 60 });
  assert.ok(Math.abs(at71 - pct / 100 * 71) < 1e-6 && Math.abs(at60 - pct / 100 * 60) < 1e-6, `inches follow the height: ${at71} at 5'11", ${at60} at 5'0"`);
  assert.ok(Math.abs(SPEC.evalMetric(inches, pts, 'R', K, ref) - pct / 100 * SPEC.DEFAULT_HEIGHT_IN) < 1e-6, 'unset, 5\'11"');
  assert.ok(Math.abs(SPEC.evalMetric(cm, pts, 'R', K, ref, { heightIn: 71 }) - at71 * 2.54) < 1e-6, 'centimetres');
  /* legs out of frame: the trunk alone carries the estimate */
  const upper = pts.map((p, i) => i >= 25 ? { ...p, visibility: 0.1 } : p);
  assert.ok(Math.abs(SPEC.stature(upper, K) - 0.25 / 0.288) < 1e-6, 'trunk only');
  assert.equal(SPEC.unitOf(inches), 'in'); assert.equal(SPEC.unitOf(m), '%');
  const s = JSON.parse(JSON.stringify(sideLegRaise)); s.faults[0] = { ...s.faults[0], metric: { kind: 'gap', pts: ['KNEE', 'FOOT'], unit: 'in' }, threshold: 2 };
  assert.match(SPEC.checkSpec(s).join(' '), /need per: "height"/);
  s.faults[0].metric.per = 'height'; assert.deepEqual(SPEC.checkSpec(s), []);
  s.faults[0].metric.unit = 'ft'; assert.match(SPEC.checkSpec(s).join(' '), /unit must be "in" or "cm"/);
});

/* Still is not the same as ready: read in one pose and then settled in another before the first
   rep, the person would read half a rep up and never come back to rest. The start is read again
   where they settled. */
test('the start position is read again when the person settles somewhere else before the first rep', () => {
  const ex = SPEC.compile(sideLegRaise, K);
  const frames = []; for (let i = 0; i < 40; i++) frames.push(pose(0));            // calibrated with the leg hanging
  for (let i = 0; i < 70; i++) frames.push(pose(12));                             // then settles with it out 12° and stays
  for (let r = 0; r < 3; r++) for (let i = 0; i < 90; i++) frames.push(pose(12 + 30 * Math.sin(Math.PI * i / 90)));   // three 30° raises from there
  for (let i = 0; i < 20; i++) frames.push(pose(12));
  const { sess, review } = run(ex, frames, { rom: 30 });
  assert.equal(sess.rebases, 1, 'read again once');
  assert.ok(Math.abs(sess.ref.start - 12) < 2, 'the new start is the settled pose: ' + sess.ref.start);
  assert.equal(review.reps, 3, 'and the raises from there are full reps'); assert.equal(review.partials, 0);
  /* after the first rep a level the person rests at is not a new start */
  const later = []; for (let i = 0; i < 40; i++) later.push(pose(0));
  for (let i = 0; i < 90; i++) later.push(pose(30 * Math.sin(Math.PI * i / 90)));
  for (let i = 0; i < 70; i++) later.push(pose(12));
  assert.equal(run(ex, later, { rom: 30 }).sess.rebases, 0);
});

/* Filmed side-on, the far arm and leg are behind the body and the pose model guesses at them. A
   fault reading those is held to a bigger violation, for longer, and below the floor is not said. */
test('a fault reading landmarks the model is unsure of needs a bigger violation', () => {
  const spec = JSON.parse(JSON.stringify(sideLegRaise));
  spec.faults = [{ id: 'bend', label: 'Knee bending', cue: 'Straighten it', tip: 'Keep the leg straight.', severity: 2, metric: { kind: 'angle', pts: ['HIP', 'KNEE', 'ANK'] }, op: '<', threshold: 150, minP: 0, persist: 300 }];
  const ex = SPEC.compile(spec, K); const f = ex.faults[0];
  const u = E.settings.fault.unsure;
  const m = (deg, conf) => ({ p: 1, gates: { bend: true }, conf: { bend: conf }, 'f_bend': deg });
  /* seen clearly: the threshold is the threshold */
  assert.equal(f.check(m(149, 1)), true); assert.equal(f.check(m(151, 1)), false);
  /* unsure: it has to clear the threshold by the margin */
  const half = (u.vis + u.floor) / 2;
  assert.equal(f.check(m(149, half)), false, 'just over the line on a limb the model is guessing at');
  assert.equal(f.check(m(150 - u.margin - 1, half)), true, 'plainly over it, and still said');
  /* and below the floor the landmarks are invention */
  assert.equal(f.check(m(10, u.floor - 0.05)), false, 'nothing is said about a limb that cannot be seen');
  /* it also has to hold longer */
  assert.ok(f.persistFor, 'the tracker is told how long');
  assert.equal(f.persistFor(m(140, 1)), 300);
  assert.equal(f.persistFor(m(140, half)), Math.round(300 * u.persist));
  /* the near side of a real side-on body sits near 1.0 and the far side near 0.5, so this is the
     line between them, not a tax on every fault */
  assert.ok(u.vis > 0.7 && u.floor < u.vis);
});

/* A set is not done in one place. Each rep is measured from the position held just before it, so a
   body that settles differently on the fourth rep is still read correctly on the fourth rep — but
   the start may only wander so far, or stopping half way down would redefine the exercise. */
test('each rep is measured from the position held before it, within a drift cap', () => {
  const ex = SPEC.compile(sideLegRaise, K);
  const ref = ex.calibrate(pose(0), 'R', { rom: 30 });
  const s0 = ref.start, span = Math.abs(ref.target - s0);
  const cfg = E.settings.rep.startAgain;
  /* the leg now hangs 6° further out than it did: the next rep starts from there */
  assert.equal(ex.startAgain(ref, pose(6), 'R', cfg), true);
  assert.ok(Math.abs(ref.start - (s0 + 6)) < 1.5, 'the new start is where the leg is: ' + ref.start);
  assert.equal(ref.restarts, 1);
  /* the same position again is not a new start */
  assert.equal(ex.startAgain(ref, pose(6), 'R', cfg), false, 'nothing moved, nothing re-read');
  /* resting half way up does not become the new floor: the start is capped at drift of the way */
  ex.startAgain(ref, pose(28), 'R', cfg);
  assert.ok(ref.start <= s0 + span * cfg.drift + 0.01, `capped at ${(span * cfg.drift).toFixed(1)}° of drift, got ${(ref.start - s0).toFixed(1)}`);
  /* an absolute target does not move with the start; a delta target does */
  assert.equal(ref.target, ref.parts0[0].target, 'the target is where it was');
  const dspec = JSON.parse(JSON.stringify(sideLegRaise)); dspec.progress = { metric: { kind: 'vertical', pts: ['HIP', 'KNEE'] }, start: 'calibrated', target: 30, targetIsDelta: true };
  const dex = SPEC.compile(dspec, K); const dref = dex.calibrate(pose(0), 'R', {});
  const t0 = dref.target; dex.startAgain(dref, pose(6), 'R', cfg);
  assert.ok(dref.target > t0 + 4, 'a target written as a change moves with the start');
  /* a demonstrated target is left alone entirely */
  const shown = SPEC.compile({ ...JSON.parse(JSON.stringify(sideLegRaise)), show: { ask: 'hold it out' } }, K);
  const sref = shown.calibrate(pose(0), 'R', { rom: 30, work: 'R' }); assert.ok(shown.showTarget(pose(28), sref), 'the demonstration was read');
  assert.equal(shown.startAgain(sref, pose(6), 'R', cfg), false, 'what they demonstrated is not re-read');
});

/* The target line has to know which end of the movement is the anchor. A move can say so outright
   instead of leaving the coach to work it out by watching. */
test('stable names the landmarks that do not move, and is checked', () => {
  const spec = JSON.parse(JSON.stringify(sideLegRaise)); spec.stable = ['SH', 'KNEE'];
  assert.deepEqual(SPEC.checkSpec(spec), []);
  assert.deepEqual(SPEC.compile(spec, K).stable, ['SH', 'KNEE']);
  spec.stable = ['ELBOW']; assert.match(SPEC.checkSpec(spec).join(' '), /unknown landmark "ELBOW"/);
  spec.stable = 'SH'; assert.match(SPEC.checkSpec(spec).join(' '), /stable must be a list/);
  delete spec.stable; assert.deepEqual(SPEC.compile(spec, K).stable, []);
});

/* Every moment the coach speaks for itself is a stage a move can silence or reword. */
test('cues: a move says which of the coach\'s own moments it wants', () => {
  const spec = JSON.parse(JSON.stringify(sideLegRaise));
  spec.cues = { count: false, praise: ['Steady'], partial: 'Higher next time', mark: [10, 3], go: 'Begin' };
  assert.deepEqual(SPEC.checkSpec(spec), []);
  assert.deepEqual(SPEC.compile(spec, K).cues.praise, ['Steady']);
  assert.ok(SPEC.STAGES.includes('opening') && SPEC.STAGES.includes('finish') && SPEC.STAGES.length === 15);
  const bad = (c) => { const s = JSON.parse(JSON.stringify(sideLegRaise)); s.cues = c; return SPEC.checkSpec(s).join(' '); };
  assert.match(bad({ whistle: false }), /"whistle" is not a stage/);
  assert.match(bad({ go: 3 }), /cues.go: true, false or the words/);
  assert.match(bad({ praise: 'Nice' }), /cues.praise: true, false or a list/);
  assert.match(bad({ go: '  ' }), /cues.go/);
  assert.match(bad([]), /cues must be a block/);
});

/* Between reps the person shifts, adjusts the mat, rests a hand on the floor. None of that is the
   exercise, and flagging it is the coach talking over a pause. */
test('a rep move\'s faults watch the rep, not the pause between reps', () => {
  const mk = (phase) => { const s = JSON.parse(JSON.stringify(sideLegRaise));
    s.faults = [{ id: 'lean', label: 'Leaning', cue: 'Stay tall', tip: 'Do not tip.', severity: 2, metric: { kind: 'lean', pts: [] }, rel: 'change', op: '<', threshold: -8, minP: 0, persist: 0, ...(phase ? { phase } : {}) }];
    return SPEC.compile(s, K).faults.find((f) => f.id === 'lean'); };
  assert.equal(mk().phase, 'moving', 'unstated means during the movement');
  assert.equal(mk('rest').phase, 'rest', 'or only between reps, if it says so');
  assert.equal(mk('any').phase, undefined, 'or both');
  /* and the tracker honours it: leaning while at rest is not a fault of the set */
  const f = mk(); const tr = new E.FaultTracker([f]);
  const m = { p: 0, gates: { lean: true }, 'f_lean': -20, conf: { lean: 1 } };
  for (const t of [1000, 1500, 2000, 2500]) assert.deepEqual(tr.update(m, 'rest', t).map((x) => x.id), [], 'quiet between reps, however long the pause');
  tr.update(m, 'moving', 3000);
  assert.deepEqual(tr.update(m, 'moving', 3600).map((x) => x.id), ['lean'], 'and said once a rep is under way');
  /* a hold is unchanged: its faults watch the held position */
  const h = JSON.parse(JSON.stringify(sideLegRaise)); h.type = 'hold'; delete h.progress;
  h.hold = { conditions: [{ metric: { kind: 'vertical', pts: ['HIP', 'KNEE'] }, min: 20 }] };
  h.faults = [{ id: 'lean', label: 'Leaning', cue: 'Stay tall', tip: 'Do not tip.', severity: 2, metric: { kind: 'lean', pts: [] }, rel: 'change', op: '<', threshold: -8, persist: 0 }];
  assert.equal(SPEC.compile(h, K).faults.find((f) => f.id === 'lean').phase, undefined);
});

/* A cue is said twice and then held back, so the set is not a lecture; what it stopped saying is
   owed to the person at the end. */
test('a cue is said at most twice a set, and a capped one is named in the review', () => {
  const spec = JSON.parse(JSON.stringify(sideLegRaise));
  const ex = SPEC.compile(spec, K);
  const cap = E.settings.fault.maxCues;
  assert.equal(cap.perSet, 2);
  assert.equal(ex.faults.find((f) => f.id === 'hike').maxCues, 2, 'every fault gets the cap');
  assert.equal(ex.faults.find((f) => f.id === 'fast').maxCues, cap.fast, 'a rule keeps its own');
  /* five reps that all hike: the cue is offered twice, the count keeps counting */
  const r = run(ex, takes(30, 5, 20), { rom: 30 });
  const fc = r.review.faults.hike;
  assert.ok(fc, 'the fault happened'); assert.ok(fc.n > 2, 'on more reps than it was said: ' + fc.n);
  assert.equal(fc.said, 2, 'and was said exactly twice');
  assert.equal(fc.capped, true, 'so the review marks it for the summary');
  /* one that was said as often as it happened is not marked */
  const once = run(ex, takes(30, 1, 20), { rom: 30 }).review.faults.hike;
  if (once) assert.ok(!once.capped, 'nothing owed when it was said every time');
});
