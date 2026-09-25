'use strict';
/* The glute bridge: feet placed, hips lifted to a line, no higher than the knees,
   feet flat throughout, lowered slowly. Every number the app acts on is held
   against a body posed to exactly that number. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const M = require('../public/js/moves.js').bridge;

const D = Math.PI / 180;
const ASPECT = 16 / 9;                        // lying down, so the phone is on its side
const cfg = (o) => Object.assign({}, Core.COMMON, M.defaults, o);
const read = (lm, o) => M.read(lm, ASPECT, cfg(o));
const judge = (r, o) => M.judge(r, cfg(o));

/* A body on its back, side on, built backwards from the angles it should read.
     shin   the angle at the heel between the toe and the knee (90 = shin plumb)
     dip    how far the thigh drops from the knee to the hip, below level: 50 lying
            on the floor with the knees up, 0 hips level with the knees, negative
            hips above them. The hip's rise above the knee reads as −dip.
     hipAng the angle at the hip between knee and shoulder
     foot   the foot line's tilt: + heel above toe, − toe above heel
     facing +1 = feet to the image right, −1 = mirrored
   The foot is laid from the heel, the shin swung up off it by `shin`, the thigh
   laid back off the knee by `dip`, and the torso swung off the thigh's line by
   `hipAng`. Each is measured off the one before it, so all four can be posed on
   their own. */
function body({ shin = 90, dip = 50, hipAng = 130, foot = 0, facing = 1, vis = 0.95,
                heelAt = [0.64, 0.68], footLen = 0.07, shinLen = 0.15, thighLen = 0.17, torso = 0.2 } = {}) {
  const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  const heel = { x: heelAt[0], y: heelAt[1] };
  const toeDir = { x: facing * Math.cos(foot * D), y: Math.sin(foot * D) };          // + foot: the toe sits lower
  const toe = { x: heel.x + footLen * toeDir.x, y: heel.y + footLen * toeDir.y };
  const shinDir = rot(toeDir, -facing * shin * D);                                   // up off the foot's line
  const knee = { x: heel.x + shinLen * shinDir.x, y: heel.y + shinLen * shinDir.y };
  const ankle = { x: heel.x + shinLen * 0.12 * shinDir.x, y: heel.y + shinLen * 0.12 * shinDir.y };
  const thighDir = { x: -facing * Math.cos(dip * D), y: Math.sin(dip * D) };         // back and down off the knee
  const hip = { x: knee.x + thighLen * thighDir.x, y: knee.y + thighLen * thighDir.y };
  const back = { x: -thighDir.x, y: -thighDir.y };                                   // hip → knee
  const torsoDir = rot(back, -facing * hipAng * D);
  const shoulder = { x: hip.x + torso * torsoDir.x, y: hip.y + torso * torsoDir.y };
  const ear = { x: shoulder.x - facing * 0.05, y: shoulder.y - 0.01 };
  const P = { heel, toe, knee, ankle, hip, shoulder, ear };
  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  for (const side of ['L', 'R']) {
    for (const [name, i] of Object.entries(Core.SIDE[side])) {
      const p = P[name]; if (!p) continue;
      lm[i] = { x: p.x / ASPECT, y: p.y, z: 0, visibility: vis };
    }
  }
  return lm;
}
const readOf = (o) => read(body(o));

test('rise: how far one point sits above another, signed', () => {
  assert.ok(Math.abs(Core.rise({ x: 0, y: 0.5 }, { x: 0.3, y: 0.5 })) < 1e-9, 'level is zero');
  assert.ok(Math.abs(Core.rise({ x: 0, y: 0.5 }, { x: 0.3, y: 0.2 }) - 45) < 1e-9, 'above is positive');
  assert.ok(Math.abs(Core.rise({ x: 0, y: 0.5 }, { x: -0.3, y: 0.8 }) + 45) < 1e-9, 'below is negative, whichever way along');
  assert.equal(Core.rise({ x: 1, y: 1 }, { x: 1, y: 1 }), null);
});

