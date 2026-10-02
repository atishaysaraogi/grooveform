'use strict';
/* A recording judged after the fact: the same readings and cues the phone would
   have given, the takes held to the tuning rule, and a trace that survives a
   trip through a file. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const Trace = require('../public/js/trace.js');
const Moves = require('../public/js/moves.js');
const M = Moves.bridge;

const D = Math.PI / 180;
const ASPECT = 16 / 9;
/* the bridge rig from bridge.test.js, enough of it for a trace */
function body({ shin = 95, dip = 50, hipAng = 130, foot = 0, facing = 1, vis = 0.95 } = {}) {
  const heelAt = [0.64, 0.68], footLen = 0.07, shinLen = 0.15, thighLen = 0.17, torso = 0.2;
  const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  const heel = { x: heelAt[0], y: heelAt[1] };
  const toeDir = { x: facing * Math.cos(foot * D), y: Math.sin(foot * D) };
  const toe = { x: heel.x + footLen * toeDir.x, y: heel.y + footLen * toeDir.y };
  const sd = rot(toeDir, -facing * shin * D);
  const knee = { x: heel.x + shinLen * sd.x, y: heel.y + shinLen * sd.y };
  const ankle = { x: heel.x + shinLen * 0.12 * sd.x, y: heel.y + shinLen * 0.12 * sd.y };
  const td = { x: -facing * Math.cos(dip * D), y: Math.sin(dip * D) };
  const hip = { x: knee.x + thighLen * td.x, y: knee.y + thighLen * td.y };
  const bd = rot({ x: -td.x, y: -td.y }, -facing * hipAng * D);
  const shoulder = { x: hip.x + torso * bd.x, y: hip.y + torso * bd.y };
  const P = { heel, toe, knee, ankle, hip, shoulder, ear: { x: shoulder.x - facing * 0.05, y: shoulder.y - 0.01 } };
  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  for (const side of ['L', 'R']) for (const [name, i] of Object.entries(Core.SIDE[side])) { const p = P[name]; if (p) lm[i] = { x: p.x / ASPECT, y: p.y, z: 0, visibility: vis }; }
  return lm;
}
/* a take: a list of [pose, ms] stretches at 30 frames a second */
function take(script) {
  const frames = []; let t = 0;
  for (const [pose, ms] of script) for (const end = t + ms; t < end; t += 33) frames.push({ t, lm: body(pose) });
  return frames;
}
const REST = { shin: 95, dip: 50, hipAng: 130 }, TOP = { shin: 95, dip: 5, hipAng: 170 }, HALF = { shin: 95, dip: 25, hipAng: 145 };
const cleanRep = [[REST, 3000], [TOP, 3500], [HALF, 1300], [REST, 1500]];

test('a trace run gives a row per frame with the reading, the verdict and the coach\'s cue', () => {
  const frames = take(cleanRep);
  const r = Trace.run(M, { readyMs: 2000 }, frames, ASPECT);
  assert.equal(r.rows.length, frames.length);
  assert.ok(Math.abs(r.rows[10].reading.hip - 130) < 0.5, 'the reading is there: ' + r.rows[10].reading.hip);
  assert.ok(r.cues.some((c) => c.id === 'raise') && r.cues.some((c) => c.id === 'count1'), JSON.stringify(r.cues.map((c) => c.text)));
  assert.equal(r.summary.reps, 1);
  const top = r.rows.find((x) => x.out.phase === 'up');
  assert.ok(top, 'the phases are on the rows');
});

test('the numbers laid over the defaults change the verdicts, and the trace need not be read again', () => {
  const frames = take([[REST, 3000], [Object.assign({}, TOP, { dip: -4 }), 3500], [HALF, 1300], [REST, 1500]]);   // four above the knee
  const strict = Trace.run(M, { readyMs: 2000 }, frames, ASPECT);
  assert.ok(Trace.stretches(strict, 'hipHigh').length > 0, 'four is over three');
  const eased = Trace.run(M, { overMax: 6 }, frames, ASPECT);
  assert.equal(Trace.stretches(eased, 'hipHigh').length, 0, 'and under six');
  assert.equal(eased.cfg.overMax, 6);
});

