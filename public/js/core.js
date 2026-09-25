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
    restSec: 2,           // reps: the quiet after one is counted before the next is asked for
    readyMs: 2000,        // reps: how long the start position is held before the coaching begins
    setCount: 3,          // how many sets make the session
    callAtSec: [45, 30, 10, 5],   // seconds left at which the time is called
    deepAt: 18,           // degrees past the band at which the stronger words are used
  };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const DEG = 180 / Math.PI;

  /* Is a reading inside its band? A body posed to exactly the edge comes back a
     ten-thousandth of a degree under it, so a bare comparison rejects the very
     number the setting says is allowed. "Five degrees either way" has to include
     five degrees, so the comparison is given room for the arithmetic and none for
     anything else. */
  const EDGE = 1e-9;
  const inBand = (x, lo, hi) => x >= lo - EDGE && x <= hi + EDGE;
  const within = (x, lim) => Math.abs(x) <= lim + EDGE;

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

  /* How far b sits above a, as the angle the a→b line makes with the floor:
     + above, − below, 0 level. Signed, unlike fromFloor, because here the side
     matters: a hip above the knee is the fault and a hip below it is not. */
  function rise(a, b) {
    const dx = Math.abs(b.x - a.x), dy = a.y - b.y;
    if (!dx && !dy) return null;
    return Math.atan2(dy, dx) * DEG;
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

  /* One side's landmarks as points in square space, so that an angle is an angle.
     A move that has to look at both sides before deciding which one to measure
     builds them itself and chooses; everything else goes through `frame`. */
  function sidePoints(lm, aspect, side) {
    const j = SIDE[side], P = {};
    for (const k of Object.keys(j)) { const p = lm[j[k]]; if (!p) return null; P[k] = { x: p.x * aspect, y: p.y, v: visOf(p) }; }
    return P;
  }
  const seen = (P, needed, cfg) => needed.every((k) => P[k] && P[k].v >= cfg.vis);

  /* Landmarks → the side worth measuring, by how clearly it can be seen. Returns
     null when the frame cannot be used at all, and `{ok:false}` when the body is
     there but not clearly enough to judge. */
  function frame(lm, aspect, cfg, joints, needed) {
    if (!lm || lm.length < 33) return null;
    const { side, vis } = pickSide(lm, joints);
    const P = sidePoints(lm, aspect, side);
    if (!P) return null;
    if (!seen(P, needed, cfg)) return { ok: false, side, vis, why: 'Some of you is out of shot or hidden' };
    return { ok: true, side, vis, points: P };
  }

  /* The angle a limb makes with straight down: 0 hanging, 90 level, more than that
     above the horizontal. Unsigned, because it is a lift and there is only one way
     to lift. */
  function fromDown(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const m = Math.hypot(dx, dy);
    if (!m) return null;
    return Math.acos(clamp(dy / m, -1, 1)) * DEG;
  }

  /* A phone laid on the floor gives a frame the shape of however it is lying, and
     the shape has to suit the body. A plank is long and low: in a tall frame it
     either loses the feet or shrinks to a line across the middle, and either way
     the angles are read from a handful of pixels. A move says which way round it
     wants the phone; this says whether it has it, and what to do if not. */
  function framing(want, w, h) {
    if (!want || !w || !h) return null;
    const wide = w > h;
    const got = `the camera is giving a ${wide ? 'wide' : 'tall'} ${w}\u00d7${h} picture`;
    if (want === 'wide' && !wide) return `Turn the phone on its side \u2014 this one needs a wide picture, and ${got}`;
    if (want === 'tall' && wide) return `Stand the phone up \u2014 this one needs a tall picture, and ${got}`;
    return null;
  }

  /* Where to put a vw×vh picture inside a W×H canvas so that all of it shows and
     none of it is stretched. Stretching to fill is the one thing that must not
     happen: a squashed body reads squashed angles, and every threshold here is an
     angle. Bars at the sides are honest; a distorted picture is not. */
  function fitRect(vw, vh, W, H) {
    if (!vw || !vh || !W || !H) return { x: 0, y: 0, w: W || 0, h: H || 0 };
    const s = Math.min(W / vw, H / vh);
    const w = vw * s, h = vh * s;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  /* A quarter turn of the landmarks, for when the browser hands over a frame that
     is stored the other way round from the world it was taken in. Every joint angle
     survives a rotation untouched, but the ones taken against vertical or the floor
     do not — a shin is only plumb with respect to gravity — so the frame has to be
     put upright before any of them is read, not after.

     `quarter` is 1 for a turn clockwise and 3 for one anticlockwise, in the same
     sense the picture is turned. */
  function rotateLandmarks(lm, quarter) {
    const q = ((quarter % 4) + 4) % 4;
    if (!lm || !q) return lm;
    return lm.map((p) => {
      if (!p) return p;
      const x = p.x, y = p.y;
      const n = q === 1 ? { x: 1 - y, y: x } : q === 2 ? { x: 1 - x, y: 1 - y } : { x: y, y: 1 - x };
      return Object.assign({}, p, n);
    });
  }

  /* Said by every move, so they live here rather than in each one. */
  const SHARED_CUES = {
    hold: { text: 'That is it — hold' },
    lost: { text: 'Step into the camera, side on' },
    fast: { text: 'slower on the way down' },
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
      this.reps = 0; this.phase = 'down'; this.repHoldMs = 0;   // only a move with reps uses these
      this.lowerAt = 0;                 // when the lowering began, for a move that wants it slow
      this.countedAt = 0;               // when the last rep was counted, for the quiet after it
      this.ready = false; this.readySince = 0;   // reps: the set-up wait, until the start is held
      this.lastT = null; this.log = [];
    }
    reset() { const { move, cfg } = this; Object.assign(this, new Coach(move)); this.cfg = cfg; }

    /* One frame. `t` is a millisecond clock the caller owns. Returns the frame's
       verdict and, at most, one cue to speak. */
    step(r, t) {
      const dt = this.lastT == null ? 0 : Math.min(t - this.lastT, 250);
      this.lastT = t; this.totalMs += dt;
      const v = this.move.judge(r, this.cfg);
      return this.move.reps ? this.stepReps(r, t, v, dt) : this.stepHold(r, t, v, dt);
    }

    /* A position held once, for as long as the target says. */
    stepHold(r, t, v, dt) {
      const cfg = this.cfg, faults = this.move.faults;

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

      if (!cue) cue = this.correct(on, t);
      return { reading: r, verdict: v, holding, cue, done, leftMs, targetMs,
        active: this.active(on),
        holdMs: this.holdMs, runMs: this.runMs, bestMs: this.bestMs };
    }

    /* The faults present this frame, in the move's order, whether or not any of
       them gets said: what the picture shows in words while the voice keeps to
       one thing at a time. Prompts and losing sight of the person are not faults. */
    active(on) {
      const prompts = this.move.prompts || [];
      return this.move.faults.filter((id) => on[id] != null && id !== 'lost' && !prompts.includes(id));
    }
    /* Whatever is wrong, the one earliest in the move's order is the one to say. */
    correct(on, t) {
      const cfg = this.cfg;
      for (const id of this.move.faults) {
        if (on[id] != null) { if (!this.since[id]) this.since[id] = t; }
        else this.since[id] = 0;
      }
      const ready = this.move.faults.filter((id) => on[id] != null && this.since[id] && t - this.since[id] >= cfg.persistMs);
      for (const id of ready) {
        const c = this.cues[id];
        const cue = this.offer(id, t, (on[id] > cfg.deepAt && c.deep) || c.text);
        if (cue) return cue;
      }
      return null;
    }

    /* Reps: come to the start, go to the position, hold it for the target, lower,
       and come back to the start. A rep is only counted on that last step — the
       lowering is part of the exercise, and a knee dropped from the top is not the
       same as one put down.

       The clock is the same clock as a held set, only per rep and reset at the top
       of each one, so the time calls, the settle and the one-at-a-time rule are all
       the shared ones rather than a second implementation that could drift. */
    stepReps(r, t, v, dt) {
      const cfg = this.cfg, C = this.cues;
      const targetMs = cfg.holdTargetSec * 1000, total = cfg.repCount;
      const raised = !!(v.ok && v.raised), atStart = !!(v.ok && v.atStart);

      /* The set-up wait. The opening words said where to go; until the person has
         been at the start position for a moment, nothing else is said, nothing is
         judged, and no rep is counted — they are getting down onto the floor, and
         a correction shouted at that is noise. */
      if (!this.ready) {
        if (atStart) { if (!this.readySince) this.readySince = t; if (t - this.readySince >= (cfg.readyMs || 0)) this.ready = true; }
        else this.readySince = 0;
        if (!this.ready) {
          return { reading: r, verdict: v, holding: false, cue: null, phase: 'setup', ready: false,
            done: false, leftMs: targetMs, targetMs, active: [], resting: false,
            reps: this.reps, repTarget: total, holdMs: this.holdMs, runMs: this.runMs, bestMs: this.bestMs };
        }
      }

      let holding = false;
      if (v.inPosition && this.phase === 'up') {
        if (!this.inSince) this.inSince = t;
        if (t - this.inSince >= cfg.settleMs) {
          holding = true; this.repHoldMs += dt; this.holdMs += dt; this.runMs += dt;
          this.bestMs = Math.max(this.bestMs, this.runMs);
        }
      } else { this.inSince = 0; this.runMs = 0; }

      let cue = null;
      if (this.phase === 'down' && raised) {
        this.phase = 'up'; this.repHoldMs = 0; this.inSince = 0; this.called = {};
      } else if (this.phase === 'up') {
        if (this.repHoldMs >= targetMs) { this.phase = 'lower'; this.lowerAt = t; cue = this.offer('lower', t, C.lower.text, true); }
        else if (atStart) {
          /* back down before the hold was finished: nothing to count, and worth saying
             so, because the alternative is someone quietly doing ten half reps */
          this.phase = 'down'; this.repHoldMs = 0;
          cue = this.offer('early', t, C.early.text, true);
        }
      } else if (this.phase === 'lower' && atStart) {
        this.reps += 1; this.repHoldMs = 0;
        this.phase = this.reps >= total ? 'done' : 'down';
        /* "lower slowly" is judged, not just said: a move that names how long the
           lowering should take is told when it took less. The remark rides on the
           count rather than queueing behind it, so it lands on the rep it is about. */
        const fast = cfg.lowerSec > 0 && this.lowerAt && t - this.lowerAt < cfg.lowerSec * 1000;
        if (fast) this.fastReps = (this.fastReps || 0) + 1;
        this.countedAt = t;
        const tail = fast ? ` \u2014 ${C.fast.text}` : '';
        cue = this.phase === 'done'
          ? this.offer('done', t, `${total} reps \u2014 done${tail}`, true)
          : this.offer('count' + this.reps, t, String(this.reps) + tail, true);
      }

      const leftMs = Math.max(0, targetMs - this.repHoldMs);
      if (!cue && this.phase === 'up' && this.repHoldMs > 0) {
        const passed = cfg.callAtSec.filter((n) => !this.called[n] && leftMs <= n * 1000);
        if (passed.length) {
          const n = Math.min(...passed);
          for (const m of passed) this.called[m] = true;
          cue = this.offer('call' + n, t, `${n} seconds left`, true);
        }
      }

      if (holding && !this.wasIn) this.holdDue = t;
      if (!holding) this.holdDue = 0;
      this.wasIn = holding;
      if (!cue && this.holdDue) {
        if (t - this.holdDue > cfg.gapMs * 2) this.holdDue = 0;
        else { cue = this.offer('hold', t, C.hold.text); if (cue) this.holdDue = 0; }
      }

      /* only the position being worked on is coached: telling someone standing still
         to straighten a knee they have not lifted yet is noise. A move can name the
         faults that are about the set-up — where the feet are — and those are
         coached at the start too, before the rep is asked for, because they decide
         what the rep can be. */
      let on = {};
      if (!v.ok) on = { lost: 99 };
      else if (this.phase === 'up') on = v.faults;
      else if (this.phase === 'down') {
        on = { raise: 99 };
        for (const id of this.move.setup || []) if (v.faults[id] != null) on[id] = v.faults[id];
      }
      /* the breath after a rep: for a moment after one is counted nothing is asked
         for and nothing is corrected, so the count is heard and the person can
         settle before the next is called */
      const resting = this.phase === 'down' && this.countedAt && t - this.countedAt < (cfg.restSec || 0) * 1000;
      if (!cue && !resting) cue = this.correct(on, t);

      return { reading: r, verdict: v, holding, cue, phase: this.phase, ready: true,
        done: this.phase === 'done', leftMs, targetMs, active: this.active(on), resting,
        reps: this.reps, repTarget: total,
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
      const reps = !!this.move.reps;
      const s = { move: this.move.id, holdSec: +(this.holdMs / 1000).toFixed(1),
        bestSec: +(this.bestMs / 1000).toFixed(1), totalSec: +(this.totalMs / 1000).toFixed(1),
        targetSec: this.cfg.holdTargetSec, reps: this.reps, repTarget: reps ? this.cfg.repCount : 0,
        reachedTarget: reps ? this.reps >= this.cfg.repCount : this.holdMs >= this.cfg.holdTargetSec * 1000,
        cues: {} };
      /* a prompt is not a correction: being asked to start the next rep says nothing
         about how the last one was done */
      const prompts = this.move.prompts || [];
      for (const id of Object.keys(this.said)) if (this.move.faults.includes(id) && !prompts.includes(id)) s.cues[id] = this.said[id];
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

  /* the shape of what the app remembers in the browser; the Review page writes
     tuned numbers into the same store, so both have to agree on it */
  const SETTINGS_V = 7;
  /* Stamped onto every script URL so a phone that cached the last version loads this one. Bumped with each release. */
  const VER = '2026-09-25c';

  return { VER, SETTINGS_V, SIDE, COMMON, SHARED_CUES, DEG, clamp, angleAt, tiltFromVertical, fromFloor,
    lineBend, fromDown, rise, inBand, within, visOf, pickSide, sidePoints, frame, framing, fitRect, rotateLandmarks, Coach, Smoother };
});
