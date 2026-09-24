'use strict';
/* The donkey kick: hands under shoulders, arms straight, back level, one knee kept
   bent and the thigh lifted to the back's line and no further. Every number the
   app acts on is held against a body posed to exactly that number. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const M = require('../public/js/moves.js').donkeykick;

const D = Math.PI / 180;
const ASPECT = 16 / 9;
const cfg = (o) => Object.assign({}, Core.COMMON, M.defaults, o);
const read = (lm, o) => M.read(lm, ASPECT, cfg(o));
const judge = (r, o) => M.judge(r, cfg(o));

/* On hands and knees, side on, built backwards from the angles it should read.
     back    the hip→shoulder line's rise off level: + shoulders higher (sagging)
     arm     the wrist→shoulder line from the floor: 90 plumb, more = shoulders ahead
     elbow   the angle at the elbow
     lift    the angle at the hip between knee and shoulder: 90 kneeling, 180 in line
     over    degrees the thigh sits above the back's line (0 on it; used only past 180)
     knee    the angle at the working knee
     facing  +1 = head to the image right
     up      'L' or 'R' — the working leg
   The torso is laid from the hip, the arm hung from the shoulder, the working thigh
   swung off the torso's line by `lift`, the shin off the thigh by `knee`. The other
   leg kneels: thigh straight down, shin along the floor. */
function body({ back = 0, arm = 90, elbow = 180, lift = 90, over = null, knee = 90, facing = 1, up = 'R', vis = 0.95,
                hipAt = [0.62, 0.5], torso = 0.22, uarm = 0.11, farm = 0.11, thigh = 0.16, shin = 0.15 } = {}) {
  const hip = { x: hipAt[0], y: hipAt[1] };
  const shoulder = { x: hip.x + facing * torso * Math.cos(back * D), y: hip.y - torso * Math.sin(back * D) };
  /* the arm hangs from the shoulder: the wrist sits on a line at `arm` from the
     floor, as far away as an arm bent by `elbow` reaches, and the elbow is put where
     the two bones meet (a two-bone reach), bent away from the head */
  const a = arm * D, dirx = facing * Math.cos(a), diry = Math.sin(a);
  const d = Math.sqrt(uarm * uarm + farm * farm - 2 * uarm * farm * Math.cos(elbow * D));
  const wr = { x: shoulder.x + d * dirx, y: shoulder.y + d * diry };
  const alpha = Math.acos(Math.max(-1, Math.min(1, (uarm * uarm + d * d - farm * farm) / (2 * uarm * d))));
  const turn = -facing * alpha;
  const el = { x: shoulder.x + uarm * (dirx * Math.cos(turn) - diry * Math.sin(turn)), y: shoulder.y + uarm * (dirx * Math.sin(turn) + diry * Math.cos(turn)) };
  /* the working thigh: swung off the torso's line at the hip by `lift`, on the
     underside of the body (the knee below the back's line) unless `over` says past */
  const tx = (shoulder.x - hip.x) / torso, ty = (shoulder.y - hip.y) / torso;     // toward the head
  const rot = (vx, vy, ang) => ({ x: vx * Math.cos(ang) - vy * Math.sin(ang), y: vx * Math.sin(ang) + vy * Math.cos(ang) });
  /* turning the head-ward unit vector by `lift` degrees toward the floor: for a
     body facing right, the underside is the +y side, so the turn is +angle */
  const th = over == null ? rot(tx, ty, facing * lift * D) : rot(-tx, -ty, facing * over * D);
  const kneeP = { x: hip.x + thigh * th.x, y: hip.y + thigh * th.y };
  /* the shin off the thigh by the knee angle, bending the way the sole goes to the ceiling */
  const sh = rot(-th.x, -th.y, -facing * knee * D * (over == null ? 1 : 1));
  const ankle = { x: kneeP.x + shin * sh.x, y: kneeP.y + shin * sh.y };
  const work = { hip, knee: kneeP, ankle, heel: { x: ankle.x + shin * 0.1 * sh.x, y: ankle.y + shin * 0.1 * sh.y }, toe: { x: ankle.x - facing * 0.05, y: ankle.y + 0.02 } };
  /* the kneeling leg: thigh straight down, shin along the floor behind */
  const kneeK = { x: hip.x, y: hip.y + thigh };
  const rest = { hip, knee: kneeK, ankle: { x: kneeK.x - facing * shin, y: kneeK.y }, heel: { x: kneeK.x - facing * shin * 1.05, y: kneeK.y }, toe: { x: kneeK.x - facing * shin * 1.3, y: kneeK.y } };
  const top = { shoulder, elbow: el, wrist: wr, ear: { x: shoulder.x + facing * 0.08, y: shoulder.y - 0.02 } };
  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  for (const side of ['L', 'R']) {
    const P = Object.assign({}, top, side === up ? work : rest);
    for (const [name, i] of Object.entries(Core.SIDE[side])) {
      const p = P[name]; if (!p) continue;
      lm[i] = { x: p.x / ASPECT, y: p.y, z: 0, visibility: vis };
    }
  }
  return lm;
}
const readOf = (o) => read(body(o));