test('lying there reads the shin, the hip, the hip below the knee, and a flat foot', () => {
  const r = readOf({});
  assert.ok(r.ok);
  assert.ok(Math.abs(r.shin - 90) < 0.01, 'shin plumb: ' + r.shin);
  assert.ok(Math.abs(r.hip - 130) < 0.01, 'hip angle as posed: ' + r.hip);
  assert.ok(Math.abs(r.over + 50) < 0.01, 'the hip is fifty below the knee: ' + r.over);
  assert.ok(Math.abs(r.foot) < 0.01, 'foot flat: ' + r.foot);
  const v = judge(r);
  assert.equal(v.atStart, true, 'and that is the start of a rep');
  assert.equal(v.raised, false);
  assert.equal(v.inPosition, false);
});

test('the four readings come back as posed, and are independent of each other', () => {
  for (const shin of [70, 85, 100, 120]) {
    for (const dip of [50, 20, 0, -8]) {
      for (const hipAng of [120, 160, 175]) {
        for (const foot of [-15, 0, 12]) {
          for (const facing of [1, -1]) {
            const r = read(body({ shin, dip, hipAng, foot, facing }));
            const at = `(shin ${shin}, dip ${dip}, hip ${hipAng}, foot ${foot}, facing ${facing})`;
            assert.ok(Math.abs(r.shin - shin) < 0.01, `shin read ${r.shin.toFixed(2)} ${at}`);
            assert.ok(Math.abs(r.hip - hipAng) < 0.01, `hip read ${r.hip.toFixed(2)} ${at}`);
            assert.ok(Math.abs(r.over + dip) < 0.01, `rise read ${r.over.toFixed(2)} ${at}`);
            assert.ok(Math.abs(r.foot - foot) < 0.01, `foot read ${r.foot.toFixed(2)} ${at}`);
          }
        }
      }
    }
  }
});

test('it reads the same body at half the size: degrees, not distances', () => {
  const big = read(body({ shin: 100, dip: 5, hipAng: 165, foot: 6 }));
  const small = read(body({ shin: 100, dip: 5, hipAng: 165, foot: 6, footLen: 0.035, shinLen: 0.075, thighLen: 0.085, torso: 0.1 }));
  for (const k of ['shin', 'hip', 'over', 'foot']) assert.ok(Math.abs(big[k] - small[k]) < 0.01, k);
});

const TOP = { shin: 95, dip: 5, hipAng: 170, foot: 0 };   // a good top: hips just under the knees, line made

test('the shin band is 85 to 110 at the heel, edges included, and says which way the feet go', () => {
  const at = (shin) => judge(readOf(Object.assign({}, TOP, { shin })));
  assert.equal(at(85).good.shin, true); assert.equal(at(110).good.shin, true); assert.equal(at(97).good.shin, true);
  assert.equal(at(84).good.shin, false); assert.equal(at(111).good.shin, false);
  /* the toes point away from the head, so over the band the knee leans toward
     the head: the feet are out too far and are walked in. Under it the knee is
     out over the toes: too close, walked out. */
  assert.ok(at(125).faults.feetFar > 0 && at(125).faults.feetClose == null, 'feet far');
  assert.ok(at(70).faults.feetClose > 0 && at(70).faults.feetFar == null, 'feet close');
  assert.match(M.cues.feetFar.text, /walk your feet in/i);
  assert.match(M.cues.feetClose.text, /feet out/i);
  /* the feet, flat and placed, are set-up faults, coached before the lift is asked for */
  assert.deepEqual(M.setup, ['heelsUp', 'toesUp', 'feetFar', 'feetClose']);
  /* the shin's angle is taken at the heel: a heel or a toe off the floor moves
     it, so the foot is corrected first and the shin is not judged until it is flat */
  const up = (shin, foot) => judge(readOf(Object.assign({}, TOP, { shin, foot })));
  assert.ok(up(125, 18).faults.heelsUp > 0 && up(125, 18).faults.feetFar == null, 'heels up: no word on the shin');
  assert.ok(up(70, -18).faults.toesUp > 0 && up(70, -18).faults.feetClose == null, 'toes up: likewise');
  assert.equal(up(125, 18).good.shin, false, 'the reading still shows the shin as out');
  assert.ok(up(125, 0).faults.feetFar > 0, 'and flat again, the shin is judged');
});