test('the tuning rule: quiet on every clean take, fires on every take of the fault', () => {
  const clean1 = { name: 'clean 1', tag: 'clean', frames: take(cleanRep), aspect: ASPECT };
  const clean2 = { name: 'clean 2', tag: 'clean', frames: take(cleanRep), aspect: ASPECT };
  const high = { name: 'too high', tag: 'hipHigh', frames: take([[REST, 3000], [Object.assign({}, TOP, { dip: -12 }), 3500], [HALF, 1300], [REST, 1500]]), aspect: ASPECT };
  const feet = { name: 'feet out', tag: 'feetFar', frames: take([[Object.assign({}, REST, { shin: 125 }), 4000]]), aspect: ASPECT };
  const v = Trace.verdicts(M, {}, [clean1, clean2, high, feet]);
  const row = (id) => v.table.find((x) => x.id === id);
  assert.deepEqual([row('hipHigh').cleanFired, row('hipHigh').faultFired, row('hipHigh').pass], [0, 1, true]);
  assert.deepEqual([row('feetFar').cleanFired, row('feetFar').faultFired, row('feetFar').pass], [0, 1, true]);
  assert.equal(row('heelsUp').pass, null, 'no take of it, no verdict');
  assert.equal(row('heelsUp').cleanTotal, 2);
  /* numbers that make a clean take fire fail the rule */
  const tight = Trace.verdicts(M, { overMax: -8 }, [clean1, high]);
  assert.equal(tight.table.find((x) => x.id === 'hipHigh').cleanFired, 1);
  assert.equal(tight.table.find((x) => x.id === 'hipHigh').pass, false);
});

test('a trace survives a trip through a file, and the settings list is the panel\'s', () => {
  const frames = take([[REST, 500]]);
  const json = JSON.stringify(Trace.pack({ move: 'bridge', aspect: ASPECT, source: 'test' }, frames));
  const back = Trace.unpack(json);
  assert.equal(back.meta.move, 'bridge'); assert.equal(back.meta.aspect, ASPECT);
  assert.equal(back.frames.length, frames.length);
  assert.ok(Math.abs(back.frames[3].lm[24].x - frames[3].lm[24].x) < 1e-3);
  const again = Trace.run(M, { readyMs: 2000 }, back.frames, ASPECT);
  assert.ok(Math.abs(again.rows[5].reading.hip - 130) < 0.5);
  assert.throws(() => Trace.unpack('{"v":2}'), /not a trace/);
  const keys = Trace.settingsOf(M).map((s) => s.key);
  assert.ok(keys.includes('shinMin') && keys.includes('overMax') && keys.includes('repCount'));
  assert.equal(Trace.defaults(M).overMax, 3);
  assert.deepEqual(Trace.bandRange(M.bands[2], Trace.defaults(M)), { lo: -40, hi: 3 });
});

