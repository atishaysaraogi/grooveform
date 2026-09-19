'use strict';
/* The elbow plank, held to bodies built to read a known angle. Same discipline as
   the wall sit: every number the app acts on is checked against a body posed to
   exactly that number. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const M = require('../public/js/moves.js').plank;

const D = Math.PI / 180;
const ASPECT = 16 / 9;
const cfg = (o) => Object.assign({}, Core.COMMON, M.defaults, o);
const read = (lm, o) => M.read(lm, ASPECT, cfg(o));
const judge = (r, o) => M.judge(r, cfg(o));

/* A plank seen from the side, built backwards from the angles it should read.
     stack  the upper arm's lean off vertical, + = shoulder ahead of the elbow
     sag    how far the hip sits off the shoulder→ankle line, + = hips piked up
     facing +1 = head to the image right, -1 = mirrored

   It is built from the shoulder down the arm and then along the body, and the
   body is bent at the hip by exactly the angle asked for. Bending at the hip
   rather than sliding the hip off the line is what keeps every limb the same
   length whatever the sag is — limb lengths are the one thing a real body cannot
   change, so a rig that stretched them would be proving something about a body
   that does not exist. With the shoulder pinned it is the feet that move; on a
   real person it would be the shoulders, and since the reading is an angle at the
   hip it makes no difference which end gives.

   The arm and the body are built independently, so a plank can have the shoulders
   wrong and the hips right, and each cue can be checked on its own fault.

   Lengths are shares of the frame height; x is divided by the aspect on the way out,
   because that is how a pose model reports it. */
function body({ stack = 0, sag = 0, facing = 1, shoulderAt = [0.62, 0.42], vis = 0.95,
                upper = 0.18, torso = 0.27, legs = 0.26, fore = 0.13 } = {}) {
  const P = {};
  P.shoulder = { x: shoulderAt[0], y: shoulderAt[1] };
  /* the upper arm, down from the shoulder, leaning `stack` off vertical toward the head */
  P.elbow = { x: P.shoulder.x - facing * upper * Math.sin(stack * D), y: P.shoulder.y + upper * Math.cos(stack * D) };
  P.wrist = { x: P.elbow.x + facing * fore, y: P.elbow.y + 0.012 };
  /* the body runs away from the head, slightly downhill toward the floor */
  const tilt = 12 * D;
  const dir = { x: -facing * Math.cos(tilt), y: Math.sin(tilt) };
  P.hip = { x: P.shoulder.x + torso * dir.x, y: P.shoulder.y + torso * dir.y };
  /* the legs, swung off the straight continuation by the sag. Piking the hips up
     means the far end drops, which is a turn the other way from the sign. */
  const a = -sag * D * facing, ca = Math.cos(a), sa = Math.sin(a);
  const leg = { x: dir.x * ca - dir.y * sa, y: dir.x * sa + dir.y * ca };
  P.ankle = { x: P.hip.x + legs * leg.x, y: P.hip.y + legs * leg.y };
  P.knee = { x: P.hip.x + legs * 0.55 * leg.x, y: P.hip.y + legs * 0.55 * leg.y };
  P.heel = { x: P.ankle.x - facing * 0.02, y: P.ankle.y + 0.035 };
  P.toe = { x: P.ankle.x - facing * 0.05, y: P.ankle.y + 0.055 };
  P.ear = { x: P.shoulder.x + facing * 0.05, y: P.shoulder.y - 0.04 };

  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  /* both sides get the same body: side-on the two limbs sit on top of each other */
  for (const s of ['L', 'R']) for (const [name, i] of Object.entries(Core.SIDE[s])) {
    const p = P[name]; if (!p) continue;
    lm[i] = { x: p.x / ASPECT, y: p.y, z: 0, visibility: vis };
  }
  return lm;
}
const readOf = (o) => read(body(o));

test('a straight plank reads straight, and the rig points the right way round', () => {
  const r = readOf({});
  assert.ok(r.ok);
  assert.ok(Math.abs(r.stack) < 0.01, 'a plumb upper arm reads zero: ' + r.stack);
  assert.ok(Math.abs(r.hipOff) < 0.01, 'a hip on the line reads zero: ' + r.hipOff);
  assert.equal(r.facing, 1, 'the head is to the right');
  assert.ok(r.points.elbow.y > r.points.shoulder.y, 'the elbow is below the shoulder');
  assert.ok(r.points.ankle.x < r.points.shoulder.x, 'and the feet are away from the head');
});

