'use strict';
/* The measurement and the coaching decision, held to frames built to read a known angle.
   A threshold nobody has measured is a guess, so every number the app acts on is checked here
   against a body posed to exactly that number. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
/* the cue rules, without the set-up wait in front of them (the wait has tests of its own) */
const Coach0 = (cfg) => new Core.Coach(M, Object.assign({ readyMs: 0 }, cfg));
const M = require('../public/js/moves.js').wallsit;
/* the wall sit's own read/judge, and the shared clock told which move it is coaching */
const W = { read: (lm, a, c) => M.read(lm, a, Object.assign({}, Core.COMMON, M.defaults, c)),
  judge: (r, c) => M.judge(r, Object.assign({}, Core.COMMON, M.defaults, c)),
  Coach: function (cfg) { return Coach0(cfg); },
  Smoother: Core.Smoother, SIDE: Core.SIDE };

const D = Math.PI / 180;
const ASPECT = 16 / 9;

/* A body side-on, built backwards from the angles it should read.
     knee   the angle wanted at the knee, between hip and ankle
     shin   the angle wanted between the knee→heel line and the floor: 90 is plumb,
            more than 90 puts the heel ahead of the knee, less puts it behind
     tilt   how far the torso leans off vertical, + = the way the knees point
     facing +1 = knees to the image right, -1 = mirrored

   It is built from the knee outwards, because the knee is where both angles meet:
   the shin is laid down at the angle asked for, and the thigh is swung off it by
   the knee angle. That makes the two independent, which is the whole point — a
   body can have good feet and bad depth, or the reverse, and each has its own cue.

   The ankle sits on the knee→heel line by default, so the knee angle is exactly
   the one posed whichever foot point it is taken to; `heelOff` moves the heel off
   that line when a test wants a real foot rather than a clean one.

   Lengths are shares of the frame height; x is divided by the aspect on the way out,
   because that is how a pose model reports it. */
