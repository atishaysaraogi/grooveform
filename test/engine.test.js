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
  for (const f of frames) { t += 1000 / fps; const pts = sm.update(f, t, 1); const r = sess.step(pts, t); for (const c of r.cues) sess.ackCue(c.id, t); /* the coach speaks one rep cue per rep and acks it, which is what starts its cooldown */ if (r.repCues[0]) sess.ackCue(r.repCues[0].id, t); cues.push(...r.cues.map(c => c.id), ...r.repCues.map(c => c.id)); if (r.repEvent) events.push(r.repEvent); }
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
/* ---- Rep rules are throttled: "slow it down" lands once a set, however many reps are rushed,
       but the review still counts every rushed rep. ---- */
{
  const hs = ex('heelslide'); const frames = [];
  for (let i = 0; i < 40; i++) frames.push(heelslide(0));
  for (let r = 0; r < 6; r++) for (let i = 0; i < 30; i++) frames.push(heelslide(95 * Math.sin(Math.PI * i / 30)));   // 1 s a rep, well under minMs
  for (let i = 0; i < 40; i++) frames.push(heelslide(0));
  const { review, cues } = run(hs, frames, { rom: 90 });
  const fast = ex('heelslide').faults.find(f => f.id === 'fast');
  console.log('rushed set:', { reps: review.reps, spokenFast: cues.filter(c => c === 'fast').length, countedFast: review.faults.fast.n, maxCues: fast.maxCues });
  assert.strictEqual(fast.maxCues, 1, 'settings.json caps the fast rule at one cue a set');
  assert(review.reps >= 5, 'every rushed rep still counts: ' + review.reps);
  assert(review.faults.fast.n >= 5, 'the review sees every rushed rep: ' + review.faults.fast.n);
  assert.strictEqual(cues.filter(c => c === 'fast').length, 1, 'but it is only ever offered once: ' + cues.filter(c => c === 'fast').length);
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

/* ---- The chosen limb is not the one moving: the coach follows the body rather than asking the
       person to start again. The fixture raises the RIGHT leg throughout; the set is started on
       the left. ---- */
{
  const ha = ex('hipabd'); const frames = [];
  for (let i = 0; i < 40; i++) frames.push(hipabd(0));
  for (let r = 0; r < 4; r++) for (let i = 0; i < 80; i++) { const k = Math.sin(Math.PI * i / 80); frames.push(hipabd(32 * k)); }
  for (let i = 0; i < 40; i++) frames.push(hipabd(0));
  const right = run(ha, frames, { rom: 30, work: 'R' });
  const wrong = run(ha, frames, { rom: 30, work: 'L' });
  console.log('picked the wrong leg:', { started: 'L', endedOn: wrong.sess.ref.work, switches: wrong.sess.ref.switched, reps: wrong.review.reps, sameAsRight: wrong.review.reps === right.review.reps });
  assert.strictEqual(wrong.sess.ref.work, 'R', 'it follows the leg that is actually moving');
  assert.strictEqual(wrong.sess.ref.switched, 1, 'and switches once, not back and forth');
  assert.strictEqual(wrong.review.reps, right.review.reps, 'so the reps count as if the right leg had been picked');
  /* and it does not switch when the picked leg IS the one moving */
  assert.ok(!right.sess.ref.switched, 'no switch when the pick was right');
}
/* ---- Camera tolerance: the same recordings through a phone that is propped crooked (rolled)
       and a person who is not square to the lens (yawed) must count and cue the same. ---- */
{
  const C = E.Camera;
  /* the picture rolled by r degrees about its centre, then the person turned by y degrees about
     the vertical axis through the hips — with depth for the far-side pairs, as the pose model gives */
  const bend = (frames, { roll = 0, yaw = 0, view }) => frames.map((pts) => {
    let out = pts.map(p => ({ ...p }));
    if (view === 'side') for (const i of [12, 24, 14, 26, 28, 8]) out[i].z = 0.06;      // far side is behind the near side
    if (yaw) { const hx = (out[23].x + out[24].x) / 2, c = Math.cos(yaw * Math.PI / 180), s = Math.sin(yaw * Math.PI / 180);
      out = out.map(p => ({ ...p, x: hx + (p.x - hx) * c - p.z * s, z: (p.x - hx) * s + p.z * c })); }
    if (roll) out = C.rotatePts(out, -roll, 0.5, 0.5);                                   // the picture turned the wrong way by `roll`
    return out;
  });
  /* what the coach does: level and un-squash every measured frame using what it learned at calibration */
  function runBent(ex, frames, opts, corrFrom) {
    const sess = new E.SetSession(ex, { target: 100, ...opts }); const sm = new E.PoseSmoother();
    let t = 0; const cues = []; const events = [];
    const first = corrFrom(sm.update(frames[0], t, 1));
    sess.calibrate(first.pts, E.nearSide(first.pts));
    for (const f of frames) { t += 1000 / 30; const pts = C.correctPts(sm.update(f, t, 1), first.corr); const r = sess.step(pts, t); for (const c of r.cues) sess.ackCue(c.id, t); if (r.repCues[0]) sess.ackCue(r.repCues[0].id, t); cues.push(...r.cues.map(c => c.id), ...r.repCues.map(c => c.id)); if (r.repEvent) events.push(r.repEvent); }
    return { review: sess.review(), cues, events };
  }
  const same = (a, b, what) => { assert.strictEqual(a.review.reps, b.review.reps, what + ': reps'); assert.strictEqual(a.review.partials, b.review.partials, what + ': partials'); assert.deepStrictEqual(Object.keys(faultsOf(a.review)).sort(), Object.keys(faultsOf(b.review)).sort(), what + ': faults ' + JSON.stringify([faultsOf(a.review), faultsOf(b.review)])); };

  /* heel slide (lying, side view): 12° roll, corrected from the body */
  { const hs = ex('heelslide'); const frames = [];
    for (let i = 0; i < 40; i++) frames.push(heelslide(0));
    for (let r = 0; r < 4; r++) for (let i = 0; i < 100; i++) { const k = Math.sin(Math.PI * i / 100); frames.push(heelslide((r === 2 ? 60 : 95) * k, r === 1 && k > 0.5 ? 0.3 : 0, 0)); }
    for (let i = 0; i < 40; i++) frames.push(heelslide(0));
    const straight = runBent(hs, frames, { rom: 90 }, (pts) => ({ pts, corr: null }));
    const rolled = bend(frames, { roll: 12, view: 'side' });
    const est = C.rollFromBody(new E.PoseSmoother().update(rolled[0], 0, 1), 'lying');
    assert(Math.abs(est - 12) < 1.5, 'roll read back from the lying trunk: ' + est);
    const fixed = runBent(hs, rolled, { rom: 90 }, (pts) => ({ pts: C.correctPts(pts, { roll: est }), corr: { roll: est } }));
    const unfixed = runBent(hs, rolled, { rom: 90 }, (pts) => ({ pts, corr: null }));
    console.log('heel slide rolled 12°:', { straight: faultsOf(straight.review), levelled: faultsOf(fixed.review), uncorrected: faultsOf(unfixed.review) });
    same(fixed, straight, 'heel slide levelled');
  }
  /* heel slide yawed 20° with depth: the turn is measured and the picture stretched back */
  { const hs = ex('heelslide'); const frames = [];
    for (let i = 0; i < 40; i++) frames.push(heelslide(0));
    for (let r = 0; r < 4; r++) for (let i = 0; i < 100; i++) { const k = Math.sin(Math.PI * i / 100); frames.push(heelslide((r === 2 ? 60 : 95) * k, r === 1 && k > 0.5 ? 0.3 : 0, 0)); }
    for (let i = 0; i < 40; i++) frames.push(heelslide(0));
    const straight = runBent(hs, bend(frames, { view: 'side' }), { rom: 90 }, (pts) => ({ pts, corr: null }));
    const yawed = bend(frames, { yaw: 20, view: 'side' });
    const y = C.yawOf(new E.PoseSmoother().update(yawed[0], 0, 1), 'side', E.settings.camera);
    assert(y.measured && Math.abs(y.deg - 20) < 2, 'yaw read back from depth: ' + JSON.stringify(y));
    const corr = { stretch: 1 / Math.cos(y.deg * Math.PI / 180) };
    const fixed = runBent(hs, yawed, { rom: 90 }, (pts) => ({ pts: C.correctPts(pts, corr), corr }));
    const unfixed = runBent(hs, yawed, { rom: 90 }, (pts) => ({ pts, corr: null }));
    console.log('heel slide yawed 20°:', { straight: { reps: straight.review.reps, partials: straight.review.partials }, stretched: { reps: fixed.review.reps, partials: fixed.review.partials }, uncorrected: { reps: unfixed.review.reps, partials: unfixed.review.partials } });
    same(fixed, straight, 'heel slide un-foreshortened');
  }
  /* standing hip abduction (front view): 10° roll read from the upright trunk, 20° yaw from depth */
  { const frames = [];
    for (let i = 0; i < 40; i++) frames.push(hipabd(0));
    for (let r = 0; r < 4; r++) for (let i = 0; i < 80; i++) { const k = Math.sin(Math.PI * i / 80); frames.push(hipabd(32 * k, r === 1 ? 22 * k : 0, r === 3 ? 30 * k : 0)); }
    for (let i = 0; i < 40; i++) frames.push(hipabd(0));
    const ha = ex('hipabd');
    const straight = runBent(ha, frames, { rom: 30 }, (pts) => ({ pts, corr: null }));
    const rolled = bend(frames, { roll: 10, view: 'front' });
    const est = C.rollFromBody(new E.PoseSmoother().update(rolled[0], 0, 1), 'standing');
    assert(Math.abs(est - 10) < 1.5, 'roll read back from the standing trunk: ' + est);
    const fixed = runBent(ha, rolled, { rom: 30 }, (pts) => ({ pts: C.correctPts(pts, { roll: est }), corr: { roll: est } }));
    console.log('hip abduction rolled 10°:', { straight: faultsOf(straight.review), levelled: faultsOf(fixed.review) });
    same(fixed, straight, 'hip abduction levelled');
    const yawed = bend(frames, { yaw: 20, view: 'front' });
    const y = C.yawOf(new E.PoseSmoother().update(yawed[0], 0, 1), 'front', E.settings.camera);
    assert(y.measured && Math.abs(y.deg - 20) < 2, 'front yaw read back from depth: ' + JSON.stringify(y));
    const corr = { stretch: 1 / Math.cos(y.deg * Math.PI / 180) };
    const fy = runBent(ha, yawed, { rom: 30 }, (pts) => ({ pts: C.correctPts(pts, corr), corr }));
    console.log('hip abduction yawed 20°:', { straight: faultsOf(straight.review), stretched: faultsOf(fy.review) });
    same(fy, straight, 'hip abduction un-foreshortened');
    /* without depth the turn is still noticed, from proportions, well enough to say "turn back" */
    const flat = yawed.map(f => f.map(p => ({ ...p, z: 0 })));
    const ratio0 = E.orientation(new E.PoseSmoother().update(frames[0], 0, 1)).ratio;
    const g = C.yawOf(new E.PoseSmoother().update(flat[0], 0, 1), 'front', E.settings.camera, ratio0);
    assert(!g.measured && Math.abs(g.deg - 20) < 3, 'a guessed yaw still reads a 20° turn from the width change: ' + JSON.stringify(g));
  }
}
console.log('CAMERA TOLERANCE TESTS PASSED');
console.log('ALL ENGINE TESTS PASSED');

/* ---- unsure joints: the far arm and leg of a side-on body ---- */
const test = (name, fn) => { fn(); console.log('ok -', name); };
test('an unsure joint is smoothed harder, not drawn, and takes what hangs off it with it', () => {
  const sm = new E.PoseSmoother();
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const base = () => Array.from({ length: 33 }, (_, i) => ({ x: 0.5, y: 0.3 + i * 0.01, z: 0, visibility: 0.99 }));
  let moveSure = 0, moveUnsure = 0, prev = null;
  for (let t = 0; t < 3000; t += 33) {
    const lm = base();
    const j = [rnd() * 0.04, rnd() * 0.04];                    // the same jitter on both knees
    lm[25] = { x: 0.5 + j[0], y: 0.55 + j[1], z: 0, visibility: 0.99 };   // near knee: sure
    lm[26] = { x: 0.5 + j[0], y: 0.55 + j[1], z: 0, visibility: 0.42 };   // far knee: the model is guessing
    lm[28].visibility = 0.9;                                     // the far ankle it says it can see
    const pts = sm.update(lm, t, 16 / 9);
    if (prev) { moveSure += Math.hypot(pts[25].x - prev[25].x, pts[25].y - prev[25].y); moveUnsure += Math.hypot(pts[26].x - prev[26].x, pts[26].y - prev[26].y); }
    prev = pts;
  }
  assert.ok(moveUnsure < moveSure * 0.5, `the unsure knee moves less than half as much as the sure one (${moveUnsure.toFixed(3)} vs ${moveSure.toFixed(3)})`);
  assert.equal(E.seen(prev, 25), true, 'the sure knee is drawn');
  assert.equal(E.seen(prev, 26), false, 'the unsure one is not');
  assert.equal(E.seen(prev, 28), false, 'nor is the ankle below it, however sure the model is of the ankle: no foot floats on its own');
  assert.equal(E.seen(prev, 27), true, 'the near ankle under the near knee is');
  assert.equal(E.sure(prev, 25), true); assert.equal(E.sure(prev, 26), false);
});

test('seen has hysteresis: a joint on the edge of visibility does not flicker', () => {
  const sm = new E.PoseSmoother();
  const lm = (v) => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: v }));
  let t = 0; for (let i = 0; i < 40; i++, t += 33) sm.update(lm(0.6), t, 1);
  assert.equal(E.seen(sm.pts, 11), true, 'clear of the line: seen');
  for (let i = 0; i < 40; i++, t += 33) sm.update(lm(0.45), t, 1);
  assert.equal(E.seen(sm.pts, 11), true, 'a little under it: still seen');
  for (let i = 0; i < 40; i++, t += 33) sm.update(lm(0.3), t, 1);
  assert.equal(E.seen(sm.pts, 11), false, 'well under it: gone');
  for (let i = 0; i < 40; i++, t += 33) sm.update(lm(0.45), t, 1);
  assert.equal(E.seen(sm.pts, 11), false, 'and a little under the line does not bring it back');
  /* raw model landmarks, with no smoother behind them, are judged on their confidence alone */
  assert.equal(E.seen([{ visibility: 0.55 }], 0), true); assert.equal(E.seen([{ visibility: 0.45 }], 0), false);
});

