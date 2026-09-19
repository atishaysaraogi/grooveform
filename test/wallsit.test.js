'use strict';
/* The measurement and the coaching decision, held to frames built to read a known angle.
   A threshold nobody has measured is a guess, so every number the app acts on is checked here
   against a body posed to exactly that number. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../public/js/wallsit.js');

const D = Math.PI / 180;
const ASPECT = 16 / 9;

/* A body side-on, built backwards from the angles it should read.
     knee   the angle wanted at the knee, between hip and ankle
     tilt   how far the torso leans off vertical, + = the way the knees point
     facing +1 = knees to the image right, -1 = mirrored
   Lengths are shares of the frame height; x is divided by the aspect on the way out,
   because that is how a pose model reports it. */
function body({ knee = 90, tilt = 0, facing = 1, hip = [0.55, 0.5], vis = 0.95, thigh = 0.2, shin = 0.22, torso = 0.26 } = {}) {
  const P = {};
  P.hip = { x: hip[0], y: hip[1] };
  P.knee = { x: P.hip.x + facing * thigh, y: P.hip.y };                       // thigh horizontal
  const phi = (180 - knee) * D;                                               // shin, measured off the thigh
  P.ankle = { x: P.knee.x + facing * shin * Math.cos(phi), y: P.knee.y + shin * Math.sin(phi) };
  P.shoulder = { x: P.hip.x + facing * torso * Math.sin(tilt * D), y: P.hip.y - torso * Math.cos(tilt * D) };
  P.heel = { x: P.ankle.x - facing * 0.03, y: P.ankle.y + 0.012 };
  P.toe = { x: P.ankle.x + facing * 0.06, y: P.ankle.y + 0.015 };
  P.ear = { x: P.shoulder.x + facing * 0.02, y: P.shoulder.y - 0.07 };

  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  /* both sides get the same body: side-on the two legs sit on top of each other */
  for (const s of ['L', 'R']) for (const [name, i] of Object.entries(W.SIDE[s])) {
    const p = P[name]; if (!p) continue;
    lm[i] = { x: p.x / ASPECT, y: p.y, z: 0, visibility: vis };
  }
  return lm;
}

const readOf = (opts) => W.read(body(opts), ASPECT);

test('the knee angle read back is the knee angle posed, across the whole useful range', () => {
  for (const want of [60, 75, 85, 90, 100, 110, 125, 140]) {
    const r = readOf({ knee: want });
    assert.ok(r.ok, 'the body is readable at ' + want);
    assert.ok(Math.abs(r.knee - want) < 0.01, `posed ${want}°, read ${r.knee.toFixed(2)}°`);
  }
});

test('it reads the same angle on a body facing the other way', () => {
  for (const want of [80, 95, 115]) {
    const l = readOf({ knee: want, facing: 1 }), r = readOf({ knee: want, facing: -1 });
    assert.ok(Math.abs(l.knee - r.knee) < 0.01, `facing right ${l.knee.toFixed(2)}, facing left ${r.knee.toFixed(2)}`);
    assert.equal(l.facing, 1); assert.equal(r.facing, -1);
  }
});

test('the heel reading is the same angle taken to a nearer point, and is reported beside it', () => {
  const r = readOf({ knee: 90 });
  assert.ok(r.kneeHeel != null, 'it is read');
  /* the heel sits behind and below the ankle, so the angle to it is not the same number —
     which is exactly why the ankle is the one judged */
  assert.ok(Math.abs(r.kneeHeel - r.knee) > 2, 'and it differs from the ankle reading: ' + r.kneeHeel.toFixed(1));
});

test('torso lean is signed: + when the shoulders go the way the knees point', () => {
  for (const facing of [1, -1]) {
    assert.ok(Math.abs(readOf({ tilt: 0, facing }).tilt) < 0.01, 'upright reads zero');
    assert.ok(Math.abs(readOf({ tilt: 20, facing }).tilt - 20) < 0.01, 'leaning off the wall is positive');
    assert.ok(Math.abs(readOf({ tilt: -15, facing }).tilt + 15) < 0.01, 'the other way is negative');
  }
});

