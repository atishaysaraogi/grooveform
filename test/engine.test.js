const E = require('../client/coach/engine.js');
const assert = require('assert');

function frame(map, vis = 0.95) {
  const pts = []; for (let i = 0; i < 33; i++) pts.push({ x: 0.5, y: 0.5, z: 0, visibility: vis });
  for (const k in map) { const [x, y] = map[k]; pts[+k] = { x, y, z: 0, visibility: vis }; }
  return pts;
}
const rot = (cx, cy, len, deg) => [cx + Math.cos(deg * Math.PI / 180) * len, cy + Math.sin(deg * Math.PI / 180) * len];
function run(ex, frames, opts = {}, fps = 30) {
  const sess = new E.SetSession(ex, { target: 100, ...opts }); const sm = new E.PoseSmoother();
  let t = 0; const cues = []; const events = [];
  const first = sm.update(frames[0], t, 1); sess.calibrate(first, E.nearSide(first));
  for (const f of frames) { t += 1000 / fps; const pts = sm.update(f, t, 1); const r = sess.step(pts, t); for (const c of r.cues) sess.ackCue(c.id, t); cues.push(...r.cues.map(c => c.id), ...r.repCues.map(c => c.id)); if (r.repEvent) events.push(r.repEvent); }
  return { sess, cues, events, review: sess.review() };
}
const ex = id => E.EXERCISES.find(e => e.id === id);
const faultsOf = rv => Object.fromEntries(Object.entries(rv.faults).map(([k, v]) => [k, v.n]));