test('the shoulder over the elbow is read as the upper arm off vertical, signed toward the head', () => {
  for (const want of [-25, -10, -5, 0, 8, 15, 30]) {
    for (const facing of [1, -1]) {
      const r = readOf({ stack: want, facing });
      assert.ok(Math.abs(r.stack - want) < 0.01, `posed ${want}° facing ${facing}, read ${r.stack.toFixed(2)}°`);
    }
  }
  const fwd = readOf({ stack: 20 }), back = readOf({ stack: -20 });
  assert.ok(fwd.points.shoulder.x > fwd.points.elbow.x, 'positive puts the shoulder toward the head');
  assert.ok(back.points.shoulder.x < back.points.elbow.x, 'negative puts it behind the elbow');
});

test('the shoulder belongs over the elbow or a little in front, not behind it', () => {
  const g = (stack) => judge(readOf({ stack })).good.stack;
  assert.equal(g(-20), false, 'well behind the elbow');
  assert.equal(g(-6), false);
  assert.equal(g(-4), true, 'a few degrees behind is inside the read\'s own noise');
  assert.equal(g(0), true, 'stacked');
  assert.equal(g(14), true, 'slightly in front');
  assert.equal(g(16), false, 'too far in front');
});

test('the hip is read against the shoulder-to-ankle line, and the sign says up or down', () => {
  for (const want of [-20, -8, -5, 0, 5, 12, 25]) {
    for (const facing of [1, -1]) {
      const r = readOf({ sag: want, facing });
      assert.ok(Math.abs(r.hipOff - want) < 0.01, `posed ${want}° facing ${facing}, read ${r.hipOff.toFixed(2)}°`);
    }
  }
  /* the sign checked on the points, not taken on trust: above the line is positive */
  const up = readOf({ sag: 15 }), down = readOf({ sag: -15 }), flat = readOf({ sag: 0 });
  const onLine = (r) => r.points.shoulder.y + (r.points.hip.x - r.points.shoulder.x) *
    ((r.points.ankle.y - r.points.shoulder.y) / (r.points.ankle.x - r.points.shoulder.x));
  assert.ok(up.points.hip.y < onLine(up), 'positive is a hip above the line — piked');
  assert.ok(down.points.hip.y > onLine(down), 'negative is a hip below it — sagging');
  assert.ok(Math.abs(flat.points.hip.y - onLine(flat)) < 1e-9, 'zero is a hip on it');
});

test('the hip is allowed five degrees either side of the line', () => {
  const g = (sag) => judge(readOf({ sag })).good.line;
  assert.equal(g(0), true); assert.equal(g(4), true); assert.equal(g(-4), true);
  assert.equal(g(6), false, 'piked'); assert.equal(g(-6), false, 'sagging');
  assert.equal(g(20), false); assert.equal(g(-20), false);
});

test('a reading in degrees of bend does not change with how far away the camera is', () => {
  /* the same plank, half the size in frame: the angles must not move */
  const near = readOf({ sag: 12, stack: 10 });
  const far = read(body({ sag: 12, stack: 10, upper: 0.09, torso: 0.135, legs: 0.13, fore: 0.065, shoulderAt: [0.55, 0.45] }));
  assert.ok(Math.abs(near.hipOff - far.hipOff) < 0.01, `${near.hipOff.toFixed(2)} vs ${far.hipOff.toFixed(2)}`);
  assert.ok(Math.abs(near.stack - far.stack) < 0.01);
});

test('in position means both at once', () => {
  assert.equal(judge(readOf({ stack: 6, sag: 2 })).inPosition, true);
  assert.equal(judge(readOf({ stack: -15, sag: 0 })).inPosition, false, 'shoulders behind the elbows');
  assert.equal(judge(readOf({ stack: 0, sag: 9 })).inPosition, false, 'hips piked');
  assert.equal(judge(readOf({ stack: 0, sag: -9 })).inPosition, false, 'hips sagging');
});