test('kneeling reads a level back, plumb straight arms, a right-angled hip, and is the start', () => {
  const r = readOf({});
  assert.ok(r.ok, r.why);
  assert.ok(Math.abs(r.back) < 0.01, 'back level: ' + r.back);
  assert.ok(Math.abs(r.arm - 90) < 0.01, 'arm plumb: ' + r.arm);
  assert.ok(Math.abs(r.elbow - 180) < 0.01, 'elbow straight: ' + r.elbow);
  assert.ok(Math.abs(r.lift - 90) < 0.01, 'thigh straight down off a level back: ' + r.lift);
  const v = judge(r);
  assert.equal(v.atStart, true); assert.equal(v.raised, false); assert.equal(v.inPosition, false);
});

test('the readings come back as posed, and are independent of each other', () => {
  for (const back of [-12, 0, 8]) for (const arm of [80, 90, 110]) for (const elbow of [150, 180]) for (const lift of [90, 140, 175]) for (const knee of [70, 90, 110]) for (const facing of [1, -1]) {
    const r = read(body({ back, arm, elbow, lift, knee, facing }));
    const at = `(back ${back}, arm ${arm}, elbow ${elbow}, lift ${lift}, knee ${knee}, facing ${facing})`;
    assert.ok(r.ok, 'seen ' + at);
    assert.ok(Math.abs(r.back - back) < 0.01, `back read ${r.back.toFixed(2)} ${at}`);
    assert.ok(Math.abs(r.arm - arm) < 0.01, `arm read ${r.arm.toFixed(2)} ${at}`);
    assert.ok(Math.abs(r.elbow - elbow) < 0.01, `elbow read ${r.elbow.toFixed(2)} ${at}`);
    assert.ok(Math.abs(r.lift - lift) < 0.01, `lift read ${r.lift.toFixed(2)} ${at}`);
    assert.ok(Math.abs(r.knee - knee) < 0.01, `knee read ${r.knee.toFixed(2)} ${at}`);
  }
});

test('the leg being measured is the one that is up, whichever side it is', () => {
  for (const up of ['L', 'R']) {
    const r = read(body({ lift: 170, up }));
    assert.equal(r.side, up);
    assert.ok(Math.abs(r.lift - 170) < 0.01);
  }
});

const TOP = { lift: 172, knee: 90 };
const at = (o) => judge(readOf(Object.assign({}, TOP, o)));

test('the top: at least 165 at the hip, edge included, and the thigh no more than five above the back', () => {
  assert.equal(at({ lift: 165 }).good.lift, true);
  assert.equal(at({ lift: 164 }).good.lift, false);
  assert.ok(at({ lift: 150 }).faults.liftLow > 0);
  assert.ok(Math.abs(readOf({ lift: 180, knee: 90 }).over) < 0.01, 'in line is zero over: ' + readOf({ lift: 180, knee: 90 }).over);
  assert.ok(Math.abs(readOf(TOP).over + 8) < 0.01, 'eight short of the line reads eight under it');
  assert.equal(at({ over: 5 }).good.over, true, 'five above the line is allowed');
  assert.equal(at({ over: 6 }).good.over, false);
  const past = at({ over: 12 });
  assert.ok(past.faults.liftHigh > 0 && past.faults.liftLow == null, 'past the line is too high, not too low: ' + JSON.stringify(past.faults));
  assert.match(M.cues.liftHigh.text, /not so high/i);
});