test('a hidden or out-of-shot body is not judged', () => {
  const r = W.read(body({ vis: 0.2 }), ASPECT);
  assert.equal(r.ok, false);
  assert.equal(W.judge(r).inPosition, false);
  assert.equal(W.read(null, ASPECT), null);
  assert.equal(W.read([{ x: 0, y: 0 }], ASPECT), null);
});

test('the band is 85 to 110 degrees, inclusive of what sits inside it', () => {
  const depth = (knee) => W.judge(readOf({ knee })).depth;
  assert.equal(depth(84), 'low', 'below 85 is too deep');
  assert.equal(depth(86), 'good');
  assert.equal(depth(90), 'good', 'the textbook wall sit');
  assert.equal(depth(109), 'good');
  assert.equal(depth(112), 'high', 'above 110 is not deep enough');
  assert.equal(depth(140), 'high');
});

test('the back is judged against vertical, to twelve degrees either way', () => {
  const back = (tilt) => W.judge(readOf({ tilt })).back;
  assert.equal(back(0), 'good'); assert.equal(back(10), 'good'); assert.equal(back(-10), 'good');
  assert.equal(back(20), 'forward'); assert.equal(back(-20), 'back');
});

test('in position means both at once', () => {
  assert.equal(W.judge(readOf({ knee: 95, tilt: 4 })).inPosition, true);
  assert.equal(W.judge(readOf({ knee: 95, tilt: 25 })).inPosition, false, 'good depth, bad back');
  assert.equal(W.judge(readOf({ knee: 130, tilt: 0 })).inPosition, false, 'good back, bad depth');
});

/* ---------- the coaching, over time ---------- */

/* play one posture for `ms`, at 30 frames a second, and collect what was said */
function play(coach, opts, ms, t0 = 0) {
  const said = []; let t = t0, last = null;
  for (; t < t0 + ms; t += 33) {
    const r = W.read(body(opts), ASPECT);
    last = coach.step(r, t);
    if (last.cue) said.push(last.cue);
  }
  return { said, last, t };
}

test('a cue waits until the fault has held, then is not repeated while it is fresh', () => {
  const c = new W.Coach();
  const a = play(c, { knee: 122 }, 400);
  assert.deepEqual(a.said, [], 'nothing in the first four-tenths of a second');
  const b = play(c, { knee: 122 }, 600, 400);
  assert.equal(b.said.length, 1, 'then once: ' + JSON.stringify(b.said.map((x) => x.text)));
  assert.equal(b.said[0].id, 'high'); assert.match(b.said[0].text, /lower/i);
  const d = play(c, { knee: 122 }, 3000, 1000);
  assert.deepEqual(d.said, [], 'and not again inside the cooldown');
  const e = play(c, { knee: 122 }, 1500, 4000);
  assert.equal(e.said.length, 1, 'but again once it has run out');
});

test('not deep enough by a long way gets the stronger words, as being too deep does', () => {
  const said = play(new W.Coach(), { knee: 135 }, 1200).said;
  assert.equal(said[0].id, 'high');
  assert.match(said[0].text, /slide further down/i, 'twenty-five degrees short is not a nudge');
});

test('too deep is told to come up, and a long way out gets the stronger words', () => {
  const near = play(new W.Coach(), { knee: 78 }, 1200).said;
  assert.equal(near[0].id, 'low'); assert.match(near[0].text, /come up/i);
  const far = play(new W.Coach(), { knee: 50 }, 1200).said;
  assert.match(far[0].text, /too deep/i, 'thirty-five degrees past the line is not a nudge');
});

