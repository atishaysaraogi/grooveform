/* ---------------------------------------------------------------------------
   Wall sit — the measurement and the coaching decision.

   Everything in here is pure: landmarks in, readings and a cue out. No DOM, no
   camera, no timers of its own — the caller supplies the clock. That is what
   makes it testable in node against frames built to read a known angle, which
   is the only way to know a threshold does what it says.

   A wall sit is judged on two things:

     knee angle   the angle at the knee between the hip and the ankle. 90° is
                  thighs parallel to the floor, shins vertical — the textbook
                  wall sit. Bigger means straighter legs (too high), smaller
                  means deeper (too low). The band asked for is 85–110°.

     back         seen from the side the back is against a wall, so the torso
                  should be vertical: the shoulder directly above the hip. What
                  the camera can measure is the tilt of the hip→shoulder line
                  away from straight up. It cannot see the spine rounding
                  between those two points — no pose model gives a mid-spine
                  point — so that is what this reads and what it says.
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.WallSit = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* BlazePose landmark indices, per side. */
  const SIDE = {
    L: { shoulder: 11, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31, ear: 7 },
    R: { shoulder: 12, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32, ear: 8 },
  };
  /* what gets drawn as the body */
  const BONES = [
    ['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle'], ['ankle', 'heel'], ['ankle', 'toe'], ['heel', 'toe'],
  ];

  const DEFAULTS = {
    kneeMin: 85,          // below this the legs are too bent — too low
    kneeMax: 110,         // above this the legs are too straight — too high
    backTilt: 12,         // degrees the torso may lean off vertical
    vis: 0.5,             // a landmark below this is not trusted
    smooth: 0.35,         // EMA on the angles; 1 = no smoothing
    persistMs: 500,       // how long a fault holds before it is worth saying
    cooldownMs: 4000,     // how long before the same cue may be said again
    settleMs: 700,        // how long in the band before the hold clock starts
  };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const DEG = 180 / Math.PI;

  /* The angle at b, between a and c, in degrees. Landmark x is a share of the
     frame's WIDTH and y a share of its HEIGHT, so x has to be scaled by the
     aspect before any angle taken from them means anything. */
  function angleAt(a, b, c) {
    const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
    const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
    if (!m1 || !m2) return null;
    return Math.acos(clamp((v1x * v2x + v1y * v2y) / (m1 * m2), -1, 1)) * DEG;
  }

  /* How far the hip→shoulder line leans off straight up, in degrees.
     + = leaning the way the knees point (forward, off the wall), − = the other way. */
  function tiltFromVertical(hip, shoulder, facing) {
    const dx = shoulder.x - hip.x, dy = shoulder.y - hip.y;
    if (!dx && !dy) return null;
    return Math.atan2(dx * facing, -dy) * DEG;
  }

  const visOf = (p) => (p && p.visibility === undefined ? 1 : p ? p.visibility : 0);

  /* Side-on, one leg hides the other and the pose model guesses at the far one.
     The side it is surer of is the side to measure. */
  function pickSide(lm) {
    const score = (s) => {
      const j = SIDE[s]; let sum = 0, n = 0;
      for (const k of ['shoulder', 'hip', 'knee', 'ankle', 'heel']) { sum += visOf(lm[j[k]]); n++; }
      return sum / n;
    };
    const l = score('L'), r = score('R');
    return { side: r > l ? 'R' : 'L', vis: Math.max(l, r) };
  }

  /* ---- one frame, read ----
     `lm` is the pose model's 33 landmarks, `aspect` the frame's width/height.
     Returns null when the body cannot be read well enough to judge. */
  function read(lm, aspect, cfg) {
    cfg = Object.assign({}, DEFAULTS, cfg);
    if (!lm || lm.length < 33) return null;
    const { side, vis } = pickSide(lm);
    const j = SIDE[side];
    /* into square space, so an angle is an angle */
    const P = {};
    for (const k of Object.keys(j)) { const p = lm[j[k]]; if (!p) return null; P[k] = { x: p.x * aspect, y: p.y, v: visOf(p) }; }
    if (Math.min(P.hip.v, P.knee.v, P.ankle.v, P.shoulder.v) < cfg.vis) {
      return { ok: false, side, vis, why: 'Some of you is out of shot or hidden' };
    }
    const facing = Math.sign(P.knee.x - P.hip.x) || 1;
    return {
      ok: true, side, vis, facing, points: P,
      knee: angleAt(P.hip, P.knee, P.ankle),        // the one that is judged
      kneeHeel: angleAt(P.hip, P.knee, P.heel),     // the same angle taken to the heel
      tilt: tiltFromVertical(P.hip, P.shoulder, facing),
      hip: angleAt(P.shoulder, P.hip, P.knee),      // ~90° in a good wall sit
    };
  }

  /* ---- what the readings mean ---- */
  function judge(r, cfg) {
    cfg = Object.assign({}, DEFAULTS, cfg);
    if (!r || !r.ok || r.knee == null || r.tilt == null) return { ok: false, depth: null, back: null, inPosition: false };
    const depth = r.knee > cfg.kneeMax ? 'high' : r.knee < cfg.kneeMin ? 'low' : 'good';
    const back = r.tilt > cfg.backTilt ? 'forward' : r.tilt < -cfg.backTilt ? 'back' : 'good';
    /* how far out of line each is, scaled so the two can be compared and the
       worse one is the one spoken about */
    const depthOff = depth === 'high' ? r.knee - cfg.kneeMax : depth === 'low' ? cfg.kneeMin - r.knee : 0;
    const backOff = back === 'good' ? 0 : Math.abs(r.tilt) - cfg.backTilt;
    return {
      ok: true, depth, back, depthOff, backOff,
      inPosition: depth === 'good' && back === 'good',
      severity: { depth: depthOff / 15, back: backOff / 10 },
    };
  }

  /* ---- what to say, and when ----
     A cue is an instruction, and an instruction given for a flicker is noise. So
     one is only offered when its condition has held for `persistMs`, and the same
     one is not repeated inside `cooldownMs`. When both are wrong the further-out
     one is said — there is no point correcting a back on someone whose legs are
     nowhere near the right height. */
  const CUES = {
    high: { text: 'Lower down', deep: 'Slide further down the wall' },
    low: { text: 'Come up a little', deep: 'Come up — that is too deep' },
    forward: { text: 'Press your back flat to the wall', deep: 'Back flat — your shoulders are ahead of your hips' },
    back: { text: 'Bring your hips under your shoulders' },
    hold: { text: 'That is it — hold' },
    lost: { text: 'Step into the camera, side on' },
  };

  class Coach {
    constructor(cfg) {
      this.cfg = Object.assign({}, DEFAULTS, cfg);
      this.since = {}; this.last = {}; this.said = {};
      this.inSince = 0; this.wasIn = false;
      this.holdMs = 0; this.bestMs = 0; this.runMs = 0; this.totalMs = 0;
      this.lastT = null; this.log = [];
    }
    reset() { const c = this.cfg; Object.assign(this, new Coach(c)); this.cfg = c; }

    /* One frame. `t` is a millisecond clock the caller owns. Returns the frame's
       verdict and, at most, one cue to speak. */
    step(r, t) {
      const cfg = this.cfg;
      const dt = this.lastT == null ? 0 : Math.min(t - this.lastT, 250);
      this.lastT = t; this.totalMs += dt;
      const v = judge(r, cfg);

      /* which conditions are true this frame */
      const on = {};
      if (!v.ok) on.lost = true;
      else {
        if (v.depth !== 'good') on[v.depth] = true;
        if (v.back !== 'good') on[v.back] = true;
      }
      for (const id of Object.keys(CUES)) {
        if (on[id]) { if (!this.since[id]) this.since[id] = t; }
        else this.since[id] = 0;
      }

      /* the hold clock: it runs once the position has been right for a moment,
         and it stops the instant it is not */
      let holding = false;
      if (v.inPosition) {
        if (!this.inSince) this.inSince = t;
        if (t - this.inSince >= cfg.settleMs) { holding = true; this.holdMs += dt; this.runMs += dt; this.bestMs = Math.max(this.bestMs, this.runMs); }
      } else { this.inSince = 0; this.runMs = 0; }

      /* entering the band is worth one word, and it clears the way for the next
         correction by resetting nothing else */
      let cue = null;
      if (holding && !this.wasIn) cue = this.offer('hold', t, CUES.hold.text);
      this.wasIn = holding;

      if (!cue) {
        const ready = Object.keys(on).filter((id) => this.since[id] && t - this.since[id] >= cfg.persistMs);
        const rank = (id) => (id === 'lost' ? 99 : id === 'high' || id === 'low' ? v.severity.depth : v.severity.back);
        ready.sort((a, b) => rank(b) - rank(a));
        for (const id of ready) {
          const far = (id === 'high' || id === 'low' ? v.depthOff : v.backOff) > 18;
          const text = (far && CUES[id].deep) || CUES[id].text;
          cue = this.offer(id, t, text);
          if (cue) break;
        }
      }
      return { reading: r, verdict: v, holding, cue, holdMs: this.holdMs, runMs: this.runMs, bestMs: this.bestMs };
    }

    /* a cue is only handed over if its cooldown has run out; taking it starts a new one */
    offer(id, t, text) {
      if (this.last[id] && t - this.last[id] < this.cfg.cooldownMs) return null;
      this.last[id] = t; this.said[id] = (this.said[id] || 0) + 1;
      const cue = { id, text, t };
      this.log.push(cue);
      return cue;
    }

    summary() {
      const s = { holdSec: +(this.holdMs / 1000).toFixed(1), bestSec: +(this.bestMs / 1000).toFixed(1), totalSec: +(this.totalMs / 1000).toFixed(1), cues: {} };
      for (const id of Object.keys(this.said)) if (id !== 'hold') s.cues[id] = this.said[id];
      s.log = this.log.slice();
      return s;
    }
  }

  /* A little exponential smoothing on the angles. The raw readings wobble a
     degree or two on a body that is not moving, and a threshold sitting inside
     that wobble fires on nothing. */
  class Smoother {
    constructor(alpha) { this.a = alpha == null ? DEFAULTS.smooth : alpha; this.v = {}; }
    reset() { this.v = {}; }
    of(key, x) {
      if (x == null || !Number.isFinite(x)) return this.v[key] == null ? null : this.v[key];
      this.v[key] = this.v[key] == null ? x : this.v[key] + this.a * (x - this.v[key]);
      return this.v[key];
    }
    /* smooth the angles on a reading in place, leaving the points alone */
    apply(r) {
      if (!r || !r.ok) return r;
      r.knee = this.of('knee', r.knee); r.kneeHeel = this.of('kneeHeel', r.kneeHeel);
      r.tilt = this.of('tilt', r.tilt); r.hip = this.of('hip', r.hip);
      return r;
    }
  }

  return { SIDE, BONES, DEFAULTS, CUES, angleAt, tiltFromVertical, pickSide, read, judge, Coach, Smoother };
});
