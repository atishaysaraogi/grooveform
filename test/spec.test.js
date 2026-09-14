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
