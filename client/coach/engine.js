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
    /* `cap` limits the speed the filter is allowed to read off itself before it opens up. A point
       whose own reading is mostly noise (a toe) reads that noise as speed, opens its own filter and
       lets the next frame of noise straight through; capping it at what the joint it hangs off is
       actually doing breaks that loop. */
    filter(x, t, cap) {
      if (this.x === null || this.t === null) { this.x = x; this.t = t; this.dx = 0; return x; }
      let dt = (t - this.t) / 1000; if (dt <= 0) dt = 1 / 30; this.t = t;
      const dxRaw = (x - this.x) / dt;
      const aD = OneEuro.alpha(this.dCutoff, dt);
      this.dx = aD * dxRaw + (1 - aD) * this.dx;
      const speed = Number.isFinite(cap) ? Math.min(Math.abs(this.dx), cap) : Math.abs(this.dx);
      const cutoff = this.minCutoff + this.beta * speed;
      const a = OneEuro.alpha(cutoff, dt);
      this.x = a * x + (1 - a) * this.x;
      return this.x;
    }
    reset() { this.x = null; this.t = null; this.dx = 0; }
  }

  /* Smooths all 33 landmarks; freezes low-confidence joints instead of letting them fly.
     A joint the model is unsure of (the arm and leg on the far side of a side-on body, mostly
     hidden behind the near one) also gets smoothed harder the less sure it is, so where the model
     guesses a different spot every frame the drawn joint drifts instead of flailing; and each
     joint carries `seen`, whether it is sure enough to draw at all, with hysteresis so a limb on
     the edge of visibility does not flicker (settings.json skeleton.show / skeleton.dim). */
  const SHOW_DFLT = 0.5, DIM_DFLT = 0.7;
  const skel = () => (SETTINGS && SETTINGS.skeleton) || {};
  /* The ends of the limbs are the model's least certain points: a heel or a toe is a few pixels
     near the floor, side-on the two feet overlap, and the landmark model reads them off a crop of
     the whole person that rescales as the body moves. On a real glute-bridge set the near toe
     travelled twice as far per frame as the ankle it hangs off while the feet were planted, and
     its apparent distance from the ankle swung between 9 and 131 pixels — the point sliding along
     the foot, not the foot moving. Three things below are for that, and the same three live in
     replay.js smoothFrames, which must stay identical (test/replay.test.js holds it to that).
       1. those points are smoothed harder (EXTREMITY_SCALE);
       2. a point cannot jump to an implausible distance from the joint it hangs off (BONE):
          the ankle→toe length is a fact about the person, learnt over a second and a half, and a
          frame that breaks it is an outlier to hold through, like a low-confidence one;
       3. a landmark the move says stays still (setStable) is locked once it has stopped moving,
          and released the moment it plainly moves. */
  const EXTREMITY_SCALE = { 17: 0.5, 18: 0.5, 19: 0.5, 20: 0.5, 21: 0.5, 22: 0.5, 29: 0.5, 30: 0.5, 31: 0.5, 32: 0.5 };
  const BONE = { 17: 15, 18: 16, 19: 15, 20: 16, 21: 15, 22: 16, 29: 27, 30: 28, 31: 27, 32: 28 };
  /* the length is the median of the last BONE_KEEP accepted frames (about 1.5 s), enforced only once
     BONE_MIN of them are in, and a break in it is held through for at most BONE_HOLD frames — after
     that the new length is real (a foot turning toward the camera) and is learnt */
  const BONE_TOL = 0.35, BONE_KEEP = 45, BONE_MIN = 15, BONE_HOLD = 4;
  /* 4. how fast a hand or foot point is allowed to believe it is moving: what the joint it hangs
     off is doing, times FOLLOW (the end of a limb swings further than the joint does), plus FLOOR
     for what it can do on its own — a foot pitching about a still ankle, a hand turning at a still
     wrist. FLOOR is in frame heights per second: a heel genuinely coming off the floor moves about
     0.02 of the frame in a second, while the toe landmark's own jitter reads six times that, so the
     honest movement still opens the filter and the jitter no longer does. */
  const LIMB_FOLLOW = 1.5, LIMB_FLOOR = 0.02;
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const STILL_STEP = 0.004, STILL_FRAMES = 10, RELEASE_STEP = 0.025, RELEASE_FRAMES = 3;
  class PoseSmoother {
    constructor(opts = {}) {
      this.minCutoff = opts.minCutoff ?? 1.0;
      this.beta = opts.beta ?? 3.0;
      this.visFloor = opts.visFloor ?? 0.35;
      this.jumpLimit = opts.jumpLimit ?? 0.28;
      this.stable = new Set(opts.stable || []);      // landmark indices the move says do not move
      this.bone = []; this.boneHold = []; this.lock = []; this.stillFor = []; this.awayFor = [];
      this.sureAt = opts.sureAt ?? 0.8;       // fully trusted from here up; below, the smoothing tightens towards visFloor
      this.show = opts.show ?? skel().show ?? SHOW_DFLT;
      this.filters = []; this.vis = []; this.holds = []; this.prev = []; this.seen = [];
      this.pts = null; this.lastT = null;
      for (let i = 0; i < 33; i++) {
        this.filters.push([new OneEuro(this.minCutoff, this.beta), new OneEuro(this.minCutoff, this.beta), new OneEuro(this.minCutoff * 0.6, this.beta)]);
        this.vis.push(0); this.holds.push(0); this.prev.push(null); this.seen.push(false);
        this.bone.push([]); this.boneHold.push(0); this.lock.push(null); this.stillFor.push(0); this.awayFor.push(0);
      }
    }
    /* the landmarks this move says stay put (BlazePose indices); they are locked once still */
    setStable(indices) { this.stable = new Set(indices || []); this.lock.fill(null); this.stillFor.fill(0); this.awayFor.fill(0); }
    setSmoothing(minCutoff, beta) {
      this.minCutoff = minCutoff; this.beta = beta;
      for (const f of this.filters) { f[0].minCutoff = minCutoff; f[1].minCutoff = minCutoff; f[2].minCutoff = minCutoff * 0.6; f[0].beta = f[1].beta = f[2].beta = beta; }
    }
    reset() { for (const f of this.filters) f.forEach(o => o.reset()); this.pts = null; this.lastT = null; this.prev.fill(null); this.holds.fill(0); this.seen.fill(false); for (const b of this.bone) b.length = 0; this.boneHold.fill(0); this.lock.fill(null); this.stillFor.fill(0); this.awayFor.fill(0); }
    // landmarks: array of {x,y,z,visibility} normalized (0..1). aspect = width/height (x is scaled to be isotropic).
    update(landmarks, t, aspect = 1) {
      if (!landmarks) { return this.pts; }
      const out = new Array(33);
      for (let i = 0; i < 33; i++) {
        const l = landmarks[i];
        const v = l.visibility ?? l.score ?? 1;
        this.vis[i] = 0.7 * this.vis[i] + 0.3 * v;
        /* on once the smoothed confidence clears the line, off only once it has dropped well under it */
        this.seen[i] = this.seen[i] ? this.vis[i] >= this.show - 0.1 : this.vis[i] >= this.show;
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
        /* 2. the point's distance from the joint it hangs off (raw, this frame) against what that
           distance has been: an impossible change is held through, and the length is learnt only
           from frames that kept it */
        const parent = BONE[i];
        if (useRaw && parent != null) {
          const pl = landmarks[parent]; const len = Math.hypot(x - pl.x * aspect, y - pl.y);
          const hist = this.bone[i];
          const known = hist.length >= BONE_MIN ? median(hist) : null;
          if (known != null && Math.abs(len - known) > BONE_TOL * known && this.boneHold[i] < BONE_HOLD && prev) { useRaw = false; this.boneHold[i]++; }
          else {
            /* held through BONE_HOLD frames and still there: the new length is real (a foot turning
               toward the camera) and replaces what was known, rather than outvoting it over seconds */
            if (this.boneHold[i] >= BONE_HOLD) hist.length = 0;
            this.boneHold[i] = 0; hist.push(len); if (hist.length > BONE_KEEP) hist.shift();
          }
        }
        if (!useRaw) { out[i] = { x: prev.x, y: prev.y, z: prev.z, v: this.vis[i], held: true, seen: this.seen[i] }; continue; }
        const f = this.filters[i];
        /* an unsure joint is smoothed harder: lower cutoff, and speed opens the filter less */
        const k = Math.min(1, Math.max(0.12, (this.vis[i] - this.visFloor) / Math.max(1e-3, this.sureAt - this.visFloor)));
        const c = this.minCutoff * k * k * (EXTREMITY_SCALE[i] || 1), b = this.beta * k;   /* 1. */
        f[0].minCutoff = c; f[1].minCutoff = c; f[2].minCutoff = c * 0.6; f[0].beta = f[1].beta = f[2].beta = b;
        /* the joint this one hangs off is filtered first (every parent has the lower index), so its
           speed is this frame's */
        const pf = parent != null ? this.filters[parent] : null;
        const capx = pf ? LIMB_FLOOR + LIMB_FOLLOW * Math.abs(pf[0].dx) : undefined;
        const capy = pf ? LIMB_FLOOR + LIMB_FOLLOW * Math.abs(pf[1].dx) : undefined;
        const sx = f[0].filter(x, t, capx), sy = f[1].filter(y, t, capy), sz = f[2].filter(z, t, capy);
        let ox = sx, oy = sy, locked = false;
        /* 3. a landmark the move says stays still: once it has, hold it there; a decisive move away
           (further than the release step, for a few frames running) lets it go again */
        if (this.stable.has(i)) {
          const L = this.lock[i];
          if (L) {
            const away = Math.hypot(x - L.x, y - L.y);
            this.awayFor[i] = away > RELEASE_STEP ? this.awayFor[i] + 1 : 0;
            if (this.awayFor[i] >= RELEASE_FRAMES) { this.lock[i] = null; this.stillFor[i] = 0; }
            else { ox = L.x; oy = L.y; locked = true; }
          } else if (prev) {
            const stepd = Math.hypot(sx - prev.x, sy - prev.y);
            this.stillFor[i] = stepd < STILL_STEP ? this.stillFor[i] + 1 : 0;
            if (this.stillFor[i] >= STILL_FRAMES) { this.lock[i] = { x: sx, y: sy }; this.awayFor[i] = 0; ox = sx; oy = sy; locked = true; }
          }
        }
        out[i] = { x: ox, y: oy, z: sz, v: this.vis[i], held: false, locked, seen: this.seen[i] };
        this.prev[i] = { x: sx, y: sy, z: sz };
      }
      this.pts = out; this.lastT = t;
      return out;
    }
  }
  /* Whether a landmark is sure enough to draw: the smoother's call when it has made one (with
     hysteresis), else its confidence against skeleton.show; and whether it is sure enough to draw
     at full strength (skeleton.dim). Raw model landmarks ({visibility}) and smoothed ones ({v}) both work. */
  const visOfPt = (p) => p.v ?? p.visibility ?? p.score ?? 1;
  const seenOne = (p) => !!p && (p.seen != null ? p.seen : visOfPt(p) >= (skel().show ?? SHOW_DFLT));
  /* a joint hangs off the one above it: a foot is only drawn under a knee that is drawn, a hand
     under an elbow, so the far leg does not appear as a foot floating on its own */
  const PARENT = { 13: 11, 14: 12, 15: 13, 16: 14, 17: 15, 18: 16, 19: 15, 20: 16, 21: 15, 22: 16, 25: 23, 26: 24, 27: 25, 28: 26, 29: 27, 30: 28, 31: 27, 32: 28 };
  function seen(pts, i) {
    if (typeof i !== 'number') return seenOne(pts);                    // one point on its own
    for (let j = i; j != null; j = PARENT[j]) if (!seenOne(pts[j])) return false;
    return true;
  }
  function sure(pts, i) { const p = typeof i === 'number' ? pts[i] : pts; return !!p && visOfPt(p) >= (skel().dim ?? DIM_DFLT); }

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
  /* ---------------- Camera tolerance ----------------
     Every measurement is 2-D image geometry, so a phone that is not where the move asks for it
     bends the numbers in known ways. Three corrections, all applied to the points the move
     measures (never to the ones drawn over the video, which must stay on the body):

       level    — the phone is rolled about its own lens axis (propped crooked), so "vertical" in
                  the image is not gravity. Rotating every point by the roll puts it back. The
                  roll comes from the phone's motion sensor when it has one, and otherwise from
                  the body at calibration: a standing or sitting trunk is upright, a lying one is
                  along the floor.
       yaw      — the person is not square to the lens. Estimated from the shoulder and hip lines:
                  MediaPipe gives each point a depth (z), so the angle of the shoulder line to the
                  camera is read directly; without depth the width-to-torso ratio gives a rougher
                  figure from population proportions, good enough to say "turn a little" but not
                  to correct with.
       unfore-  — off-axis by yaw, everything in the plane of the move is squashed in x by
       shorten    cos(yaw). Dividing x by cos(yaw) undoes it. Only done when the yaw came from
                  depth, i.e. was measured rather than assumed.
     Numbers come from settings.json → camera. */
  const rad = d => d * Math.PI / 180;
  function rotatePts(pts, degrees, cx, cy) {
    if (!pts || !degrees) return pts;
    const c = Math.cos(rad(degrees)), s = Math.sin(rad(degrees));
    return pts.map(p => p ? { ...p, x: cx + (p.x - cx) * c - (p.y - cy) * s, y: cy + (p.x - cx) * s + (p.y - cy) * c } : p);
  }
  function scaleX(pts, k, cx) {
    if (!pts || !k || k === 1) return pts;
    return pts.map(p => p ? { ...p, x: cx + (p.x - cx) * k } : p);
  }
  /* Roll of the image, in degrees: where gravity points in the picture, measured from straight
     down (y-down coordinates: roll = atan2(down.x, down.y)). rotatePts(pts, +roll) levels it.
     From the body at the calibration frame: a standing or sitting trunk points along gravity; a
     lying one lies across it. null when the posture gives no safe reference. */
  function rollFromBody(pts, posture) {
    if (!pts) return null;
    const sh = mid(pts[11], pts[12]), hp = mid(pts[23], pts[24]);
    const dx = hp.x - sh.x, dy = hp.y - sh.y;
    if (Math.hypot(dx, dy) < 0.05) return null;
    if (posture === 'standing' || posture === 'sitting') return deg(Math.atan2(dx, dy));           // shoulder→hip is "down"
    if (posture === 'lying' || posture === 'prone' || posture === 'sidelying') {
      const a = deg(Math.atan2(dy, dx)); const t = a > 90 ? a - 180 : a < -90 ? a + 180 : a;       // trunk's angle from the floor line, either way the head points
      return -t;                                                                                   // the floor is 90° from "down", so the picture's tilt is the opposite sign
    }
    return null;                                                                                   // kneeling covers upright and all-fours; no safe assumption
  }
  /* Yaw, degrees away from the ideal view, from the shoulder and hip lines. With depth (z) it is
     measured outright. Without it, it is guessed from how the width-to-torso ratio has changed
     since calibration (ratio0): facing the camera the width shrinks by cos(yaw) as they turn, a
     self-calibrating read; side-on it grows from near nothing, so population proportions
     (widthRatio) stand in. A guess is good enough to say "turn back", not to correct with. */
  function yawOf(pts, view, cam, ratio0) {
    if (!pts) return null;
    const hasZ = [11, 12, 23, 24].some(i => Math.abs(pts[i].z || 0) > 1e-4);
    if (hasZ) {
      const line = (a, b) => { const dx = Math.abs(pts[a].x - pts[b].x), dz = Math.abs(pts[a].z - pts[b].z); return view === 'front' ? deg(Math.atan2(dz, dx)) : deg(Math.atan2(dx, dz)); };
      /* shoulders are the wider, better-seen pair; hips steady it */
      return { deg: 0.65 * line(11, 12) + 0.35 * line(23, 24), measured: true, ratio: orientation(pts).ratio };
    }
    const o = orientation(pts); const W = cam.widthRatio || 0.55;
    const r = view === 'front' ? Math.min(1, o.ratio / (ratio0 || W)) : Math.min(1, Math.max(0, o.ratio - (ratio0 || 0)) / W);
    return { deg: deg(view === 'front' ? Math.acos(r) : Math.asin(r)), measured: false, ratio: o.ratio };
  }
  /* The corrected points a move measures: levelled by the roll, then un-squashed by the yaw. The
     pivot is the mid-hip so rotating and scaling do not move the body around the frame. */
  function correctPts(pts, corr) {
    if (!pts || !corr) return pts;
    const hp = mid(pts[23], pts[24]); let out = pts;
    if (corr.roll) out = rotatePts(out, corr.roll, hp.x, hp.y);
    if (corr.stretch && corr.stretch !== 1) out = scaleX(out, corr.stretch, hp.x);
    return out;
  }
  const Camera = { rotatePts, scaleX, rollFromBody, yawOf, correctPts };

  /* ---------------- How the head is drawn ----------------
     The pose model gives a nose and two ears, no skull. Joining them (nose–ear, ear–shoulder) makes
     a small triangle that reads as a face from the side and as a bow-tie from the front, which is
     why it is worth a choice. headShape returns a circle and a neck line in the same normalised
     coordinates as the landmarks, so every drawer — the live camera, the replay, the Studio — puts
     the head in the same place. The style comes from settings.json (skeleton.head).
       face   the nose-and-ears triangle the model gives, joints included (what it has always been)
       ball   a filled circle on the head, and a neck down to the shoulders
       circle the same circle, outlined, so the video shows through it
       dot    one dot where the head is, and a neck
       none   a neck stub and nothing else                                                   */
  const HEAD_STYLES = ['face', 'ball', 'circle', 'dot', 'none'];
  const HEAD_LINKS = [[7, 11], [8, 12], [0, 7], [0, 8]];
  function headShape(pts, at) {
    const g = (i) => (pts[i] && (pts[i].v ?? pts[i].visibility ?? 1) >= 0.3 ? pts[i] : null);
    const nose = g(0), eL = g(7), eR = g(8), sL = g(11), sR = g(12);
    if (!sL && !sR) return null;
    const neck = sL && sR ? mid(sL, sR) : (sL || sR);
    const c = eL && eR ? mid(eL, eR) : nose || null;
    if (!c) return null;
    /* the ears span the skull across; from a true side view they sit almost on top of each other,
       so the neck distance carries the estimate instead */
    const span = eL && eR ? dist(eL, eR) : 0;
    const up = dist(c, neck);
    const r = Math.max(span * 0.62, up * 0.42, 0.012);
    return { x: c.x, y: c.y, r, neck: { x: neck.x, y: neck.y } };
  }

  function bodyHeight(pts) {
    let miny = 1, maxy = 0; for (const i of [0, 11, 12, 23, 24, 25, 26, 27, 28]) { miny = Math.min(miny, pts[i].y); maxy = Math.max(maxy, pts[i].y); }
    return maxy - miny;
  }
  /* The coach's positioning checks, without the words: is the body seen well enough, in frame,
     facing the right way and big enough for this move. ex may be partial (a Studio draft): with no
     view any orientation passes, with no required list the trunk and legs stand in. */
  const BODY_DFLT = [0, 11, 12, 23, 24, 25, 26, 27, 28];
  /* Side-on, the arm and leg away from the camera are behind the body: the model guesses at them,
     and on a move that works both sides together they say nothing the near limb does not. A move
     that sets farSide "ignore" has them left out — not drawn, not required in frame, and (checked
     when the move is compiled) not measured. The torso pairs are not "the far side" in this sense:
     both shoulders and both hips are what the trunk is read from, and both stay visible. */
  const FAR_LIMB = { L: [13, 15, 17, 19, 21, 25, 27, 29, 31], R: [14, 16, 18, 20, 22, 26, 28, 30, 32] };
  const farLimb = (nearS) => FAR_LIMB[nearS === 'L' ? 'R' : 'L'];
  function positionCheck(pts, ex, aspect = 1) {
    ex = ex || {};
    let required = ex.required && ex.required.length ? ex.required : BODY_DFLT;
    /* a limb the move ignores is not a limb the person has to get into frame */
    if (ex.farSide === 'ignore') { const far = new Set(farLimb(nearSide(pts))); required = required.filter((i) => !far.has(i)); }
    const visOk = visOf(pts, required) > 0.55;
    const edges = framing(pts, required, aspect); const frameOk = edges.length === 0;
    const o = orientation(pts);
    const accept = !ex.view ? [o.view] : ex.camera && ex.camera.posture === 'sidelying' ? [ex.view, 'unclear'] : [ex.view];
    const orientOk = accept.includes(o.view);
    const size = ex.upperBody ? dist(pts[0], mid(pts[23], pts[24])) : bodyHeight(pts); const sizeOk = size > (ex.upperBody ? 0.28 : 0.22);
    return { ok: visOk && frameOk && orientOk && sizeOk, visOk, frameOk, edges, orientOk, view: o.view, ratio: o.ratio, sizeOk };
  }
  /* When a recording is ready to calibrate: the body has passed positionCheck and the hips have
     been still for holdMs — the coach's positioning step, one smoothed frame at a time. step()
     returns the time it settled at, once; null before and after. A phone video starts wherever the
     phone did (walking in, lying down), so a take from one calibrates here, not at a fixed moment. */
  class Settle {
    constructor(ex, { holdMs = 1200, moveTol = 0.012 } = {}) { this.ex = ex; this.holdMs = holdMs; this.moveTol = moveTol; this.since = 0; this.prevHip = null; this.at = null; }
    step(pts, t, aspect = 1) {
      if (this.at != null) return null;
      if (!pts || !positionCheck(pts, this.ex, aspect).ok) { this.since = 0; this.prevHip = null; return null; }
      const hip = mid(pts[23], pts[24]);
      const moving = this.prevHip && dist(hip, this.prevHip) > this.moveTol; this.prevHip = hip;
      if (moving || !this.since) this.since = t;
      if (t - this.since >= this.holdMs) { this.at = t; return t; }
      return null;
    }
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
  /* Rep thresholds, band scale, scoring: read from data/settings.json through configure(). Nothing
     here has a built-in value — the file is the one place those numbers live. */
  let SETTINGS = null;
  const T = {};                                            // T.rest, T.attempt, T.full
  const settingsOr = () => { if (!SETTINGS) throw new Error('engine: configure(settings) has not run — data/settings.json must load before any move'); return SETTINGS; };
  function configure(s) {
    if (!s || !s.rep || !s.band || !s.score) throw new Error('settings.json needs rep, band and score sections');
    SETTINGS = s; T.rest = s.rep.rest; T.attempt = s.rep.attempt; T.full = s.rep.full;
  }

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

  // Resistance band grades — the colour scale lives in settings.json (band). 'none' = bodyweight only.
  const BAND = (dflt) => { const b = settingsOr().band; return { key: 'band', label: b.label, values: b.values.slice(), default: dflt, labels: { ...b.labels }, swatches: { ...b.swatches } }; };
  /* Hand weight in kilograms — the steps live in settings.json (weight); 'custom' lets the person
     type their own, and a number that is not one of the steps is that custom entry. */
  const WEIGHT = (dflt) => { const w = settingsOr().weight || { label: 'Weight', unit: 'kg', values: ['none', 1, 2, 5, 'custom'], labels: {} }; return { key: 'weight', label: w.label, values: w.values.slice(), default: dflt, labels: { ...w.labels }, custom: w.values.includes('custom'), customUnit: w.unit || 'kg' }; };
  // Auto side selection that does not flicker at rest: keep the current side unless the other one moves clearly more (hysteresis of 8°).
  function stickySide(ref, rL, rR) { const cur = ref.autoSide || (rL >= rR ? 'L' : 'R'); const next = cur === 'L' ? (rR > rL + 8 ? 'R' : 'L') : (rL > rR + 8 ? 'L' : 'R'); ref.autoSide = next; return next; }
  /* ---- exercise library -------------------------------------------------
     Moves are not defined here. Each one lives in its own file under
     coach/library/ and registers itself through coach/exercise-library.js,
     which validates that it carries every detail the app renders. This
     hands those files the kinematics they need; EXERCISES is the library's
     own array, so it stays live as moves register.
     -------------------------------------------------------------------- */
  const library = (typeof module !== 'undefined' && module.exports)
    ? require('./exercise-library.js') : root.ExerciseLibrary;
  if (!library) throw new Error('engine.js: load coach/exercise-library.js first');
  library.kinematics = {
    LM, SIDE, BAND, WEIGHT,
    get REST() { return settingsOr() && T.rest; }, get ATTEMPT() { return settingsOr() && T.attempt; }, get FULL() { return settingsOr() && T.full; },
    get settings() { return settingsOr(); },
    angle, armAngle, armRot, clamp, deg, dist, elbowGap, fromVertical, headTilt,
    lineOffset, lineTilt, mid, outward, pelvisTilt, segTilt, sideJoints, stickySide, trunkLean,
  };
  const EXERCISES = library.list;

  /* ---------------- Rep counter (hysteresis state machine) ---------------- */
  class RepCounter {
    constructor(opts = {}) {
      settingsOr(); this.rest = opts.rest ?? T.rest; this.attempt = opts.attempt ?? T.attempt; this.full = opts.full ?? T.full;
      this.minRep = opts.minRep ?? 600; this.turnHyst = opts.turnHyst ?? 0.12;
      /* a rep with a hold: the top only counts once p has stayed at or above `full` for holdMs */
      this.holdMs = opts.holdMs || 0; this.topMs = 0; this.lastT = null; this.holdDone = false;
      /* A rep is over when the reading comes back below `rest`. It is also over when the reading
         settles: the person who lowers to half way and rests there has finished the rep, and the
         next rise is the next rep. `floor` is the level a rep was closed at, so the rise that
         follows is judged from there and a descent from it is not a rep of its own. */
      this.stillMs = opts.stillMs ?? 1000; this.stillTol = opts.stillTol ?? 0.04; this.stillP = null; this.stillSince = 0; this.floor = 0; this.pEnter = 0;
      this.state = 'rest'; this.p = 0; this.peak = 0; this.t0 = 0; this.tPeak = 0; this.trough = 0; this.tTrough = 0;
      this.count = 0; this.partials = 0; this.reps = []; this.faultsThisRep = new Set();
      this.alpha = 0.4;
    }
    // returns event: null | {type:'rep', full, rep} | {type:'phase', ...}
    update(pRaw, t) {
      this.p = this.p === null ? pRaw : this.alpha * pRaw + (1 - this.alpha) * this.p;
      const p = this.p; let ev = null;
      const dt = this.lastT === null ? 0 : Math.min(Math.max(0, t - this.lastT), 200); this.lastT = t;
      if (this.holdMs && this.state !== 'rest') { if (p >= this.full) { this.topMs += dt; if (!this.holdDone && this.topMs >= this.holdMs) { this.holdDone = true; ev = { type: 'held', ms: this.topMs }; } } }
      if (this.stillP === null || Math.abs(p - this.stillP) > this.stillTol) { this.stillP = p; this.stillSince = t; }
      const settled = t - this.stillSince >= this.stillMs;
      switch (this.state) {
        case 'rest':
          if (p < this.rest) this.floor = 0;
          if (p > this.attempt) { this.state = 'out'; this.t0 = t; this.peak = p; this.tPeak = t; this.faultsThisRep = new Set(); this.topMs = 0; this.holdDone = false; this.pEnter = this.floor; }
          break;
        case 'out':
          if (p > this.peak) { this.peak = p; this.tPeak = t; }
          else if (p < this.peak - this.turnHyst) { this.state = 'back'; this.trough = p; this.tTrough = t; }
          break;
        case 'back':
          if (p < this.trough) { this.trough = p; this.tTrough = t; }
          if (p > this.peak + 0.05) { this.state = 'out'; this.peak = p; this.tPeak = t; }
          else if (p < this.rest) { ev = this._finish(t, 'rest'); this.floor = 0; }
          else if (this.trough < this.attempt && p > this.trough + this.turnHyst) {
            // bounced at the bottom without fully resting (e.g. no lock-out) — close the rep at the trough and start the next
            ev = this._finish(this.tTrough, 'out'); this.floor = this.trough; this.pEnter = this.floor; this.t0 = this.tTrough; this.peak = p; this.tPeak = t; this.faultsThisRep = new Set(); this.topMs = 0; this.holdDone = false;
          }
          else if (settled && p < this.full - this.turnHyst && p <= this.trough + this.stillTol) {
            // came part of the way back and stayed there: the rep is over where it settled
            ev = this._finish(this.tTrough, 'rest', true); this.floor = p;
          }
          break;
      }
      return ev;
    }
    _finish(t, next, sure) {
      const duration = t - this.t0, reached = this.peak >= this.full, held = !this.holdMs || this.topMs >= this.holdMs, full = reached && held;
      const rep = { n: 0, full, peak: this.peak, endP: this.p, duration, tDown: this.tPeak - this.t0, tUp: t - this.tPeak, t, faults: [...this.faultsThisRep], topMs: Math.round(this.topMs), shortHold: reached && !held };
      this.state = next;
      if (duration < this.minRep && !sure) return null;              /* a second's settle says the rep was real, however quick the rise */
      if (this.peak < this.pEnter + this.turnHyst) return null;     /* never rose from where the last rep was closed: a descent, not a rep */
      if (full) { this.count++; rep.n = this.count; } else this.partials++;
      this.reps.push(rep); return { type: 'rep', full, rep };
    }
    get phase() { return this.state === 'rest' ? 'rest' : 'moving'; }
    /* at the top of a rep-with-hold: how long it has been held so far, else null */
    get holding() { return this.holdMs && this.state !== 'rest' && this.p >= this.full ? this.topMs : null; }
    noteFault(id) { if (this.state !== 'rest') this.faultsThisRep.add(id); }
  }

  /* ---------------- Fault tracker: persistence + cooldown ---------------- */
  class FaultTracker {
    constructor(faults) { this.faults = faults.filter(f => !f.onRep); this.since = {}; this.lastCue = {}; this.cued = {}; this.active = new Set(); this.counts = {}; this.timeIn = {}; this.lastT = null; }
    // returns list of fault objects that should be cued now (already debounced)
    update(m, phase, t) {
      const cues = []; const dt = this.lastT ? Math.min(t - this.lastT, 200) : 0; this.lastT = t;
      for (const f of this.faults) {
        const applies = (!f.phase || f.phase === phase) && !!f.check(m);
        if (applies) {
          if (!this.since[f.id]) this.since[f.id] = t;
          const held = t - this.since[f.id];
          /* how long it must hold: a fault whose landmarks the model is unsure of asks for longer
             (spec.js persistFor), so a far limb flickering in and out does not cue */
          if (held >= (f.persistFor ? f.persistFor(m) : f.persist)) {
            if (!this.active.has(f.id)) { this.active.add(f.id); this.counts[f.id] = (this.counts[f.id] || 0) + 1; }
            this.timeIn[f.id] = (this.timeIn[f.id] || 0) + dt;
            if (this.due(f, t)) cues.push(f);
          }
        } else { this.since[f.id] = 0; this.active.delete(f.id); }
      }
      /* The heaviest cue first — but a fault that has not been said yet in this set comes before
         one that has, however heavy: two faults on cooldown otherwise take turns for the whole
         set and a third is never heard. */
      cues.sort((a, b) => ((this.cued[a.id] || 0) - (this.cued[b.id] || 0)) || (b.weight - a.weight));
      return cues;
    }
    /* A cue is due when it has not been spoken inside its own cooldown and has not already been
       said as often as this set allows. Live cues go through update(); rep-level cues are checked
       from step(), because they are raised at the rep event rather than frame by frame. */
    due(f, t) {
      if (Number.isFinite(f.maxCues) && (this.cued[f.id] || 0) >= f.maxCues) return false;
      return !this.lastCue[f.id] || t - this.lastCue[f.id] > (f.cooldown || 0);
    }
    // call once a cue has actually been spoken/shown; until then it keeps being offered
    ack(id, t) { this.lastCue[id] = t; this.cued[id] = (this.cued[id] || 0) + 1; }
  }

  /* ---------------- Set session: ties it together ---------------- */
  class SetSession {
    constructor(exercise, opts = {}) {
      this.ex = exercise; this.opts = opts; this.target = opts.target ?? exercise.defaultTarget;
      this.ref = null; this.side = 'L'; this.counter = exercise.type === 'reps' ? new RepCounter(exercise.repHold ? { holdMs: exercise.repHold * 1000 } : {}) : null;
      this.faults = new FaultTracker(exercise.faults);
      this.startT = null; this.lastT = null; this.holdMs = 0; this.goodMs = 0; this.lostMs = 0; this.frames = 0;
      this.repEvents = []; this.repFaultCounts = {}; this.complete = false; this.m = null; this.trace = [];
      this.pHist = []; this.calT = null; this.rebases = 0;
      this.restP = null; this.restSince = 0; this.restarts = 0;
      /* what each measurement does on its own while the person is still (see noteQuiet) */
      this.quiet = []; this.pauses = []; this.noise = null; this.qP = null; this.qSince = 0;
      /* the set-up faults true of the position the NEXT rep starts from, and whether they have
         already been counted (the check before the count-in counts its own) */
      this.startPend = []; this.startPendCounted = false; this.startChecked = false; this.restFrom = 0;
    }
    calibrate(pts, side) { this.side = side; this.ref = this.ex.calibrate(pts, side, this.opts); this.calT = this.lastT; this.pHist = []; }
    /* The start position was read while the person was still, but still is not the same as ready:
       someone who lies down with the knees pulled up, is read there, then settles into the real
       start reads half a rep up before they have moved — and never comes back below the resting
       threshold, so no rep ever closes. Before the first rep, a reading that has sat still for a
       second and a half somewhere well above the start is that start; the baselines are read again
       there and the counter begins from it. Only before the first rep: after one, a level the
       person rests at between reps is the "return" rule's business, not a new start. */
    rebaseIfSettled(pts, p, t) {
      if (!this.counter || this.counter.reps.length || this.rebases >= 2 || (this.ref && this.ref.shown != null)) return false;   /* a demonstrated target lives on the ref and would be lost */
      if (this.calT === null) this.calT = t;                       /* calibrated before the first step: the clock starts here */
      this.pHist.push([t, p]); while (this.pHist.length && t - this.pHist[0][0] > 1500) this.pHist.shift();
      if (t - this.calT < 1500 || this.pHist.length < 5 || t - this.pHist[0][0] < 1400) return false;
      let lo = Infinity, hi = -Infinity; for (const [, q] of this.pHist) { lo = Math.min(lo, q); hi = Math.max(hi, q); }
      if (hi - lo > 0.06 || lo < 0.2 || hi > this.counter.full - 0.1) return false;
      this.calibrate(pts, this.side); this.calT = t; this.rebases++;
      this.counter = new RepCounter(this.ex.repHold ? { holdMs: this.ex.repHold * 1000 } : {});
      return true;
    }
    /* The start position, judged before the set starts (see spec.js checkStart). The coach calls
       this while the person is holding still; what it finds is said then, not during the reps. */
    startCheck(pts, side) { return this.ex.checkStart ? this.ex.checkStart(pts, side || this.side, this.opts) : []; }
    /* A set-up fault that was still true when the set began belongs in the review like any other,
       so it is counted here — once, whatever the coach had to say about it beforehand. It is also
       what the first rep starts from, so it is carried forward as that rep's start, already counted. */
    noteStart(ids, t) {
      for (const id of ids || []) { this.faults.counts[id] = (this.faults.counts[id] || 0) + 1; this.startFaults = [...new Set([...(this.startFaults || []), id])]; }
      this.startPend = [...(ids || [])]; this.startPendCounted = true; this.startChecked = true;
    }
    /* ---------- the position each rep starts from ----------
       A set-up fault is not only a thing about the beginning of a set. Feet creep out, a heel
       shifts, a knee is already bent on the sixth rep and was not on the first — and read once,
       before the count-in, none of that is ever seen. So the same checks run again on the position
       each rep actually starts from: the still moment before it, which is the frame that rep is
       measured from anyway. What they find is attached to that rep, so the review and the Studio
       can say which reps began wrong rather than only that the set did.

       Checked once per pause, not once per frame: checkStart calibrates a throwaway reference of
       its own, which is real work, and the answer cannot change while the person is still. */
    checkRepStart(pts, t) {
      if (!this.counter || !this.ex.checkStart || this.startChecked) return;
      this.startChecked = true;
      let ids = []; try { ids = this.startCheck(pts, this.side).map((f) => f.id); } catch (e) { return; }
      this.startPend = ids; this.startPendCounted = false;
    }
    /* ---------- what a measurement is worth ----------
       A threshold is only meaningful against a reading that holds still when the body does. Some
       do: a hip angle read off shoulder, hip and knee sits within half a degree between reps. Some
       do not: the heel and toe landmarks are a few pixels each, near the floor, on a foot the body
       half hides, and the pitch read off them wanders a couple of percent of the shin with the
       feet flat on the mat — so a fault set to fire at 1.5 fires on a still foot, every rep, and
       spends the set's cues on nothing. Filtering does not reach it: the wander is slower than a
       second, so a low-pass tight enough to remove it would lag a real heel lift by as long.
       What does work is knowing it. Between reps the body is still by definition, so every reading
       is sampled there, and the spread of those samples is that measurement's own wobble. A fault
       then has to clear its threshold AND the wobble (spec.js `over`), which leaves a clean
       measurement judged exactly as before and stops a noisy one from inventing faults.
       Rep moves only: a hold has no still moment that is not the exercise itself. */
    noteQuiet(m, t, resting) {
      const cfg = (settingsOr().fault || {}).noise; if (!cfg) return;
      if (!resting || !m || !m.readings) { this.closeQuiet(cfg); return; }
      /* resting is not the same as still: the rep's descent passes through it. The clock restarts
         every time the reading moves, so what is sampled is a body that has stopped. */
      if (this.qP == null || Math.abs((m.p ?? 0) - this.qP) > (cfg.move ?? 0.02)) { this.qP = m.p ?? 0; this.qSince = t; this.quiet.length = 0; return; }
      if (t - this.qSince < (cfg.settle ?? 400)) return;
      this.quiet.push([t, m.readings]);
      while (this.quiet.length > 1 && t - this.quiet[0][0] > (cfg.still ?? 4000)) this.quiet.shift();
      const spread = this.spreadOf(cfg);
      if (spread) this.noise = this.pauses.length ? this.middleOf(this.pauses.concat([spread])) : spread;
    }
    /* the pause is over: what it measured joins the last few, and the figure the faults are judged
       against is the middle one of those. One pause on its own is whatever that half-second
       happened to do; the median of several is the reading's own wobble, and it does not grow just
       because the person's feet genuinely moved between one rep and the next. */
    closeQuiet(cfg) {
      const spread = this.spreadOf(cfg); this.quiet.length = 0; this.qP = null;
      if (!spread) return;
      this.pauses.push(spread);
      while (this.pauses.length > (cfg.pauses ?? 6)) this.pauses.shift();
      this.noise = this.middleOf(this.pauses);
    }
    /* the middle 80% of what each reading did over this pause, halved: a ± figure in its own
       units. The ends are left out so one dropped frame is not the answer. */
    spreadOf(cfg) {
      const min = cfg.min ?? 20; if (this.quiet.length < min) return null;
      const n = this.quiet[this.quiet.length - 1][1].length, out = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        const col = [];
        for (const [, vals] of this.quiet) { const v = vals[i]; if (Number.isFinite(v)) col.push(v); }
        if (col.length < min) continue;
        col.sort((a, b) => a - b);
        out[i] = (col[Math.floor(col.length * 0.9)] - col[Math.floor(col.length * 0.1)]) / 2;
      }
      return out;
    }
    /* column by column, the middle of several pauses' spreads (not the module's `median`, which
       takes one list of numbers) */
    middleOf(list) {
      const n = Math.max(...list.map((r) => r.length)), out = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        const col = list.map((r) => r[i]).filter(Number.isFinite).sort((a, b) => a - b);
        if (col.length) out[i] = col[Math.floor(col.length / 2)];
      }
      return out;
    }
    ackCue(id, t) { this.faults.ack(id, t); }
    // returns { m, cues:[fault], repEvent, done }
    step(pts, t) {
      if (this.startT === null) this.startT = t;
      const dt = this.lastT ? Math.min(t - this.lastT, 200) : 0; this.lastT = t; this.frames++;
      if (!pts) { this.lostMs += dt; return { m: this.m, cues: [], repEvent: null, done: false }; }
      let m = this.ex.measure(pts, this.side, this.ref);
      const rebased = this.counter && this.rebaseIfSettled(pts, m.p, t);
      /* Between reps, the position being held is the next rep's start (see spec.js startAgain):
         a body that settles differently on the fourth rep is still read correctly on the fourth
         rep. Only at rest, only once a rep has been done, and only once the reading has stopped
         moving, so the descent of the rep just finished is not mistaken for a new start. */
      let restarted = false;
      if (this.counter && !rebased && this.ex.startAgain && this.counter.reps.length && this.counter.state === 'rest') {
        const cfg = (settingsOr().rep || {}).startAgain || null;
        if (cfg) {
          if (this.restP === null || Math.abs(m.p - this.restP) > 0.04) { this.restP = m.p; this.restSince = t; }
          if (t - this.restSince >= (cfg.still ?? 400)) {
            restarted = this.ex.startAgain(this.ref, pts, this.side, cfg);
            /* the position this rep begins from has moved, so whatever the start checks made of
               the old one no longer applies: judge the new one */
            if (restarted) { this.restarts++; this.restSince = t; this.restP = null; this.startChecked = false; m = this.ex.measure(pts, this.side, this.ref); this.counter.p = m.p; }
          }
        }
      } else if (this.counter && this.counter.state !== 'rest') { this.restP = null; }
      /* The still moment between reps is the next rep's start position, so judge it there, once.
         It keeps its own clock: startAgain pushes restSince forward every time it moves the start,
         and a gate hung off that one never opens. */
      if (this.counter) {
        if (this.counter.state !== 'rest') this.restFrom = 0;
        else if (!this.restFrom) this.restFrom = t;
        else if (t - this.restFrom >= (((settingsOr().rep || {}).startAgain || {}).still ?? 400)) this.checkRepStart(pts, t);
      }
      if (rebased) m = this.ex.measure(pts, this.side, this.ref);
      this.m = m;
      let repEvent = null, held = null, phase = 'hold';
      if (this.counter) {
        repEvent = this.counter.update(m.p, t); phase = this.counter.phase;
        if (repEvent && repEvent.type === 'held') { held = repEvent; repEvent = null; }
        if (repEvent) {
          /* what this rep was measured from, so the review and the diagnostics can say so */
          repEvent.rep.from = this.ref && Number.isFinite(this.ref.start) ? +this.ref.start.toFixed(2) : undefined;
          /* and what was wrong with the position it started from (see checkRepStart) */
          repEvent.rep.startFaults = [...this.startPend];
          if (!this.startPendCounted) for (const id of this.startPend) { this.faults.counts[id] = (this.faults.counts[id] || 0) + 1; this.startFaults = [...new Set([...(this.startFaults || []), id])]; }
          this.startPendCounted = true; this.startChecked = false;   /* the next pause is checked afresh */
          for (const f of this.ex.faults.filter(f => f.onRep)) if (f.check(repEvent.rep)) { repEvent.rep.faults.push(f.id); }
          for (const id of repEvent.rep.faults) this.repFaultCounts[id] = (this.repFaultCounts[id] || 0) + 1;
          this.repEvents.push(repEvent);
          if (this.counter.count >= this.target) this.complete = true;
        }
      } else {
        if (m.inPosition) { this.holdMs += dt; if (this.faults.active.size === 0) this.goodMs += dt; }
        if (this.holdMs >= this.target * 1000) this.complete = true;
      }
      /* the pause between reps: once the body has stopped there, what the readings still do is
         their own noise (noteQuiet) */
      if (this.counter) this.noteQuiet(m, t, this.counter.state === 'rest');
      if (this.noise) m.noise = this.noise;
      const cues = this.faults.update(m, phase, t);
      if (this.counter) for (const id of this.faults.active) this.counter.noteFault(id);
      if (this.frames % 3 === 0) this.trace.push([Math.round(t - this.startT), +(m.p ?? 0).toFixed(2)]);
      /* Rep-level cues fire at the rep event, heaviest first, and obey the same cooldown as live
         cues — otherwise a rule that is true on every rep ("slow it down") is spoken on every rep
         and drowns out everything else. The counting in repFaultCounts is untouched, so the
         end-of-set review still sees every occurrence. */
      const repCues = repEvent
        ? repEvent.rep.faults.map(id => this.ex.faults.find(f => f.id === id)).filter(f => f && f.onRep && this.faults.due(f, t)).sort((a, b) => b.weight - a.weight)
        : [];
      /* a set-up that has drifted is worth saying at the rep boundary, where there is a pause to
         fix it in; it takes its turn with the rep rules and obeys the same cap and cooldown */
      const startCues = repEvent
        ? (repEvent.rep.startFaults || []).map(id => this.ex.faults.find(f => f.id === id)).filter(f => f && this.faults.due(f, t)).sort((a, b) => b.weight - a.weight)
        : [];
      return { m, cues, repCues, startCues, repEvent, held, holding: this.counter ? this.counter.holding : null, rebased, restarted, done: this.complete };
    }
    review() {
      const ex = this.ex; const faultCounts = {}; const wobble = {}; const tips = [];
      for (const f of ex.faults) {
        const n = f.onRep ? (this.repFaultCounts[f.id] || 0) : (this.faults.counts[f.id] || 0);
        /* which reps began from a position this fault was true of */
        const startReps = f.atStart ? this.repEvents.filter((e) => (e.rep.startFaults || []).includes(f.id)).length : 0;
        /* a cue that used up its turns and went quiet while the fault kept happening: the summary
           owes the person that one, so it is marked here */
        const said = this.faults.cued[f.id] || 0;
        const capped = Number.isFinite(f.maxCues) && said >= f.maxCues && n > said;
        /* what this fault's own reading did while the person was still, in the reading's units.
           Kept beside the faults rather than among them: it is true of every fault, fired or not,
           and it is what says whether a threshold is small enough to be measurement noise. */
        if (this.noise && f.iRead != null && this.noise[f.iRead]) wobble[f.id] = +this.noise[f.iRead].toFixed(2);
        if (n > 0) faultCounts[f.id] = { fault: f, n, ms: this.faults.timeIn[f.id] || 0, said, capped, ...(f.atStart ? { startReps } : {}) };
      }
      let score = 100;
      const out = { exercise: ex.id, name: ex.name, type: ex.type, target: this.target, faults: faultCounts, wobble, durationMs: (this.lastT || 0) - (this.startT || 0), trace: this.trace, date: Date.now() };
      if (ex.type === 'reps') {
        const reps = this.counter.reps; const full = reps.filter(r => r.full);
        out.reps = this.counter.count; out.partials = this.counter.partials;
        out.avgTempo = full.length ? full.reduce((s, r) => s + r.duration, 0) / full.length : 0;
        out.avgROM = full.length ? full.reduce((s, r) => s + Math.min(r.peak, 1.2), 0) / full.length : 0;
        out.repList = reps;
        // each fault costs weight×faultCost per occurrence, capped so one recurring fault can't zero the score
        const sc = settingsOr().score;
        for (const k in faultCounts) { const fc = faultCounts[k]; score -= Math.min(fc.fault.weight * sc.faultCost * fc.n, fc.fault.weight * sc.faultCap); }
        score -= this.counter.partials * sc.partialCost;
        if (this.counter.count === 0) score = Math.min(score, sc.noRepCap);
      } else {
        out.holdSec = Math.round(this.holdMs / 100) / 10; out.goodSec = Math.round(this.goodMs / 100) / 10;
        const goodFrac = this.holdMs ? this.goodMs / this.holdMs : 0;
        const sc = settingsOr().score;
        score = Math.round(sc.holdFloor + (100 - sc.holdFloor) * goodFrac);
        if (this.holdMs < this.target * 1000) score -= Math.round(sc.shortHoldPenalty * (1 - this.holdMs / (this.target * 1000)));
      }
      score = clamp(Math.round(score), 0, 100); out.score = score;
      const sorted = Object.values(faultCounts).sort((a, b) => b.fault.weight * b.n - a.fault.weight * a.n);
      for (const fc of sorted.slice(0, settingsOr().score.tips)) tips.push({ label: fc.fault.label, tip: fc.fault.tip, n: fc.n });
      out.tips = tips;
      out.headline = (settingsOr().score.headlines.find((h) => score >= h.atLeast) || { text: '' }).text;
      out.trackingLossPct = this.frames ? Math.round(100 * this.lostMs / Math.max(1, out.durationMs)) : 0;
      return out;
    }
  }

  const FormEngine = { LM, SIDE, CONNECTIONS, HEAD_LINKS, HEAD_STYLES, headShape, seen, sure, farLimb, positionCheck, Settle, Camera, fromVertical, armAngle, tiltOf, lineTilt, headTilt, armRot, elbowGap, outward, OneEuro, PoseSmoother, angle, lineOffset, dist, mid, nearSide, orientation, framing, bodyHeight, visOf, EXERCISES, RepCounter, FaultTracker, SetSession, clamp, lerp, configure,
    get REST() { return settingsOr() && T.rest; }, get ATTEMPT() { return settingsOr() && T.attempt; }, get FULL() { return settingsOr() && T.full; }, get settings() { return SETTINGS; } };
  /* Node (server + tests) has no <script> tags, so the whole library is loaded here, in the order
     the browser's OnTrackCatalog.load() uses: settings first, then the hand-written code moves the
     manifest lists, then every catalogue file. Either way each move registers itself into
     library.list, which EXERCISES points at. */
  if (typeof module !== 'undefined' && module.exports) {
    const path = require('node:path');
    const catalog = require('./catalog.js');
    /* GROOVEFORM_DATA_DIR points a test at a scratch copy of client/data/; the app never sets it. */
    const DATA_DIR = process.env.GROOVEFORM_DATA_DIR || path.join(__dirname, '..', 'data');
    const data = catalog.readDataSync(DATA_DIR);
    configure(data.settings); library.configure(data.settings);
    for (const f of data.manifest.code) require(path.join(__dirname, '..', f));
    catalog.defineAll(data);
    /* Re-read the catalogue files without restarting (the dev server does this after the Studio
       saves one). Settings and the code moves are not reloaded — those need a restart. */
    FormEngine.reloadCatalog = () => { const fresh = catalog.readDataSync(DATA_DIR); library.remove((e) => e.catalog); catalog.defineAll(fresh); return fresh; };
    FormEngine.DATA_DIR = DATA_DIR;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = FormEngine; else root.FormEngine = FormEngine;
})(typeof window !== 'undefined' ? window : globalThis);