test('a hidden or out-of-shot body is not judged', () => {
  const r = read(body({ vis: 0.2 }));
  assert.equal(r.ok, false);
  assert.equal(judge(r).inPosition, false);
  assert.equal(read(null), null);
  assert.equal(read([{ x: 0, y: 0 }]), null);
});

/* ---------- the coaching, over time ---------- */

/* play one posture for `ms`, at 30 frames a second, and collect what was said */
function play(coach, opts, ms, t0 = 0) {
  const said = []; let t = t0, last = null;
  for (; t < t0 + ms; t += 33) {
    last = coach.step(read(body(opts), coach.cfg), t);
    if (last.cue) said.push(last.cue);
  }
  return { said, last, t };
}

test('hips above the line are told to come down, hips below it to lift', () => {
  const up = play(new Core.Coach(M), { sag: 12 }, 1200).said;
  assert.equal(up[0].id, 'hipup', 'said: ' + JSON.stringify(up.map((x) => x.text)));
  assert.match(up[0].text, /lower your hips/i);
  const down = play(new Core.Coach(M), { sag: -12 }, 1200).said;
  assert.equal(down[0].id, 'hipdown');
  assert.match(down[0].text, /lift your hips/i);
  /* a long way off gets the stronger words, and the plank's bands are tight enough
     that "a long way" has to mean something tighter than the wall sit's */
  const far = play(new Core.Coach(M), { sag: -20 }, 1200).said;
  assert.match(far[0].text, /one line/i, 'fifteen degrees past the line is not a nudge');
});

test('the shoulders are called before the hips, being what the hips are measured from', () => {
  const c = new Core.Coach(M);
  /* shoulders barely out, hips miles out: the base still goes first */
  const first = play(c, { stack: -7, sag: 25 }, 1200);
  assert.equal(first.said[0].id, 'stackback', 'said: ' + JSON.stringify(first.said.map((x) => x.text)));
  assert.match(first.said[0].text, /shoulders over your elbows/i);
  /* fix the shoulders and the hips are what is left to say */
  const then = play(c, { stack: 0, sag: 25 }, 3000, first.t);
  assert.equal(then.said[0].id, 'hipup', 'said: ' + JSON.stringify(then.said.map((x) => x.text)));
});

test('shoulders too far in front are told to come back', () => {
  const said = play(new Core.Coach(M), { stack: 25 }, 1200).said;
  assert.equal(said[0].id, 'stackfwd');
  assert.match(said[0].text, /shoulders back/i);
});

test('a good plank is told to hold, and the same countdown runs', () => {
  const c = new Core.Coach(M, { holdTargetSec: 10, callAtSec: [5] });
  const r = play(c, { stack: 5, sag: 1 }, 12000);
  assert.equal(r.said.filter((x) => x.id === 'hold').length, 1, 'said once');
  const calls = r.said.filter((x) => /^call\d|^done$/.test(x.id));
  assert.deepEqual(calls.map((x) => x.text), ['5 seconds left', '10 seconds — done']);
  assert.equal(r.last.done, true);
  const s = c.summary();
  assert.equal(s.move, 'plank');
  assert.equal(s.reachedTarget, true);
  assert.deepEqual(s.cues, {}, 'and nothing was corrected: ' + JSON.stringify(s.cues));
});

test('coming out of the plank pauses the countdown rather than running it down', () => {
  const c = new Core.Coach(M, { holdTargetSec: 30 });
  let t = 0;
  ({ t } = play(c, { stack: 5, sag: 1 }, 10000, t));
  const left = c.step(read(body({ stack: 5, sag: 1 })), t).leftMs;
  const out = play(c, { sag: 30 }, 6000, t + 33);
  assert.equal(out.last.holding, false);
  assert.ok(Math.abs(out.last.leftMs - left) < 100, `the clock did not move: ${left} → ${out.last.leftMs}`);
});

test('the bands are settings, not rules baked into the code', () => {
  const strict = new Core.Coach(M, { hipLine: 2 });
  assert.equal(judge(readOf({ sag: 4 }), { hipLine: 2 }).good.line, false, 'narrowed, four degrees is out');
  assert.equal(judge(readOf({ sag: 4 })).good.line, true, 'and the default band is unchanged');
  assert.equal(strict.cfg.hipLine, 2);
});