function body({ knee = 90, shin = 90, tilt = 0, facing = 1, kneeAt = [0.75, 0.55], vis = 0.95,
                heelVis = null, thigh = 0.2, shinLen = 0.22, torso = 0.26, heelOff = [0, 0] } = {}) {
  const P = {};
  P.knee = { x: kneeAt[0], y: kneeAt[1] };
  /* the shin, from the horizontal that points back toward the wall */
  const u = { x: -facing * Math.cos(shin * D), y: Math.sin(shin * D) };
  P.heel = { x: P.knee.x + shinLen * u.x + facing * heelOff[0], y: P.knee.y + shinLen * u.y + heelOff[1] };
  P.ankle = { x: P.knee.x + shinLen * 0.86 * u.x, y: P.knee.y + shinLen * 0.86 * u.y };
  /* the thigh, swung off the shin by the knee angle — clockwise on screen when
     the knees point right, the other way when they point left */
  const a = knee * D * facing, ca = Math.cos(a), sa = Math.sin(a);
  const h = { x: u.x * ca - u.y * sa, y: u.x * sa + u.y * ca };
  P.hip = { x: P.knee.x + thigh * h.x, y: P.knee.y + thigh * h.y };
  P.shoulder = { x: P.hip.x + facing * torso * Math.sin(tilt * D), y: P.hip.y - torso * Math.cos(tilt * D) };
  P.toe = { x: P.heel.x + facing * 0.08, y: P.heel.y + 0.004 };
  P.ear = { x: P.shoulder.x + facing * 0.02, y: P.shoulder.y - 0.07 };

  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  /* both sides get the same body: side-on the two legs sit on top of each other */
  for (const s of ['L', 'R']) for (const [name, i] of Object.entries(W.SIDE[s])) {
    const p = P[name]; if (!p) continue;
    lm[i] = { x: p.x / ASPECT, y: p.y, z: 0, visibility: name === 'heel' && heelVis != null ? heelVis : vis };
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

test('the knee angle is taken to the ankle, so where the heel sits does not move it', () => {
  const clean = readOf({ knee: 90, shin: 90 });
  const real = readOf({ knee: 90, shin: 90, heelOff: [-0.03, 0.012] });
  assert.ok(Math.abs(real.knee - clean.knee) < 1e-9, 'the knee reading is untouched by the heel');
  /* the shin is the reading that does depend on it, and it moves as the heel moves */
  assert.ok(Math.abs(real.shin - clean.shin) > 2, 'the shin reading follows the heel: '
    + clean.shin.toFixed(1) + ' → ' + real.shin.toFixed(1));
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
  const depth = (knee) => { const v = W.judge(readOf({ knee })); return v.faults.high != null ? 'high' : v.faults.low != null ? 'low' : 'good'; };
  assert.equal(depth(84), 'low', 'below 85 is too deep');
  assert.equal(depth(86), 'good');
  assert.equal(depth(90), 'good', 'the textbook wall sit');
  assert.equal(depth(109), 'good');
  assert.equal(depth(112), 'high', 'above 110 is not deep enough');
  assert.equal(depth(140), 'high');
});

test('the shin is read against the floor, plumb at ninety, and the side of ninety says which way the feet go', () => {
  for (const want of [60, 75, 85, 90, 100, 110, 120]) {
    for (const facing of [1, -1]) {
      const r = readOf({ shin: want, facing });
      assert.ok(Math.abs(r.shin - want) < 0.01, `posed ${want}\u00b0 facing ${facing}, read ${r.shin.toFixed(2)}\u00b0`);
    }
  }
  /* the geometry behind the number, checked on the points rather than trusted */
  const ahead = readOf({ shin: 115 }), behind = readOf({ shin: 65 }), plumb = readOf({ shin: 90 });
  assert.ok(ahead.points.heel.x > ahead.points.knee.x, 'above ninety the heel is ahead of the knee');
  assert.ok(behind.points.heel.x < behind.points.knee.x, 'below ninety it is behind it');
  assert.ok(Math.abs(plumb.points.heel.x - plumb.points.knee.x) < 1e-9, 'at ninety it is under it');
});

test('the shin band is 85 to 95 degrees', () => {
  const feet = (shin) => { const v = W.judge(readOf({ shin })); return v.faults.feetback != null ? 'out' : v.faults.feetfwd != null ? 'in' : 'good'; };
  assert.equal(feet(65), 'in', 'heels well behind the knees');
  assert.equal(feet(84), 'in');
  assert.equal(feet(86), 'good');
  assert.equal(feet(90), 'good', 'plumb');
  assert.equal(feet(94), 'good');
  assert.equal(feet(96), 'out');
  assert.equal(feet(120), 'out', 'heels well ahead of the knees');
});

test('heels ahead of the knees are told to bring the feet back, heels behind to bring them forward', () => {
  const out = play(W.Coach(), { shin: 112 }, 1200).said;
  assert.equal(out[0].id, 'feetback', 'said: ' + JSON.stringify(out.map((x) => x.text)));
  assert.match(out[0].text, /feet back/i);
  const inn = play(W.Coach(), { shin: 68 }, 1200).said;
  assert.equal(inn[0].id, 'feetfwd');
  assert.match(inn[0].text, /feet forward/i);
  /* and a long way out gets the stronger words, as the other faults do */
  const far = play(W.Coach(), { shin: 125 }, 1200).said;
  assert.match(far[0].text, /well ahead of your knees/i, 'twenty-five degrees out is not a nudge');
});

test('faults are corrected in the order of the chain: feet, then knee, then back', () => {
  const first = (opts) => {
    const said = play(W.Coach(), opts, 1200).said;
    assert.ok(said.length, 'nothing was said for ' + JSON.stringify(opts));
    return said[0].id;
  };
  /* the feet come first however small their error is beside the others */
  assert.equal(first({ knee: 145, shin: 97, tilt: 40 }), 'feetback', 'feet barely out, knee and back miles out');
  assert.equal(first({ knee: 50, shin: 83, tilt: -40 }), 'feetfwd');
  /* with the feet right, the knee is next — again however small beside the back */
  assert.equal(first({ knee: 112, shin: 90, tilt: 40 }), 'high', 'knee barely out, back miles out');
  assert.equal(first({ knee: 83, shin: 90, tilt: -40 }), 'low');
  /* and the back is what is left */
  assert.equal(first({ knee: 95, shin: 90, tilt: 40 }), 'forward');
  assert.equal(first({ knee: 95, shin: 90, tilt: -40 }), 'back');
  /* nothing outranks not being able to see the body at all */
  assert.equal(first({ vis: 0.1 }), 'lost');
});

test('an untrusted heel hands the shin over to the ankle rather than guessing', () => {
  const r = readOf({ shin: 92, heelVis: 0.1 });
  assert.equal(r.of.shin.to, 'ankle', 'the reading says which point it came from');
  assert.ok(Math.abs(r.shin - 92) < 0.01, 'and the ankle is on the same line, so it reads the same');
  assert.equal(readOf({ shin: 92 }).of.shin.to, 'heel', 'a trusted heel is used');
});

test('the back is judged against vertical, to twelve degrees either way', () => {
  const back = (tilt) => { const v = W.judge(readOf({ tilt })); return v.faults.forward != null ? 'forward' : v.faults.back != null ? 'back' : 'good'; };
  assert.equal(back(0), 'good'); assert.equal(back(10), 'good'); assert.equal(back(-10), 'good');
  assert.equal(back(20), 'forward'); assert.equal(back(-20), 'back');
});

test('in position means all three at once', () => {
  assert.equal(W.judge(readOf({ knee: 95, tilt: 4, shin: 92 })).inPosition, true);
  assert.equal(W.judge(readOf({ knee: 95, tilt: 4, shin: 98 })).inPosition, false, 'three degrees past the shin band is out');
  assert.equal(W.judge(readOf({ knee: 95, tilt: 25 })).inPosition, false, 'good depth and feet, bad back');
  assert.equal(W.judge(readOf({ knee: 130, tilt: 0 })).inPosition, false, 'good back and feet, bad depth');
  assert.equal(W.judge(readOf({ knee: 95, tilt: 0, shin: 115 })).inPosition, false, 'good depth and back, feet too far out');
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
  const c = W.Coach();
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
  const said = play(W.Coach(), { knee: 135 }, 1200).said;
  assert.equal(said[0].id, 'high');
  assert.match(said[0].text, /slide further down/i, 'twenty-five degrees short is not a nudge');
});

test('too deep is told to come up, and a long way out gets the stronger words', () => {
  const near = play(W.Coach(), { knee: 78 }, 1200).said;
  assert.equal(near[0].id, 'low'); assert.match(near[0].text, /come up/i);
  const far = play(W.Coach(), { knee: 50 }, 1200).said;
  assert.match(far[0].text, /too deep/i, 'thirty-five degrees past the line is not a nudge');
});

test('a back off the wall is called, in the words of the wall', () => {
  const said = play(W.Coach(), { knee: 95, tilt: 25 }, 1200).said;
  assert.equal(said[0].id, 'forward'); assert.match(said[0].text, /back flat/i);
  const other = play(W.Coach(), { knee: 95, tilt: -25 }, 1200).said;
  assert.equal(other[0].id, 'back'); assert.match(other[0].text, /hips under/i);
});

test('the knee is said before the back, and then the back once the knee is right', () => {
  const c = W.Coach();
  const first = play(c, { knee: 140, tilt: 35 }, 1200);
  assert.equal(first.said[0].id, 'high', 'said: ' + JSON.stringify(first.said.map((x) => x.text)));
  /* fix the knee and the back is what is left to say */
  const then = play(c, { knee: 95, tilt: 35 }, 3000, first.t);
  assert.equal(then.said[0].id, 'forward', 'said: ' + JSON.stringify(then.said.map((x) => x.text)));
});

test('two faults ready at once are not said on top of each other', () => {
  /* knee and shin both eighteen degrees past their band, so both come ready on the
     same frame; only one may be spoken, and the second waits out the gap */
  const c = W.Coach();
  const first = play(c, { knee: 128, shin: 118 }, 1200);
  assert.equal(first.said.length, 1, 'said: ' + JSON.stringify(first.said.map((x) => x.text)));
  assert.equal(first.said[0].id, 'feetback', 'and it is the feet, being the setup');
  const rest = play(c, { knee: 128, shin: 118 }, 2000, first.t);
  assert.equal(rest.said.length, 1, 'then the other, once the gap has passed');
  assert.equal(rest.said[0].id, 'high');
  assert.ok(rest.said[0].t - first.said[0].t >= 1500, 'a second and a half apart at least');
});

test('a time call is not held back by the gap, because a late one is a wrong one', () => {
  const c = W.Coach({ holdTargetSec: 10, callAtSec: [5] });
  const r = play(c, { knee: 95 }, 7000);
  const hold = r.said.find((x) => x.id === 'hold'), call = r.said.find((x) => x.id === 'call5');
  assert.ok(hold && call, 'said: ' + JSON.stringify(r.said.map((x) => x.text)));
  /* the call lands on the frame the clock reaches it, five seconds of hold in */
  assert.ok(Math.abs(call.t - 5700) < 200, 'called at ' + call.t + ' ms');
});

test('a good wall sit is told to hold, once, and the clock runs', () => {
  const c = W.Coach();
  const r = play(c, { knee: 95, tilt: 3 }, 5000);
  const holds = r.said.filter((x) => x.id === 'hold');
  assert.equal(holds.length, 1, 'said once, not every frame: ' + r.said.length);
  assert.deepEqual(r.said.filter((x) => x.id !== 'hold'), [], 'and nothing is corrected');
  /* the clock starts after the position has settled, so about four of the five seconds */
  assert.ok(r.last.holdMs > 3800 && r.last.holdMs < 4600, 'held ' + r.last.holdMs + ' ms');
  assert.ok(r.last.holding);
});

test('the clock stops the moment the position goes, and the best run is remembered', () => {
  const c = W.Coach();
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

test('the set is a sixty second countdown, called at forty five, thirty, ten and five', () => {
  const c = W.Coach();
  const r = play(c, { knee: 95 }, 62000);
  const calls = r.said.filter((x) => /^call\d|^done$/.test(x.id));
  assert.deepEqual(calls.map((x) => x.id), ['call45', 'call30', 'call10', 'call5', 'done'],
    'said: ' + JSON.stringify(r.said.map((x) => x.text)));
  assert.match(calls[0].text, /^45 seconds left$/);
  assert.match(calls[3].text, /^5 seconds left$/);
  assert.match(calls[4].text, /60 seconds .* done/);
  /* each is called at the moment it is true, allowing the settle before the clock starts */
  assert.ok(Math.abs(calls[0].t - 15700) < 200, 'forty five left at ' + calls[0].t + ' ms');
  assert.ok(Math.abs(calls[4].t - 60700) < 200, 'done at ' + calls[4].t + ' ms');
  assert.equal(r.last.done, true);
  assert.equal(r.last.leftMs, 0);
  assert.equal(c.summary().reachedTarget, true);
});

test('the countdown is spent from time in position, so standing up pauses it rather than running it down', () => {
  const c = W.Coach();
  let t = 0;
  ({ t } = play(c, { knee: 95 }, 20000, t));              // ~19.3 s held, 40.7 s left
  const paused = play(c, { knee: 140 }, 8000, t);          // out of position for eight seconds
  assert.equal(paused.last.holding, false);
  assert.ok(Math.abs(paused.last.leftMs - 40700) < 300, 'the clock did not move: ' + paused.last.leftMs);
  const back = play(c, { knee: 95 }, 12000, paused.t);
  /* it picks up from the 40.7 s it was paused at, less the twelve seconds played,
     less one more settle: getting back into position has to be earned again */
  assert.ok(back.last.leftMs > 28500 && back.last.leftMs < 30000, 'left: ' + back.last.leftMs);
  /* forty five was called during the first stretch; the eight seconds standing up added
     nothing, so thirty is the next and only mark reached */
  const calls = [...paused.said, ...back.said].filter((x) => /^call\d/.test(x.id));
  assert.deepEqual(calls.map((x) => x.id), ['call30'], 'said: ' + JSON.stringify(calls.map((x) => x.id)));
});

test('nothing is counted down before the position has ever been right', () => {
  const c = W.Coach();
  const r = play(c, { knee: 140 }, 20000);
  assert.equal(r.last.leftMs, 60000, 'the full sixty is still to do');
  assert.deepEqual(r.said.filter((x) => /^call\d|^done$/.test(x.id)), []);
});

test('the target is a setting, and so are the moments the time is called', () => {
  const c = W.Coach({ holdTargetSec: 20, callAtSec: [10] });
  const r = play(c, { knee: 95 }, 22000);
  const calls = r.said.filter((x) => /^call\d|^done$/.test(x.id));
  assert.deepEqual(calls.map((x) => x.text), ['10 seconds left', '20 seconds \u2014 done']);
});

test('a frame gap that carries the clock past two marks calls only the nearer one', () => {
  const c = W.Coach();
  let t = 0, said = [];
  /* settle, then step in half-second jumps — the coach caps each step at 250 ms,
     so the clock crawls and the marks are approached; then one huge jump */
  for (; t < 2000; t += 33) { const o = c.step(W.read(body({ knee: 95 }), ASPECT), t); if (o.cue) said.push(o.cue); }
  c.holdMs = 47000;                                        // straight past forty five and thirty
  const o = c.step(W.read(body({ knee: 95 }), ASPECT), t + 33);
  assert.equal(o.cue.id, 'call30', 'the nearer mark is the one worth saying');
  const next = play(c, { knee: 95 }, 2000, t + 66);
  assert.deepEqual(next.said.filter((x) => /^call45$/.test(x.id)), [], 'and the one skipped is spent');
});

test('a body the camera cannot read is asked to step in, not corrected', () => {
  const c = W.Coach();
  const said = play(c, { vis: 0.1 }, 1500).said;
  assert.equal(said[0].id, 'lost'); assert.match(said[0].text, /side on/i);
});

test('the summary counts what was said and keeps the timeline', () => {
  const c = W.Coach();
  let t = 0; ({ t } = play(c, { knee: 130 }, 6000, t)); play(c, { knee: 95 }, 4000, t);
  const s = c.summary();
  assert.ok(s.cues.high >= 1, JSON.stringify(s.cues));
  assert.ok(s.holdSec > 2, 'it held for a while: ' + s.holdSec);
  assert.ok(s.log.length >= 2 && s.log.every((x) => typeof x.t === 'number' && x.text), 'the log carries times and words');
});

test('thresholds are settings, not rules baked into the code', () => {
  const strict = W.Coach({ kneeMin: 88, kneeMax: 92 });
  assert.equal(W.judge(readOf({ knee: 95 }), strict.cfg).good.knee, false, 'narrowed, 95 is out');
  assert.equal(W.judge(readOf({ knee: 95 })).good.knee, true, 'and the default band is unchanged');
});

test('smoothing settles on the truth and ignores a single wild frame', () => {
  const s = new W.Smoother(0.35);
  for (let i = 0; i < 40; i++) s.of('knee', 100);
  assert.ok(Math.abs(s.of('knee', 100) - 100) < 0.01, 'it converges');
  const after = s.of('knee', 160);
  assert.ok(after < 125, 'one bad frame does not take it there: ' + after.toFixed(1));
});

test('a hold shows every fault present in words, in the move\'s order', () => {
  const c = Coach0();
  /* the knee too open and the back off the wall: two faults on view, one at a time in the voice */
  const out = c.step(W.read(body({ knee: 130, shin: 90, tilt: 20 }), ASPECT, c.cfg), 0);
  assert.deepEqual(out.active, ['high', 'forward']);
  assert.equal(M.cues.high.label, 'Too high');
  const fine = c.step(W.read(body({ knee: 95, shin: 90, tilt: 0 }), ASPECT, c.cfg), 33);
  assert.deepEqual(fine.active, []);
});
