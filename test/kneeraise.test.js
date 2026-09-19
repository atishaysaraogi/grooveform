'use strict';
/* The standing knee raise: two right angles, a ten second hold, and ten reps.
   Same discipline as the holds — every number the app acts on is checked against a
   body posed to exactly that number. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const M = require('../public/js/moves.js').kneeraise;

const D = Math.PI / 180;
const ASPECT = 9 / 16;                       // a standing body, so the phone is stood up
const cfg = (o) => Object.assign({}, Core.COMMON, M.defaults, o);
const read = (lm, o) => M.read(lm, ASPECT, cfg(o));
const judge = (r, o) => M.judge(r, cfg(o));

/* A standing body side on, with one leg raised, built backwards from the angles
   it should read.
     thigh  how far the raised thigh has come off straight down: 0 standing, 90 level
     knee   the angle at that knee, between hip and ankle
     foot   the angle at that heel, between the toe and the knee
     facing +1 = toes to the image right, -1 = mirrored
     up     'L' or 'R' — which leg is the raised one

   The raised leg is built out from the hip: the thigh is swung off straight down,
   the shin off the thigh by the knee angle, and the foot off the shin by the foot
   angle. Each is measured from the one before it, which is how a leg actually hangs
   together, and means the three can be posed independently.

   The heel is put on the shin's line, a little below the ankle, so that the angle
   asked for at the heel is exactly the angle that comes back. A real heel sits a
   couple of centimetres behind that line and the reading shifts with it, which is
   why the band is a setting and why it is not centred on a right angle.

   The other leg is left standing straight underneath, as the one holding the
   person up. */
function body({ thigh = 0, knee = 180, foot = 95, facing = 1, up = 'R', vis = 0.95,
                hipAt = [0.22, 0.42], thighLen = 0.17, shinLen = 0.16, heelDrop = 0.03,
                footLen = 0.08, torso = 0.22 } = {}) {
  const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  const leg = (lift, bend, ang) => {
    const hip = { x: hipAt[0], y: hipAt[1] };
    const dir = { x: facing * Math.sin(lift * D), y: Math.cos(lift * D) };      // the thigh, off straight down
    const kneeP = { x: hip.x + thighLen * dir.x, y: hip.y + thighLen * dir.y };
    const sd = rot(dir, (180 - bend) * D * facing);                              // the shin, off the thigh
    const ankleP = { x: kneeP.x + shinLen * sd.x, y: kneeP.y + shinLen * sd.y };
    const heel = { x: ankleP.x + heelDrop * sd.x, y: ankleP.y + heelDrop * sd.y };
    const fd = rot({ x: -sd.x, y: -sd.y }, ang * D * facing);                    // the foot, off heel→knee
    return { hip, knee: kneeP, ankle: ankleP, heel,
      toe: { x: heel.x + footLen * fd.x, y: heel.y + footLen * fd.y } };
  };
  const raised = leg(thigh, knee, foot);
  const stood = leg(0, 180, 90);            // the other leg, straight down, foot flat
  const shoulder = { x: hipAt[0], y: hipAt[1] - torso };
  const ear = { x: shoulder.x + facing * 0.012, y: shoulder.y - 0.06 };

  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  for (const side of ['L', 'R']) {
    const P = Object.assign({ shoulder, ear }, side === up ? raised : stood);
    for (const [name, i] of Object.entries(Core.SIDE[side])) {
      const p = P[name]; if (!p) continue;
      lm[i] = { x: p.x / ASPECT, y: p.y, z: 0, visibility: vis };
    }
  }
  return lm;
}
const readOf = (o) => read(body(o));

test('standing still reads a thigh hanging straight down and a straight knee', () => {
  const r = readOf({});
  assert.ok(r.ok);
  assert.ok(Math.abs(r.thigh) < 0.01, 'the thigh hangs: ' + r.thigh);
  assert.ok(Math.abs(r.knee - 180) < 0.01, 'the knee is straight: ' + r.knee);
  assert.ok(Math.abs(r.foot - 90) < 0.01, 'the standing foot reads a right angle to the shin: ' + r.foot);
  const v = judge(r);
  assert.equal(v.atStart, true, 'and that is the start of a rep');
  assert.equal(v.raised, false);
  assert.equal(v.inPosition, false);
});

test('the three angles are read back as posed, and are independent of each other', () => {
  for (const thigh of [15, 45, 70, 90]) {
    for (const knee of [90, 120, 180]) {
      for (const foot of [70, 95, 130]) {
        for (const facing of [1, -1]) {
          const r = read(body({ thigh, knee, foot, facing }));
          assert.ok(Math.abs(r.thigh - thigh) < 0.01, `thigh ${thigh} read ${r.thigh.toFixed(2)}`);
          assert.ok(Math.abs(r.knee - knee) < 0.01, `knee ${knee} read ${r.knee.toFixed(2)} (thigh ${thigh}, facing ${facing})`);
          assert.ok(Math.abs(r.foot - foot) < 0.01, `foot ${foot} read ${r.foot.toFixed(2)} (facing ${facing})`);
        }
      }
    }
  }
});

