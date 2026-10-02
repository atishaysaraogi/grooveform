'use strict';
/* The bridge rig: a body posed to known angles, as the pose model's landmarks, and a
   take made of poses held for stretches of time. Shared by the trace and discover
   tests, so a number asserted in one is the number the other saw. */
const Core = require('../../public/js/core.js');

const D = Math.PI / 180;
const ASPECT = 16 / 9;

/* a seeded generator in [-0.5, 0.5), so a jittered take is the same take on every run */
function seeded(seed) {
  let s = (seed == null ? 7 : seed) >>> 0;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
}

/* A body lying side on: the shin's angle at the heel between toe and knee, the thigh's dip
   below the knee, the angle at the hip, the foot's slant, which way it faces, how sure the
   model is of each landmark (`vis`, or per landmark in `dim`: { wrist: 0.3 }), and a
   `jitter` (a share of the picture) added to every landmark from `rnd`. The elbow and the
   wrist lie on the floor between the shoulder and the hip, arms by the sides. */
function body({ shin = 95, dip = 50, hipAng = 130, foot = 0, facing = 1, vis = 0.95, dim = null, jitter = 0, rnd = null } = {}) {
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
  const elbow = { x: shoulder.x + facing * 0.11, y: heel.y - 0.01 }, wrist = { x: shoulder.x + facing * 0.23, y: heel.y - 0.01 };
  const P = { heel, toe, knee, ankle, hip, shoulder, elbow, wrist, ear: { x: shoulder.x - facing * 0.05, y: shoulder.y - 0.01 } };
  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  /* three uniforms summed, scaled so the jitter is the noise's standard deviation, not a third of it */
  const j = () => (jitter && rnd ? jitter * 2 * (rnd() + rnd() + rnd()) : 0);
  for (const side of ['L', 'R']) for (const [name, i] of Object.entries(Core.SIDE[side])) {
    const p = P[name]; if (!p) continue;
    lm[i] = { x: p.x / ASPECT + j(), y: p.y + j(), z: 0, visibility: dim && dim[name] != null ? dim[name] : vis };
  }
  return lm;
}

/* a take: a list of [pose, ms] stretches, at `fps` frames a second (or `step` ms a frame),
   with `jitter` on every landmark from a generator seeded with `seed`; `pose` is laid
   under every stretch's pose (a `dim` for the whole take, say) */
function take(script, opts) {
  const o = opts || {};
  const step = o.step || Math.round(1000 / (o.fps || 30));
  const rnd = seeded(o.seed), frames = []; let t = 0;
  for (const [pose, ms] of script) for (const end = t + ms; t < end; t += step) frames.push({ t, lm: body(Object.assign({ jitter: o.jitter || 0, rnd }, o.pose || {}, pose)) });
  return frames;
}

/* The three poses of a rep. The foot's slant of 9 is the model's own: its heel landmark
   sits above the sole. The file reads the foot against its start, so the slant is taken off
   by itself. */
const REST = { shin: 95, dip: 50, hipAng: 130, foot: 9 }, TOP = { shin: 95, dip: 5, hipAng: 170, foot: 9 }, HALF = { shin: 95, dip: 25, hipAng: 145, foot: 9 };
const cleanRep = [[REST, 3000], [TOP, 3500], [HALF, 1300], [REST, 1500]];
/* one rep from the top: held, lowered, and the pause before the next */
const rep = (top, rest) => [[Object.assign({}, TOP, top || {}), 3500], [Object.assign({}, HALF, rest || {}), 1300], [Object.assign({}, REST, rest || {}), 2600]];

module.exports = { D, ASPECT, seeded, body, take, REST, TOP, HALF, cleanRep, rep };
