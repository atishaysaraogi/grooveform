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
    LM, SIDE, BAND,
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
    constructor(faults) { this.faults = faults.filter(f => !f.onRep); this.since = {}; this.lastCue = {}; this.cued = {}; this.active = new Set(); this.counts = {}; this.timeIn = {}; this.lastT = null; }
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
            if (this.due(f, t)) cues.push(f);
          }
        } else { this.since[f.id] = 0; this.active.delete(f.id); }
      }
      cues.sort((a, b) => b.weight - a.weight);
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
      /* Rep-level cues fire at the rep event, heaviest first, and obey the same cooldown as live
         cues — otherwise a rule that is true on every rep ("slow it down") is spoken on every rep
         and drowns out everything else. The counting in repFaultCounts is untouched, so the
         end-of-set review still sees every occurrence. */
      const repCues = repEvent
        ? repEvent.rep.faults.map(id => this.ex.faults.find(f => f.id === id)).filter(f => f && f.onRep && this.faults.due(f, t)).sort((a, b) => b.weight - a.weight)
        : [];
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

  const FormEngine = { LM, SIDE, CONNECTIONS, fromVertical, armAngle, tiltOf, lineTilt, headTilt, armRot, elbowGap, outward, OneEuro, PoseSmoother, angle, lineOffset, dist, mid, nearSide, orientation, framing, bodyHeight, visOf, EXERCISES, RepCounter, FaultTracker, SetSession, clamp, lerp, configure,
    get REST() { return settingsOr() && T.rest; }, get ATTEMPT() { return settingsOr() && T.attempt; }, get FULL() { return settingsOr() && T.full; }, get settings() { return SETTINGS; } };
  /* Node (server + tests) has no <script> tags, so the whole library is loaded here, in the order
     the browser's FyzioCatalog.load() uses: settings first, then the hand-written code moves the
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
