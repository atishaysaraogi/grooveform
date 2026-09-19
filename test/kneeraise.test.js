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
     ankle  the angle at that ankle, between knee and toe
     facing +1 = toes to the image right, -1 = mirrored
     up     'L' or 'R' — which leg is the raised one

   The raised leg is built out from the hip: the thigh is swung off straight down,
   the shin off the thigh by the knee angle, and the foot off the shin by the ankle
   angle. Each is measured from the one before it, which is how a leg actually
   hangs together, and means the three can be posed independently. The other leg is
   left standing straight underneath, as the one holding the person up. */
function body({ thigh = 0, knee = 180, ankle = 90, facing = 1, up = 'R', vis = 0.95,
                hipAt = [0.22, 0.42], thighLen = 0.17, shinLen = 0.16, foot = 0.07, torso = 0.22 } = {}) {
  const leg = (lift, bend, foot_) => {
    const hip = { x: hipAt[0], y: hipAt[1] };
    /* straight down, turned by `lift` toward the way the toes point */
    const a = lift * D * facing;
    const dir = { x: Math.sin(a) * 1, y: Math.cos(lift * D) };
    dir.x = facing * Math.sin(lift * D);
    const kneeP = { x: hip.x + thighLen * dir.x, y: hip.y + thighLen * dir.y };
    /* the shin, off the thigh by the knee angle: straight (180) continues the line */
    const b = (180 - bend) * D * facing;
    const sd = { x: dir.x * Math.cos(b) - dir.y * Math.sin(b), y: dir.x * Math.sin(b) + dir.y * Math.cos(b) };
    const ankleP = { x: kneeP.x + shinLen * sd.x, y: kneeP.y + shinLen * sd.y };
    /* the foot, off the shin by the ankle angle, turned the other way so the toes
       lead rather than trail */
    const c = -(180 - foot_) * D * facing;
    const fd = { x: sd.x * Math.cos(c) - sd.y * Math.sin(c), y: sd.x * Math.sin(c) + sd.y * Math.cos(c) };
    const toe = { x: ankleP.x + foot * fd.x, y: ankleP.y + foot * fd.y };
    return { hip, knee: kneeP, ankle: ankleP, toe,
      heel: { x: ankleP.x - facing * 0.018, y: ankleP.y + 0.012 } };
  };
  const raised = leg(thigh, knee, ankle);
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
  assert.ok(Math.abs(r.ankle - 90) < 0.01, 'the foot is square to the shin: ' + r.ankle);
  const v = judge(r);
  assert.equal(v.atStart, true, 'and that is the start of a rep');
  assert.equal(v.raised, false);
  assert.equal(v.inPosition, false);
});