/* ---- where a recording settles: the coach's positioning step over frames ---- */
test('Settle finds the moment the body is in view and has been still for a second', () => {
  const body = (dx) => { const pts = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
    const m = { 0: [0.5, 0.2], 11: [0.4, 0.3], 12: [0.6, 0.3], 23: [0.42, 0.55], 24: [0.58, 0.55], 25: [0.42, 0.75], 26: [0.58, 0.75], 27: [0.42, 0.92], 28: [0.58, 0.92] };
    for (const k in m) pts[+k] = { x: m[k][0] + dx, y: m[k][1], z: 0, visibility: 0.99 }; return pts; };
  const run = (ex, mover) => { const s = new E.Settle(ex); const sm = new E.PoseSmoother(); for (let t = 0; t < 8000; t += 33) { const at = s.step(sm.update(mover(t), t, 1), t, 1); if (at != null) return at; } return null; };
  /* walks in from the left for a second, then holds: settles about 1.2 s after the walk ends */
  const at = run({ view: 'front' }, (t) => body(t < 1000 ? -0.5 * (1 - t / 1000) : 0));
  assert.ok(at >= 2150 && at <= 2600, `settled at ${at}`);
  /* still from the first frame: settles at the hold time */
  const at0 = run({ view: 'front' }, () => body(0)); assert.ok(at0 >= 1200 && at0 <= 1300, `settled at ${at0}`);
  /* the wrong way round for the move never settles */
  assert.equal(run({ view: 'side' }, () => body(0)), null);
  /* a draft with no view yet takes any orientation */
  assert.ok(run({}, () => body(0)) > 0);
  const warm = new E.PoseSmoother(); let pts; for (let t = 0; t < 400; t += 33) pts = warm.update(body(0), t, 1);   // the smoother's confidence warms up over a few frames
  const c = E.positionCheck(pts, { view: 'front' }, 1); assert.ok(c.ok && c.view === 'front' && c.visOk && c.frameOk && c.sizeOk, JSON.stringify(c));
});