test('the knee stays at a right angle, ten degrees either way; the arms plumb, the elbows straight, the back level', () => {
  assert.equal(at({ knee: 80 }).good.knee, true); assert.equal(at({ knee: 100 }).good.knee, true);
  assert.equal(at({ knee: 79 }).good.knee, false); assert.equal(at({ knee: 101 }).good.knee, false);
  assert.ok(at({ knee: 120 }).faults.kneeOpen > 0); assert.ok(at({ knee: 60 }).faults.kneeShut > 0);
  assert.equal(at({ arm: 85 }).good.arm, true); assert.equal(at({ arm: 105 }).good.arm, true);
  assert.ok(at({ arm: 75 }).faults.armBack > 0, 'shoulders behind the wrists'); assert.ok(at({ arm: 115 }).faults.armFwd > 0, 'ahead of them');
  assert.equal(at({ elbow: 165 }).good.elbow, true); assert.ok(at({ elbow: 150 }).faults.elbowBent > 0);
  assert.equal(at({ back: 10 }).good.back, true); assert.equal(at({ back: -10 }).good.back, true);
  assert.ok(at({ back: 15 }).faults.backSag > 0, 'shoulders above hips: sagging'); assert.ok(at({ back: -15 }).faults.backRound > 0, 'hips above shoulders: rounding');
});

test('the position is everything together, with the leg actually up; the order is hands, arms, back, then the leg', () => {
  assert.equal(at({}).inPosition, true);
  assert.equal(at({ knee: 120 }).inPosition, false);
  assert.equal(at({ elbow: 140 }).inPosition, false);
  assert.equal(at({ back: 15 }).inPosition, false);
  assert.equal(at({ lift: 150 }).inPosition, false);
  assert.equal(at({ lift: 115 }).raised, false); assert.equal(at({ lift: 120 }).raised, true);
  assert.equal(at({ lift: 106 }).atStart, false); assert.equal(at({ lift: 105 }).atStart, true);
  assert.deepEqual(M.faults, ['lost', 'armBack', 'armFwd', 'elbowBent', 'backSag', 'backRound', 'raise', 'kneeOpen', 'kneeShut', 'liftHigh', 'liftLow']);
  assert.deepEqual(M.setup, ['armBack', 'armFwd', 'elbowBent', 'backSag', 'backRound']);
  assert.equal(M.camera, 'wide'); assert.equal(M.defaults.repCount, 10); assert.equal(M.defaults.holdTargetSec, 2); assert.equal(M.alternate, true);
});

/* ---------- a set ---------- */
const step = (c, o, t) => c.step(read(body(o), c.cfg), t);
function play(c, o, ms, t0) {
  const said = []; let t = t0, last = null;
  for (; t < t0 + ms; t += 33) { last = step(c, o, t); if (last.cue) said.push(last.cue); }
  return { said, last, t };
}
const REST = {}, HALFWAY = { lift: 112 };
const texts = (p) => JSON.stringify(p.said.map((x) => x.text));

test('a rep: kick up, hold two seconds, lower slowly, and it counts when the knee is down', () => {
  const c = new Core.Coach(M);
  let t = 0;
  const rest = play(c, REST, 1200, t); t = rest.t;
  assert.ok(rest.said.some((x) => x.id === 'raise' && /kick up/i.test(x.text)), texts(rest));
  const up = play(c, TOP, 3500, t); t = up.t;
  assert.equal(up.last.phase, 'lower');
  assert.ok(up.said.some((x) => x.id === 'hold') && up.said.some((x) => x.id === 'lower'), texts(up));
  ({ t } = play(c, HALFWAY, 1300, t));
  const down = play(c, REST, 1000, t);
  assert.equal(c.reps, 1);
  assert.equal(down.said.find((x) => x.id === 'count1').text, '1');
});

test('arms and back are corrected at the start, before the kick is asked for; too high before not high enough', () => {
  const c = new Core.Coach(M);
  const bent = play(c, { elbow: 140 }, 1500, 0);
  const first = bent.said.find((x) => x.id !== 'lost');
  assert.equal(first && first.id, 'elbowBent', texts(bent));
  assert.ok(!bent.said.some((x) => x.id === 'raise'));
  const c2 = new Core.Coach(M);
  let t = 0;
  ({ t } = play(c2, REST, 1000, t));
  const high = play(c2, { over: 14, knee: 90 }, 2500, t);
  const said = high.said.find((x) => x.id !== 'lost');
  assert.equal(said && said.id, 'liftHigh', texts(high));
});