test('the three angles are read back as posed, and are independent of each other', () => {
  for (const thigh of [15, 45, 70, 90]) {
    for (const knee of [90, 120, 180]) {
      for (const ankle of [70, 90, 110]) {
        for (const facing of [1, -1]) {
          const r = read(body({ thigh, knee, ankle, facing }));
          assert.ok(Math.abs(r.thigh - thigh) < 0.01, `thigh ${thigh} read ${r.thigh.toFixed(2)}`);
          assert.ok(Math.abs(r.knee - knee) < 0.01, `knee ${knee} read ${r.knee.toFixed(2)} (thigh ${thigh}, facing ${facing})`);
          assert.ok(Math.abs(r.ankle - ankle) < 0.01, `ankle ${ankle} read ${r.ankle.toFixed(2)}`);
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

test('five degrees either side of a right angle, at the knee and at the ankle', () => {
  /* the edge of the band is inside it: five degrees allowed has to allow five */
  const g = (o) => judge(readOf(Object.assign({ thigh: 85 }, o))).good;
  assert.equal(g({ knee: 90 }).knee, true, 'a right angle');
  assert.equal(g({ knee: 85 }).knee, true, 'and the edges of the five allowed');
  assert.equal(g({ knee: 95 }).knee, true);
  assert.equal(g({ knee: 84 }).knee, false);
  assert.equal(g({ knee: 96 }).knee, false);
  assert.equal(g({ knee: 90, ankle: 90 }).ankle, true);
  assert.equal(g({ knee: 90, ankle: 85 }).ankle, true);
  assert.equal(g({ knee: 90, ankle: 95 }).ankle, true);
  assert.equal(g({ knee: 90, ankle: 84 }).ankle, false);
  assert.equal(g({ knee: 90, ankle: 96 }).ankle, false);
});

test('a knee that is too straight is told to bend, and toes that point are told to come up', () => {
  const f = (o) => judge(readOf(Object.assign({ thigh: 85, knee: 90, ankle: 90 }, o))).faults;
  assert.ok(f({ knee: 120 }).kneeOpen > 0, 'too open');
  assert.ok(f({ knee: 70 }).kneeShut > 0, 'too shut');
  assert.ok(f({ ankle: 130 }).toesDown > 0, 'toes pointed away');
  assert.ok(f({ ankle: 60 }).toesUp > 0, 'toes pulled too far up');
  assert.deepEqual(f({}), {}, 'and nothing at all when it is right');
});

test('the position is the two right angles together, with the knee actually up', () => {
  assert.equal(judge(readOf({ thigh: 85, knee: 90, ankle: 90 })).inPosition, true);
  assert.equal(judge(readOf({ thigh: 85, knee: 110, ankle: 90 })).inPosition, false, 'knee out');
  assert.equal(judge(readOf({ thigh: 85, knee: 90, ankle: 120 })).inPosition, false, 'foot out');
  /* the two right angles can be made with the heel tucked up behind, which is not a
     knee raise — so the thigh has to have come up for any of it to count */
  const tucked = judge(readOf({ thigh: 10, knee: 90, ankle: 90 }));
  assert.equal(tucked.good.knee, true, 'the angles are right');
  assert.equal(tucked.good.ankle, true);
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
const UP = { thigh: 88, knee: 90, ankle: 90 };
const DOWN = { thigh: 0, knee: 180, ankle: 90 };

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
  const a = play(still, { thigh: 0, knee: 180, ankle: 140 }, 2000, 0);
  assert.deepEqual(a.said.filter((x) => /toes|knee/i.test(x.id)).map((x) => x.id), []);
  /* the same foot with the knee up is */
  const upc = new Core.Coach(M);
  let t = 0; ({ t } = play(upc, DOWN, 700, t));
  const b = play(upc, { thigh: 88, knee: 90, ankle: 140 }, 2500, t);
  assert.ok(b.said.some((x) => x.id === 'toesDown'), 'said: ' + JSON.stringify(b.said.map((x) => x.text)));
});

test('the knee is corrected before the foot, being what the foot hangs off', () => {
  const c = new Core.Coach(M);
  let t = 0; ({ t } = play(c, DOWN, 700, t));
  const r = play(c, { thigh: 88, knee: 130, ankle: 140 }, 2000, t);
  const first = r.said.filter((x) => /knee|toes/i.test(x.id))[0];
  assert.equal(first.id, 'kneeOpen', 'said: ' + JSON.stringify(r.said.map((x) => x.text)));
});

test('the bands are settings, not rules baked into the code', () => {
  const loose = { kneeMin: 70, kneeMax: 110 };
  assert.equal(judge(readOf({ thigh: 85, knee: 100 }), loose).good.knee, true, 'widened, 100 is in');
  assert.equal(judge(readOf({ thigh: 85, knee: 100 })).good.knee, false, 'and the default band is unchanged');
  /* how far the thigh must come up is a setting too, and is not marked either way */
  assert.equal(judge(readOf({ thigh: 30, knee: 90, ankle: 90 })).raised, false);
  assert.equal(judge(readOf({ thigh: 30, knee: 90, ankle: 90 }), { raiseAt: 25 }).raised, true);
});