/* ---- Heel slide: supine, head left, near leg = left; flexion f degrees ---- */
function heelslide(f, heelLift = 0, hipLift = 0) {
  const hip = [0.30, 0.60 - hipLift * 0.08], thigh = 0.13, shin = 0.13;
  const half = f / 2; const knee = rot(hip[0], hip[1], thigh, -half); const ank = [knee[0] + Math.cos(half * Math.PI / 180) * shin, hip[1]];
  const heel = [ank[0] - 0.015, ank[1] + 0.01 - heelLift * 0.08], foot = [ank[0] + 0.02, ank[1] + 0.01];
  return frame({ 0: [0.16, 0.58], 7: [0.17, 0.57], 8: [0.17, 0.575], 11: [0.20, 0.60], 12: [0.20, 0.605], 13: [0.24, 0.62], 14: [0.24, 0.62], 15: [0.28, 0.63], 16: [0.28, 0.63], 23: hip, 24: [hip[0], hip[1] + 0.005], 25: knee, 26: [knee[0], knee[1] + 0.005], 27: ank, 28: [ank[0], ank[1] + 0.005], 29: heel, 30: heel, 31: foot, 32: foot });
}
{
  const hs = ex('heelslide'); const frames = [];
  for (let i = 0; i < 40; i++) frames.push(heelslide(0));
  for (let r = 0; r < 4; r++) for (let i = 0; i < 100; i++) { const k = Math.sin(Math.PI * i / 100); frames.push(heelslide((r === 2 ? 60 : 95) * k, r === 1 && k > 0.5 ? 0.3 : 0, 0)); }
  for (let i = 0; i < 40; i++) frames.push(heelslide(0));
  const { review, cues, events } = run(hs, frames, { rom: 90 });
  console.log('heel slide:', { reps: review.reps, partials: review.partials, peaks: events.map(e => e.rep.peak.toFixed(2)), faults: faultsOf(review), cues, score: review.score });
  assert.strictEqual(review.reps, 3); assert.strictEqual(review.partials, 1); assert(review.faults.heel); assert(review.faults.shallow);
}
/* ---- Standing hip abduction: front view, right leg raises ---- */
function hipabd(raise, lean = 0, hike = 0) {
  const hipL = [0.45, 0.50], hipR = [0.55, 0.50 - Math.tan(hike * Math.PI / 180) * 0.10];
  const leg = 0.35; const a = raise * Math.PI / 180;
  const kneeR = [hipR[0] + Math.sin(a) * leg * 0.5, hipR[1] + Math.cos(a) * leg * 0.5]; const ankR = [hipR[0] + Math.sin(a) * leg, hipR[1] + Math.cos(a) * leg];
  const shift = Math.tan(lean * Math.PI / 180) * 0.22; // shoulders move away from the raising (right) leg
  return frame({ 0: [0.5 - shift, 0.15], 7: [0.48 - shift, 0.16], 8: [0.52 - shift, 0.16], 11: [0.42 - shift, 0.28], 12: [0.58 - shift, 0.28], 13: [0.38 - shift, 0.40], 14: [0.62 - shift, 0.40], 15: [0.36 - shift, 0.50], 16: [0.64 - shift, 0.50], 23: hipL, 24: hipR, 25: [0.45, 0.675], 26: kneeR, 27: [0.45, 0.85], 28: ankR, 29: [0.44, 0.87], 30: [ankR[0] - 0.01, ankR[1] + 0.02], 31: [0.46, 0.88], 32: [ankR[0] + 0.01, ankR[1] + 0.02] });
}
{
  const ha = ex('hipabd'); const frames = [];
  for (let i = 0; i < 40; i++) frames.push(hipabd(0));
  for (let r = 0; r < 4; r++) for (let i = 0; i < 80; i++) { const k = Math.sin(Math.PI * i / 80); frames.push(hipabd(32 * k, r === 1 ? 22 * k : 0, r === 3 ? 30 * k : 0)); }
  for (let i = 0; i < 40; i++) frames.push(hipabd(0));
  const { review, cues } = run(ha, frames, { rom: 30 });
  console.log('hip abduction:', { reps: review.reps, partials: review.partials, faults: faultsOf(review), cues, score: review.score });
  assert.strictEqual(review.reps, 4); assert(review.faults.lean); assert(review.faults.hike);
}
/* ---- Wall calf stretch: profile, wall on the right, back (near) leg on the left ---- */
function calf(shinLean = 18, knee = 178, heelLift = 0, hipAng = 175) {
  const ank = [0.42, 0.85], shin = 0.18, thigh = 0.18;
  const kneeP = [ank[0] + Math.sin(shinLean * Math.PI / 180) * shin, ank[1] - Math.cos(shinLean * Math.PI / 180) * shin];
  const thighDir = shinLean + (180 - knee); const hip = [kneeP[0] + Math.sin(thighDir * Math.PI / 180) * thigh, kneeP[1] - Math.cos(thighDir * Math.PI / 180) * thigh];
  const torsoDir = thighDir + (180 - hipAng); const sh = [hip[0] + Math.sin(torsoDir * Math.PI / 180) * 0.2, hip[1] - Math.cos(torsoDir * Math.PI / 180) * 0.2];
  const heel = [ank[0] - 0.02, ank[1] + 0.02 - heelLift * 0.18], foot = [ank[0] + 0.03, ank[1] + 0.02];
  return frame({ 0: [sh[0] + 0.02, sh[1] - 0.06], 7: [sh[0], sh[1] - 0.05], 8: [sh[0], sh[1] - 0.05], 11: sh, 12: [sh[0], sh[1] + 0.005], 13: [sh[0] + 0.1, sh[1] + 0.03], 14: [sh[0] + 0.1, sh[1] + 0.03], 15: [sh[0] + 0.2, sh[1] + 0.02], 16: [sh[0] + 0.2, sh[1] + 0.02], 23: hip, 24: [hip[0], hip[1] + 0.005], 25: kneeP, 26: [kneeP[0] + 0.1, kneeP[1]], 27: ank, 28: [ank[0] + 0.14, ank[1]], 29: heel, 30: [ank[0] + 0.12, ank[1] + 0.02], 31: foot, 32: [ank[0] + 0.17, ank[1] + 0.02] });
}
{
  const cs = ex('calfstretch'); const frames = [];
  for (let i = 0; i < 40; i++) frames.push(calf(2, 178, 0));            // standing upright to calibrate heel height
  for (let i = 0; i < 200; i++) frames.push(calf(18, 178, 0));          // good stretch
  for (let i = 0; i < 90; i++) frames.push(calf(18, 178, 0.6));         // heel lifts
  for (let i = 0; i < 90; i++) frames.push(calf(18, 150, 0));           // knee bends
  for (let i = 0; i < 90; i++) frames.push(calf(4, 178, 0));            // stops leaning
  const { review, cues } = run(cs, frames, { variant: 'straight' });
  console.log('calf stretch:', { hold: review.holdSec, good: review.goodSec, faults: faultsOf(review), cues, score: review.score });
  assert(review.holdSec >= 6 && review.holdSec <= 8.5, 'hold counted only while in position: ' + review.holdSec); assert(review.faults.heel); assert(review.faults.kneebend); assert(review.faults.lean);
  const soleus = run(cs, [...Array(40).fill(calf(2, 178, 0)), ...Array(120).fill(calf(18, 150, 0))], { variant: 'bent' }).review;
  console.log('soleus variant:', { hold: soleus.holdSec, faults: faultsOf(soleus) }); assert(soleus.holdSec > 3); assert(!soleus.faults.kneebend);
}
/* ---- Plank & wall sit ---- */
function plankFrame(sag = 0) { const sh = [0.3, 0.55], ank = [0.9, 0.62], hip = [0.6, 0.585 + sag]; return frame({ 7: [0.26, 0.5], 11: sh, 12: [sh[0], sh[1] + 0.01], 13: [0.3, 0.7], 14: [0.3, 0.7], 15: [0.25, 0.7], 16: [0.25, 0.7], 23: hip, 24: hip, 25: [0.75, 0.6], 26: [0.75, 0.6], 27: ank, 28: ank, 29: [0.9, 0.66], 30: [0.9, 0.66], 31: [0.93, 0.66], 32: [0.93, 0.66] }); }
{
  const frames = []; for (let i = 0; i < 300; i++) frames.push(plankFrame(i > 150 && i < 240 ? 0.07 : 0));
  const { review } = run(ex('plank'), frames); console.log('plank:', { hold: review.holdSec, good: review.goodSec, faults: faultsOf(review) });
  assert(review.holdSec > 9); assert(review.faults.sag);
}
function wallsit(knee) { const hip = [0.6, 0.5], kneeP = [0.45, 0.5]; const a = (knee - 90) * Math.PI / 180; const ank = [kneeP[0] - Math.sin(a) * 0.15, kneeP[1] + Math.cos(a) * 0.15]; return frame({ 7: [0.6, 0.3], 11: [0.6, 0.33], 12: [0.6, 0.335], 23: hip, 24: hip, 25: kneeP, 26: kneeP, 27: ank, 28: ank, 29: [ank[0] + 0.02, ank[1] + 0.02], 30: [ank[0] + 0.02, ank[1] + 0.02], 31: [ank[0] - 0.04, ank[1] + 0.02], 32: [ank[0] - 0.04, ank[1] + 0.02] }); }
{
  const frames = [...Array(150).fill(wallsit(90)), ...Array(60).fill(wallsit(120)), ...Array(60).fill(wallsit(65))];
  const { review, cues } = run(ex('wallsit'), frames); console.log('wall sit:', { hold: review.holdSec, faults: faultsOf(review), cues }); assert(review.holdSec > 4); assert(review.faults.high); assert(review.faults.low);
}
/* ---- Jitter: noisy standing frames must not create hip-abduction reps ---- */
{
  const frames = []; for (let i = 0; i < 200; i++) { const f = hipabd(0); for (const p of f) { p.x += (Math.random() - 0.5) * 0.02; p.y += (Math.random() - 0.5) * 0.02; } frames.push(f); }
  const { review } = run(ex('hipabd'), frames); console.log('jitter:', { reps: review.reps, partials: review.partials }); assert.strictEqual(review.reps, 0);
}

