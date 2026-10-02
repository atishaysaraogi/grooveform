'use strict';
/* The standing knee raise: the thigh up to level, the lower leg hanging under the knee,
   the trunk tall, a ten second hold, and ten reps.
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
     lean   the trunk off plumb, + forward
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
function body({ thigh = 0, knee = 180, foot = 85, lean = 0, facing = 1, up = 'R', vis = 0.95,
                hipAt = [0.28, 0.42], thighLen = 0.11, shinLen = 0.10, heelDrop = 0.02,
                footLen = 0.05, torso = 0.18 } = {}) {
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
  const shoulder = { x: hipAt[0] + facing * torso * Math.sin(lean * D), y: hipAt[1] - torso * Math.cos(lean * D) };
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

test('standing still reads a thigh hanging straight down, a straight knee, a plumb shin and an upright trunk', () => {
  const r = readOf({});
  assert.ok(r.ok);
  assert.ok(Math.abs(r.thigh) < 0.01, 'the thigh hangs: ' + r.thigh);
  assert.ok(Math.abs(r.knee - 180) < 0.01, 'the knee is straight: ' + r.knee);
  assert.ok(Math.abs(r.shin) < 0.01, 'the shin is plumb: ' + r.shin);
  assert.ok(Math.abs(r.lean) < 0.01, 'the trunk upright: ' + r.lean);
  const v = judge(r);
  assert.equal(v.atStart, true, 'and that is the start of a rep');
  assert.equal(v.raised, false);
  assert.equal(v.inPosition, false);
});

test('the angles are read back as posed: the lower leg off plumb is what the thigh and the knee leave it', () => {
  for (const thigh of [15, 45, 70, 90]) {
    for (const knee of [90, 120, 180]) {
      for (const lean of [-10, 0, 12]) {
        for (const facing of [1, -1]) {
          const r = read(body({ thigh, knee, lean, facing }));
          assert.ok(Math.abs(r.thigh - thigh) < 0.01, `thigh ${thigh} read ${r.thigh.toFixed(2)}`);
          assert.ok(Math.abs(r.knee - knee) < 0.01, `knee ${knee} read ${r.knee.toFixed(2)} (thigh ${thigh}, facing ${facing})`);
          /* the foot out in front of the knee reads below zero, tucked back above it */
          assert.ok(Math.abs(r.shin - (180 - thigh - knee)) < 0.01, `shin read ${r.shin.toFixed(2)} (thigh ${thigh}, knee ${knee}, facing ${facing})`);
          assert.ok(Math.abs(r.lean - lean) < 0.01, `lean ${lean} read ${r.lean.toFixed(2)} (facing ${facing})`);
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

test('the lower leg hangs under the knee, twenty degrees either way', () => {
  /* the edge of the band is inside it */
  const g = (o) => judge(readOf(Object.assign({ thigh: 85 }, o))).good;
  assert.equal(g({ knee: 95 }).shin, true, 'hanging plumb');
  assert.equal(g({ knee: 115 }).shin, true, 'and the edges of the twenty allowed');
  assert.equal(g({ knee: 75 }).shin, true);
  assert.equal(g({ knee: 116 }).shin, false);
  assert.equal(g({ knee: 74 }).shin, false);
});

test('the thigh comes up to level or near it — the knee\'s angle no longer stands in for it', () => {
  /* a thigh at sixty with the shin plumb reads a knee of 120: the fix is to lift higher, not
     to bend the knee, and that is what is said */
  const f = (o) => judge(readOf(Object.assign({ thigh: 85, knee: 95 }, o))).faults;
  assert.ok(f({ thigh: 60, knee: 120 }).thighLow > 0, 'lift higher');
  assert.equal(f({ thigh: 60, knee: 120 }).kneeOpen, undefined, 'and nothing about the knee while the thigh is low');
  assert.equal(f({ thigh: 75, knee: 105 }).thighLow, undefined, 'seventy five is in');
  assert.match(M.cues.thighLow.text, /higher/i);
  assert.ok(M.measurements.find((m) => m.key === 'knee') && !M.bands.some((b) => b.key === 'knee'), 'the knee is drawn, not judged');
  assert.ok(!M.faults.includes('toesDown') && !M.faults.includes('toesUp'), 'no source sets where the foot should be, so it is not judged');
});

