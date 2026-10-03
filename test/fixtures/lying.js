'use strict';
/* A body posed to the figure's angles, as the pose model's landmarks: lying, kneeling, side-lying.
   Shared by the new-moves tests and the studio's count-every-rep tests. */
const Core = require('../../public/js/core.js');
const D = Math.PI / 180;

/* A side-on body from joint angles, in a frame `aspect` wide. Angles follow the
   figure's own convention: torso from vertical (+ the way the body faces), thigh
   and shin from straight down (+ forward), foot from horizontal-forward (+ toes
   up), arms from straight down. Both legs are given, near (the side measured is
   whichever the move picks) and far. facing +1 = the body faces the image right.
   `farBelow` drops the far side by that share of the picture: lying on the side facing
   the phone, the bottom hip and shoulder sit below the top ones. */
function body(o) {
  const f = o.facing == null ? 1 : o.facing, aspect = o.aspect || 16 / 9;
  const L = { torso: o.torsoLen || 0.24, thigh: 0.19, shin: 0.19, foot: 0.07, heel: 0.02, uarm: 0.14, farm: 0.13 };
  const hip = { x: o.hipAt ? o.hipAt[0] : 1.0, y: o.hipAt ? o.hipAt[1] : 0.5 };
  const down = (p, a, len) => ({ x: p.x + f * Math.sin(a * D) * len, y: p.y + Math.cos(a * D) * len });
  const up = (p, a, len) => ({ x: p.x + f * Math.sin(a * D) * len, y: p.y - Math.cos(a * D) * len });
  const shoulder = up(hip, o.torso || 0, L.torso);
  const ear = up(shoulder, (o.torso || 0) + (o.neck || 0), 0.08);
  const elbow = down(shoulder, o.uarm == null ? 5 : o.uarm, L.uarm), wrist = down(elbow, o.farm == null ? 5 : o.farm, L.farm);
  const leg = (th, sh, ft) => {
    const knee = down(hip, th, L.thigh), ankle = down(knee, sh, L.shin);
    /* the heel a little below the ankle along the shin's line, the toe along the foot's own line */
    const heel = down(ankle, sh, L.heel);
    const fl = o.footLen == null ? L.foot : o.footLen;   // the foot's length in the picture: long when seen in profile
    const toe = { x: heel.x + f * Math.cos(ft * D) * fl, y: heel.y - Math.sin(ft * D) * fl };
    return { knee, ankle, heel, toe };
  };
  const near = leg(o.thigh || 0, o.shin == null ? (o.thigh || 0) : o.shin, o.foot || 0);
  const far = leg(o.thighF == null ? (o.thigh || 0) : o.thighF, o.shinF == null ? (o.thighF == null ? (o.shin == null ? (o.thigh || 0) : o.shin) : o.thighF) : o.shinF, o.footF == null ? (o.foot || 0) : o.footF);
  const drop = (P) => { const k = o.farBelow || 0; if (!k) return P; const out = {}; for (const [n, q] of Object.entries(P)) out[n] = { x: q.x, y: q.y + k }; return out; };
  const sides = { R: Object.assign({ shoulder, ear, elbow, wrist, hip }, near), L: drop(Object.assign({ shoulder, ear, elbow, wrist, hip }, far)) };
  const hide = new Set(o.hide || []);
  /* `tilt` turns the whole body about the hip, as a phone not laid level would */
  const t = (o.tilt || 0) * D, turn = (p) => (!t ? p : { x: hip.x + (p.x - hip.x) * Math.cos(t) - (p.y - hip.y) * Math.sin(t), y: hip.y + (p.x - hip.x) * Math.sin(t) + (p.y - hip.y) * Math.cos(t) });
  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  for (const s of ['L', 'R']) for (const [name, i] of Object.entries(Core.SIDE[s])) { const p = sides[s][name]; if (p) { const q = turn(p); lm[i] = { x: q.x / aspect, y: q.y, z: 0, visibility: hide.has(name) || hide.has(s + '.' + name) ? 0.1 : 0.95 }; } }
  return lm;
}

/* lying on the back, head to the right: torso 90; a leg along the floor is -90 */
const SUPINE = { torso: 90, thigh: -90, shin: -90, foot: 90, thighF: -90, shinF: -90, footF: 90, uarm: -90, farm: -90, hipAt: [1.0, 0.7] };
const lifted = (deg, over) => Object.assign({}, SUPINE, { thigh: -90 - deg, shin: -90 - deg, foot: 90 - deg }, over);

module.exports = { body, SUPINE, lifted };