test('the top is a hip angle of at least 160, and the hip no more than three degrees above the knee', () => {
  const at = (o) => judge(readOf(Object.assign({}, TOP, o)));
  assert.equal(at({ hipAng: 160 }).good.hip, true, 'the edge is in');
  assert.equal(at({ hipAng: 159 }).good.hip, false);
  assert.ok(at({ hipAng: 150 }).faults.hipLow > 0);
  assert.equal(at({ dip: -3 }).good.over, true, 'three above is allowed');
  assert.equal(at({ dip: -3 }).faults.hipHigh, undefined);
  assert.equal(at({ dip: -4 }).good.over, false, 'four is not');
  assert.ok(Math.abs(at({ dip: -10 }).faults.hipHigh - 7) < 0.01, 'and the fault is how far over');
  assert.equal(at({ dip: 30 }).good.over, true, 'below the knee is never the fault');
  assert.match(M.cues.hipHigh.text, /no higher than your knees/i);
});

test('the foot stays flat: heels lifting and toes lifting are told apart', () => {
  const at = (foot) => judge(readOf(Object.assign({}, TOP, { foot })));
  assert.equal(at(10).good.foot, true); assert.equal(at(-10).good.foot, true);
  assert.equal(at(11).good.foot, false); assert.equal(at(-11).good.foot, false);
  assert.ok(at(18).faults.heelsUp > 0 && at(18).faults.toesUp == null, 'heel above toe: heels up');
  assert.ok(at(-18).faults.toesUp > 0 && at(-18).faults.heelsUp == null, 'toe above heel: toes up');
  assert.match(M.cues.heelsUp.text, /heels down/i);
  assert.match(M.cues.toesUp.text, /toes down/i);
});

test('the position is all four together, with the hips actually lifted', () => {
  const at = (o) => judge(readOf(Object.assign({}, TOP, o)));
  assert.equal(at({}).inPosition, true);
  assert.equal(at({ shin: 120 }).inPosition, false, 'feet');
  assert.equal(at({ hipAng: 150 }).inPosition, false, 'hip short of the line');
  assert.equal(at({ dip: -8 }).inPosition, false, 'hip past the knees');
  assert.equal(at({ foot: 15 }).inPosition, false, 'heels up');
  assert.equal(at({ hipAng: 145 }).raised, false, 'and under the lift mark it is not up at all');
  assert.equal(at({ hipAng: 150 }).raised, true);
  assert.equal(at({ hipAng: 141 }).atStart, false);
  assert.equal(at({ hipAng: 140 }).atStart, true);
});

test('the order: feet flat, then where they are, then the hips — too high before not high enough', () => {
  assert.deepEqual(M.faults, ['lost', 'heelsUp', 'toesUp', 'feetFar', 'feetClose', 'raise', 'hipHigh', 'hipLow']);
  assert.equal(M.camera, 'wide');
  assert.equal(M.reps, true);
  assert.equal(M.defaults.holdTargetSec, 2);
  assert.equal(M.defaults.repCount, 10);
});

/* ---------- a set of reps ---------- */

const step = (c, o, t) => c.step(read(body(o), c.cfg), t);
function play(c, o, ms, t0) {
  const said = []; let t = t0, last = null;
  for (; t < t0 + ms; t += 33) { last = step(c, o, t); if (last.cue) said.push(last.cue); }
  return { said, last, t };
}
const REST = { shin: 95, dip: 50, hipAng: 130, foot: 0 };
const HALFWAY = { shin: 95, dip: 25, hipAng: 145, foot: 0 };
const texts = (p) => JSON.stringify(p.said.map((x) => x.text));
/* the set-up wait: at the start for two seconds before anything is coached */
const settle = (c, t0) => play(c, REST, 2300, t0).t;

test('nothing is said until the person has been at the start for two seconds', () => {
  const c = new Core.Coach(M);
  /* getting down: not at the start, feet wrong, hips half up — and nothing said */
  const down = play(c, { shin: 125, dip: 20, hipAng: 150, foot: 14 }, 3000, 0);
  assert.deepEqual(down.said, [], texts(down));
  assert.equal(down.last.phase, 'setup'); assert.equal(down.last.ready, false);
  assert.deepEqual(down.last.active, [], 'and no fault words');
  /* at the start with the feet wrong: still nothing for two seconds, then the feet */
  const rest = play(c, Object.assign({}, REST, { shin: 125 }), 3000, down.t);
  const first = rest.said[0];
  assert.ok(first && first.id === 'feetFar' && first.t - down.t >= 2000, 'the feet, after the wait: ' + texts(rest) + ' at ' + (first && first.t - down.t));
  assert.equal(rest.last.ready, true);
  /* leaving the start before the two seconds are up starts the wait again */
  const c2 = new Core.Coach(M);
  let t = play(c2, REST, 1500, 0).t;
  t = play(c2, HALFWAY, 300, t).t;
  const again = play(c2, REST, 1500, t);
  assert.equal(again.last.ready, false, 'not yet');
  assert.equal(play(c2, REST, 800, again.t).last.ready, true);
});

