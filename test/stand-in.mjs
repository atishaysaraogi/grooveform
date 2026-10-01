/* The bodies the smoke tests pose in the page, so the app sees ordinary landmarks without a
   person or a camera; and the spy on the speech engine. Shared by smoke.mjs and care-smoke.mjs. */
/* The same bodies the unit tests pose, built in the page so the app sees ordinary
   landmarks. Which one is built follows `__pose.move`, so switching exercise in the
   UI switches what the stand-in camera is showing, as a real person would. */
export const POSE_SRC = `
const D = Math.PI / 180;
/* the frame the camera is actually giving, which is not the same for every move:
   the knee raise asks for a tall one. A stand-in that assumed a shape would pose
   bodies the app then reads at the wrong scale. */
function aspect() {
  const cam = document.getElementById('cam');
  return cam && cam.videoWidth ? cam.videoWidth / cam.videoHeight : 16 / 9;
}
const SIDE = { L: { ear:7, shoulder:11, elbow:13, wrist:15, hip:23, knee:25, ankle:27, heel:29, toe:31 },
               R: { ear:8, shoulder:12, elbow:14, wrist:16, hip:24, knee:26, ankle:28, heel:30, toe:32 } };
window.__pose = { move: 'wallsit', knee: 90, shin: 90, tilt: 0, stack: 0, sag: 0,
                  thigh: 0, kneeUp: 180, foot: 90, bShin: 95, dip: 50, hipAng: 130, bFoot: 0,
                  dBack: 0, dArm: 90, dElbow: 180, dLift: 90, dOver: null, dKnee: 90, vis: 0.95 };

function wallsitBody(o, f) {
  const thigh = 0.2, shinLen = 0.22, torso = 0.26;
  const knee = { x: 0.34, y: 0.48 };      // placed for the tall frame this move asks for
  const u = { x: -f * Math.cos(o.shin * D), y: Math.sin(o.shin * D) };
  const heel = { x: knee.x + shinLen * u.x, y: knee.y + shinLen * u.y };
  const ankle = { x: knee.x + shinLen * 0.86 * u.x, y: knee.y + shinLen * 0.86 * u.y };
  const a = o.knee * D * f, ca = Math.cos(a), sa = Math.sin(a);
  const h = { x: u.x * ca - u.y * sa, y: u.x * sa + u.y * ca };
  const hip = { x: knee.x + thigh * h.x, y: knee.y + thigh * h.y };
  const shoulder = { x: hip.x + f * torso * Math.sin(o.tilt * D), y: hip.y - torso * Math.cos(o.tilt * D) };
  return { hip, knee, ankle, shoulder, heel,
    toe: { x: heel.x + f * 0.08, y: heel.y + 0.004 },
    ear: { x: shoulder.x + f * 0.02, y: shoulder.y - 0.07 } };
}
function plankBody(o, f) {
  const upper = 0.18, torso = 0.27, legs = 0.26, fore = 0.13;
  const shoulder = { x: 0.62, y: 0.42 };
  const elbow = { x: shoulder.x - f * upper * Math.sin(o.stack * D), y: shoulder.y + upper * Math.cos(o.stack * D) };
  const wrist = { x: elbow.x + f * fore, y: elbow.y + 0.012 };
  const tilt = 12 * D, dir = { x: -f * Math.cos(tilt), y: Math.sin(tilt) };
  const hip = { x: shoulder.x + torso * dir.x, y: shoulder.y + torso * dir.y };
  const a = -o.sag * D * f, ca = Math.cos(a), sa = Math.sin(a);
  const leg = { x: dir.x * ca - dir.y * sa, y: dir.x * sa + dir.y * ca };
  const ankle = { x: hip.x + legs * leg.x, y: hip.y + legs * leg.y };
  return { shoulder, elbow, wrist, hip, ankle,
    knee: { x: hip.x + legs * 0.55 * leg.x, y: hip.y + legs * 0.55 * leg.y },
    heel: { x: ankle.x - f * 0.02, y: ankle.y + 0.035 },
    toe: { x: ankle.x - f * 0.05, y: ankle.y + 0.055 },
    ear: { x: shoulder.x + f * 0.05, y: shoulder.y - 0.04 } };
}
function kneeraiseBody(o, f) {
  const thighLen = 0.17, shinLen = 0.16, heelDrop = 0.03, footLen = 0.08, torso = 0.22, hipAt = [0.22, 0.42];
  const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  const leg = (lift, bend, ang) => {
    const hip = { x: hipAt[0], y: hipAt[1] };
    const dir = { x: f * Math.sin(lift * D), y: Math.cos(lift * D) };
    const knee = { x: hip.x + thighLen * dir.x, y: hip.y + thighLen * dir.y };
    const sd = rot(dir, (180 - bend) * D * f);
    const ankle = { x: knee.x + shinLen * sd.x, y: knee.y + shinLen * sd.y };
    const heel = { x: ankle.x + heelDrop * sd.x, y: ankle.y + heelDrop * sd.y };
    const fd = rot({ x: -sd.x, y: -sd.y }, ang * D * f);
    return { hip, knee, ankle, heel,
      toe: { x: heel.x + footLen * fd.x, y: heel.y + footLen * fd.y } };
  };
  const shoulder = { x: hipAt[0], y: hipAt[1] - torso };
  const top = { shoulder, ear: { x: shoulder.x + f * 0.012, y: shoulder.y - 0.06 } };
  /* two legs, not one copied: the raised one and the one holding him up. That is
     what makes the app's choice of which leg to measure a real choice here. */
  return { R: Object.assign({}, top, leg(o.thigh, o.kneeUp, o.foot)),
    L: Object.assign({}, top, leg(0, 180, 90)) };
}
/* on the back, side on: the same rig as bridge.test.js */
function bridgeBody(o, f) {
  const footLen = 0.07, shinLen = 0.15, thighLen = 0.17, torso = 0.2;
  const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  const heel = { x: 0.64, y: 0.68 };
  const toeDir = { x: f * Math.cos(o.bFoot * D), y: Math.sin(o.bFoot * D) };
  const toe = { x: heel.x + footLen * toeDir.x, y: heel.y + footLen * toeDir.y };
  const sd = rot(toeDir, -f * o.bShin * D);
  const knee = { x: heel.x + shinLen * sd.x, y: heel.y + shinLen * sd.y };
  const ankle = { x: heel.x + shinLen * 0.12 * sd.x, y: heel.y + shinLen * 0.12 * sd.y };
  const td = { x: -f * Math.cos(o.dip * D), y: Math.sin(o.dip * D) };
  const hip = { x: knee.x + thighLen * td.x, y: knee.y + thighLen * td.y };
  const bd = rot({ x: -td.x, y: -td.y }, -f * o.hipAng * D);
  const shoulder = { x: hip.x + torso * bd.x, y: hip.y + torso * bd.y };
  return { heel, toe, knee, ankle, hip, shoulder, ear: { x: shoulder.x - f * 0.05, y: shoulder.y - 0.01 } };
}
/* on hands and knees, side on: the same rig as donkeykick.test.js */
function donkeykickBody(o, f) {
  const torso = 0.22, uarm = 0.11, farm = 0.11, thigh = 0.16, shin = 0.15;
  const hip = { x: 0.62, y: 0.5 };
  const shoulder = { x: hip.x + f * torso * Math.cos(o.dBack * D), y: hip.y - torso * Math.sin(o.dBack * D) };
  const a = o.dArm * D, dirx = f * Math.cos(a), diry = Math.sin(a);
  const d = Math.sqrt(uarm * uarm + farm * farm - 2 * uarm * farm * Math.cos(o.dElbow * D));
  const wrist = { x: shoulder.x + d * dirx, y: shoulder.y + d * diry };
  const alpha = Math.acos(Math.max(-1, Math.min(1, (uarm * uarm + d * d - farm * farm) / (2 * uarm * d)))), turn = -f * alpha;
  const elbow = { x: shoulder.x + uarm * (dirx * Math.cos(turn) - diry * Math.sin(turn)), y: shoulder.y + uarm * (dirx * Math.sin(turn) + diry * Math.cos(turn)) };
  const tx = (shoulder.x - hip.x) / torso, ty = (shoulder.y - hip.y) / torso;
  const rot = (vx, vy, ang) => ({ x: vx * Math.cos(ang) - vy * Math.sin(ang), y: vx * Math.sin(ang) + vy * Math.cos(ang) });
  const th = o.dOver == null ? rot(tx, ty, f * o.dLift * D) : rot(-tx, -ty, f * o.dOver * D);
  const knee = { x: hip.x + thigh * th.x, y: hip.y + thigh * th.y };
  const sh = rot(-th.x, -th.y, -f * o.dKnee * D);
  const ankle = { x: knee.x + shin * sh.x, y: knee.y + shin * sh.y };
  const work = { hip, knee, ankle, heel: { x: ankle.x + shin * 0.1 * sh.x, y: ankle.y + shin * 0.1 * sh.y }, toe: { x: ankle.x - f * 0.05, y: ankle.y + 0.02 } };
  const kneeK = { x: hip.x, y: hip.y + thigh };
  const rest = { hip, knee: kneeK, ankle: { x: kneeK.x - f * shin, y: kneeK.y }, heel: { x: kneeK.x - f * shin * 1.05, y: kneeK.y }, toe: { x: kneeK.x - f * shin * 1.3, y: kneeK.y } };
  const top = { shoulder, elbow, wrist, ear: { x: shoulder.x + f * 0.08, y: shoulder.y - 0.02 } };
  return { R: Object.assign({}, top, work), L: Object.assign({}, top, rest) };
}
window.__poseSource = function () {
  const o = window.__pose; if (!o) return null;
  const A = aspect();
  const B = o.move === 'plank' ? plankBody(o, 1)
    : o.move === 'kneeraise' ? kneeraiseBody(o, 1)
    : o.move === 'bridge' ? bridgeBody(o, 1)
    : o.move === 'donkeykick' ? donkeykickBody(o, 1) : wallsitBody(o, 1);
  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  for (const s of ['L', 'R']) {
    /* side on, most bodies here have their two sides on top of each other; the one
       that does not hands back a limb for each */
    const P = B[s] || B;
    for (const k in SIDE[s]) {
      const p = P[k]; if (!p) continue;
      lm[SIDE[s][k]] = { x: p.x / A, y: p.y, z: 0, visibility: o.vis };
    }
  }
  return lm;
};
`;

/* Headless Chromium has a speech engine that makes no sound, so "did it speak?"
   is checked by watching what is handed to it. That is the part that can break:
   a cue that never reaches the engine is silent on a real phone too. */
export const SPY_SRC = `
window.__spoken = [];
const _speak = speechSynthesis.speak.bind(speechSynthesis);
speechSynthesis.speak = function (u) { window.__spoken.push({ text: u.text, volume: u.volume }); return _speak(u); };
`;