/* ================= Shoulder & neck ================= */
// Front-facing upper body. Image x: person's LEFT side is on image RIGHT (unmirrored camera). Shoulders at y .30, hips at .55.
function upper(map = {}) {
  const base = { 0: [0.50, 0.14], 7: [0.47, 0.15], 8: [0.53, 0.15], 11: [0.59, 0.30], 12: [0.41, 0.30], 13: [0.61, 0.42], 14: [0.39, 0.42], 15: [0.62, 0.53], 16: [0.38, 0.53], 23: [0.56, 0.55], 24: [0.44, 0.55], 25: [0.56, 0.75], 26: [0.44, 0.75], 27: [0.56, 0.95], 28: [0.44, 0.95] };
  return frame({ ...base, ...map });
}
/* External rotation, left arm (image right): elbow at the ribs, forearm rotates from across the stomach (−50°) outward */
function er(phi, { drift = 0, shrug = 0, twist = 0, drop = 0 } = {}) {
  const sh = [0.59 - twist * 0.05, 0.30 - shrug], el = [0.60 + drift * 0.06, 0.42 - shrug * 0.5]; const fore = 0.11;
  const wr = [el[0] + Math.sin(phi * Math.PI / 180) * fore, el[1] + 0.01 + drop];
  return upper({ 11: sh, 13: el, 15: wr, 12: [0.41 + twist * 0.05, 0.30] });
}
{
  const frames = []; for (let i = 0; i < 40; i++) frames.push(er(-50));
  const rep = (peak, o) => { for (let i = 0; i < 90; i++) { const k = Math.sin(Math.PI * i / 90); frames.push(er(-50 + peak * k, i > 30 && i < 60 ? o : {})); } };
  rep(70); rep(70, { drift: 1 }); rep(35); rep(70, { twist: 1 }); rep(70, { shrug: 0.04 }); rep(70, { drop: 0.08 });
  for (let i = 0; i < 40; i++) frames.push(er(-50));
  const { review, cues, events } = run(ex('shoulder_er'), frames, { rom: 60, variant: 'er', work: 'L' });
  console.log('shoulder ER:', { reps: review.reps, partials: review.partials, peaks: events.map(e => e.rep.peak.toFixed(2)), faults: faultsOf(review), cues, score: review.score });
  assert.strictEqual(review.reps, 5); assert.strictEqual(review.partials, 1); assert(review.faults.drift); assert(review.faults.twist); assert(review.faults.shrug); assert(review.faults.shallow); assert.strictEqual(review.faults.straight.n, 1, 'elbow opening flagged once'); assert(!review.faults.overbent);
  // internal rotation: same geometry mirrored in direction — start out (+40), pull in to −40
  const ir = []; for (let i = 0; i < 40; i++) ir.push(er(40)); for (let r = 0; r < 3; r++) for (let i = 0; i < 90; i++) ir.push(er(40 - 80 * Math.sin(Math.PI * i / 90))); for (let i = 0; i < 40; i++) ir.push(er(40));
  const rv = run(ex('shoulder_er'), ir, { rom: 60, variant: 'ir' }).review; console.log('shoulder IR:', { reps: rv.reps, faults: faultsOf(rv) }); assert.strictEqual(rv.reps, 3);
}
/* Shoulder abduction, left arm raises out to the side */
function abd(raise, { shrug = 0, lean = 0, bend = 0, } = {}) {
  const sh = [0.59, 0.30 - shrug]; const a = raise * Math.PI / 180; const up = 0.13, fo = 0.12;
  const el = [sh[0] + Math.sin(a) * up, sh[1] + Math.cos(a) * up]; const a2 = (raise - bend) * Math.PI / 180;
  const wr = [el[0] + Math.sin(a2) * fo, el[1] + Math.cos(a2) * fo];
  const shift = Math.tan(lean * Math.PI / 180) * 0.25;   // shoulders shifting toward image left = away from the left arm
  return upper({ 11: sh.map((v, i) => i ? v : v - shift), 12: [0.41 - shift, 0.30], 13: el.map((v, i) => i ? v : v - shift), 15: wr.map((v, i) => i ? v : v - shift), 0: [0.50 - shift, 0.14], 7: [0.47 - shift, 0.15], 8: [0.53 - shift, 0.15] });
}
{
  const frames = []; for (let i = 0; i < 40; i++) frames.push(abd(0));
  const rep = (peak, o) => { for (let i = 0; i < 90; i++) { const k = Math.sin(Math.PI * i / 90); frames.push(abd(peak * k, i > 30 && i < 60 ? o : {})); } };
  rep(90); rep(90, { shrug: 0.035 }); rep(90, { lean: 16 }); rep(90, { bend: 40 }); rep(118); rep(50);
  for (let i = 0; i < 40; i++) frames.push(abd(0));
  const { review, cues, events } = run(ex('shoulder_abd'), frames, { rom: 90 });
  console.log('shoulder abduction:', { reps: review.reps, partials: review.partials, peaks: events.map(e => e.rep.peak.toFixed(2)), faults: faultsOf(review), cues, score: review.score });
  assert.strictEqual(review.reps, 5); assert.strictEqual(review.partials, 1); assert(review.faults.shrug); assert(review.faults.lean); assert(review.faults.bend); assert(review.faults.high); assert(!review.faults.high || review.faults.high.n === 1);
}
/* Band row, side view, anchor to the image right: elbow travels from ahead of the shoulder to behind it */
function row(k, { shrug = 0, lean = 0, flare = 0 } = {}) {
  const sh = [0.50 + Math.tan(lean * Math.PI / 180) * 0.25, 0.30 - shrug], hip = [0.50, 0.55]; const up = 0.13, fo = 0.12;
  const th = (150 + flare * 30) * k * Math.PI / 180;                     // upper arm: 0 = pointing at the anchor (image right), 150° = tucked behind and below the shoulder, 180° = flared to shoulder height
  const el = [sh[0] + Math.cos(th) * up, sh[1] + Math.sin(th) * up];
  const wr = [el[0] + fo * (1 - 0.4 * k), el[1] + fo * 0.2 * k];
  return frame({ 7: [sh[0] - 0.01, 0.15], 8: [sh[0] - 0.005, 0.15], 0: [sh[0] + 0.03, 0.14], 11: sh, 12: [sh[0], sh[1] + 0.005], 13: el, 14: [el[0], el[1] + 0.005], 15: wr, 16: [wr[0], wr[1] + 0.005], 23: hip, 24: [hip[0], hip[1] + 0.005], 25: [0.50, 0.75], 26: [0.50, 0.755], 27: [0.50, 0.95], 28: [0.50, 0.955] });
}
{
  const frames = []; for (let i = 0; i < 40; i++) frames.push(row(0));
  const rep = (peak, o) => { for (let i = 0; i < 90; i++) { const k = Math.sin(Math.PI * i / 90); frames.push(row(peak * k, i > 30 && i < 60 ? o : {})); } };
  rep(1); rep(1, { shrug: 0.035 }); rep(1, { lean: -12 }); rep(1, { flare: 1 }); rep(0.5);
  for (let i = 0; i < 40; i++) frames.push(row(0));
  const { review, cues, events } = run(ex('band_row'), frames);
  console.log('band row:', { reps: review.reps, partials: review.partials, peaks: events.map(e => e.rep.peak.toFixed(2)), faults: faultsOf(review), cues, score: review.score });
  assert.strictEqual(review.reps, 4); assert.strictEqual(review.partials, 1); assert(review.faults.shrug); assert(review.faults.lean); assert(review.faults.flare);
}
/* Pull-apart: arms open from pointing at the camera (foreshortened) to a T */
function pull(k, { bend = 0, shrug = 0, drop = 0 } = {}) {
  const shL = [0.59, 0.30 - shrug], shR = [0.41, 0.30 - shrug]; const arm = 0.29;   // torso .25 → arm ≈ 1.15 × torso
  const reach = 0.12 + (arm - 0.12) * k;                                              // visible arm length grows as the arms come into the plane
  const elL = [shL[0] + reach * 0.5 * (bend ? 0.8 : 1), shL[1] + drop * 0.5 - bend * 0.04], wrL = [shL[0] + reach, shL[1] + drop];
  const elR = [shR[0] - reach * 0.5 * (bend ? 0.8 : 1), shR[1] + drop * 0.5 - bend * 0.04], wrR = [shR[0] - reach, shR[1] + drop];
  return upper({ 11: shL, 12: shR, 13: elL, 14: elR, 15: wrL, 16: wrR });
}
{
  const frames = []; for (let i = 0; i < 40; i++) frames.push(pull(0));
  const rep = (peak, o) => { for (let i = 0; i < 90; i++) { const k = Math.sin(Math.PI * i / 90); frames.push(pull(peak * k, i > 30 && i < 60 ? o : {})); } };
  rep(1); rep(1, { bend: 1 }); rep(1, { shrug: 0.035 }); rep(1, { drop: 0.09 }); rep(0.5);
  for (let i = 0; i < 40; i++) frames.push(pull(0));
  const { review, cues, events } = run(ex('pullapart'), frames);
  console.log('pull-apart:', { reps: review.reps, partials: review.partials, peaks: events.map(e => e.rep.peak.toFixed(2)), faults: faultsOf(review), cues, score: review.score });
  assert.strictEqual(review.reps, 4); assert.strictEqual(review.partials, 1); assert(review.faults.bend); assert(review.faults.shrug); assert(review.faults.low);
}
/* Upper trap stretch: right ear drops toward the right shoulder → left trap stretched; left hand behind the back (wrist low) */
function trap(tilt, { shoulderUp = 0, turn = 0, handUp = 0 } = {}) {
  const a = tilt * Math.PI / 180; const c = [0.50, 0.15]; const half = 0.03;
  const earL = [c[0] - Math.cos(a) * half, c[1] - Math.sin(a) * half], earR = [c[0] + Math.cos(a) * half, c[1] + Math.sin(a) * half];   // 7 = left ear (image right?) — keep indices: 7 at image LEFT here, mirrored camera
  const nose = [c[0] + turn * 0.03, c[1] - 0.01 + Math.sin(a) * 0.0];
  return upper({ 7: earL, 8: earR, 0: nose, 11: [0.59, 0.30 - shoulderUp], 12: [0.41, 0.30], 15: [0.62, 0.62 - handUp], 16: [0.30, 0.10] });
}
{
  const frames = [...Array(40).fill(trap(0)), ...Array(150).fill(trap(25)), ...Array(90).fill(trap(25, { shoulderUp: 0.04 })), ...Array(90).fill(trap(25, { turn: 1 })), ...Array(90).fill(trap(25, { handUp: 0.15 })), ...Array(60).fill(trap(6))];
  const { review, cues, sess } = run(ex('trapstretch'), frames);
  console.log('upper trap stretch:', { hold: review.holdSec, good: review.goodSec, side: sess.m.side, faults: faultsOf(review), cues, score: review.score });
  assert(review.holdSec >= 12 && review.holdSec <= 15, 'hold counted only while tilted: ' + review.holdSec); assert(review.faults.shoulder); assert(review.faults.turn); assert(review.faults.hand);
}
console.log('ALL ENGINE TESTS PASSED');
