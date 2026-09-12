/* ============================================================
   FormEngine — pose smoothing, geometry, exercise rules,
   rep counting, fault detection and set review.
   Pure JS, no DOM: runs in the browser and in Node tests.
   ============================================================ */
(function (root) {
  'use strict';

  // BlazePose 33-landmark indices
  const LM = {
    NOSE: 0, L_EAR: 7, R_EAR: 8, L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14,
    L_WR: 15, R_WR: 16, L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26,
    L_ANK: 27, R_ANK: 28, L_HEEL: 29, R_HEEL: 30, L_FOOT: 31, R_FOOT: 32
  };
  const SIDE = {
    L: { EAR: 7, SH: 11, EL: 13, WR: 15, HIP: 23, KNEE: 25, ANK: 27, HEEL: 29, FOOT: 31 },
    R: { EAR: 8, SH: 12, EL: 14, WR: 16, HIP: 24, KNEE: 26, ANK: 28, HEEL: 30, FOOT: 32 }
  };
  const CONNECTIONS = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
    [7, 11], [8, 12], [0, 7], [0, 8]
  ];

  /* ---------------- Smoothing ---------------- */
  // One Euro filter: low lag on fast motion, strong jitter removal when still.
  class OneEuro {
    constructor(minCutoff = 1.0, beta = 3.0, dCutoff = 1.0) {
      this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
      this.x = null; this.dx = 0; this.t = null;
    }
    static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
    filter(x, t) {
      if (this.x === null || this.t === null) { this.x = x; this.t = t; this.dx = 0; return x; }
      let dt = (t - this.t) / 1000; if (dt <= 0) dt = 1 / 30; this.t = t;
      const dxRaw = (x - this.x) / dt;
      const aD = OneEuro.alpha(this.dCutoff, dt);
      this.dx = aD * dxRaw + (1 - aD) * this.dx;
      const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
      const a = OneEuro.alpha(cutoff, dt);
      this.x = a * x + (1 - a) * this.x;
      return this.x;
    }
    reset() { this.x = null; this.t = null; this.dx = 0; }
  }

  // Smooths all 33 landmarks; freezes low-confidence joints instead of letting them fly.
  class PoseSmoother {
    constructor(opts = {}) {
      this.minCutoff = opts.minCutoff ?? 1.0;
      this.beta = opts.beta ?? 3.0;
      this.visFloor = opts.visFloor ?? 0.35;
      this.jumpLimit = opts.jumpLimit ?? 0.28;
      this.filters = []; this.vis = []; this.holds = []; this.prev = [];
      this.pts = null; this.lastT = null;
      for (let i = 0; i < 33; i++) {
        this.filters.push([new OneEuro(this.minCutoff, this.beta), new OneEuro(this.minCutoff, this.beta), new OneEuro(this.minCutoff * 0.6, this.beta)]);
        this.vis.push(0); this.holds.push(0); this.prev.push(null);
      }
    }
    setSmoothing(minCutoff, beta) {
      this.minCutoff = minCutoff; this.beta = beta;
      for (const f of this.filters) { f[0].minCutoff = minCutoff; f[1].minCutoff = minCutoff; f[2].minCutoff = minCutoff * 0.6; f[0].beta = f[1].beta = f[2].beta = beta; }
    }
    reset() { for (const f of this.filters) f.forEach(o => o.reset()); this.pts = null; this.lastT = null; this.prev.fill(null); this.holds.fill(0); }
    // landmarks: array of {x,y,z,visibility} normalized (0..1). aspect = width/height (x is scaled to be isotropic).
    update(landmarks, t, aspect = 1) {
      if (!landmarks) { return this.pts; }
      const out = new Array(33);
      for (let i = 0; i < 33; i++) {
        const l = landmarks[i];
        const v = l.visibility ?? l.score ?? 1;
        this.vis[i] = 0.7 * this.vis[i] + 0.3 * v;
        const prev = this.prev[i];
        let x = l.x * aspect, y = l.y, z = l.z ?? 0;
        let useRaw = true;
        if (prev) {
          const jump = Math.hypot(x - prev.x, y - prev.y);
          const lowConf = v < this.visFloor;
          const outlier = jump > this.jumpLimit && v < 0.75 && this.holds[i] < 4;
          if (lowConf || outlier) { useRaw = false; this.holds[i]++; }
          else this.holds[i] = 0;
        }
        if (!useRaw) { out[i] = { x: prev.x, y: prev.y, z: prev.z, v: this.vis[i], held: true }; continue; }
        const f = this.filters[i];
        out[i] = { x: f[0].filter(x, t), y: f[1].filter(y, t), z: f[2].filter(z, t), v: this.vis[i], held: false };
        this.prev[i] = out[i];
      }
      this.pts = out; this.lastT = t;
      return out;
    }
  }

  /* ---------------- Geometry ---------------- */
  const deg = r => r * 180 / Math.PI;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v ?? 1, b.v ?? 1) });
  // Interior angle at b (degrees, 0..180)
  function angle(a, b, c) {
    const abx = a.x - b.x, aby = a.y - b.y, cbx = c.x - b.x, cby = c.y - b.y;
    const d = Math.hypot(abx, aby) * Math.hypot(cbx, cby); if (d < 1e-9) return 180;
    return deg(Math.acos(Math.max(-1, Math.min(1, (abx * cbx + aby * cby) / d))));
  }
  // How far point p sits off the line a→c, as a fraction of |ac|. sign: + = below the line in image space (larger y), − = above.
  function lineOffset(a, c, p) {
    const vx = c.x - a.x, vy = c.y - a.y, L2 = vx * vx + vy * vy; if (L2 < 1e-9) return 0;
    const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2;
    const px = a.x + t * vx, py = a.y + t * vy;
    const off = Math.hypot(p.x - px, p.y - py) / Math.sqrt(L2);
    return (p.y - py) >= 0 ? off : -off;
  }
  // Angle of a segment relative to horizontal, 0..90
  function segTilt(a, b) { return deg(Math.atan2(Math.abs(a.y - b.y), Math.abs(a.x - b.x) + 1e-9)); }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------------- Body analysis helpers ---------------- */
  function visOf(pts, ids) { let s = 0; for (const i of ids) s += pts[i].v; return s / ids.length; }
  function nearSide(pts) {
    const l = visOf(pts, [7, 11, 13, 23, 25, 27]), r = visOf(pts, [8, 12, 14, 24, 26, 28]);
    return r > l + 0.05 ? 'R' : 'L';
  }
  // 'front' | 'side' | 'unclear' from shoulder/hip width vs torso length
  function orientation(pts) {
    const shW = dist(pts[11], pts[12]), hipW = dist(pts[23], pts[24]);
    const torso = dist(mid(pts[11], pts[12]), mid(pts[23], pts[24])) + 1e-6;
    const ratio = Math.max(shW, hipW) / torso;
    if (ratio > 0.5) return { view: 'front', ratio };
    if (ratio < 0.3) return { view: 'side', ratio };
    return { view: 'unclear', ratio };
  }
  function framing(pts, ids, aspect) {
    // returns which edges are being clipped, given isotropic x (0..aspect) and y (0..1)
    const m = 0.03; const edges = new Set();
    for (const i of ids) {
      const p = pts[i]; if (p.v < 0.3) continue;
      if (p.x < m) edges.add('left'); if (p.x > aspect - m) edges.add('right');
      if (p.y < m) edges.add('top'); if (p.y > 1 - m) edges.add('bottom');
    }
    return [...edges];
  }
  function bodyHeight(pts) {
    let miny = 1, maxy = 0; for (const i of [0, 11, 12, 23, 24, 25, 26, 27, 28]) { miny = Math.min(miny, pts[i].y); maxy = Math.max(maxy, pts[i].y); }
    return maxy - miny;
  }

  /* ---------------- Exercise definitions ----------------
     Each exercise exposes:
       view: 'front' | 'side' — required camera orientation
       required: landmarks that must be visible
       calibrate(pts, S) → ref (captured while user holds the start position)
       measure(pts, S, ref) → { p (0 = start, 1 = full range), ...metrics }
       faults: [{ id, label, cue, tip, weight, persist, cooldown, phase?, check(m, ctx) }]
     type 'reps' uses p; type 'hold' uses m.inPosition.
  --------------------------------------------------------- */
  const REST = 0.15, ATTEMPT = 0.32, FULL = 0.85;

  function sideJoints(pts, S) { const s = SIDE[S]; return { ear: pts[s.EAR], sh: pts[s.SH], el: pts[s.EL], wr: pts[s.WR], hip: pts[s.HIP], knee: pts[s.KNEE], ank: pts[s.ANK], heel: pts[s.HEEL], foot: pts[s.FOOT] }; }

  // vertical/horizontal helpers
  const fromVertical = (top, bottom) => deg(Math.atan2(Math.abs(bottom.x - top.x), Math.max(1e-6, bottom.y - top.y))); // 0 = plumb line
  const armAngle = (top, bottom) => deg(Math.atan2(Math.abs(bottom.x - top.x), bottom.y - top.y)); // 0 = hanging straight down, 90 = horizontal, 180 = straight up
  const tiltOf = (a, b) => deg(Math.atan2(b.y - a.y, b.x - a.x)); // signed angle of a→b vs horizontal
  // trunk lean from vertical, signed: + = shoulders to the image right of the hips
  const trunkLean = pts => { const s = mid(pts[11], pts[12]), h = mid(pts[23], pts[24]); return deg(Math.atan2(s.x - h.x, Math.max(1e-6, h.y - s.y))); };
  // pelvis tilt as seen from the front: + = the named hip is higher (smaller y) than the other, in degrees, wrap-safe
  const pelvisTilt = (pts, left) => { const a = left ? pts[23] : pts[24], b = left ? pts[24] : pts[23]; return deg(Math.atan2(b.y - a.y, Math.max(1e-6, Math.abs(b.x - a.x)))); };
  /* upper-body helpers (shoulder & neck exercises) */
  // roll of the a→b line, sign-safe whichever side of the image each point is on: + = b lower than a
  const lineTilt = (a, b) => deg(Math.atan2(b.y - a.y, Math.max(1e-6, Math.abs(b.x - a.x))));
  // head roll: + = right ear (8) dropping toward the right shoulder
  const headTilt = pts => lineTilt(pts[7], pts[8]) - lineTilt(pts[23], pts[24]);   // relative to the pelvis, so a rising shoulder is flagged rather than hidden
  // image direction from the body midline toward side s (+1 or −1)
  const outward = (pts, s) => Math.sign(pts[SIDE[s].SH].x - pts[SIDE[s === 'L' ? 'R' : 'L'].SH].x) || 1;
  // forearm rotation as seen from the front, degrees: 0 = forearm pointing at the camera, + = hand out to that side, − = hand across the body
  const armRot = (pts, s, foreRef) => { const j = SIDE[s]; const lat = (pts[j.WR].x - pts[j.EL].x) * outward(pts, s); return deg(Math.asin(clamp(lat / Math.max(foreRef, 1e-3), -1, 1))); };
  // how far the elbow sits outside the shoulder, image units (+ = away from the body)
  const elbowGap = (pts, s) => { const j = SIDE[s]; return (pts[j.EL].x - pts[j.SH].x) * outward(pts, s); };

  // Resistance band grades — TheraBand / standard exercise-band colour scale. 'none' = bodyweight only.
  const BAND = (dflt) => ({ key: 'band', label: 'Resistance band', values: ['none', 'tan', 'yellow', 'red', 'green', 'blue', 'black'], default: dflt,
    labels: { none: 'No band', tan: 'Tan · extra light', yellow: 'Yellow · light', red: 'Red · medium', green: 'Green · heavy', blue: 'Blue · extra heavy', black: 'Black · special heavy' },
    swatches: { none: 'transparent', tan: '#d9b98a', yellow: '#f2d23c', red: '#d8433b', green: '#2e9e5b', blue: '#2f6fd6', black: '#222222' } });
  // Auto side selection that does not flicker at rest: keep the current side unless the other one moves clearly more (hysteresis of 8°).
  function stickySide(ref, rL, rR) { const cur = ref.autoSide || (rL >= rR ? 'L' : 'R'); const next = cur === 'L' ? (rR > rL + 8 ? 'R' : 'L') : (rL > rR + 8 ? 'L' : 'R'); ref.autoSide = next; return next; }
  const EXERCISES = [
    {
      id: 'heelslide', name: 'Heel slide', group: 'Knee range of motion', type: 'reps', view: 'side', icon: '🦵',
      summary: 'Knee flexion range after surgery or injury — measured in degrees, rep by rep.',
      setup: 'Lie on your back on the floor, side-on to the camera at floor level, about 2 m away. The leg you are working should be the one nearest the camera. Start with that leg straight, other leg bent or straight, hips and shoulders flat.',
      why: 'From the side, hip–knee–ankle form a clean triangle in one plane, so knee angle is read directly, and the heel and hip staying on the floor are both visible as height changes.',
      defaultTarget: 10, targets: [6, 8, 10, 12, 15],
      options: [{ key: 'rom', label: 'Flexion target', values: [60, 75, 90, 105, 120], unit: '°', default: 90 }],
      required: [11, 12, 23, 24, 25, 26, 27, 28, 29, 30],
      enterCue: null,
      calibrate(pts, S, opts) {
        const j = sideJoints(pts, S); const shin = Math.max(dist(j.knee, j.ank), 0.03);
        return { kneeRest: Math.max(angle(j.hip, j.knee, j.ank), 160), shin, heel0: j.heel.y, ank0: j.ank.y, hip0: j.hip.y, thigh: Math.max(dist(j.hip, j.knee), 0.03), ear0: j.ear.y, rom: (opts && opts.rom) || 90 };
      },
      measure(pts, S, ref) {
        const j = sideJoints(pts, S);
        const knee = angle(j.hip, j.knee, j.ank);
        const flexion = ref.kneeRest - knee;                                   // degrees bent from straight
        const heelRise = (ref.heel0 - j.heel.y) / ref.shin;                    // + = heel above where it rested
        const hipRise = (ref.hip0 - j.hip.y) / ref.thigh;                      // + = hip lifting off the floor
        // If the knee falls out to the side (toward or away from the camera) the thigh and shin foreshorten in the image.
        // In-plane reps keep the shin ≥ ~0.78 of its calibrated length at peak bend; a leg falling out reads 0.60–0.70.
        const shinRatio = dist(j.knee, j.ank) / ref.shin, thighRatio = dist(j.hip, j.knee) / ref.thigh;
        const legRatio = (dist(j.knee, j.ank) + dist(j.hip, j.knee)) / (ref.shin + ref.thigh);
        const headLift = (ref.ear0 - j.ear.y) / ref.thigh;                    // + = head/ear rising off the floor to watch the knee
        return { p: flexion / ref.rom, knee, flexion, heelRise, hipRise, shinRatio, thighRatio, legRatio, headLift, focus: [SIDE[S].KNEE], side: S };
      },
      faults: [
        { id: 'heel', label: 'Heel lifting off the floor', cue: 'Keep your heel on the floor', tip: 'The heel should slide, not lift. Lifting it turns the movement into a leg raise and loses the knee-bend.', weight: 3, persist: 400, cooldown: 4000, phase: 'moving', check: m => m.p > 0.15 && m.heelRise > 0.12 },
        { id: 'legout', label: 'Knee falling out to the side', cue: 'Knee pointing at the ceiling', tip: 'Keep the knee and toes pointing straight up as you slide, so the bend happens in the knee rather than the leg rolling outward at the hip.', weight: 3, persist: 450, cooldown: 4000, phase: 'moving', check: m => m.flexion > 35 && (m.shinRatio < 0.74 || m.legRatio < 0.80) },
        { id: 'hip', label: 'Hip lifting', cue: 'Keep your hips down', tip: 'Lifting the hip cheats the last few degrees. Keep the pelvis flat and accept the smaller bend for now.', weight: 2, persist: 400, cooldown: 5000, phase: 'moving', check: m => m.p > 0.4 && m.hipRise > 0.15 },
        { id: 'shallow', label: 'Short of the flexion target', cue: 'Slide a little further', tip: 'Ease into the last few degrees on each rep — that is where range is gained. Pain up to mild is expected; sharp pain is not.', weight: 1, onRep: true, check: rep => rep.peak < FULL && rep.peak > ATTEMPT },
        { id: 'fast', label: 'Too fast', cue: 'Slow — hold the bend for a moment', tip: 'Take 2–3 seconds to slide in, hold the bend 2–5 seconds, then 2–3 seconds out.', weight: 1, onRep: true, check: rep => rep.duration < 2500 },
        { id: 'head', label: 'Lifting the head to watch', cue: 'Rest your head down', tip: 'Craning to watch the knee strains the neck and tips the pelvis. The coach is watching the knee for you.', weight: 1, persist: 900, cooldown: 8000, check: m => m.headLift > 0.35 },
        { id: 'return', label: 'Not straightening fully', cue: 'Straighten all the way', tip: 'Full extension at the end of each rep matters as much as flexion.', weight: 1, onRep: true, check: rep => rep.endP > 0.2 },
      ]
    },
    {
      id: 'hipabd', name: 'Standing hip abduction', group: 'Hip strength', type: 'reps', view: 'front', icon: '🧍', identifyLimb: 'leg',
      summary: 'Side leg raise for glute medius — the muscle that keeps the pelvis level when you walk and run.',
      setup: 'Stand facing the camera, about 2.5 m away, camera at hip height, one hand lightly on a chair or wall. Whole body in frame. To progress, loop a band around both ankles. Lift one leg straight out to the side and lower with control; do all reps on one leg, then repeat facing the camera with the other.',
      why: 'From the front, the leg swings across the camera plane, so raise angle, pelvis tilt, trunk lean and knee bend are all read directly with nothing in the way.',
      defaultTarget: 10, targets: [6, 8, 10, 12, 15],
      options: [{ key: 'rom', label: 'Raise target', values: [20, 25, 30, 35], unit: '°', default: 30 }, BAND('none')],
      required: [11, 12, 23, 24, 25, 26, 27, 28],
      calibrate(pts, S, opts) {
        // leg baselines come from the still standing frame captured before the leg-identification step when available
        const lb = opts && opts.legBase;
        const base = { legL: lb ? lb.L : fromVertical(pts[23], pts[27]), legR: lb ? lb.R : fromVertical(pts[24], pts[28]), hipW: Math.max(dist(pts[23], pts[24]), 0.03), rom: (opts && opts.rom) || 30 };
        // baseline trunk lean and pelvis tilt while standing, so only the CHANGE during the rep counts
        base.lean0 = trunkLean(pts); base.tiltL = pelvisTilt(pts, true); base.tiltR = pelvisTilt(pts, false);
        base.work = (opts && opts.work) || null;   // 'L' | 'R' chosen by the user lifting the leg at the start; null = auto
        return base;
      },
      measure(pts, S, ref) {
        const rL = fromVertical(pts[23], pts[27]) - ref.legL, rR = fromVertical(pts[24], pts[28]) - ref.legR;
        const useL = ref.work ? ref.work === 'L' : rL >= rR; const raise = useL ? rL : rR;
        const knee = useL ? angle(pts[23], pts[25], pts[27]) : angle(pts[24], pts[26], pts[28]);
        const stanceKnee = useL ? angle(pts[24], pts[26], pts[28]) : angle(pts[23], pts[25], pts[27]);
        const workHip = useL ? pts[23] : pts[24], otherHip = useL ? pts[24] : pts[23];
        const away = Math.sign(otherHip.x - workHip.x) || 1;                   // image direction from the working hip toward the stance leg
        const lean = trunkLean(pts) - ref.lean0;                                // signed, + = shoulders toward image right
        const leanAway = lean * away;                                           // + = leaning toward the stance leg (away from the lifting leg)
        const hike = pelvisTilt(pts, useL) - (useL ? ref.tiltL : ref.tiltR);   // + = working-side hip higher than the other
        return { p: raise / ref.rom, raise, knee, stanceKnee, hike, leanAway, useL, away, focus: [useL ? 27 : 28], side: useL ? 'L' : 'R' };
      },
      faults: [
        { id: 'lean', label: 'Leaning away to lift higher', cue: 'Stay tall — shoulders over hips', tip: 'Leaning the trunk away makes the leg look higher without the glute doing the work. Keep the torso upright and accept a smaller raise.', weight: 3, persist: 400, cooldown: 4500, phase: 'moving', check: m => m.p > 0.3 && m.leanAway > 15 },
        { id: 'hike', label: 'Hip hiking', cue: 'Hips level — lift from the hip, not the waist', tip: 'The pelvis should stay level; lifting the hip on the working side uses the back muscles instead of the glute. (The camera sees some pelvis tilt on every raise; only a tilt well beyond what the raise explains is flagged.)', weight: 1, persist: 500, cooldown: 6000, phase: 'moving', check: m => m.p > 0.3 && m.hike > 12 + 0.35 * m.raise },
        { id: 'bend', label: 'Knee bending', cue: 'Keep the leg straight', tip: 'Lead with the heel and keep the knee locked so the movement comes from the hip.', weight: 2, persist: 400, cooldown: 5000, phase: 'moving', check: m => m.p > 0.3 && m.knee < 160 },
        { id: 'stance', label: 'Standing knee bending', cue: 'Stand tall on the standing leg', tip: 'A bent standing knee lets the pelvis drop and the trunk lean. Keep it straight but not locked.', weight: 1, persist: 700, cooldown: 7000, check: m => m.p > 0.3 && m.stanceKnee < 160 },
        { id: 'high', label: 'Swinging too high', cue: 'Not so high — control it', tip: 'Above about 45° the pelvis has to tilt; keep the raise modest and slow.', weight: 1, persist: 300, cooldown: 5000, phase: 'moving', check: m => m.raise > 48 },
        { id: 'shallow', label: 'Not reaching the target', cue: 'Lift a little higher', tip: 'Aim for the raise target without leaning; if it is not reachable, lower the target rather than cheat.', weight: 1, onRep: true, check: rep => rep.peak < FULL && rep.peak > ATTEMPT },
        { id: 'fast', label: 'Too fast', cue: 'Slower — two seconds up, two down', tip: 'Momentum does the work if the leg swings. Two seconds up, brief pause, two seconds down.', weight: 1, onRep: true, check: rep => rep.duration < 1800 },
      ]
    },
    {
      id: 'wallsit', name: 'Wall sit', group: 'Knee & quad', type: 'hold', view: 'side', icon: '🧱',
      summary: 'Quad endurance at a safe 90° knee angle.',
      setup: 'Camera side-on, 2–3 m away, roughly hip height. Back flat on the wall, feet about 50 cm out, shoulder-width apart. Whole body in frame.',
      why: 'From the side the camera reads knee angle and whether your shins are vertical (knees not past toes) — both invisible from the front.',
      defaultTarget: 30, targets: [20, 30, 45, 60],
      required: [11, 12, 23, 24, 25, 26, 27, 28],
      enterCue: 'Slide down the wall until your knees are at ninety',
      calibrate() { return {}; },
      measure(pts, S) {
        const j = sideJoints(pts, S);
        const knee = angle(j.hip, j.knee, j.ank);
        const shinLean = (j.knee.x - j.ank.x) * (j.foot.x > j.heel.x ? 1 : -1) / Math.max(dist(j.knee, j.ank), 0.02); // + = knee forward of ankle toward toes
        const thighTilt = segTilt(j.hip, j.knee);   // 0 = thigh horizontal
        const trunk = fromVertical(j.sh, j.hip);    // trunk angle from vertical — back should be on the wall
        const handOnThigh = Math.abs(lineOffset(j.hip, j.knee, j.wr)) < 0.12 && j.wr.x > Math.min(j.hip.x, j.knee.x) - 0.02 && j.wr.x < Math.max(j.hip.x, j.knee.x) + 0.02 && j.wr.v > 0.5;
        return { p: 0, inPosition: knee <= 118 && knee > 55, seated: knee < 168, knee, shinLean, thighTilt, trunk, handOnThigh, focus: [SIDE[S].KNEE] };
      },
      faults: [
        { id: 'high', label: 'Sitting too high', cue: 'Slide down a little', tip: 'Aim for a 90° knee — thighs parallel to the floor.', weight: 2, persist: 700, cooldown: 3500, check: m => m.seated && m.knee > 108 },
        { id: 'low', label: 'Below 90°', cue: 'Come up a touch — knees at ninety', tip: 'Deeper than 90° increases kneecap load; stay at parallel.', weight: 2, persist: 700, cooldown: 3500, check: m => m.seated && m.knee < 78 },
        { id: 'lean', label: 'Back off the wall', cue: 'Press your back into the wall', tip: 'Shoulder blades, mid-back and hips all stay on the wall; leaning forward shifts load to the knees.', weight: 2, persist: 1500, cooldown: 5000, check: m => m.inPosition && m.trunk > 15 },
        { id: 'hands', label: 'Hands resting on thighs', cue: 'Hands off your thighs', tip: 'Arms at your sides, crossed, or out in front — resting on the thighs takes load off the quads.', weight: 1, persist: 1200, cooldown: 8000, check: m => m.inPosition && m.handOnThigh },
        { id: 'shin', label: 'Knees past toes', cue: 'Walk your feet out — shins vertical', tip: 'Keep the shin vertical so the load stays in the quads, not the kneecap.', weight: 2, persist: 800, cooldown: 5000, check: m => m.inPosition && m.shinLean > 0.35 },
      ]
    },
    {
      id: 'plank', name: 'Plank', group: 'Core', type: 'hold', view: 'side', icon: '📏',
      summary: 'Straight-line hold with live sag / pike correction.',
      setup: 'Camera on the floor, side-on, 2–3 m away. Forearm or straight-arm plank. Whole body in frame.',
      why: 'The only view where the hip line, shoulder-over-elbow stacking and head position can all be measured at once.',
      defaultTarget: 30, targets: [20, 30, 45, 60, 90],
      required: [11, 12, 13, 14, 23, 24, 27, 28],
      enterCue: 'Get into your plank — body in one straight line',
      calibrate() { return {}; },
      measure(pts, S) {
        const j = sideJoints(pts, S);
        const lineAng = angle(j.sh, j.hip, j.ank);
        const hipOff = lineOffset(j.sh, j.ank, j.hip);
        const neck = angle(j.ear, j.sh, j.hip);
        const stack = (j.sh.x - j.el.x) * (j.foot.x > j.heel.x ? -1 : 1) / Math.max(dist(j.sh, j.el), 0.02); // + shoulders behind elbows
        const bodyTilt = segTilt(j.sh, j.ank);
        const kneeAng = angle(j.hip, j.knee, j.ank);
        const kneesDown = j.knee.y > j.ank.y - 0.03;                            // knee at floor level → knees-down variant
        return { p: 0, inPosition: bodyTilt < 35 && lineAng > 140 && j.hip.y < 0.98, lineAng, hipOff, neck, stack, kneeAng, kneesDown, focus: [SIDE[S].HIP] };
      },
      faults: [
        { id: 'sag', label: 'Hips sagging', cue: 'Lift your hips — squeeze your glutes', tip: 'Tuck the pelvis slightly and brace; sagging loads the lower back.', weight: 3, persist: 500, cooldown: 4000, check: m => m.inPosition && m.hipOff > 0.055 },
        { id: 'pike', label: 'Hips too high', cue: 'Lower your hips into a straight line', tip: 'A high pike takes the work out of the core.', weight: 2, persist: 600, cooldown: 4000, check: m => m.inPosition && m.hipOff < -0.075 },
        { id: 'knees', label: 'Knees bending', cue: 'Straighten your legs — squeeze the thighs', tip: 'Pull the kneecaps up so the legs are part of the line; bent knees drop the hips.', weight: 1, persist: 900, cooldown: 8000, check: m => m.inPosition && !m.kneesDown && m.kneeAng < 160 },
        { id: 'stack', label: 'Shoulders not over elbows', cue: 'Bring your shoulders over your elbows', tip: 'Stack the shoulder directly above the elbow to protect the shoulder joint.', weight: 1, persist: 900, cooldown: 8000, check: m => m.inPosition && Math.abs(m.stack) > 0.45 },
        { id: 'neck', label: 'Head dropping', cue: 'Eyes to the floor ahead — neck long', tip: 'Keep the head in line with the spine.', weight: 1, persist: 800, cooldown: 8000, check: m => m.inPosition && m.neck < 140 },
      ]
    },
    {
      id: 'calfstretch', name: 'Wall calf stretch', group: 'Foot & ankle', type: 'hold', view: 'side', icon: '🧗',
      summary: 'Gastrocnemius (straight knee) or soleus (bent knee) stretch, verified heel-down and knee-correct.',
      setup: 'Stand facing a wall with both hands on it, side-on to the camera at hip height, 2–3 m away. Step the stretching leg back so it is the leg nearest the camera; toes pointing at the wall. Whole body from hands to back heel in frame.',
      why: 'Side-on, the three things that make or break the stretch — back heel on the floor, back knee straight or bent, shin leaning toward the wall — are each a direct height or angle read.',
      defaultTarget: 30, targets: [20, 30, 45, 60],
      options: [{ key: 'variant', label: 'Variant', values: ['straight', 'bent'], labels: { straight: 'Straight knee (calf)', bent: 'Bent knee (soleus)' }, default: 'straight' }],
      required: [11, 12, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32],
      enterCue: 'Hands on the wall, step the back leg back, and lean in',
      calibrate(pts, S, opts) {
        const j = sideJoints(pts, S);
        return { heel0: j.heel.y, shin: Math.max(dist(j.knee, j.ank), 0.03), variant: (opts && opts.variant) || 'straight' };
      },
      measure(pts, S, ref) {
        const j = sideJoints(pts, S);
        const knee = angle(j.hip, j.knee, j.ank);
        const heelRise = (ref.heel0 - j.heel.y) / ref.shin;
        const shinLean = fromVertical(j.knee, j.ank);                          // shin angle from vertical — dorsiflexion proxy
        const hipAng = angle(j.sh, j.hip, j.knee);
        const bent = ref.variant === 'bent';
        const kneeOk = bent ? (knee >= 135 && knee <= 165) : knee >= 165;
        const reach = Math.abs(j.wr.x - j.sh.x) / Math.max(dist(j.sh, j.el), 0.02);   // arms extended toward the wall
        const engaged = reach > 1.2;                                                   // hands on the wall = set-up position, judge from here
        const inPosition = engaged && shinLean >= 10 && heelRise < 0.08 && kneeOk && hipAng > 150;
        const handHeight = (j.sh.y - j.wr.y) / Math.max(dist(j.sh, j.el), 0.02);  // + = hands above the shoulder, in upper-arm lengths
        const F = SIDE[S === 'L' ? 'R' : 'L']; const frontKnee = angle(pts[F.HIP], pts[F.KNEE], pts[F.ANK]); const frontVis = Math.min(pts[F.HIP].v, pts[F.KNEE].v, pts[F.ANK].v);
        return { p: 0, inPosition, engaged, reach, knee, heelRise, shinLean, hipAng, bent, handHeight, frontKnee, frontVis, focus: [SIDE[S].ANK, SIDE[S].KNEE] };
      },
      faults: [
        { id: 'heel', label: 'Back heel lifting', cue: 'Press the back heel down', tip: 'The stretch only reaches the calf when the heel stays flat. Step the foot closer to the wall if it will not stay down.', weight: 3, persist: 500, cooldown: 3500, check: m => m.engaged && m.heelRise >= 0.08 },
        { id: 'kneebend', label: 'Back knee bending', cue: 'Straighten the back knee', tip: 'For the calf (gastrocnemius) stretch the back knee must stay straight; a bent knee shifts the stretch to the soleus.', weight: 2, persist: 600, cooldown: 4000, check: m => m.engaged && !m.bent && m.knee < 165 },
        { id: 'kneestraight', label: 'Back knee not bent enough', cue: 'Bend the back knee a little more', tip: 'For the soleus variant keep the back knee softly bent, about 20–40°.', weight: 2, persist: 600, cooldown: 4000, check: m => m.engaged && m.bent && m.knee > 165 },
        { id: 'lean', label: 'Not leaning in enough', cue: 'Lean into the wall until you feel the calf', tip: 'Move the hips toward the wall; the shin should tilt forward at least 10–15°.', weight: 2, persist: 900, cooldown: 4000, check: m => m.engaged && m.shinLean < 10 && m.heelRise < 0.08 },
        { id: 'hands', label: 'Hands not at shoulder height', cue: 'Hands on the wall at shoulder height', tip: 'Hands too high pull the shoulders up and arch the back; too low folds you at the waist.', weight: 1, persist: 1200, cooldown: 8000, check: m => m.engaged && (m.handHeight > 0.9 || m.handHeight < -0.7) },
        { id: 'front', label: 'Front knee straight', cue: 'Bend the front knee as you lean', tip: 'The front knee bends toward the wall so the hips can travel forward; a straight front leg blocks the lean.', weight: 1, persist: 1200, cooldown: 8000, check: m => m.engaged && m.frontVis > 0.5 && m.frontKnee > 172 },
        { id: 'hinge', label: 'Bending at the hips', cue: 'Keep your body in a straight line', tip: 'Lean from the ankle, not the waist — shoulders, hips and back knee in one line.', weight: 1, persist: 900, cooldown: 5000, check: m => m.engaged && m.hipAng < 150 },
      ]
    },
    /* ================= SHOULDER & NECK (added from the shoulder HEP handouts) =================
       All five are upper-body: the camera is at chest height and only head-to-hips needs to be in frame.
       Helpers: an arm is identified by the user lifting it at the start (identifyLimb: 'arm') or picked automatically. */
    {
      id: 'shoulder_er', upperBody: true, name: 'Standing shoulder rotation (band)', group: 'Shoulder — rotator cuff', type: 'reps', view: 'front', icon: '💪', identifyLimb: 'arm',
      summary: 'External or internal rotation with the elbow pinned to your side — the classic rotator-cuff exercise, checked for elbow drift, shrugging and trunk twist.',
      setup: 'Anchor the band at elbow height beside you (door handle, railing). Stand facing the camera about 2 m away, camera at chest height, head to hips in frame. Elbow bent to 90° and touching your ribs, forearm across your stomach for external rotation (or out to the side for internal rotation). Rotate the forearm against the band, elbow glued to your side, then return slowly.',
      why: 'Facing the camera, the forearm swings across the picture like a clock hand, so rotation angle is read directly, and the elbow leaving the ribs, the shoulder rising toward the ear and the torso twisting are all visible as changes the camera can measure.',
      defaultTarget: 10, targets: [6, 8, 10, 12, 15],
      options: [
        { key: 'variant', label: 'Direction', values: ['er', 'ir'], labels: { er: 'External (out, away from stomach)', ir: 'Internal (in, toward stomach)' }, default: 'er' },
        { key: 'rom', label: 'Rotation target', values: [45, 60, 75, 90], unit: '°', default: 60 },
        BAND('yellow'),
      ],
      required: [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24],
      calibrate(pts, S, opts) {
        const base = { rom: (opts && opts.rom) || 60, variant: (opts && opts.variant) || 'er', work: (opts && opts.work) || null };
        for (const s of ['L', 'R']) { const j = SIDE[s]; const sh = pts[j.SH], el = pts[j.EL], wr = pts[j.WR];
          base['upper' + s] = Math.max(dist(sh, el), 0.03); base['fore' + s] = Math.max(dist(el, wr), 0.85 * base['upper' + s]);   /* the forearm points toward the camera for most of the rep, so its true length is taken from the upper arm (hanging in-plane) */
          base['lat' + s] = (pts[j.WR].x - pts[j.EL].x) * outward(pts, s); /* start offset in image units; turned into an angle with the best forearm length seen (see measure) */ base['elGap' + s] = elbowGap(pts, s) / base['upper' + s]; base['neck' + s] = dist(pts[j.EAR], sh); }
        base.shW = Math.max(dist(pts[11], pts[12]), 0.03); base.lean0 = trunkLean(pts); base.torso = Math.max(dist(mid(pts[11], pts[12]), mid(pts[23], pts[24])), 0.05);
        return base;
      },
      measure(pts, S, ref) {
        for (const s of ['L', 'R']) ref['fore' + s] = Math.max(ref['fore' + s], dist(pts[SIDE[s].EL], pts[SIDE[s].WR]));   // forearm length is only fully seen when it lies in the camera plane
        const phi0 = s => deg(Math.asin(clamp(ref['lat' + s] / ref['fore' + s], -1, 1)));
        const rot = s => (armRot(pts, s, ref['fore' + s]) - phi0(s)) * (ref.variant === 'ir' ? -1 : 1);   // + = rotating in the trained direction
        const rL = rot('L'), rR = rot('R'); const useL = ref.work ? ref.work === 'L' : stickySide(ref, rL, rR) === 'L'; const s = useL ? 'L' : 'R'; const j = SIDE[s];
        const rotation = useL ? rL : rR;
        const drift = elbowGap(pts, s) / ref['upper' + s] - ref['elGap' + s];                      // elbow moving out from the ribs, in upper-arm lengths
        const shrug = (ref['neck' + s] - dist(pts[j.EAR], pts[j.SH])) / ref.torso;                // shoulder rising toward the ear
        const twist = 1 - dist(pts[11], pts[12]) / ref.shW;                                        // shoulders narrowing in the image = torso turning
        const lean = Math.abs(trunkLean(pts) - ref.lean0);
        const wristDrop = (pts[j.WR].y - pts[j.EL].y) / ref['upper' + s];   /* + = wrist below the elbow (arm straightening), − = wrist above (over-bent); ≈0 at a 90° elbow */
        const elbow = angle(pts[j.SH], pts[j.EL], pts[j.WR]);
        return { p: rotation / ref.rom, rotation, drift, shrug, twist, lean, wristDrop, elbow, useL, side: s, focus: [j.WR, j.EL] };
      },
      faults: [
        { id: 'drift', label: 'Elbow leaving your side', cue: 'Elbow glued to your ribs', tip: 'Once the elbow lifts away from the body the movement becomes a shoulder swing and the rotator cuff stops doing the work. Tuck a folded towel between elbow and ribs and keep it pinned.', weight: 3, persist: 400, cooldown: 4500, phase: 'moving', check: m => m.p > 0.25 && m.drift > 0.22 },
        { id: 'straight', label: 'Elbow opening past 90°', cue: 'Keep the elbow bent at ninety', tip: 'If the elbow straightens the hand swings down and the movement stops being rotation. Forearm level with the floor, elbow at a right angle, for the whole rep.', weight: 2, persist: 500, cooldown: 5000, check: m => m.p > 0.15 && m.wristDrop > 0.45 },
        { id: 'overbent', label: 'Elbow bent past 90°', cue: 'Forearm level — open the elbow to ninety', tip: 'Pulling the hand up toward the chest shortens the lever and shifts the work to the biceps. Keep the forearm parallel to the floor.', weight: 1, persist: 600, cooldown: 6000, check: m => m.p > 0.15 && m.wristDrop < -0.40 },
        { id: 'twist', label: 'Twisting the torso', cue: 'Chest to the camera — rotate the arm, not the body', tip: 'Turning the trunk fakes extra range. Keep both shoulders square to the camera and accept less rotation.', weight: 2, persist: 450, cooldown: 5000, phase: 'moving', check: m => m.p > 0.25 && m.twist > 0.14 },
        { id: 'shrug', label: 'Shrugging', cue: 'Shoulder down, away from your ear', tip: 'When the shoulder creeps up the upper trapezius takes over. Set the shoulder blade down and back before each rep and keep the neck long.', weight: 2, persist: 500, cooldown: 5000, check: m => m.shrug > 0.10 },
        { id: 'lean', label: 'Leaning', cue: 'Stand tall', tip: 'Leaning sideways or back recruits the trunk. Feet hip-width, ribs down, stay upright.', weight: 1, persist: 600, cooldown: 6000, check: m => m.lean > 12 },
        { id: 'shallow', label: 'Not reaching the rotation target', cue: 'Rotate a little further', tip: 'Take the forearm through the full comfortable range each rep; if it is not reachable, lower the target rather than cheat with the elbow.', weight: 1, onRep: true, check: rep => rep.peak < FULL && rep.peak > ATTEMPT },
        { id: 'fast', label: 'Too fast', cue: 'Slower — two seconds out, three back', tip: 'The return against the band is where the cuff works hardest. Two seconds out, brief pause, three seconds back.', weight: 1, onRep: true, check: rep => rep.duration < 2200 },
        { id: 'return', label: 'Not returning fully', cue: 'All the way back to the start', tip: 'Finish each rep back at the start position so the muscle works through its whole range.', weight: 1, onRep: true, check: rep => rep.endP > 0.25 },
      ]
    },
    {
      id: 'shoulder_abd', upperBody: true, name: 'Shoulder abduction (band)', group: 'Shoulder — rotator cuff', type: 'reps', view: 'front', icon: '🙋', identifyLimb: 'arm',
      summary: 'Straight-arm raise out to the side against a band, to shoulder height — checked for shrugging, leaning, bending the elbow and swinging too high.',
      setup: 'Stand on the band, hold the other end at your side. Face the camera about 2.5 m away, camera at chest height, whole body in frame. Raise the arm straight out to the side, thumb slightly up, no higher than shoulder level, then lower slowly.',
      why: 'From the front the arm swings across the camera plane, so the raise angle, a bending elbow, a rising shoulder and a trunk leaning the other way are all measured directly — the same geometry that makes standing hip abduction easy to track.',
      defaultTarget: 10, targets: [6, 8, 10, 12, 15],
      options: [{ key: 'rom', label: 'Raise target', values: [45, 60, 75, 90], unit: '°', default: 90 }, BAND('yellow')],
      required: [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24],
      calibrate(pts, S, opts) {
        const base = { rom: (opts && opts.rom) || 90, work: (opts && opts.work) || null };
        for (const s of ['L', 'R']) { const j = SIDE[s]; base['arm' + s] = armAngle(pts[j.SH], pts[j.EL]); base['neck' + s] = dist(pts[j.EAR], pts[j.SH]); }   /* raise is read from the upper arm so a bending elbow is flagged, not mis-read as a lower raise */
        base.lean0 = trunkLean(pts); base.torso = Math.max(dist(mid(pts[11], pts[12]), mid(pts[23], pts[24])), 0.05);
        return base;
      },
      measure(pts, S, ref) {
        const rL = armAngle(pts[11], pts[13]) - ref.armL, rR = armAngle(pts[12], pts[14]) - ref.armR;
        const useL = ref.work ? ref.work === 'L' : stickySide(ref, rL, rR) === 'L'; const s = useL ? 'L' : 'R'; const j = SIDE[s]; const raise = useL ? rL : rR;
        const elbow = angle(pts[j.SH], pts[j.EL], pts[j.WR]);
        const shrug = (ref['neck' + s] - dist(pts[j.EAR], pts[j.SH])) / ref.torso;
        const away = Math.sign(pts[useL ? 12 : 11].x - pts[j.SH].x) || 1;                        // image direction from the working shoulder toward the other one
        const leanAway = (trunkLean(pts) - ref.lean0) * away;                                    // + = trunk tipping away from the lifting arm
        const wristAboveShoulder = (pts[j.SH].y - pts[j.WR].y) / ref.torso;
        return { p: raise / ref.rom, raise, elbow, shrug, leanAway, wristAboveShoulder, useL, side: s, focus: [j.WR] };
      },
      faults: [
        { id: 'shrug', label: 'Shrugging', cue: 'Shoulder down — push the hand away, not up', tip: 'If the shoulder rises toward the ear the upper trapezius does the lift. Set the shoulder blade down first; think of reaching the hand toward the wall rather than lifting it.', weight: 3, persist: 400, cooldown: 4500, phase: 'moving', check: m => m.p > 0.3 && m.shrug > 0.09 },
        { id: 'lean', label: 'Leaning away', cue: 'Stay tall — no leaning', tip: 'Tipping the trunk the other way makes the arm look higher without the shoulder working. Keep the torso upright and accept a smaller raise.', weight: 2, persist: 450, cooldown: 5000, phase: 'moving', check: m => m.p > 0.3 && m.leanAway > 10 },
        { id: 'bend', label: 'Elbow bending', cue: 'Keep the arm straight — soft elbow', tip: 'A bending elbow shortens the lever and shifts work to the biceps. Keep a small soft bend and hold it fixed for the whole rep.', weight: 2, persist: 400, cooldown: 5000, phase: 'moving', check: m => m.p > 0.3 && m.elbow < 150 },
        { id: 'high', label: 'Raising above shoulder height', cue: 'Stop at shoulder height', tip: 'Above about 90° the shoulder blade has to rotate and the space under the acromion narrows; for rehab, stop with the hand level with the shoulder.', weight: 2, persist: 300, cooldown: 5000, phase: 'moving', check: m => m.raise > 100 },
        { id: 'shallow', label: 'Not reaching the target', cue: 'A little higher', tip: 'Aim for the raise target without shrugging or leaning; if it hurts before then, lower the target.', weight: 1, onRep: true, check: rep => rep.peak < FULL && rep.peak > ATTEMPT },
        { id: 'fast', label: 'Too fast', cue: 'Slower — two up, pause, three down', tip: 'Swinging the arm lets momentum lift it. Two seconds up, a one-second pause at the top, three seconds down.', weight: 1, onRep: true, check: rep => rep.duration < 2200 },
      ]
    },
    {
      id: 'band_row', upperBody: true, name: 'Band rows', group: 'Shoulder — scapula & back', type: 'reps', view: 'side', icon: '🚣', enterCue: null,
      summary: 'Pull the band to your ribs with the elbows close — checked for shrugging, leaning back, flaring elbows and incomplete pulls.',
      setup: 'Anchor the band at waist height in front of you. Stand side-on to the camera about 2.5 m away, camera at chest height, whole body in frame. Arms straight toward the anchor with light tension. Draw the elbows straight back past your ribs, squeeze the shoulder blades together, pause, and let the arms straighten slowly.',
      why: 'From the side the elbow travelling behind the line of the torso, the shoulder rising, and the trunk leaning back are all plain to see; from the front they are hidden behind the body.',
      defaultTarget: 10, targets: [6, 8, 10, 12, 15],
      options: [BAND('red')],
      required: [7, 8, 11, 12, 13, 14, 15, 16, 23, 24],
      calibrate(pts, S, opts) {
        const j = sideJoints(pts, S); const upper = Math.max(dist(j.sh, j.el), 0.03);
        const dir = Math.sign(j.wr.x - j.sh.x) || 1;                                            // image direction toward the anchor
        return { upper, dir, eb0: ((j.el.x - j.sh.x) * -dir) / upper, neck0: dist(j.ear, j.sh), lean0: trunkLean(pts), torso: Math.max(dist(j.sh, j.hip), 0.05), full: 0.45 };
      },
      measure(pts, S, ref) {
        const j = sideJoints(pts, S);
        const elbowBack = ((j.el.x - j.sh.x) * -ref.dir) / ref.upper;                            // + = elbow behind the shoulder line
        const p = (elbowBack - ref.eb0) / (ref.full - ref.eb0);
        const shrug = (ref.neck0 - dist(j.ear, j.sh)) / ref.torso;
        const leanBack = (trunkLean(pts) - ref.lean0) * -ref.dir;                                // + = shoulders moving away from the anchor
        const elbowHigh = (j.sh.y - j.el.y) / ref.upper;                                         // + = elbow above the shoulder
        const elbow = angle(j.sh, j.el, j.wr);
        return { p, elbowBack, shrug, leanBack, elbowHigh, elbow, side: S, focus: [SIDE[S].EL] };
      },
      faults: [
        { id: 'shrug', label: 'Shrugging', cue: 'Shoulders down as you pull', tip: 'Pull the shoulder blades down and back, not up. If the shoulder rises toward the ear the upper trapezius is doing the row.', weight: 3, persist: 400, cooldown: 4500, phase: 'moving', check: m => m.p > 0.3 && m.shrug > 0.09 },
        { id: 'lean', label: 'Leaning back', cue: 'Stand tall — pull with the arms, not the body', tip: 'Rocking the torso back uses body weight instead of the back muscles. Brace the abdomen and keep the trunk still; if you must lean, the band is too strong.', weight: 2, persist: 450, cooldown: 5000, phase: 'moving', check: m => m.p > 0.3 && m.leanBack > 8 },
        { id: 'flare', label: 'Elbows flaring up', cue: 'Elbows down, close to your ribs', tip: 'Elbows at shoulder height turn this into a high row that loads the neck. Keep the elbows low and brushing your sides.', weight: 2, persist: 400, cooldown: 5000, phase: 'moving', check: m => m.p > 0.4 && m.elbowHigh > -0.15 },
        { id: 'shallow', label: 'Not pulling all the way back', cue: 'Elbows further back — squeeze the blades', tip: 'The squeeze at the end is the point of the exercise: the elbow should pass behind your ribs before you pause.', weight: 1, onRep: true, check: rep => rep.peak < FULL && rep.peak > ATTEMPT },
        { id: 'fast', label: 'Too fast', cue: 'Slower — pause at the back', tip: 'Two seconds back, hold the squeeze for a count, three seconds forward. Do not let the band snap the arms out.', weight: 1, onRep: true, check: rep => rep.duration < 2200 },
        { id: 'return', label: 'Not letting the arms straighten', cue: 'Let the arms reach forward fully', tip: 'Each rep starts with the arms long so the shoulder blades can glide forward and then be pulled back through the full range.', weight: 1, onRep: true, check: rep => rep.endP > 0.3 },
      ]
    },
    {
      id: 'pullapart', upperBody: true, name: 'Band pull-apart', group: 'Shoulder — scapula & back', type: 'reps', view: 'front', icon: '🏹', enterCue: null,
      summary: 'Arms straight at shoulder height, pull the band to your chest — checked for bending elbows, shrugging, the band drifting up or down, and short reps.',
      setup: 'Hold the band in front of you at shoulder height, arms straight, hands a little wider than the shoulders, light tension. Face the camera about 2.5 m away, camera at chest height, head to hips in frame. Pull the hands apart until the band touches your chest, squeeze the shoulder blades together, pause, then return slowly.',
      why: 'Facing the camera the arms open into a T in the camera plane: the distance between the hands, a bending elbow, the shoulders rising, and the hands drifting above or below shoulder height are all read directly.',
      defaultTarget: 12, targets: [6, 8, 10, 12, 15, 20],
      options: [BAND('yellow')],
      required: [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24],
      calibrate(pts, S, opts) {
        const shW = Math.max(dist(pts[11], pts[12]), 0.03); const torso = Math.max(dist(mid(pts[11], pts[12]), mid(pts[23], pts[24])), 0.05);
        // arm length is foreshortened at the start (arms point at the camera), so estimate it from torso length: arm ≈ 1.15 × shoulder–hip
        return { shW, torso, arm: 1.15 * torso, span0: dist(pts[15], pts[16]), neck0: (dist(pts[7], pts[11]) + dist(pts[8], pts[12])) / 2 };
      },
      measure(pts, S, ref) {
        const span = dist(pts[15], pts[16]);
        const p = (span - ref.span0) / (ref.shW + 2 * ref.arm * 0.92 - ref.span0);              // full = hands out at ~92 % of the span
        const elbow = Math.min(angle(pts[11], pts[13], pts[15]), angle(pts[12], pts[14], pts[16]));
        const shrug = (ref.neck0 - (dist(pts[7], pts[11]) + dist(pts[8], pts[12])) / 2) / ref.torso;
        const handDrop = ((pts[15].y + pts[16].y) / 2 - (pts[11].y + pts[12].y) / 2) / ref.torso;   // + = hands below shoulder height
        return { p, span, elbow, shrug, handDrop, side: S, focus: [15, 16] };
      },
      faults: [
        { id: 'bend', label: 'Elbows bending', cue: 'Arms long — pull with the shoulder blades', tip: 'Bending the elbows turns the pull-apart into a row and takes the rear shoulder out of it. Keep a tiny soft bend and hold it fixed.', weight: 3, persist: 400, cooldown: 4500, phase: 'moving', check: m => m.p > 0.45 && m.elbow < 150 },
        { id: 'shrug', label: 'Shrugging', cue: 'Long neck — shoulders down', tip: 'Pull the shoulders gently down before each rep: wide collarbones, then squeeze the blades back. If they climb toward the ears the upper trapezius takes over.', weight: 2, persist: 450, cooldown: 5000, check: m => m.shrug > 0.09 },
        { id: 'low', label: 'Hands dropping below shoulder height', cue: 'Keep the band at shoulder height', tip: 'As you tire the band drifts down toward the stomach and the movement becomes a shoulder extension. Keep the hands level with the shoulders the whole way.', weight: 2, persist: 500, cooldown: 5000, phase: 'moving', check: m => m.p > 0.4 && m.handDrop > 0.28 },
        { id: 'high', label: 'Hands rising above shoulder height', cue: 'Bring the band down to shoulder height', tip: 'Pulling above the shoulders loads the neck. Hands level with the shoulders.', weight: 1, persist: 500, cooldown: 5000, phase: 'moving', check: m => m.p > 0.4 && m.handDrop < -0.28 },
        { id: 'shallow', label: 'Not pulling all the way apart', cue: 'All the way — band to the chest', tip: 'Finish with the band touching the chest and a one-second squeeze. If that is not possible, use a lighter band.', weight: 1, onRep: true, check: rep => rep.peak < FULL && rep.peak > ATTEMPT },
        { id: 'fast', label: 'Too fast', cue: 'Slower — pause with the band on your chest', tip: 'One to two seconds apart, a one-second squeeze, three seconds back. Do not let the band snap the arms together.', weight: 1, onRep: true, check: rep => rep.duration < 2200 },
      ]
    },
    {
      id: 'trapstretch', upperBody: true, name: 'Upper trapezius stretch', group: 'Neck', type: 'hold', view: 'front', icon: '🧘', identifyLimb: null,
      enterCue: 'Ear toward the shoulder — and keep the other shoulder down',
      summary: 'Ear toward the opposite shoulder with the stretched-side hand behind your back — checked for the shoulder creeping up, the head turning and the hand coming out.',
      setup: 'Sit or stand facing the camera about 1.5 m away, camera at chest height, head to hips in frame. Put the hand of the side you are stretching behind your back (or sit on it). Tuck the chin slightly, then tilt the ear toward the opposite shoulder; the other hand may rest on the head to add gentle weight. Hold, breathe, keep the stretched shoulder down.',
      why: 'From the front the tilt of the head against the line of the shoulders, a shoulder rising toward the ear, and the nose turning away from the camera are all measured directly.',
      defaultTarget: 20, targets: [15, 20, 30, 45],
      options: [],
      required: [0, 7, 8, 11, 12, 15, 16, 23, 24],
      calibrate(pts, S, opts) {
        return { headTilt0: headTilt(pts), shTilt0: lineTilt(pts[11], pts[12]), earSpan: Math.max(dist(pts[7], pts[8]), 0.02), torso: Math.max(dist(mid(pts[11], pts[12]), mid(pts[23], pts[24])), 0.05), neckL: dist(pts[7], pts[11]), neckR: dist(pts[8], pts[12]), work: (opts && opts.work) || null };
      },
      measure(pts, S, ref) {
        const tilt = headTilt(pts) - ref.headTilt0;                                              // + = head tilting toward image right (right ear down)
        const stretchL = tilt > 0, s = ref.work ? ref.work : stretchL ? 'L' : 'R';              // right ear down stretches the LEFT upper trap
        const j = SIDE[s], other = SIDE[s === 'L' ? 'R' : 'L'];
        const amount = Math.abs(tilt);
        // the stretched shoulder must stay down: its ear→shoulder distance should GROW, and the shoulder line must not tip up on that side
        const shoulderUp = (ref['neck' + s] - dist(pts[j.EAR], pts[j.SH])) / ref.torso + Math.max(0, (s === 'L' ? 1 : -1) * (lineTilt(pts[11], pts[12]) - ref.shTilt0)) / 30;
        const noseOff = Math.abs(pts[0].x - (pts[7].x + pts[8].x) / 2) / ref.earSpan;             // nose off the ear midpoint = head turned
        const handUp = (pts[j.HIP].y - pts[j.WR].y) / ref.torso;                                 // stretched-side hand above the hip = not behind the back
        const inPosition = amount >= 18;
        return { p: 0, inPosition, amount, tilt, shoulderUp, noseOff, handUp, side: s, focus: [j.SH, other.EAR] };
      },
      faults: [
        { id: 'shoulder', label: 'Stretched shoulder creeping up', cue: 'Keep that shoulder down', tip: 'The stretch only reaches the upper trapezius when the shoulder on the stretched side stays down. Press the hand behind your back toward the floor, or sit on it.', weight: 3, persist: 700, cooldown: 5000, check: m => m.inPosition && m.shoulderUp > 0.10 },
        { id: 'turn', label: 'Turning the head', cue: 'Nose forward — tilt, don\'t turn', tip: 'Keep the eyes and nose pointing at the camera; turning the head changes which muscle is stretched and can pinch the neck.', weight: 2, persist: 800, cooldown: 6000, check: m => m.inPosition && m.noseOff > 0.25 },
        { id: 'hand', label: 'Hand not behind the back', cue: 'Put the hand behind your back', tip: 'The arm behind the back anchors the shoulder blade so the stretch goes into the trapezius, not the shoulder joint.', weight: 1, persist: 1200, cooldown: 8000, check: m => m.inPosition && m.handUp > 0.25 },
        { id: 'shallow', label: 'Not tilting enough', cue: 'Ear a little closer to the shoulder', tip: 'Tilt until you feel a clear pull along the side of the neck — gentle, never painful. About 20–30° is usually enough.', weight: 1, persist: 2500, cooldown: 8000, check: m => !m.inPosition && m.amount > 6 },
      ]
    },
  ];

  /* ---------------- Rep counter (hysteresis state machine) ---------------- */
  class RepCounter {
    constructor(opts = {}) {
      this.rest = opts.rest ?? REST; this.attempt = opts.attempt ?? ATTEMPT; this.full = opts.full ?? FULL;
      this.minRep = opts.minRep ?? 600; this.turnHyst = opts.turnHyst ?? 0.12;
      this.state = 'rest'; this.p = 0; this.peak = 0; this.t0 = 0; this.tPeak = 0; this.trough = 0; this.tTrough = 0;
      this.count = 0; this.partials = 0; this.reps = []; this.faultsThisRep = new Set();
      this.alpha = 0.4;
    }
    // returns event: null | {type:'rep', full, rep} | {type:'phase', ...}
    update(pRaw, t) {
      this.p = this.p === null ? pRaw : this.alpha * pRaw + (1 - this.alpha) * this.p;
      const p = this.p; let ev = null;
      switch (this.state) {
        case 'rest':
          if (p > this.attempt) { this.state = 'out'; this.t0 = t; this.peak = p; this.tPeak = t; this.faultsThisRep = new Set(); }
          break;
        case 'out':
          if (p > this.peak) { this.peak = p; this.tPeak = t; }
          else if (p < this.peak - this.turnHyst) { this.state = 'back'; this.trough = p; this.tTrough = t; }
          break;
        case 'back':
          if (p < this.trough) { this.trough = p; this.tTrough = t; }
          if (p > this.peak + 0.05) { this.state = 'out'; this.peak = p; this.tPeak = t; }
          else if (p < this.rest) { ev = this._finish(t, 'rest'); }
          else if (this.trough < this.attempt && p > this.trough + this.turnHyst) {
            // bounced at the bottom without fully resting (e.g. no lock-out) — close the rep at the trough and start the next
            ev = this._finish(this.tTrough, 'out'); this.t0 = this.tTrough; this.peak = p; this.tPeak = t; this.faultsThisRep = new Set();
          }
          break;
      }
      return ev;
    }
    _finish(t, next) {
      const duration = t - this.t0, full = this.peak >= this.full;
      const rep = { n: 0, full, peak: this.peak, endP: this.p, duration, tDown: this.tPeak - this.t0, tUp: t - this.tPeak, t, faults: [...this.faultsThisRep] };
      this.state = next;
      if (duration < this.minRep) return null;
      if (full) { this.count++; rep.n = this.count; } else this.partials++;
      this.reps.push(rep); return { type: 'rep', full, rep };
    }
    get phase() { return this.state === 'rest' ? 'rest' : 'moving'; }
    noteFault(id) { if (this.state !== 'rest') this.faultsThisRep.add(id); }
  }

  /* ---------------- Fault tracker: persistence + cooldown ---------------- */
  class FaultTracker {
    constructor(faults) { this.faults = faults.filter(f => !f.onRep); this.since = {}; this.lastCue = {}; this.active = new Set(); this.counts = {}; this.timeIn = {}; this.lastT = null; }
    // returns list of fault objects that should be cued now (already debounced)
    update(m, phase, t) {
      const cues = []; const dt = this.lastT ? Math.min(t - this.lastT, 200) : 0; this.lastT = t;
      for (const f of this.faults) {
        const applies = (!f.phase || f.phase === phase) && !!f.check(m);
        if (applies) {
          if (!this.since[f.id]) this.since[f.id] = t;
          const held = t - this.since[f.id];
          if (held >= f.persist) {
            if (!this.active.has(f.id)) { this.active.add(f.id); this.counts[f.id] = (this.counts[f.id] || 0) + 1; }
            this.timeIn[f.id] = (this.timeIn[f.id] || 0) + dt;
            if (!this.lastCue[f.id] || t - this.lastCue[f.id] > f.cooldown) cues.push(f);
          }
        } else { this.since[f.id] = 0; this.active.delete(f.id); }
      }
      cues.sort((a, b) => b.weight - a.weight);
      return cues;
    }
    // call once a cue has actually been spoken/shown; until then it keeps being offered
    ack(id, t) { this.lastCue[id] = t; }
  }

  /* ---------------- Set session: ties it together ---------------- */
  class SetSession {
    constructor(exercise, opts = {}) {
      this.ex = exercise; this.opts = opts; this.target = opts.target ?? exercise.defaultTarget;
      this.ref = null; this.side = 'L'; this.counter = exercise.type === 'reps' ? new RepCounter() : null;
      this.faults = new FaultTracker(exercise.faults);
      this.startT = null; this.lastT = null; this.holdMs = 0; this.goodMs = 0; this.lostMs = 0; this.frames = 0;
      this.repEvents = []; this.repFaultCounts = {}; this.complete = false; this.m = null; this.trace = [];
    }
    calibrate(pts, side) { this.side = side; this.ref = this.ex.calibrate(pts, side, this.opts); }
    ackCue(id, t) { this.faults.ack(id, t); }
    // returns { m, cues:[fault], repEvent, done }
    step(pts, t) {
      if (this.startT === null) this.startT = t;
      const dt = this.lastT ? Math.min(t - this.lastT, 200) : 0; this.lastT = t; this.frames++;
      if (!pts) { this.lostMs += dt; return { m: this.m, cues: [], repEvent: null, done: false }; }
      const m = this.ex.measure(pts, this.side, this.ref); this.m = m;
      let repEvent = null, phase = 'hold';
      if (this.counter) {
        repEvent = this.counter.update(m.p, t); phase = this.counter.phase;
        if (repEvent) {
          for (const f of this.ex.faults.filter(f => f.onRep)) if (f.check(repEvent.rep)) { repEvent.rep.faults.push(f.id); }
          for (const id of repEvent.rep.faults) this.repFaultCounts[id] = (this.repFaultCounts[id] || 0) + 1;
          this.repEvents.push(repEvent);
          if (this.counter.count >= this.target) this.complete = true;
        }
      } else {
        if (m.inPosition) { this.holdMs += dt; if (this.faults.active.size === 0) this.goodMs += dt; }
        if (this.holdMs >= this.target * 1000) this.complete = true;
      }
      const cues = this.faults.update(m, phase, t);
      if (this.counter) for (const id of this.faults.active) this.counter.noteFault(id);
      if (this.frames % 3 === 0) this.trace.push([Math.round(t - this.startT), +(m.p ?? 0).toFixed(2)]);
      // rep-level cues fire once per rep event
      const repCues = repEvent ? repEvent.rep.faults.map(id => this.ex.faults.find(f => f.id === id)).filter(f => f && f.onRep) : [];
      return { m, cues, repCues, repEvent, done: this.complete };
    }
    review() {
      const ex = this.ex; const faultCounts = {}; const tips = [];
      for (const f of ex.faults) {
        const n = f.onRep ? (this.repFaultCounts[f.id] || 0) : (this.faults.counts[f.id] || 0);
        if (n > 0) faultCounts[f.id] = { fault: f, n, ms: this.faults.timeIn[f.id] || 0 };
      }
      let score = 100;
      const out = { exercise: ex.id, name: ex.name, type: ex.type, target: this.target, faults: faultCounts, durationMs: (this.lastT || 0) - (this.startT || 0), trace: this.trace, date: Date.now() };
      if (ex.type === 'reps') {
        const reps = this.counter.reps; const full = reps.filter(r => r.full);
        out.reps = this.counter.count; out.partials = this.counter.partials;
        out.avgTempo = full.length ? full.reduce((s, r) => s + r.duration, 0) / full.length : 0;
        out.avgROM = full.length ? full.reduce((s, r) => s + Math.min(r.peak, 1.2), 0) / full.length : 0;
        out.repList = reps;
        // each fault costs weight×3 per occurrence, capped so one recurring fault can't zero the score
        for (const k in faultCounts) { const fc = faultCounts[k]; score -= Math.min(fc.fault.weight * 3 * fc.n, fc.fault.weight * 12); }
        score -= this.counter.partials * 3;
        if (this.counter.count === 0) score = Math.min(score, 40);
      } else {
        out.holdSec = Math.round(this.holdMs / 100) / 10; out.goodSec = Math.round(this.goodMs / 100) / 10;
        const goodFrac = this.holdMs ? this.goodMs / this.holdMs : 0;
        score = Math.round(40 + 60 * goodFrac);
        if (this.holdMs < this.target * 1000) score -= Math.round(20 * (1 - this.holdMs / (this.target * 1000)));
      }
      score = clamp(Math.round(score), 0, 100); out.score = score;
      const sorted = Object.values(faultCounts).sort((a, b) => b.fault.weight * b.n - a.fault.weight * a.n);
      for (const fc of sorted.slice(0, 3)) tips.push({ label: fc.fault.label, tip: fc.fault.tip, n: fc.n });
      out.tips = tips;
      out.headline = score >= 90 ? 'Excellent form' : score >= 75 ? 'Good set — one thing to tidy up' : score >= 55 ? 'Decent — a couple of things to work on' : 'Let\'s rebuild the basics';
      out.trackingLossPct = this.frames ? Math.round(100 * this.lostMs / Math.max(1, out.durationMs)) : 0;
      return out;
    }
  }

  const FormEngine = { LM, SIDE, CONNECTIONS, fromVertical, armAngle, tiltOf, lineTilt, headTilt, armRot, elbowGap, outward, OneEuro, PoseSmoother, angle, lineOffset, dist, mid, nearSide, orientation, framing, bodyHeight, visOf, EXERCISES, RepCounter, FaultTracker, SetSession, REST, ATTEMPT, FULL, clamp, lerp };
  if (typeof module !== 'undefined' && module.exports) module.exports = FormEngine; else root.FormEngine = FormEngine;
})(typeof window !== 'undefined' ? window : globalThis);