test('the leg being measured is the one that is raised, whichever side it is', () => {
  for (const up of ['L', 'R']) {
    const r = read(body({ thigh: 85, knee: 90, up }));
    assert.equal(r.side, up, 'it followed the lifted leg');
    assert.ok(Math.abs(r.thigh - 85) < 0.01, 'and read it, not the one holding him up');
  }
  /* standing on both, neither is raised and it does not matter which is picked */
  const still = readOf({});
  assert.ok(Math.abs(still.thigh) < 0.01);
});

test('a right angle at the knee, five degrees either way', () => {
  /* the edge of the band is inside it: five degrees allowed has to allow five */
  const g = (o) => judge(readOf(Object.assign({ thigh: 85 }, o))).good;
  assert.equal(g({ knee: 90 }).knee, true, 'a right angle');
  assert.equal(g({ knee: 85 }).knee, true, 'and the edges of the five allowed');
  assert.equal(g({ knee: 95 }).knee, true);
  assert.equal(g({ knee: 84 }).knee, false);
  assert.equal(g({ knee: 96 }).knee, false);
});

test('the foot cues say which way the foot is wrong, and do not promise a right angle', () => {
  for (const id of ['toesDown', 'toesUp']) {
    const c = M.cues[id];
    assert.ok(c.deep, id + ' has words for a foot well out');
    /* the band is 85 to 110, so it is not a right angle and the cue must not say it is */
    assert.doesNotMatch(c.deep, /square|right angle/i, id + ' deep: ' + c.deep);
  }
  assert.match(M.cues.toesDown.deep, /pointing away/i);
  assert.match(M.cues.toesUp.deep, /too far up/i);
});

test('the foot is taken at the heel, between the toe and the knee, and allowed 85 to 110', () => {
  const g = (foot) => judge(readOf({ thigh: 85, knee: 90, foot })).good.foot;
  assert.equal(g(84), false);
  assert.equal(g(85), true, 'the low edge is inside');
  assert.equal(g(95), true);
  assert.equal(g(110), true, 'and so is the high one');
  assert.equal(g(111), false);
  assert.equal(g(140), false, 'a foot well past it');
  /* it is the angle at the HEEL, not at the ankle: the two are different numbers on
     a real body, and the one being judged is the one asked for */
  const r = readOf({ thigh: 85, knee: 90, foot: 95 });
  const atAnkle = Core.angleAt(r.points.knee, r.points.ankle, r.points.toe);
  assert.ok(Math.abs(r.foot - 95) < 0.01, 'the heel reads what was posed');
  assert.ok(Math.abs(atAnkle - 95) > 1, 'and the ankle reads something else: ' + atAnkle.toFixed(1));
});

test('a knee that is too straight is told to bend, and toes that point are told to come up', () => {
  const f = (o) => judge(readOf(Object.assign({ thigh: 85, knee: 90, foot: 95 }, o))).faults;
  assert.ok(f({ knee: 120 }).kneeOpen > 0, 'too open');
  assert.ok(f({ knee: 70 }).kneeShut > 0, 'too shut');
  assert.ok(f({ foot: 130 }).toesDown > 0, 'toes pointed away');
  assert.ok(f({ foot: 60 }).toesUp > 0, 'toes pulled too far up');
  assert.deepEqual(f({}), {}, 'and nothing at all when it is right');
});

test('the position is the two right angles together, with the knee actually up', () => {
  assert.equal(judge(readOf({ thigh: 85, knee: 90, foot: 95 })).inPosition, true);
  assert.equal(judge(readOf({ thigh: 85, knee: 110, foot: 95 })).inPosition, false, 'knee out');
  assert.equal(judge(readOf({ thigh: 85, knee: 90, foot: 130 })).inPosition, false, 'foot out');
  /* the two right angles can be made with the heel tucked up behind, which is not a
     knee raise — so the thigh has to have come up for any of it to count */
  const tucked = judge(readOf({ thigh: 10, knee: 90, foot: 95 }));
  assert.equal(tucked.good.knee, true, 'the angles are right');
  assert.equal(tucked.good.foot, true);
  assert.equal(tucked.inPosition, false, 'and it is still not the position');
  assert.equal(tucked.raised, false);
});

/* ---------- a set of reps ---------- */

const step = (c, o, t) => c.step(read(body(o), c.cfg), t);
/* hold one posture for `ms` at 30 frames a second */
function play(c, o, ms, t0) {
  const said = []; let t = t0, last = null;
  for (; t < t0 + ms; t += 33) { last = step(c, o, t); if (last.cue) said.push(last.cue); }
  return { said, last, t };
}
const UP = { thigh: 88, knee: 90, foot: 95 };
const DOWN = { thigh: 0, knee: 180, foot: 90 };