test('the reps are broken out one by one, with the faults inside each and when they were said', () => {
  /* two reps, the first past the knees for a moment at the top, then a dropped attempt */
  const frames = take([[REST, 3000], [TOP, 1500], [Object.assign({}, TOP, { dip: -12 }), 1500], [TOP, 2500], [HALF, 1300], [REST, 2600],
    [TOP, 3500], [HALF, 1300], [REST, 2600],
    [TOP, 800], [REST, 1500]]);
  const r = Trace.run(M, { readyMs: 2000 }, frames, ASPECT);
  const reps = Trace.reps(r, M);
  assert.equal(reps.length, 3, 'two reps and an attempt: ' + reps.map((x) => x.n).join(','));
  assert.deepEqual(reps.map((x) => x.counted), [true, true, false]);
  assert.deepEqual(reps.map((x) => x.n), [1, 2, null]);
  assert.ok(reps[0].t0 >= 2900 && reps[0].t0 <= 3200, 'the first rep starts at the lift: ' + reps[0].t0);
  const high = reps[0].faults.find((f) => f.id === 'hipHigh');
  assert.ok(high, 'the first rep flags the hips past the knees: ' + JSON.stringify(reps[0].faults.map((f) => f.id)));
  assert.ok(high.stretches[0].t0 >= 4400 && high.stretches[0].t0 <= 4700, 'from the moment it went past: ' + high.stretches[0].t0);
  assert.ok(high.said.length === 1 && high.said[0] >= high.stretches[0].t0, 'and was said, once, after it held: ' + high.said);
  assert.equal(reps[1].faults.length, 0, 'the second rep is clean — a hip still on its way up is not short of the line: ' + JSON.stringify(reps[1].faults));
  assert.ok(reps[0].holdMs > 1500 && reps[1].holdMs > 1500, 'each earned its hold');
  assert.ok(reps[0].lowerMs > 1000, 'and the lowering took its time: ' + reps[0].lowerMs);
  assert.ok(reps[2].cues.some((c) => c.id === 'early'), 'the dropped attempt was told so');
  /* the numbers moved: the fault leaves the rep */
  const eased = Trace.reps(Trace.run(M, { readyMs: 2000, overMax: 15 }, frames, ASPECT), M);
  assert.ok(!eased[0].faults.some((f) => f.id === 'hipHigh'));
  /* set-up faults in the pause before a rep */
  const feet = take([[Object.assign({}, REST, { shin: 125 }), 3000], [REST, 800], [TOP, 3500], [HALF, 1300], [REST, 1500]]);
  const rr = Trace.reps(Trace.run(M, { readyMs: 2000 }, feet, ASPECT), M);
  assert.ok(rr[0].before.faults.some((f) => f.id === 'feetFar'), 'the feet out, before the first rep');
});

test('a hold is cut into the stretches its clock ran', () => {
  const W = Moves.wallsit;
  const frames = [];
  /* the wall sit rig is not here; the bridge as a hold stands in — the coach treats any move without reps as a hold */
  const H = Object.assign({}, M, { reps: false, ready: null, defaults: Object.assign({}, M.defaults, { holdTargetSec: 60, callAtSec: [] }) });
  let t = 0; for (const [pose, ms] of [[TOP, 2500], [REST, 800], [TOP, 2500], [REST, 400]]) for (const end = t + ms; t < end; t += 33) frames.push({ t, lm: body(pose) });
  const r = Trace.run(H, { readyMs: 0 }, frames, ASPECT);   // the set-up wait has tests of its own
  const holds = Trace.reps(r, H);
  assert.equal(holds.length, 2, 'two stretches: ' + holds.length);
  assert.ok(holds[0].holdMs > 1000 && holds[1].holdMs > 1000);
  assert.ok(holds[1].before.faults.some((f) => f.id === 'hipLow'), 'what broke the hold, in between');
  assert.ok(W.faults.length, 'the wall sit exists');
});

test('an attempt is accounted for: how far it got, its hold against the target, and what fell short of a rep', () => {
  /* a rep, a half-hearted lift that never reaches the line, and an attempt put down before its hold */
  const frames = take([[REST, 3000], [TOP, 3500], [HALF, 1300], [REST, 2600], [HALF, 1200], [REST, 2000], [TOP, 800], [REST, 1500]]);
  const r = Trace.run(M, { readyMs: 2000 }, frames, ASPECT);
  const reps = Trace.reps(r, M);
  assert.equal(reps.length, 2, 'a rep and an attempt: ' + reps.length);
  const P = Trace.progressOf(M, r.cfg);
  assert.ok(P && P.of && typeof P.raiseAt === 'number' && typeof P.downAt === 'number', 'the rep reading and its lines: ' + JSON.stringify(P));
  for (const x of reps) { assert.ok(x.why && x.why.peak != null, 'each attempt says how far it got'); assert.equal(x.why.targetMs, r.cfg.holdTargetSec * 1000); }
  assert.ok(reps[0].counted && !reps[1].counted && reps[1].early, 'the second was put down early');
  assert.ok(reps[1].why.inPosMs < reps[0].why.inPosMs, 'and was in position for less of its time: ' + reps[1].why.inPosMs + ' < ' + reps[0].why.inPosMs);
  const misses = Trace.misses(r, M);
  assert.equal(misses.length, 1, 'the half lift fell short of a rep: ' + JSON.stringify(misses));
  assert.ok(misses[0].share >= 0.4 && misses[0].share < 1 && misses[0].t0 > reps[0].t1 && misses[0].t1 < reps[1].t0, 'between the rep and the attempt: ' + JSON.stringify(misses[0]));
  assert.equal(Trace.misses(r, Object.assign({}, M, { reps: false })).length, 0, 'a hold has no reps to fall short of');
});

