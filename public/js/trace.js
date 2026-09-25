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

  return { settingsOf, defaults, bandRange, run, stretches, faultIds, verdicts, pack, unpack };
});