/* A rep with a hold at the top: the counter times how long p sits at or above `full`, says when
   the hold is up, and counts the rep only if it was. */
test('RepCounter with holdMs: the top has to be held, and says when it has been', () => {
  const play = (holdAtTop, holdMs) => {
    const c = new E.RepCounter({ holdMs, alpha: 1 }); c.alpha = 1; let t = 0; const evs = []; let held = 0;
    const feed = (p, ms) => { for (let k = 0; k < ms / 50; k++) { t += 50; const ev = c.update(p, t); if (ev && ev.type === 'held') held++; else if (ev) evs.push(ev); } };
    feed(0, 300); feed(0.5, 200); feed(1, holdAtTop); feed(0.5, 200); feed(0, 400);
    return { evs, held, c };
  };
  const short = play(300, 500);
  assert.equal(short.evs.length, 1); assert.equal(short.evs[0].full, false); assert.ok(short.evs[0].rep.shortHold, 'reached but not held');
  assert.equal(short.held, 0); assert.equal(short.c.partials, 1);
  const long = play(800, 500);
  assert.equal(long.evs.length, 1); assert.equal(long.evs[0].full, true); assert.ok(!long.evs[0].rep.shortHold);
  assert.equal(long.held, 1, 'the hold is announced once'); assert.equal(long.c.count, 1);
  assert.ok(long.evs[0].rep.topMs >= 800 && long.evs[0].rep.topMs <= 900, 'time at the top is on the rep: ' + long.evs[0].rep.topMs);
  const none = play(300, 0);
  assert.equal(none.evs[0].full, true, 'without a hold the rep counts as before'); assert.ok(!none.evs[0].rep.shortHold);
});