test('a rep: lift, hold at the top, lower slowly, and it counts when the hips are down', () => {
  const c = new Core.Coach(M);
  let t = settle(c, 0);
  const rest = play(c, REST, 1200, t); t = rest.t;
  assert.equal(c.reps, 0);
  assert.ok(rest.said.some((x) => x.id === 'raise' && /lift your hips/i.test(x.text)), 'asked to lift: ' + texts(rest));

  const up = play(c, TOP, 3500, t); t = up.t;            // settle, then the two second squeeze
  assert.equal(up.last.phase, 'lower', 'held, and time to come down');
  assert.equal(c.reps, 0, 'not counted at the top');
  assert.ok(up.said.some((x) => x.id === 'hold'), 'told to hold: ' + texts(up));
  assert.ok(up.said.some((x) => x.id === 'lower' && /lower slowly/i.test(x.text)), 'and to lower slowly');

  const mid = play(c, HALFWAY, 1300, t); t = mid.t;
  assert.equal(c.reps, 0, 'halfway down is not down');
  const down = play(c, REST, 1000, t);
  assert.equal(c.reps, 1, 'back down is what counts it');
  assert.equal(down.said.find((x) => x.id === 'count1').text, '1', texts(down));
});

test('dropped from the top, the rep is counted and the count says so', () => {
  const c = new Core.Coach(M);
  let t = settle(c, 0);
  ({ t } = play(c, REST, 1000, t));
  ({ t } = play(c, TOP, 3500, t));
  const drop = play(c, REST, 900, t);
  assert.equal(c.reps, 1);
  assert.match(drop.said.find((x) => x.id === 'count1').text, /^1 — slower on the way down$/);
});

test('feet placed wrong are corrected at the start, before the lift is asked for', () => {
  const c = new Core.Coach(M);
  const far = play(c, Object.assign({}, REST, { shin: 125 }), 3800, 0);
  const first = far.said.find((x) => x.id !== 'lost');
  assert.ok(first && first.id === 'feetFar', 'the feet came first: ' + texts(far));
  assert.ok(!far.said.some((x) => x.id === 'raise'), 'and the lift was not asked for over them');
  /* fixed, the lift is asked for */
  const fixed = play(c, REST, 3000, far.t);
  assert.ok(fixed.said.some((x) => x.id === 'raise'), texts(fixed));
  /* and a foot off the floor at the start comes before where the feet are */
  const both = new Core.Coach(M);
  const lifted = play(both, Object.assign({}, REST, { shin: 125, foot: -16 }), 3800, 0);
  const said = lifted.said.find((x) => x.id !== 'lost');
  assert.equal(said && said.id, 'toesUp', 'toes down first: ' + texts(lifted));
});

test('at the top, the hips past the knees are said before the line being short, and the feet before both', () => {
  const both = new Core.Coach(M);
  let t = settle(both, 0);
  ({ t } = play(both, REST, 1000, t));
  const up = play(both, { shin: 95, dip: -10, hipAng: 150, foot: 0 }, 2500, t);
  const ids = up.said.map((x) => x.id);
  assert.ok(ids.includes('hipHigh'), texts(up));
  assert.ok(!ids.includes('hipLow') || ids.indexOf('hipHigh') < ids.indexOf('hipLow'), 'too high first');
  const feet = new Core.Coach(M);
  t = settle(feet, 0);
  ({ t } = play(feet, REST, 1000, t));
  const lift = play(feet, { shin: 95, dip: -10, hipAng: 150, foot: 16 }, 2500, t);
  const first = lift.said.find((x) => x.id !== 'lost');
  assert.equal(first && first.id, 'heelsUp', 'heels before hips: ' + texts(lift));
});