test('a back off the wall is called, in the words of the wall', () => {
  const said = play(new W.Coach(), { knee: 95, tilt: 25 }, 1200).said;
  assert.equal(said[0].id, 'forward'); assert.match(said[0].text, /back flat/i);
  const other = play(new W.Coach(), { knee: 95, tilt: -25 }, 1200).said;
  assert.equal(other[0].id, 'back'); assert.match(other[0].text, /hips under/i);
});

test('when both are wrong the one further out is said first', () => {
  /* legs miles off, back a little off: the legs are the thing to fix */
  const legs = play(new W.Coach(), { knee: 140, tilt: 16 }, 1200).said;
  assert.equal(legs[0].id, 'high', 'said: ' + JSON.stringify(legs.map((x) => x.text)));
  /* legs just past the line, back badly off: the back */
  const back = play(new W.Coach(), { knee: 112, tilt: 35 }, 1200).said;
  assert.equal(back[0].id, 'forward', 'said: ' + JSON.stringify(back.map((x) => x.text)));
});

test('a good wall sit is told to hold, once, and the clock runs', () => {
  const c = new W.Coach();
  const r = play(c, { knee: 95, tilt: 3 }, 5000);
  const holds = r.said.filter((x) => x.id === 'hold');
  assert.equal(holds.length, 1, 'said once, not every frame: ' + r.said.length);
  assert.deepEqual(r.said.filter((x) => x.id !== 'hold'), [], 'and nothing is corrected');
  /* the clock starts after the position has settled, so about four of the five seconds */
  assert.ok(r.last.holdMs > 3800 && r.last.holdMs < 4600, 'held ' + r.last.holdMs + ' ms');
  assert.ok(r.last.holding);
});

test('the clock stops the moment the position goes, and the best run is remembered', () => {
  const c = new W.Coach();
  let t = 0;
  ({ t } = play(c, { knee: 95 }, 4000, t));          // ~3.3 s of hold
  const after = play(c, { knee: 135 }, 3000, t);     // out of position
  assert.equal(after.last.holding, false);
  assert.equal(after.last.runMs, 0, 'the current run is broken');
  const held = after.last.holdMs;
  const again = play(c, { knee: 95 }, 2000, after.t);
  assert.ok(again.last.holdMs > held, 'and it picks up again');
  assert.ok(again.last.bestMs >= 3000, 'the best unbroken run stands: ' + again.last.bestMs);
});

test('a body the camera cannot read is asked to step in, not corrected', () => {
  const c = new W.Coach();
  const said = play(c, { vis: 0.1 }, 1500).said;
  assert.equal(said[0].id, 'lost'); assert.match(said[0].text, /side on/i);
});

test('the summary counts what was said and keeps the timeline', () => {
  const c = new W.Coach();
  let t = 0; ({ t } = play(c, { knee: 130 }, 6000, t)); play(c, { knee: 95 }, 4000, t);
  const s = c.summary();
  assert.ok(s.cues.high >= 1, JSON.stringify(s.cues));
  assert.ok(s.holdSec > 2, 'it held for a while: ' + s.holdSec);
  assert.ok(s.log.length >= 2 && s.log.every((x) => typeof x.t === 'number' && x.text), 'the log carries times and words');
});

test('thresholds are settings, not rules baked into the code', () => {
  const strict = new W.Coach({ kneeMin: 88, kneeMax: 92 });
  assert.equal(W.judge(readOf({ knee: 95 }), strict.cfg).depth, 'high');
  assert.equal(W.judge(readOf({ knee: 95 })).depth, 'good', 'and the default band is unchanged');
});

test('smoothing settles on the truth and ignores a single wild frame', () => {
  const s = new W.Smoother(0.35);
  for (let i = 0; i < 40; i++) s.of('knee', 100);
  assert.ok(Math.abs(s.of('knee', 100) - 100) < 0.01, 'it converges');
  const after = s.of('knee', 160);
  assert.ok(after < 125, 'one bad frame does not take it there: ' + after.toFixed(1));
});