/* A rep that comes part of the way back and stays there is over where it settled; the next rise
   is the next rep, and a descent from that level is not a rep of its own. */
test('RepCounter: a rep closes where the person settles, not only below rest', () => {
  const c = new E.RepCounter(); c.alpha = 1; let t = 0; const evs = [];
  const feed = (p, ms) => { for (let k = 0; k < ms / 50; k++) { t += 50; const ev = c.update(p, t); if (ev && ev.type === 'rep') evs.push(ev); } };
  feed(0, 300); feed(0.6, 300); feed(1.0, 300); feed(0.55, 1300);          // up, and rests half way down
  assert.equal(evs.length, 1, 'closed on the plateau'); assert.equal(evs[0].full, true); assert.ok(Math.abs(evs[0].rep.endP - 0.55) < 0.01);
  feed(1.0, 300); feed(0.55, 1300);                                        // the next rise from there is a second rep
  assert.equal(evs.length, 2); assert.equal(c.count, 2);
  feed(0.3, 300); feed(0, 400);                                           // then all the way down: no rep in a descent
  assert.equal(evs.length, 2, 'a descent from the closing level is not a rep'); assert.equal(c.partials, 0);
  feed(0.6, 300); feed(1.0, 300); feed(0, 400);
  assert.equal(c.count, 3, 'and from the floor the counter is as it was');
});

