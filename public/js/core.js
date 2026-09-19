/* ---------------------------------------------------------------------------
   The parts that are true of any held position: reading landmarks into points,
   the geometry the measurements are built from, and the clock and the cue rules
   that turn a stream of verdicts into at most one thing said at a time.

   Nothing in here knows what a wall sit or a plank is. A move supplies its own
   read(), judge(), cue words and the order it wants faults corrected in; this
   file supplies everything that would otherwise be written twice.

   It is all pure: landmarks and a clock in, readings and a cue out. No DOM, no
   camera, no timers of its own. That is what makes it testable in node against
   bodies built to read a known angle, which is the only way to know a threshold
   does what it says.
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* BlazePose landmark indices, per side. */
  const SIDE = {
    L: { ear: 7, shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
    R: { ear: 8, shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 },
  };

  /* Settings every move shares. A move's own defaults are laid over these. */
  const COMMON = {
    vis: 0.5,             // a landmark below this is not trusted
    smooth: 0.35,         // EMA on the angles; 1 = no smoothing
    persistMs: 500,       // how long a fault holds before it is worth saying
    cooldownMs: 4000,     // how long before the same cue may be said again
    gapMs: 1500,          // the least silence between any two cues
    settleMs: 700,        // how long in position before the hold clock starts
    holdTargetSec: 60,    // the set: this many seconds in position
    callAtSec: [45, 30, 10, 5],   // seconds left at which the time is called
    deepAt: 18,           // degrees past the band at which the stronger words are used
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

  /* How far the base→top line leans off straight up, in degrees.
     + = leaning the way `facing` points, − = the other way. */
  function tiltFromVertical(base, top, facing) {
    const dx = top.x - base.x, dy = top.y - base.y;
    if (!dx && !dy) return null;
    return Math.atan2(dx * facing, -dy) * DEG;
  }

  /* The angle a limb makes with the floor, taken from `at` to `to` and measured
     from the horizontal that points the opposite way to `facing`:

        90°   `to` is directly below `at`
       >90°   `to` is the way `facing` points
       <90°   `to` is the other way

     so the side of 90 it falls on is a direction, not just a size. The rise is
     taken as a magnitude, because a foot above a knee is not the position at all
     and reading it as a sign flip would send the correction the wrong way. */
  function fromFloor(at, to, facing) {
    const dx = (to.x - at.x) * facing, dy = Math.abs(to.y - at.y);
    if (!dx && !dy) return null;
    return Math.atan2(dy, -dx) * DEG;
  }

  /* How far b sits off the straight line from a to c, as the angle by which the
     line bends at b. 0 is straight. The sign says which side: + when b is above
     the line, − when it is below, with `facing` pointing from b toward a.

     The size is the bend at b rather than a distance, so it does not change with
     how far away the camera is — which is what lets one threshold in degrees
     mean the same thing on every body and at every range. */
  function lineBend(a, b, c, facing) {
    const straight = angleAt(a, b, c);
    if (straight == null) return null;
    const ux = c.x - a.x, uy = c.y - a.y;
    const cross = (b.x - a.x) * uy - (b.y - a.y) * ux;
    const s = Math.sign(cross * -facing) || 1;
    return s * (180 - straight);
  }

  const visOf = (p) => (p && p.visibility === undefined ? 1 : p ? p.visibility : 0);

  /* Side-on, one limb hides the other and the pose model guesses at the far one.
     The side it is surer of over the joints that matter is the side to measure. */
  function pickSide(lm, joints) {
    const score = (s) => {
      const j = SIDE[s]; let sum = 0;
      for (const k of joints) sum += visOf(lm[j[k]]);
      return sum / joints.length;
    };
    const l = score('L'), r = score('R');
    return { side: r > l ? 'R' : 'L', vis: Math.max(l, r) };
  }

  /* Landmarks → points in square space, so that an angle is an angle. Returns
     null when the frame cannot be used at all, and `{ok:false}` when the body is
     there but not clearly enough to judge. */
  function frame(lm, aspect, cfg, joints, needed) {
    if (!lm || lm.length < 33) return null;
    const { side, vis } = pickSide(lm, joints);
    const j = SIDE[side];
    const P = {};
    for (const k of Object.keys(j)) { const p = lm[j[k]]; if (!p) return null; P[k] = { x: p.x * aspect, y: p.y, v: visOf(p) }; }
    for (const k of needed) if (P[k].v < cfg.vis) return { ok: false, side, vis, why: 'Some of you is out of shot or hidden' };
    return { ok: true, side, vis, points: P };
  }

  /* A phone laid on the floor gives a frame the shape of however it is lying, and
     the shape has to suit the body. A plank is long and low: in a tall frame it
     either loses the feet or shrinks to a line across the middle, and either way
     the angles are read from a handful of pixels. A move says which way round it
     wants the phone; this says whether it has it, and what to do if not. */
  function framing(want, w, h) {
    if (!want || !w || !h) return null;
    const wide = w > h;
    if (want === 'wide' && !wide) return 'Turn the phone on its side \u2014 this one needs a wide frame';
    if (want === 'tall' && wide) return 'Stand the phone up \u2014 this one needs a tall frame';
    return null;
  }

  /* Said by every move, so they live here rather than in each one. */
  const SHARED_CUES = {
    hold: { text: 'That is it — hold' },
    lost: { text: 'Step into the camera, side on' },
  };

  /* ---- what to say, and when ----
     A cue is an instruction, and an instruction given for a flicker is noise. So
     one is only offered when its condition has held for `persistMs`, the same one
     is not repeated inside `cooldownMs`, and no two are said inside `gapMs`.
     When several are wrong the move's own order decides, not their sizes. */
  class Coach {
    constructor(move, cfg) {
      this.move = move;
      this.cfg = Object.assign({}, COMMON, move.defaults, cfg);
      this.cues = Object.assign({}, SHARED_CUES, move.cues);
      this.since = {}; this.last = {}; this.said = {};
      this.inSince = 0; this.wasIn = false; this.holdDue = 0;
      this.holdMs = 0; this.bestMs = 0; this.runMs = 0; this.totalMs = 0;
      this.called = {};                 // which time calls have already been made
      this.lastSpoke = 0;               // when anything was last said, whatever it was
      this.lastT = null; this.log = [];
    }
    reset() { const { move, cfg } = this; Object.assign(this, new Coach(move)); this.cfg = cfg; }

    /* One frame. `t` is a millisecond clock the caller owns. Returns the frame's
       verdict and, at most, one cue to speak. */
    step(r, t) {
      const cfg = this.cfg, faults = this.move.faults;
      const dt = this.lastT == null ? 0 : Math.min(t - this.lastT, 250);
      this.lastT = t; this.totalMs += dt;
      const v = this.move.judge(r, cfg);

      /* which faults are true this frame, and by how much */
      const on = v.ok ? v.faults : { lost: 99 };
      for (const id of faults) {
        if (on[id] != null) { if (!this.since[id]) this.since[id] = t; }
        else this.since[id] = 0;
      }

      /* the hold clock: it runs once the position has been right for a moment,
         and it stops the instant it is not */
      let holding = false;
      if (v.inPosition) {
        if (!this.inSince) this.inSince = t;
        if (t - this.inSince >= cfg.settleMs) { holding = true; this.holdMs += dt; this.runMs += dt; this.bestMs = Math.max(this.bestMs, this.runMs); }
      } else { this.inSince = 0; this.runMs = 0; }

      /* The countdown. It is spent from time IN position, not from the wall
         clock: coming out of the position stops it rather than running it down,
         so a minute means a minute of the exercise. */
      const targetMs = cfg.holdTargetSec * 1000;
      const leftMs = Math.max(0, targetMs - this.holdMs);
      const done = this.holdMs >= targetMs;

      /* the time called out, which jumps the queue: it is two words and it is
         only right at the moment it is true */
      let cue = null;
      if (this.holdMs > 0) {
        if (done && !this.called.done) {
          this.called.done = true;
          for (const n of cfg.callAtSec) this.called[n] = true;   // nothing left to count
          cue = this.offer('done', t, `${cfg.holdTargetSec} seconds — done`, true);
        } else if (!done) {
          /* a dropped frame can carry the clock past two marks at once; only the
             nearest is worth saying, and the ones skipped are spent */
          const passed = cfg.callAtSec.filter((n) => !this.called[n] && leftMs <= n * 1000);
          if (passed.length) {
            const n = Math.min(...passed);
            for (const m of passed) this.called[m] = true;
            cue = this.offer('call' + n, t, `${n} seconds left`, true);
          }
        }
      }

      /* Getting into position is worth one word. It happens on a single frame, so
         unlike a fault it cannot simply be re-offered until it lands — if the gap
         swallows that frame the word is gone. So the moment is remembered and
         retried, and given up on if it has not been said within a couple of gaps,
         by which time saying it would be a remark about the past. */
      if (holding && !this.wasIn) this.holdDue = t;
      if (!holding) this.holdDue = 0;
      this.wasIn = holding;
      if (!cue && this.holdDue) {
        if (t - this.holdDue > cfg.gapMs * 2) this.holdDue = 0;
        else { cue = this.offer('hold', t, this.cues.hold.text); if (cue) this.holdDue = 0; }
      }

      if (!cue) {
        /* whatever is wrong, the one earliest in the move's order is the one to say */
        const ready = faults.filter((id) => on[id] != null && this.since[id] && t - this.since[id] >= cfg.persistMs);
        for (const id of ready) {
          const c = this.cues[id];
          cue = this.offer(id, t, (on[id] > cfg.deepAt && c.deep) || c.text);
          if (cue) break;
        }
      }
      return { reading: r, verdict: v, holding, cue, done, leftMs, targetMs,
        holdMs: this.holdMs, runMs: this.runMs, bestMs: this.bestMs };
    }

    /* A cue is handed over only if its own cooldown has run out AND nothing else
       has just been said. Two instructions a frame apart are worse than one: they
       talk over each other and the second wipes the first off the screen.

       A time call is `urgent` and takes no notice of the gap — "ten seconds left"
       said two seconds late is a lie. It still sets the clock, so the next
       correction waits rather than treading on it. */
    offer(id, t, text, urgent) {
      if (this.last[id] && t - this.last[id] < this.cfg.cooldownMs) return null;
      if (!urgent && this.lastSpoke && t - this.lastSpoke < this.cfg.gapMs) return null;
      this.last[id] = t; this.lastSpoke = t; this.said[id] = (this.said[id] || 0) + 1;
      const cue = { id, text, t };
      this.log.push(cue);
      return cue;
    }

    summary() {
      const s = { move: this.move.id, holdSec: +(this.holdMs / 1000).toFixed(1),
        bestSec: +(this.bestMs / 1000).toFixed(1), totalSec: +(this.totalMs / 1000).toFixed(1),
        targetSec: this.cfg.holdTargetSec, reachedTarget: this.holdMs >= this.cfg.holdTargetSec * 1000, cues: {} };
      for (const id of Object.keys(this.said)) if (this.move.faults.includes(id)) s.cues[id] = this.said[id];
      s.log = this.log.slice();
      return s;
    }
  }

  /* A little exponential smoothing on the angles. The raw readings wobble a
     degree or two on a body that is not moving, and a threshold sitting inside
     that wobble fires on nothing. */
  class Smoother {
    constructor(alpha) { this.a = alpha == null ? COMMON.smooth : alpha; this.v = {}; }
    reset() { this.v = {}; }
    of(key, x) {
      if (x == null || !Number.isFinite(x)) return this.v[key] == null ? null : this.v[key];
      this.v[key] = this.v[key] == null ? x : this.v[key] + this.a * (x - this.v[key]);
      return this.v[key];
    }
    /* smooth every angle on a reading in place, leaving the points alone */
    apply(r) {
      if (!r || !r.ok || !r.angles) return r;
      for (const k of r.angles) r[k] = this.of(k, r[k]);
      return r;
    }
  }

  return { SIDE, COMMON, SHARED_CUES, DEG, clamp, angleAt, tiltFromVertical, fromFloor,
    lineBend, visOf, pickSide, frame, framing, Coach, Smoother };
});
