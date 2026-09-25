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
  const r = Trace.run(M, {}, frames, ASPECT);
  assert.equal(r.rows.length, frames.length);
  assert.ok(Math.abs(r.rows[10].reading.hip - 130) < 0.5, 'the reading is there: ' + r.rows[10].reading.hip);
  assert.ok(r.cues.some((c) => c.id === 'raise') && r.cues.some((c) => c.id === 'count1'), JSON.stringify(r.cues.map((c) => c.text)));
  assert.equal(r.summary.reps, 1);
  const top = r.rows.find((x) => x.out.phase === 'up');
  assert.ok(top, 'the phases are on the rows');
});

test('the numbers laid over the defaults change the verdicts, and the trace need not be read again', () => {
  const frames = take([[REST, 3000], [Object.assign({}, TOP, { dip: -4 }), 3500], [HALF, 1300], [REST, 1500]]);   // four above the knee
  const strict = Trace.run(M, {}, frames, ASPECT);
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
  const again = Trace.run(M, {}, back.frames, ASPECT);
  assert.ok(Math.abs(again.rows[5].reading.hip - 130) < 0.5);
  assert.throws(() => Trace.unpack('{"v":2}'), /not a trace/);
  const keys = Trace.settingsOf(M).map((s) => s.key);
  assert.ok(keys.includes('shinMin') && keys.includes('overMax') && keys.includes('repCount'));
  assert.equal(Trace.defaults(M).overMax, 3);
  assert.deepEqual(Trace.bandRange(M.bands[2], Trace.defaults(M)), { lo: -40, hi: 3 });
});
