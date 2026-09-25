/* ---------------------------------------------------------------------------
   A recording, read the way the phone reads it. A trace is the pose model's
   landmarks for a run of frames with their times; running a move over it gives
   every reading, every verdict and every cue the coach would have given, at
   those times. Nothing here touches a video or the model: the Review page
   makes the trace and this judges it, so the same trace can be judged again
   the instant a band edge is moved — and judged in node, in the tests.

   Takes: a trace tagged as clean, or as showing one named fault. The tuning
   rule from the OnTrack Studio: a fault's numbers are right when it is quiet
   on every clean take and fires on every take of that fault.
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./core.js'));
  else root.Trace = factory(root.Core);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  /* every number a move owns, as the settings panel lists them: the band edges
     and whatever else the move declares */
  const settingsOf = (m) => m.bands.reduce((a, b) => a.concat(b.set || []), []).concat(m.extra || []);
  const defaults = (m) => Object.assign({}, Core.COMMON, m.defaults);

  /* the edges of a band under a given set of numbers */
  function bandRange(b, c) {
    if (b.sym) return { lo: -c[b.sym], hi: c[b.sym] };
    if (b.min) return { lo: c[b.min], hi: b.scale[1] };
    if (b.max) return { lo: b.scale[0], hi: c[b.max] };
    return { lo: c[b.lo], hi: c[b.hi] };
  }

  /* Run a move over a trace with the given numbers laid over its defaults.
     frames: [{ t: ms, lm: landmarks }], aspect: the frame's width over its height.
     Returns one row per frame — the reading, the verdict and the coach's output —
     and the cues in order. */
  function run(move, tuned, frames, aspect) {
    const coach = new Core.Coach(move, tuned || {});
    const smoother = new Core.Smoother(coach.cfg.smooth);
    const rows = frames.map((f) => {
      const reading = smoother.apply(move.read(f.lm, aspect, coach.cfg));
      const out = coach.step(reading, f.t);
      return { t: f.t, reading, verdict: out.verdict, out };
    });
    return { move: move.id, rows, cues: coach.log.slice(), summary: coach.summary(), cfg: coach.cfg };
  }

  /* where a fault is present, frame by frame, as stretches of time */
  function stretches(result, id) {
    const out = []; let open = null;
    for (const r of result.rows) {
      const on = !!(r.verdict && r.verdict.ok && r.verdict.faults && r.verdict.faults[id] != null);
      if (on && !open) open = { t0: r.t, t1: r.t };
      else if (on) open.t1 = r.t;
      else if (open) { out.push(open); open = null; }
    }
    if (open) out.push(open);
    return out;
  }
  /* the faults a move can call, less the prompts and losing sight of the person */
  const faultIds = (m) => m.faults.filter((id) => id !== 'lost' && !(m.prompts || []).includes(id));

  /* Every take judged, and each fault held to the rule. A take is
     { name, tag: 'clean' | faultId, frames, aspect }. "Fired" means the coach
     said that cue at least once in the take. */
  function verdicts(move, tuned, takes) {
    const runs = takes.map((tk) => ({ take: tk, result: run(move, tuned, tk.frames, tk.aspect) }));
    const fired = (r, id) => r.result.cues.some((c) => c.id === id);
    const table = faultIds(move).map((id) => {
      const clean = runs.filter((r) => r.take.tag === 'clean'), own = runs.filter((r) => r.take.tag === id);
      const cleanFired = clean.filter((r) => fired(r, id)).length, ownFired = own.filter((r) => fired(r, id)).length;
      return { id, cleanTotal: clean.length, cleanFired, faultTotal: own.length, faultFired: ownFired,
        /* no verdict without a take of the fault; a pass needs quiet on the clean ones too */
        pass: own.length ? (cleanFired === 0 && ownFired === own.length) : null };
    });
    return { runs, table };
  }

  /* ---- the reps, one by one ----
     A rep move's run is cut at the coach's own phases: a rep is the stretch from
     the lift (phase up) to the return (phase back to down), counted if the coach
     counted it, an attempt if it was dropped early. Each carries the faults that
     were present inside it and when, which of them were said and when, the hold
     it earned, and the set-up faults present in the pause before it. A hold move
     is cut into the stretches its clock ran, with the faults that broke them in
     between. Numbers laid over the defaults change all of this at once, which is
     the point: which reps would flag, and at what moments. */
  /* A fault counts inside a rep the way the coach counts it: it has to be one the
     coach was watching in that phase (a hip still on its way up is not "short of
     the line", and nothing is judged on the way down), and it has to hold for the
     persist time, the coach's own threshold for a fault worth saying. A flicker
     shorter than that never reaches the voice and is left out here too. */
  function within(result, id, t0, t1) {
    const out = []; let open = null;
    for (const r of result.rows) {
      if (r.t < t0 || r.t > t1) continue;
      const on = !!(r.out && r.out.active && r.out.active.includes(id));
      if (on && !open) open = { t0: r.t, t1: r.t };
      else if (on) open.t1 = r.t;
      else if (open) { out.push(open); open = null; }
    }
    if (open) out.push(open);
    const persist = (result.cfg && result.cfg.persistMs) || 0;
    return out.filter((s) => s.t1 - s.t0 >= persist);
  }
  function faultsIn(result, move, t0, t1, ids) {
    return (ids || faultIds(move)).map((id) => {
      const stretches = within(result, id, t0, t1);
      if (!stretches.length) return null;
      const said = result.cues.filter((c) => c.id === id && c.t >= t0 && c.t <= t1).map((c) => c.t);
      return { id, stretches, said, ms: stretches.reduce((a, s) => a + (s.t1 - s.t0), 0) };
    }).filter(Boolean);
  }
  function reps(result, move) {
    const rows = result.rows; if (!rows.length) return [];
    const segs = [];
    if (move.reps) {
      let cur = null, lastReps = 0, pauseFrom = rows[0].t;
      const setup = move.setup || [];
      rows.forEach((r, i) => {
        const ph = r.out && r.out.phase, active = ph === 'up' || ph === 'lower';
        if (active && !cur) cur = { t0: r.t, i0: i, before: { t0: pauseFrom, t1: r.t }, holdMs0: r.out.holdMs || 0, lowerAt: null };
        if (cur && ph === 'lower' && cur.lowerAt == null) cur.lowerAt = r.t;
        if (cur && !active) {
          const n = (r.out && r.out.reps) || 0;
          cur.t1 = r.t; cur.i1 = i; cur.counted = n > lastReps; lastReps = n;
          cur.holdMs = ((r.out && r.out.holdMs) || 0) - cur.holdMs0;
          segs.push(cur); cur = null; pauseFrom = r.t;
        }
      });
      if (cur) { const last = rows[rows.length - 1]; cur.t1 = last.t; cur.i1 = rows.length - 1; cur.counted = false; cur.open = true; cur.holdMs = ((last.out && last.out.holdMs) || 0) - cur.holdMs0; segs.push(cur); }
      let n = 0;
      return segs.map((s) => {
        if (s.counted) n += 1;
        return {
          n: s.counted ? n : null, counted: s.counted, open: !!s.open, t0: s.t0, t1: s.t1,
          holdMs: Math.max(0, s.holdMs || 0), lowerMs: s.lowerAt != null ? s.t1 - s.lowerAt : null,
          faults: faultsIn(result, move, s.t0, s.t1),
          before: { t0: s.before.t0, t1: s.before.t1, faults: faultsIn(result, move, s.before.t0, s.before.t1, setup.length ? setup : []) },
          cues: result.cues.filter((c) => c.t >= s.t0 && c.t <= s.t1),
        };
      });
    }
    /* a hold: the stretches the clock ran, and what broke them */
    let cur = null, pauseFrom = rows[0].t;
    rows.forEach((r, i) => {
      const on = !!(r.out && r.out.holding);
      if (on && !cur) cur = { t0: r.t, before: { t0: pauseFrom, t1: r.t } };
      if (cur && !on) { cur.t1 = r.t; segs.push(cur); cur = null; pauseFrom = r.t; }
    });
    if (cur) { cur.t1 = rows[rows.length - 1].t; cur.open = true; segs.push(cur); }
    return segs.map((s, i) => ({
      n: i + 1, counted: true, open: !!s.open, t0: s.t0, t1: s.t1, holdMs: s.t1 - s.t0, lowerMs: null,
      faults: faultsIn(result, move, s.t0, s.t1),
      before: { t0: s.before.t0, t1: s.before.t1, faults: faultsIn(result, move, s.before.t0, s.before.t1) },
      cues: result.cues.filter((c) => c.t >= s.t0 && c.t <= s.t1),
    }));
  }

  /* ---- a trace on disk: compact arrays, one file ---- */
  function pack(meta, frames) {
    return Object.assign({ v: 1 }, meta, {
      frames: frames.map((f) => ({ t: Math.round(f.t), lm: f.lm ? f.lm.map((p) => [+p.x.toFixed(4), +p.y.toFixed(4), +(p.z || 0).toFixed(4), +(p.visibility == null ? 1 : p.visibility).toFixed(3)]) : null })),
    });
  }
  function unpack(json) {
    const d = typeof json === 'string' ? JSON.parse(json) : json;
    if (!d || d.v !== 1 || !Array.isArray(d.frames)) throw new Error('not a trace');
    const frames = d.frames.map((f) => ({ t: f.t, lm: f.lm ? f.lm.map((p) => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] })) : null }));
    const { frames: _, ...meta } = d;
    return { meta, frames };
  }

  return { settingsOf, defaults, bandRange, run, stretches, faultIds, verdicts, reps, pack, unpack };
});
