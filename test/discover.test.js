'use strict';
/* Measures the exercise lacks: given reps a person classified, which measurement not in the
   file would tell the marked reps from the clean ones? Judged on the bridge rig with the pose
   model's wobble added from a seeded generator, so every number here is the same on every
   run. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const Spec = require('../public/js/spec.js');
const Trace = require('../public/js/trace.js');
const Moves = require('../public/js/moves.js');
const { ASPECT, take, REST, rep } = require('./fixtures/rig.js');

/* a bridge without its shin measurement, its two shin faults, the start range on it, its arc
   and its limb colours: the move that has to find the shin for itself */
const file = JSON.parse(JSON.stringify(Moves.bridge.spec));
file.measurements = file.measurements.filter((m) => m.key !== 'shin');
file.faults = file.faults.filter((f) => f.measure !== 'shin');
delete file.ready.ranges.shin;
file.draw = file.draw.filter((d) => d.measure !== 'shin');
for (const k of Object.keys(file.landmarks.limb)) if (file.landmarks.limb[k] === 'shin') delete file.landmarks.limb[k];
assert.equal(Spec.check(file).filter((p) => p.level === 'error').length, 0, 'the shin-less bridge is a valid file');
const NOSHIN = Spec.compile(file, Core);
const M = Moves.bridge;

const JIT = { jitter: 0.004 };
const run = (move, frames, name) => { const result = Trace.run(move, { readyMs: 2000 }, frames, ASPECT); return { result, reps: Trace.reps(result, move), name }; };
/* labels by rep time, as the Review page keeps them: a tag per rep, 'clean' or a fault id */
const label = (reps, tags) => reps.map((x, i) => Object.assign({ t0: x.t0, t1: x.t1 }, tags[i] === 'clean' ? { tag: 'clean' } : { tag: 'faults', faults: [tags[i]] }));
const pts = (m) => ['a', 'b', 'c', 'base', 'top', 'at', 'to', 'from'].map((k) => m[k]).filter(Boolean);
const SHIN = ['knee', 'ankle', 'heel', 'toe'];
/* five reps, the second and the fourth with the feet walked out (the shin at 120 at the top) */
const FEET_OUT = [[REST, 3000], ...rep(), ...rep({ shin: 120 }), ...rep(), ...rep({ shin: 120 }), ...rep()];