test('ten reps finish the set; the number is a setting', () => {
  const c = new Core.Coach(M, { repCount: 3 });
  let t = settle(c, 0);
  for (let i = 0; i < 3; i++) {
    ({ t } = play(c, REST, 800, t));
    ({ t } = play(c, TOP, 3300, t));
    ({ t } = play(c, HALFWAY, 1200, t));
    const out = play(c, REST, 900, t); t = out.t;
    assert.equal(c.reps, i + 1);
    if (i === 2) assert.ok(out.said.some((x) => x.id === 'done' && /3 reps/.test(x.text)), texts(out));
  }
  assert.equal(c.step(read(body(REST), c.cfg), t).done, true);
  const s = c.summary();
  assert.equal(s.reps, 3); assert.equal(s.repTarget, 3); assert.equal(s.reachedTarget, true);
});

test('after a rep is counted there is a quiet two seconds before the next is asked for', () => {
  const c = new Core.Coach(M);
  let t = settle(c, 0);
  ({ t } = play(c, REST, 1000, t));
  ({ t } = play(c, TOP, 3500, t));
  ({ t } = play(c, HALFWAY, 1300, t));
  const down = play(c, REST, 2600, t);
  const count = down.said.find((x) => x.id === 'count1');
  const next = down.said.find((x) => x.id === 'raise');
  assert.ok(count, texts(down));
  assert.ok(next, 'the next rep is asked for eventually: ' + texts(down));
  assert.ok(next.t - count.t >= 2000, `and not for two seconds: ${next.t - count.t} ms after the count`);
  assert.ok(down.said.slice(0, -1).every((x) => x.id !== 'raise' || x.t - count.t >= 2000));
  /* a set-up fault waits for the quiet too */
  const c2 = new Core.Coach(M);
  let u = settle(c2, 0);
  ({ t: u } = play(c2, REST, 1000, u)); ({ t: u } = play(c2, TOP, 3500, u)); ({ t: u } = play(c2, HALFWAY, 1300, u));
  const far = play(c2, Object.assign({}, REST, { shin: 125 }), 2600, u);
  const cnt = far.said.find((x) => x.id === 'count1'), feet = far.said.find((x) => x.id === 'feetFar');
  assert.ok(feet && feet.t - cnt.t >= 2000, 'feet corrected only after the quiet: ' + texts(far));
  /* and it is a setting: none at zero */
  const c3 = new Core.Coach(M, { restSec: 0 });
  let w = settle(c3, 0);
  ({ t: w } = play(c3, REST, 1000, w)); ({ t: w } = play(c3, TOP, 3500, w)); ({ t: w } = play(c3, HALFWAY, 1300, w));
  const quick = play(c3, REST, 2600, w);
  const q0 = quick.said.find((x) => x.id === 'count1'), q1 = quick.said.find((x) => x.id === 'raise');
  assert.ok(q1 && q1.t - q0.t < 2000, texts(quick));
});

test('every fault present is on view in words, whether or not it is the one being said', () => {
  const c = new Core.Coach(M);
  let t = settle(c, 0);
  ({ t } = play(c, REST, 1000, t));
  /* at the top with three things wrong: the voice says one, the words show all three */
  const out = c.step(read(body({ shin: 120, dip: -10, hipAng: 150, foot: 16 }), c.cfg), t);
  assert.deepEqual(out.active, ['heelsUp', 'hipHigh', 'hipLow'], 'in the move\'s order — and no word on the shin while a heel is up');
  for (const id of out.active) assert.ok(M.cues[id].label, id + ' has short words');
  /* at rest only the set-up faults are on view; the hips being down is not a fault there */
  const rest = c.step(read(body(Object.assign({}, REST, { shin: 70 })), c.cfg), t + 33);
  assert.deepEqual(rest.active, ['feetClose']);
  /* and a prompt is not a fault */
  const clean = c.step(read(body(REST), c.cfg), t + 66);
  assert.deepEqual(clean.active, []);
});

test('every fault of every move has short words for the picture', () => {
  const Moves = require('../public/js/moves.js');
  for (const m of Moves.list) {
    for (const id of m.faults) {
      if (id === 'lost' || (m.prompts || []).includes(id)) continue;
      assert.ok(m.cues[id] && m.cues[id].label, m.id + ': ' + id);
      assert.ok(m.cues[id].label.length <= 26, m.id + ': ' + id + ' is short');
    }
  }
});