test('a rep is up, held to the count, lowered, and only then counted', () => {
  const c = new Core.Coach(M);
  let t = 0, said = [];
  ({ t } = Object.assign({}, (() => { const p = play(c, DOWN, 1000, t); said = said.concat(p.said); return p; })()));
  assert.equal(c.reps, 0, 'standing there is not a rep');

  const up = play(c, UP, 11500, t);            // settle, then the ten second hold
  said = said.concat(up.said); t = up.t;
  assert.equal(up.last.phase, 'lower', 'the hold is done and it is time to come down');
  assert.equal(c.reps, 0, 'but the rep is not counted at the top');
  assert.ok(up.said.some((x) => x.id === 'hold'), 'it was told to hold');
  assert.ok(up.said.some((x) => x.id === 'call5'), 'and the time was called');
  assert.ok(up.said.some((x) => x.id === 'lower' && /lower slowly/i.test(x.text)), 'and told to lower');

  const down = play(c, DOWN, 1000, t);
  assert.equal(c.reps, 1, 'back to standing is what counts it');
  assert.equal(down.last.reps, 1);
  assert.equal(down.last.repTarget, 10);
  assert.ok(down.said.some((x) => x.text === '1'), 'and the count is called: ' + JSON.stringify(down.said.map((x) => x.text)));
});

test('a knee dropped before the count is finished is not a rep, and is said so', () => {
  const c = new Core.Coach(M);
  let t = 0;
  ({ t } = play(c, DOWN, 800, t));
  ({ t } = play(c, UP, 4000, t));              // up, but only four of the ten seconds
  const early = play(c, DOWN, 1500, t);
  assert.equal(c.reps, 0, 'nothing counted');
  assert.equal(early.last.phase, 'down', 'and it is back to waiting for the next one');
  assert.ok(early.said.some((x) => x.id === 'early'), 'said: ' + JSON.stringify(early.said.map((x) => x.text)));
});

test('ten reps finish the set, and the clock is per rep rather than per set', () => {
  const c = new Core.Coach(M, { holdTargetSec: 2, callAtSec: [1], repCount: 3 });
  let t = 0;
  for (let i = 0; i < 3; i++) {
    ({ t } = play(c, DOWN, 700, t));
    ({ t } = play(c, UP, 3200, t));
    const out = play(c, DOWN, 900, t); t = out.t;
    assert.equal(c.reps, i + 1, 'rep ' + (i + 1) + ' counted');
    if (i < 2) assert.ok(out.last.leftMs === 2000, 'and the clock is back to the full two seconds for the next');
  }
  const end = step(c, DOWN, t + 33);
  assert.equal(end.done, true, 'three of three');
  assert.equal(end.phase, 'done');
  const s = c.summary();
  assert.equal(s.reps, 3); assert.equal(s.repTarget, 3); assert.equal(s.reachedTarget, true);
});

test('standing still is prompted to start, and that prompt is not counted as a correction', () => {
  const c = new Core.Coach(M);
  const r = play(c, DOWN, 2000, 0);
  assert.ok(r.said.some((x) => x.id === 'raise' && /raise one knee/i.test(x.text)),
    'said: ' + JSON.stringify(r.said.map((x) => x.text)));
  assert.deepEqual(c.summary().cues, {}, 'and nothing was wrong with anything');
});

test('the knee and the foot are only corrected once the knee is actually up', () => {
  /* standing with a pointed toe is not a fault: there is no rep under way */
  const still = new Core.Coach(M);
  const a = play(still, { thigh: 0, knee: 180, foot: 140 }, 2000, 0);
  assert.deepEqual(a.said.filter((x) => /toes|knee/i.test(x.id)).map((x) => x.id), []);
  /* the same foot with the knee up is */
  const upc = new Core.Coach(M);
  let t = 0; ({ t } = play(upc, DOWN, 700, t));
  const b = play(upc, { thigh: 88, knee: 90, foot: 140 }, 2500, t);
  assert.ok(b.said.some((x) => x.id === 'toesDown'), 'said: ' + JSON.stringify(b.said.map((x) => x.text)));
});

test('the knee is corrected before the foot, being what the foot hangs off', () => {
  const c = new Core.Coach(M);
  let t = 0; ({ t } = play(c, DOWN, 700, t));
  const r = play(c, { thigh: 88, knee: 130, foot: 140 }, 2000, t);
  const first = r.said.filter((x) => /knee|toes/i.test(x.id))[0];
  assert.equal(first.id, 'kneeOpen', 'said: ' + JSON.stringify(r.said.map((x) => x.text)));
});

test('the bands are settings, not rules baked into the code', () => {
  const loose = { kneeMin: 70, kneeMax: 110 };
  assert.equal(judge(readOf({ thigh: 85, knee: 100 }), loose).good.knee, true, 'widened, 100 is in');
  assert.equal(judge(readOf({ thigh: 85, knee: 100 })).good.knee, false, 'and the default band is unchanged');
  /* how far the thigh must come up is a setting too, and is not marked either way */
  assert.equal(judge(readOf({ thigh: 30, knee: 90, foot: 95 })).raised, false);
  assert.equal(judge(readOf({ thigh: 30, knee: 90, foot: 95 }), { raiseAt: 25 }).raised, true);
});