test('a shin-from-vertical candidate ranks first on a bridge that has no shin measurement', () => {
  const A = run(NOSHIN, take(FEET_OUT, JIT), 'clip 1');
  assert.deepEqual(A.reps.map((x) => x.n), [1, 2, 3, 4, 5]);
  const d = Trace.discover(NOSHIN, [Object.assign(A, { labels: label(A.reps, ['clean', '+feet out', 'clean', '+feet out', 'clean']) })]);
  assert.equal(d.labelled, 5);
  assert.ok(d.candidates.total >= 90 && d.candidates.kept === d.candidates.total, JSON.stringify(d.candidates));
  assert.equal(d.groups.length, 1, 'one fault named, so no "any fault" group');
  const g = d.groups[0];
  assert.equal(g.id, '+feet out'); assert.equal(g.label, 'feet out'); assert.equal(g.when, 'rep');
  assert.deepEqual(g.n, { clean: 3, marked: 2 }); assert.equal(g.status, 'ok');
  assert.ok(g.luck > 10, 'with five reps a perfect split is cheap, and the count says so: ' + g.luck);
  const r = g.rows[0], m = r.measurement;
  assert.equal(r.rank, 1); assert.equal(r.status, 'new'); assert.equal(r.existing, null);
  assert.equal(m.kind, 'tilt', JSON.stringify(m));
  assert.ok(pts(m).every((p) => SHIN.includes(p)) && pts(m).includes('knee'), 'a line on the shin: ' + pts(m));
  assert.equal(r.side, 'below');
  assert.ok(r.edge > r.marked.hi && r.edge < r.clean.lo, `the edge ${r.edge} between the marked ${r.marked.hi} and the clean ${r.clean.lo}`);
  assert.ok(r.sep > 5 && r.gap > 20, `a wide gap in noise units: gap ${r.gap}, noise ${r.noise}, sep ${r.sep}`);
  const kneeAngle = (x) => x.kind === 'angle' && x.b === 'knee' && x.a === 'hip';
  assert.ok(r.also.some((a) => kneeAngle(a.measurement)) || g.rows.some((x) => kneeAngle(x.measurement)), 'the knee angle moves with it, or stands as its own row: ' + JSON.stringify(g.rows.map((x) => x.measurement)));
  /* file-ready: a band on the marked side, a setting over the values seen, the default at the edge, a fault that uses it */
  assert.equal(m.band.min, m.settings[0].key); assert.deepEqual(m.scale, [m.settings[0].min, m.settings[0].max]);
  assert.ok(m.scale[0] <= r.marked.lo && m.scale[1] >= r.clean.hi);
  assert.deepEqual(r.defaults, { [m.band.min]: r.edge });
  assert.deepEqual(r.fault, { id: 'feetOut', measure: m.key, side: 'below', when: 'rep', label: 'feet out', text: 'feet out', tone: 'plain' }, 'the fault says its own name until it is given words');
  assert.equal(r.values.length, 5); assert.deepEqual(r.values.map((v) => v.marked), [false, true, false, true, false]); assert.equal(r.values[0].take, 'clip 1');
  assert.match(r.words.sentence, /^The shin line \(.*\) from upright — clean reps .*°, marked reps .*°; suggest at least −\d+° through the rep$/u, r.words.sentence);
  assert.match(r.why, /apart, .* the model's wobble on this segment; two points/);
  /* written into the file, the suggestion is a valid measurement and fault, and the coach flags the marked reps */
  const f2 = JSON.parse(JSON.stringify(file));
  f2.measurements.push(m); Object.assign(f2.defaults, r.defaults); f2.faults.push(Object.assign({}, r.fault, { text: 'Walk your feet in' }));
  assert.equal(Spec.check(f2).filter((p) => p.level === 'error').length, 0, JSON.stringify(Spec.check(f2)));
  const M2 = Spec.compile(f2, Core), B = run(M2, take(FEET_OUT, JIT));
  assert.deepEqual(B.reps.map((x) => x.faults.some((q) => q.id === 'feetOut')), [false, true, false, true, false]);
  /* and discovery, run again, finds the geometry already built */
  const d2 = Trace.discover(M2, [Object.assign(B, { labels: label(B.reps, ['clean', 'feetOut', 'clean', 'feetOut', 'clean']) })]);
  const top = d2.groups[0].rows[0];
  assert.equal(top.status, 'existing'); assert.equal(top.existing.key, m.key); assert.equal(top.existing.hasFault, true); assert.equal(top.fault, null);
});

test('an existing measurement wins its fold: on the full bridge the file\'s own shin angle is the row', () => {
  const A = run(M, take(FEET_OUT, JIT));
  const d = Trace.discover(M, [Object.assign(A, { labels: label(A.reps, ['clean', 'feetFar', 'clean', 'feetFar', 'clean']) })]);
  const g = d.groups[0];
  assert.equal(g.id, 'feetFar'); assert.equal(g.label, 'Feet too far out'); assert.equal(g.when, 'always', 'the fault\'s own window');
  const r = g.rows[0];
  assert.equal(r.status, 'existing'); assert.deepEqual(r.existing, { key: 'shin', label: 'toe, heel, knee', hasBand: true, hasFault: true });
  assert.equal(r.measurement.kind, 'angle'); assert.deepEqual(pts(r.measurement), ['toe', 'heel', 'knee']);
  assert.equal(r.side, 'above'); assert.ok(r.edge > 96 && r.edge < 121, 'the edge between the walls: ' + r.edge);
  assert.equal(r.fault, null, 'the fault is already on it');
  const shinSig = (m) => m.kind === 'angle' && pts(m).slice().sort().join() === 'heel,knee,toe';
  assert.ok(!g.rows.some((x) => x.status === 'new' && shinSig(x.measurement)), 'nothing already built is offered as new');
});

test('nothing separates identical reps, however they are marked', () => {
  const A = run(M, take([[REST, 3000], ...rep(), ...rep(), ...rep(), ...rep(), ...rep()], JIT));
  const d = Trace.discover(M, [Object.assign(A, { labels: label(A.reps, ['clean', 'hipHigh', 'clean', 'clean', 'hipHigh']) })]);
  const g = d.groups.find((x) => x.id === 'hipHigh');
  assert.equal(g.status, 'none'); assert.deepEqual(g.rows, []);
  assert.ok(g.luck > 1, 'and the luck count says why a split would mean little: ' + g.luck);
  assert.match(g.note, /Nothing I can measure from these landmarks tells the 2 reps you marked ‘Hips above knees’ from the 3 clean ones/);
});

test('the floor: two clean reps and one marked, and a small effect under the gate', () => {
  const A = run(NOSHIN, take([[REST, 3000], ...rep(), ...rep({ shin: 120 }), ...rep()], JIT));
  const d = Trace.discover(NOSHIN, [Object.assign(A, { labels: label(A.reps, ['clean', '+feet out', 'clean']) })]);
  const g = d.groups[0];
  assert.deepEqual(g.n, { clean: 2, marked: 1 }); assert.equal(g.status, 'ok');
  assert.ok(g.rows.length >= 1);
  const r = g.rows[0];
  assert.equal(r.measurement.kind, 'tilt'); assert.ok(pts(r.measurement).every((p) => SHIN.includes(p)));
  assert.ok(r.sep >= 2, 'the gate is two wobbles with one marked rep: ' + r.sep);
  assert.ok(g.luck > 40 && g.luck < 70, 'two thirds of the candidates would split three reps by luck: ' + g.luck);
  assert.ok(r.edge > r.marked.hi && r.edge < r.clean.lo);
  /* a three-degree lean is inside the model's wobble on a shin: no row */
  const B = run(NOSHIN, take([[REST, 3000], ...rep(), ...rep({ shin: 98 }), ...rep()], JIT));
  const d2 = Trace.discover(NOSHIN, [Object.assign(B, { labels: label(B.reps, ['clean', '+feet out', 'clean']) })]);
  assert.equal(d2.groups[0].status, 'none', JSON.stringify(d2.groups[0].rows.map((x) => [x.measurement.key, x.sep])));
  assert.deepEqual(d2.groups[0].rows, []);
  /* fewer than two clean or no marked: too few, and no luck computed */
  const d3 = Trace.discover(NOSHIN, [Object.assign({}, A, { labels: label(A.reps, ['clean', '+feet out', '+feet out']) })]);
  assert.equal(d3.groups[0].status, 'few'); assert.equal(d3.groups[0].luck, null); assert.match(d3.groups[0].note, /two clean reps and one with ‘feet out’/);
  assert.deepEqual(Trace.discover(NOSHIN, [Object.assign({}, A, { labels: [] })]).groups, []);
});

test('change from the start: two recordings whose start positions differ, the lean on top of each', () => {
  /* take A starts with the shin at 95 and the marked reps lean to 110 at the top; take B starts at 115 and leans to 130.
     The plain lean overlaps across the takes — B's clean start is further than A's marked top — and the change from the start does not. */
  const A = run(NOSHIN, take([[REST, 3000], ...rep(), ...rep({ shin: 110 }), ...rep(), ...rep({ shin: 110 })], Object.assign({ seed: 1 }, JIT)), 'A');
  const far = { shin: 115 };
  const B = run(NOSHIN, take([[Object.assign({}, REST, far), 3000], ...rep(far, far), ...rep({ shin: 130 }, far), ...rep(far, far), ...rep({ shin: 130 }, far)], Object.assign({ seed: 2 }, JIT)), 'B');
  const tags = ['clean', '+feet out', 'clean', '+feet out'];
  const d = Trace.discover(NOSHIN, [Object.assign(A, { labels: label(A.reps, tags) }), Object.assign(B, { labels: label(B.reps, tags) })]);
  assert.equal(d.labelled, 8); assert.equal(d.candidates.skipped.noStart, 0);
  const g = d.groups[0];
  assert.deepEqual(g.n, { clean: 4, marked: 4 }); assert.equal(g.status, 'ok');
  const r = g.rows[0];
  assert.equal(r.measurement.fromStart, 'change', JSON.stringify(r.measurement));
  assert.ok(pts(r.measurement).includes('knee') && pts(r.measurement).some((p) => SHIN.includes(p) && p !== 'knee'), 'on the leg at the knee: ' + pts(r.measurement));
  /* the shin's own lean, as the change from the start, reads nought on every clean rep in both takes */
  const shin = g.rows.find((x) => x.measurement.kind === 'tilt' && x.measurement.fromStart === 'change' && pts(x.measurement).every((p) => SHIN.includes(p)));
  assert.ok(shin, 'the shin lean, as a change, is a row: ' + JSON.stringify(g.rows.map((x) => x.measurement)));
  const cleanV = shin.values.filter((v) => !v.marked).map((v) => v.v);
  /* the level a rep held is its extreme over the window, so a steady reading sits a wobble or two under its own median baseline — within the row's noise, not at nought */
  assert.ok(cleanV.every((v) => Math.abs(v) <= 2 * shin.noise), `the clean reps read their own start (noise ${shin.noise}): ` + cleanV);
  assert.deepEqual([...new Set(r.values.map((v) => v.take))], ['A', 'B']);
  assert.ok(r.values.filter((v) => v.take === 'A').length === 4 && r.values.filter((v) => v.take === 'B').length === 4);
  assert.match(shin.words.sentence, /change since the start/);
  assert.ok(g.luck < 5, 'eight reps, four marked: luck is small now: ' + g.luck);
});

test('trust: a landmark the model is unsure of is left out, and said so', () => {
  const A = run(NOSHIN, take([[REST, 3000], ...rep(), ...rep({ shin: 120 }), ...rep()], Object.assign({ pose: { dim: { wrist: 0.3 } } }, JIT)));
  const d = Trace.discover(NOSHIN, [Object.assign(A, { labels: label(A.reps, ['clean', '+feet out', 'clean']) })]);
  const u = d.candidates.skipped.untrusted;
  assert.equal(u.length, 1); assert.equal(u[0].landmark, 'wrist'); assert.ok(u[0].share < 0.9 && u[0].need > 0, JSON.stringify(u));
  assert.equal(d.candidates.kept, d.candidates.total - u[0].need);
  for (const g of d.groups) for (const r of g.rows) {
    assert.ok(!pts(r.measurement).includes('wrist'), 'no row uses the wrist');
    for (const a of r.also) assert.ok(!pts(a.measurement).includes('wrist'));
  }
  assert.equal(d.groups[0].status, 'ok', 'and the shin is still found');
});

test('performance: thirty seconds at fifteen frames a second, under a second', () => {
  const frames = take([[REST, 3000], ...rep(), ...rep(), ...rep({ shin: 120 }), ...rep()], Object.assign({ fps: 15 }, JIT));
  assert.ok(frames.length > 400 && frames.length < 500, 'about 450 frames: ' + frames.length);
  const A = run(M, frames);
  assert.equal(A.reps.length, 4);
  const labels = label(A.reps, ['clean', 'clean', 'feetFar', 'clean']);
  const t0 = Date.now();
  const d = Trace.discover(M, [Object.assign(A, { labels })]);
  const ms = Date.now() - t0;
  assert.ok(ms < 1000, 'discover took ' + ms + ' ms');
  assert.equal(d.groups[0].status, 'ok'); assert.equal(d.groups[0].rows[0].existing.key, 'shin');
});

test('the groups: every fault the labels name, and all of them together; windowOf is the coach\'s window', () => {
  const A = run(M, take(FEET_OUT, JIT));
  const labels = label(A.reps, ['clean', 'feetFar', 'clean', '+feet out', 'clean']);
  labels[3].faults.push('hipHigh');
  const d = Trace.discover(M, [Object.assign(A, { labels })]);
  assert.deepEqual(d.groups.map((g) => g.id), ['feetFar', '+feet out', 'hipHigh', '*']);
  const any = d.groups.find((g) => g.id === '*');
  assert.equal(any.label, 'Any fault'); assert.deepEqual(any.n, { clean: 3, marked: 2 }); assert.equal(any.status, 'ok');
  assert.deepEqual(d.groups.find((g) => g.id === 'feetFar').n, { clean: 4, marked: 1 }, 'a rep marked with another fault is clean for this one');
  assert.deepEqual(d.groups.find((g) => g.id === 'hipHigh').n, { clean: 4, marked: 1 });
  assert.equal(d.groups.find((g) => g.id === 'hipHigh').status, 'none', 'the hips were never high');
  /* the window by a fault's id or by its name */
  const r = A.reps[0];
  assert.deepEqual(Trace.windowOf(A.result, M, r, 'hipHigh').map((x) => x.t), Trace.windowOf(A.result, M, r, 'top').map((x) => x.t));
  assert.ok(Trace.windowOf(A.result, M, r, 'top').every((x) => x.verdict.raised && x.t >= r.t0 && x.t <= r.t1));
  assert.ok(Trace.windowOf(A.result, M, r, 'between').every((x) => x.t < r.t0));
  assert.equal(Trace.windowOf(A.result, M, r, 'always').length, Trace.windowOf(A.result, M, r, 'rep').length + Trace.windowOf(A.result, M, r, 'between').length);
  assert.deepEqual(Trace.windowIdx(A.result, M, r, 'rep').map((i) => A.result.rows[i]), Trace.windowOf(A.result, M, r, 'rep'));
  /* a wobble floor from the geometry: a foot is shorter than a shin, so the same jitter is more degrees on it */
  const len = (a, b) => ({ 'heel|toe': 0.07, 'heel|knee': 0.15, 'knee|hip': 0.17 }[a + '|' + b] || 0.15);
  assert.ok(Trace.noiseOf({ kind: 'rise', a: 'heel', b: 'toe' }, len, 0.004) > Trace.noiseOf({ kind: 'tilt', base: 'heel', top: 'knee' }, len, 0.004));
  assert.ok(Trace.noiseOf({ kind: 'tilt', base: 'heel', top: 'knee', fromStart: 'change' }, len, 0.004) > Trace.noiseOf({ kind: 'tilt', base: 'heel', top: 'knee' }, len, 0.004));
});