test('a foot out in front or tucked back is told to hang, and the trunk to stand tall', () => {
  const f = (o) => judge(readOf(Object.assign({ thigh: 85, knee: 95 }, o))).faults;
  assert.ok(f({ knee: 125 }).kneeOpen > 0, 'out in front');
  assert.ok(f({ knee: 65 }).kneeShut > 0, 'tucked back');
  assert.match(M.cues.kneeOpen.text, /hang/i);
  assert.ok(f({ lean: -12 }).leanBack > 0, 'leaning back to lift the knee');
  assert.ok(f({ lean: 20 }).leanFwd > 0, 'or folding forward');
  assert.equal(f({ lean: -8 }).leanBack, undefined, 'eight back is the edge');
  assert.deepEqual(f({}), {}, 'and nothing at all when it is right');
});

test('the position is the thigh up, the lower leg hanging and the trunk tall, with the knee actually up', () => {
  assert.equal(judge(readOf({ thigh: 85, knee: 95 })).inPosition, true);
  assert.equal(judge(readOf({ thigh: 85, knee: 125 })).inPosition, false, 'foot out in front');
  assert.equal(judge(readOf({ thigh: 70, knee: 110 })).inPosition, false, 'thigh low');
  assert.equal(judge(readOf({ thigh: 85, knee: 95, lean: -12 })).inPosition, false, 'leaning back');
  /* a heel tucked up behind is not a knee raise: the thigh has to have come up */
  const tucked = judge(readOf({ thigh: 10, knee: 90 }));
  assert.equal(tucked.inPosition, false);
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
const UP = { thigh: 88, knee: 90, foot: 85 };
const DOWN = { thigh: 0, knee: 180, foot: 90 };
const HALFWAY = { thigh: 35, knee: 120, foot: 88 };   // on the way down: below the raise mark, above the start
/* the set-up wait: standing at the start for two seconds before anything is coached */
const settle = (c, t0) => play(c, DOWN, 2300, t0).t;

test('a rep is up, held to the count, lowered, and only then counted', () => {
  const c = new Core.Coach(M, { readyMs: 2000, readyMs: 2000 });
  let t = settle(c, 0), said = [];
  ({ t } = Object.assign({}, (() => { const p = play(c, DOWN, 1000, t); said = said.concat(p.said); return p; })()));
  assert.equal(c.reps, 0, 'standing there is not a rep');

  const up = play(c, UP, 11500, t);            // settle, then the ten second hold
  said = said.concat(up.said); t = up.t;
  assert.equal(up.last.phase, 'lower', 'the hold is done and it is time to come down');
  assert.equal(c.reps, 0, 'but the rep is not counted at the top');
  assert.ok(up.said.some((x) => x.id === 'hold'), 'it was told to hold');
  assert.ok(up.said.some((x) => x.id === 'call5'), 'and the time was called');
  assert.ok(up.said.some((x) => x.id === 'lower' && /lower slowly/i.test(x.text)), 'and told to lower');

  const mid = play(c, HALFWAY, 1300, t); t = mid.t;   // lowered over a second and a bit
  assert.equal(c.reps, 0, 'halfway down is not down');
  const down = play(c, DOWN, 1000, t);
  assert.equal(c.reps, 1, 'back to standing is what counts it');
  assert.equal(down.last.reps, 1);
  assert.equal(down.last.repTarget, 10);
  assert.ok(down.said.some((x) => x.text === '1'), 'and the count is called: ' + JSON.stringify(down.said.map((x) => x.text)));
});

test('"lower slowly" is judged: a knee dropped from the top is counted, and told so with the count', () => {
  const c = new Core.Coach(M, { readyMs: 2000, holdTargetSec: 2, callAtSec: [] });
  let t = settle(c, 0);
  ({ t } = play(c, DOWN, 800, t));
  ({ t } = play(c, UP, 3200, t));
  const drop = play(c, DOWN, 900, t);                  // straight down in one frame
  assert.equal(c.reps, 1, 'it is still a rep');
  const count = drop.said.find((x) => x.id === 'count1');
  assert.ok(count && /^1 \u2014 slower on the way down$/.test(count.text), 'the count carries the remark: ' + (count && count.text));
  assert.equal(c.fastReps, 1);
  /* and one that takes its time is just counted */
  ({ t } = play(c, UP, 3200, drop.t));
  ({ t } = play(c, HALFWAY, 1300, t));
  const eased = play(c, DOWN, 900, t);
  assert.equal(c.reps, 2);
  assert.equal(eased.said.find((x) => x.id === 'count2').text, '2');
  assert.equal(c.fastReps, 1, 'no remark on that one');
  /* the check is a setting, and off at zero */
  const off = new Core.Coach(M, { readyMs: 2000, holdTargetSec: 2, callAtSec: [], lowerSec: 0 });
  let u = settle(off, 0);
  ({ t: u } = play(off, DOWN, 800, u)); ({ t: u } = play(off, UP, 3200, u));
  const p = play(off, DOWN, 900, u);
  assert.equal(p.said.find((x) => x.id === 'count1').text, '1');
});

test('a knee dropped before the count is finished is not a rep, and is said so', () => {
  const c = new Core.Coach(M, { readyMs: 2000, readyMs: 2000 });
  let t = settle(c, 0);
  ({ t } = play(c, DOWN, 800, t));
  ({ t } = play(c, UP, 4000, t));              // up, but only four of the ten seconds
  const early = play(c, DOWN, 1500, t);
  assert.equal(c.reps, 0, 'nothing counted');
  assert.equal(early.last.phase, 'down', 'and it is back to waiting for the next one');
  assert.ok(early.said.some((x) => x.id === 'early'), 'said: ' + JSON.stringify(early.said.map((x) => x.text)));
});

test('ten reps finish the set, and the clock is per rep rather than per set', () => {
  const c = new Core.Coach(M, { readyMs: 2000, holdTargetSec: 2, callAtSec: [1], repCount: 3 });
  let t = settle(c, 0);
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
  const c = new Core.Coach(M, { readyMs: 2000, readyMs: 2000 });
  const r = play(c, DOWN, 4300, 0);          // two seconds of set-up wait, then the prompt
  assert.ok(r.said.some((x) => x.id === 'raise' && /raise one knee/i.test(x.text)),
    'said: ' + JSON.stringify(r.said.map((x) => x.text)));
  assert.deepEqual(c.summary().cues, {}, 'and nothing was wrong with anything');
});

test('the lean and the lower leg are only corrected once the knee is actually up', () => {
  /* standing leaning back is not a fault: there is no rep under way */
  const still = new Core.Coach(M, { readyMs: 2000 });
  const a = play(still, { thigh: 0, knee: 180, lean: -14 }, 4000, 0);
  assert.deepEqual(a.said.filter((x) => /lean|knee/i.test(x.id)).map((x) => x.id), []);
  /* the same lean with the knee up is */
  const upc = new Core.Coach(M, { readyMs: 2000 });
  let t = settle(upc, 0); ({ t } = play(upc, DOWN, 700, t));
  const b = play(upc, { thigh: 88, knee: 90, lean: -14 }, 2500, t);
  assert.ok(b.said.some((x) => x.id === 'leanBack'), 'said: ' + JSON.stringify(b.said.map((x) => x.text)));
});

test('the trunk is corrected before the knee\'s height, and the height before the lower leg', () => {
  const c = new Core.Coach(M, { readyMs: 2000 });
  let t = settle(c, 0); ({ t } = play(c, DOWN, 700, t));
  const r = play(c, { thigh: 70, knee: 140, lean: -15 }, 2000, t);
  const first = r.said.filter((x) => /lean|thigh|knee/i.test(x.id))[0];
  assert.equal(first.id, 'leanBack', 'said: ' + JSON.stringify(r.said.map((x) => x.text)));
  const c2 = new Core.Coach(M, { readyMs: 2000 });
  t = settle(c2, 0); ({ t } = play(c2, DOWN, 700, t));
  const r2 = play(c2, { thigh: 70, knee: 140 }, 2000, t);
  assert.equal(r2.said.filter((x) => /thigh|knee/i.test(x.id))[0].id, 'thighLow', 'said: ' + JSON.stringify(r2.said.map((x) => x.text)));
});

test('the bands are settings, not rules baked into the code', () => {
  const loose = { shinTilt: 40 };
  assert.equal(judge(readOf({ thigh: 85, knee: 125 }), loose).good.shin, true, 'widened, thirty degrees out is in');
  assert.equal(judge(readOf({ thigh: 85, knee: 125 })).good.shin, false, 'and the default band is unchanged');
  /* how far the thigh must come up is a setting too, and is not marked either way */
  assert.equal(judge(readOf({ thigh: 30, knee: 90, foot: 85 })).raised, false);
  assert.equal(judge(readOf({ thigh: 30, knee: 90, foot: 85 }), { raiseAt: 25 }).raised, true);
});