/* Two faults on cooldown otherwise alternate for the whole set and a third is never heard. */
test('FaultTracker: a cue not yet said this set is offered before one that has been', () => {
  const f = (id, weight) => ({ id, weight, persist: 0, cooldown: 4000, check: () => true });
  const tr = new E.FaultTracker([f('heavy', 3), f('mid', 2), f('light', 1)]);
  let t = 1000; const said = [];
  const round = () => { const cues = tr.update({}, 'moving', t); if (cues.length) { tr.ack(cues[0].id, t); said.push(cues[0].id); } t += 1500; };
  for (let i = 0; i < 6; i++) round();
  assert.deepEqual(said.slice(0, 3), ['heavy', 'mid', 'light'], 'each is heard once before any repeats: ' + said.join(' '));
  assert.deepEqual(said.slice(3), ['heavy', 'mid', 'light'], 'then heaviest first again, in turn');
});

/* The ends of the limbs wander even when planted. A toe that jitters around its ankle is calmed, a
   frame that puts it an impossible distance from the ankle is held through, and a point the move
   calls stable is locked once still — while a real lift still reads. */
test('PoseSmoother: a planted toe is held steady, an impossible foot length is held through, a stable point locks', () => {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const base = (jit, toeDy = 0, toeLen = 0.06) => { const p = []; for (let i = 0; i < 33; i++) p.push({ x: 0.5, y: 0.5, z: 0, visibility: 1 });
    p[27] = { x: 0.40, y: 0.85, z: 0, visibility: 0.97 };                                              // ankle
    p[31] = { x: 0.40 + toeLen + rnd() * jit, y: 0.85 - toeDy + rnd() * jit, z: 0, visibility: 0.98 };  // toe: jitter, a lift, a length
    p[25] = { x: 0.42, y: 0.65, z: 0, visibility: 0.99 }; p[11] = { x: 0.6, y: 0.4, z: 0, visibility: 1 };
    return p; };
  const travel = (pts) => { let s = 0; for (let k = 1; k < pts.length; k++) s += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y); return s / (pts.length - 1); };
  /* 1. a jittering toe on a planted foot: smoothed travel well under raw */
  const sm = new E.PoseSmoother(); let t = 0; const rawT = [], smT = [];
  for (let i = 0; i < 90; i++) { t += 33; const f = base(0.012); rawT.push(f[31]); smT.push(sm.update(f, t, 1)[31]); }
  assert.ok(travel(smT) < travel(rawT) * 0.35, `the toe is calmed: ${travel(smT).toFixed(4)} vs raw ${travel(rawT).toFixed(4)}`);
  /* 2. a frame that puts the toe 3× as far from the ankle is held through, then the length re-learns if it stays */
  let held = 0; for (let i = 0; i < 3; i++) { t += 33; const p = sm.update(base(0.001, 0, 0.18), t, 1)[31]; if (p.held) held++; }
  assert.ok(held >= 2, 'an impossible foot length is held through: ' + held);
  for (let i = 0; i < 60; i++) { t += 33; sm.update(base(0.001, 0, 0.18), t, 1); }
  const relearned = sm.update(base(0.001, 0, 0.18), t + 33, 1)[31];
  assert.ok(!relearned.held && Math.abs(relearned.x - 0.58) < 0.02, 'a length that stays is real and is learnt: ' + JSON.stringify(relearned));
  /* 3. a real lift reads through the harder smoothing */
  const sm2 = new E.PoseSmoother(); t = 0; for (let i = 0; i < 60; i++) { t += 33; sm2.update(base(0.003), t, 1); }
  let lifted; for (let i = 0; i < 20; i++) { t += 33; lifted = sm2.update(base(0.003, 0.05), t, 1)[31]; }
  assert.ok(0.85 - lifted.y > 0.035, 'a 5 % lift reads as a lift within two thirds of a second: ' + (0.85 - lifted.y).toFixed(3));
  /* 4. a stable point locks once still and lets go when it plainly moves */
  const sm3 = new E.PoseSmoother({ stable: [25] }); t = 0; let last;
  for (let i = 0; i < 30; i++) { t += 33; last = sm3.update(base(0.006), t, 1)[25]; }
  assert.equal(last.locked, true, 'the knee the move calls stable is locked once still');
  const lockedAt = { x: last.x, y: last.y };
  for (let i = 0; i < 5; i++) { t += 33; const f = base(0.006); f[25].y -= 0.004; last = sm3.update(f, t, 1)[25]; }
  assert.ok(last.locked && last.x === lockedAt.x, 'a wobble does not release it');
  for (let i = 0; i < 6; i++) { t += 33; const f = base(0.006); f[25].y -= 0.08; last = sm3.update(f, t, 1)[25]; }
  assert.equal(last.locked, false, 'a real move away releases it');
  assert.ok(last.y < lockedAt.y - 0.03, 'and it follows: ' + last.y.toFixed(3));
  /* a point no move called stable never locks */
  const sm4 = new E.PoseSmoother(); t = 0; for (let i = 0; i < 40; i++) { t += 33; last = sm4.update(base(0.001), t, 1)[25]; }
  assert.ok(!last.locked);
});