test('reps classified by a person: the edge that agrees with them is recommended, the current one kept when it already does', () => {
  /* four reps: two clean at the top, one with the hips past the knees (dip -12), one not high enough (hipAng 150) */
  const frames = take([[REST, 3000],
    [TOP, 3500], [HALF, 1300], [REST, 2600],
    [Object.assign({}, TOP, { dip: -12 }), 3500], [HALF, 1300], [REST, 2600],
    [TOP, 3500], [HALF, 1300], [REST, 2600],
    [Object.assign({}, TOP, { hipAng: 150 }), 3500], [HALF, 1300], [REST, 2600]]);
  const r = Trace.run(M, { readyMs: 2000 }, frames, ASPECT);
  const reps = Trace.reps(r, M);
  assert.equal(reps.length, 4, 'four reps: ' + reps.map((x) => x.n + (x.counted ? '' : '!')).join(','));
  const labels = [
    { t0: reps[0].t0, t1: reps[0].t1, tag: 'clean' },
    { t0: reps[1].t0, t1: reps[1].t1, tag: 'faults', faults: ['hipHigh'] },
    { t0: reps[2].t0, t1: reps[2].t1, tag: 'clean' },
    { t0: reps[3].t0, t1: reps[3].t1, tag: 'faults', faults: ['hipLow'] },
  ];
  assert.equal(Trace.labelOf(labels, reps[1]), labels[1], 'a label finds its rep by its time');
  assert.equal(Trace.labelOf(labels, { t0: reps[1].t1 + 50, t1: reps[1].t1 + 400 }), null, 'and not a stretch beside it');
  const rec = Trace.recommend(M, r, reps, labels, Trace.misses(r, M));
  assert.equal(rec.labelled, 4); assert.equal(rec.unlabelled, 0);
  const high = rec.faults.find((f) => f.id === 'hipHigh'), low = rec.faults.find((f) => f.id === 'hipLow');
  assert.ok(high && low, rec.faults.map((f) => f.id).join(','));
  /* hips past the knees: the clean reps sit about five below the knee line, the marked rep about twelve above; the
     allowance of three already divides them, so it stays */
  assert.equal(high.key, 'overMax'); assert.equal(high.status, 'fine'); assert.equal(high.value, high.now);
  assert.equal(high.clean.n, 3, 'the hipLow rep counts as clean for this fault'); assert.equal(high.bad.n, 1);
  assert.ok(high.clean.hi < 0 && high.bad.lo > 8, `clean up to ${high.clean.hi}, marked from ${high.bad.lo}`);
  assert.equal(high.nowFalse, 0); assert.equal(high.nowMiss, 0);
  /* not high enough: the marked rep's hip reaches about 150, the clean ones 170; the line of 160 already divides them */
  assert.equal(low.key, 'hipMin'); assert.equal(low.status, 'fine'); assert.equal(low.side, 'below');
  assert.ok(low.bad.hi < 155 && low.clean.lo > 165, `marked up to ${low.bad.hi}, clean from ${low.clean.lo}`);
  /* the allowance moved to fifteen: the marked rep no longer fires, and the recommendation brings it back between the walls */
  const r2 = Trace.run(M, { readyMs: 2000, overMax: 15 }, frames, ASPECT), reps2 = Trace.reps(r2, M);
  const rec2 = Trace.recommend(M, r2, reps2, labels, []);
  const high2 = rec2.faults.find((f) => f.id === 'hipHigh');
  assert.equal(high2.nowMiss, 1, 'at fifteen the marked rep is missed');
  assert.equal(high2.status, 'move'); assert.ok(high2.value > high2.clean.hi && high2.value < high2.bad.lo, `recommended ${high2.value} between ${high2.clean.hi} and ${high2.bad.lo}`);
  assert.equal(high2.afterMiss, 0); assert.equal(high2.afterFalse, 0);
  /* the line moved the other way, to minus two: the clean reps fire; the recommendation lifts it just past them */
  const r3 = Trace.run(M, { readyMs: 2000, overMax: -8 }, frames, ASPECT), reps3 = Trace.reps(r3, M);
  const rec3 = Trace.recommend(M, r3, reps3, labels, []);
  const high3 = rec3.faults.find((f) => f.id === 'hipHigh');
  assert.ok(high3.nowFalse >= 1, 'clean reps fire at minus eight: ' + high3.nowFalse);
  assert.equal(high3.status, 'move'); assert.ok(high3.value >= high3.clean.hi && high3.value < high3.bad.lo, `lifted to ${high3.value}`);
  assert.equal(high3.afterFalse, 0);
  /* a person who calls a clean rep faulty and a faulty rep clean: the two overlap, and the best cut is reported with what it gets wrong */
  const mixed = [{ t0: reps[0].t0, t1: reps[0].t1, tag: 'faults', faults: ['hipHigh'] }, { t0: reps[1].t0, t1: reps[1].t1, tag: 'clean' }, { t0: reps[2].t0, t1: reps[2].t1, tag: 'clean' }];
  const rec4 = Trace.recommend(M, r, reps, mixed, []);
  const high4 = rec4.faults.find((f) => f.id === 'hipHigh');
  assert.equal(high4.status, 'overlap'); assert.equal(high4.afterFalse + high4.afterMiss, 1, 'one rep is on the wrong side whatever the cut');
  /* a stretch marked as not a rep is left out of everything */
  const rec5 = Trace.recommend(M, r, reps, labels.map((l, i) => (i === 1 ? Object.assign({}, l, { tag: 'skip' }) : l)), []);
  assert.equal(rec5.skipped, 1);
  const high5 = rec5.faults.find((f) => f.id === 'hipHigh');
  assert.equal(high5.bad.n, 0, 'no rep marked with it is left'); assert.equal(high5.clean.n, 3); assert.equal(high5.status, 'fine', 'and the edge is quiet on the clean ones, which is all that can be said');
  /* the sustained level: a one-frame spike is not a level */
  assert.equal(Trace.sustained([{ v: 10, dt: 33 }, { v: 2, dt: 33 }, { v: 3, dt: 33 }, { v: 2, dt: 33 }], 'above', 60), 3);
  assert.equal(Trace.sustained([{ v: 10, dt: 33 }, { v: 2, dt: 33 }], 'below', 60), 10);
});

test('the lift line: a movement the person called a rep has to cross it', () => {
  /* a rep, then a smaller one that only gets to a hip angle of 150 — short of the 160 line the file starts a rep at */
  const frames = take([[REST, 3000], [TOP, 3500], [HALF, 1300], [REST, 2600], [{ shin: 95, dip: 28, hipAng: 146 }, 2500], [REST, 2600]]);
  const r = Trace.run(M, { readyMs: 2000 }, frames, ASPECT);
  const reps = Trace.reps(r, M), misses = Trace.misses(r, M);
  assert.equal(reps.length, 1); assert.equal(misses.length, 1, 'the small one fell short: ' + JSON.stringify(misses.map((m) => m.peak)));
  const rec = Trace.recommend(M, r, reps, [{ t0: reps[0].t0, t1: reps[0].t1, tag: 'clean' }, { t0: misses[0].t0, t1: misses[0].t1, tag: 'rep' }], misses);
  const line = rec.lines[0];
  assert.ok(line && line.key === 'raiseAt' && line.status === 'move', JSON.stringify(rec.lines));
  assert.ok(line.value < misses[0].peak && line.value > 140, `the line comes down to ${line.value}, under the small rep's ${misses[0].peak}`);
  const rec2 = Trace.recommend(M, r, reps, [{ t0: reps[0].t0, t1: reps[0].t1, tag: 'clean' }], misses);
  assert.equal(rec2.lines[0].status, 'fine', 'without the person\'s word the line stands');
});
