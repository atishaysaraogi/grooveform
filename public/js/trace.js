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
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./core.js'), require('./spec.js'));
  else root.Trace = factory(root.Core, root.Spec);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, Spec) {
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
  /* opts.room: a function of a reading that says which joint the movement would take out of the picture (the page has the figure; this file does not) */
  function run(move, tuned, frames, aspect, opts) {
    const coach = new Core.Coach(move, tuned || {});
    const room = opts && opts.room;
    const smoother = new Core.Smoother(coach.cfg.smooth), gate = new Core.JumpGate(coach.cfg);
    const rows = frames.map((f) => {
      const lm = gate.apply(f.lm, f.t);
      if (f.scene) coach.scene(f.scene);
      const reading = smoother.apply(move.read(lm, aspect, coach.cfg));
      if (room && !coach.ready) coach.room(room(reading));
      const out = coach.step(reading, f.t);
      return { t: f.t, reading, verdict: out.verdict, out, held: gate.held.length, scene: f.scene || null };
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
  function within(result, id, t0, t1, move) {
    const out = []; let open = null;
    for (const r of result.rows) {
      if (r.t < t0 || r.t > t1) continue;
      const on = !!(r.out && r.out.active && r.out.active.includes(id));
      if (on && !open) open = { t0: r.t, t1: r.t };
      else if (on) open.t1 = r.t;
      else if (open) { out.push(open); open = null; }
    }
    if (open) out.push(open);
    const own = move && move.persist && move.persist[id];
    const persist = own != null ? own : (result.cfg && result.cfg.persistMs) || 0;
    return out.filter((s) => s.t1 - s.t0 >= persist);
  }
  function faultsIn(result, move, t0, t1, ids) {
    return (ids || faultIds(move)).map((id) => {
      const stretches = within(result, id, t0, t1, move);
      if (!stretches.length) return null;
      const said = result.cues.filter((c) => c.id === id && c.t >= t0 && c.t <= t1).map((c) => c.t);
      return { id, stretches, said, ms: stretches.reduce((a, s) => a + (s.t1 - s.t0), 0) };
    }).filter(Boolean);
  }
  /* the reading a rep is judged on, and its lines: the compiled move keeps the file, and the
     numbers come from the run's own settings */
  function progressOf(move, cfg) {
    const p = move.reps && move.spec && move.spec.progress; if (!p) return null;
    const m = (move.measurements || []).find((q) => q.key === p.measure);
    const kind = m ? m.kind : 'angle';
    return { key: p.measure, of: m ? (m.of || m.key) : p.measure, band: (move.bands || []).find((b) => b.key === p.measure) || null,
      raiseAt: cfg[p.raiseAt], downAt: cfg[p.downAt], dir: p.direction === 'down' ? -1 : 1,
      label: (m && (m.label || m.hud)) || p.measure, unit: ['angle', 'tilt', 'floor', 'down', 'bend', 'rise'].includes(kind) ? '\u00b0' : kind === 'distance' ? '%' : '',
      keep: (move.spec.inPosition || (move.bands || []).map((b) => b.key)).filter((k) => k !== p.measure) };
  }
  /* why an attempt did or did not count, in numbers: how far it got, how long it was in
     position at the top, how long the hold clock ran against its target, which band broke
     the position and for how long, how long the person was not seen */
  function account(result, move, i0, i1) {
    const P = progressOf(move, result.cfg); if (!P) return null;
    const rows = result.rows, cfg = result.cfg;
    let peak = null, inPosMs = 0, unseenMs = 0, edgeMs = 0; const bad = {}, edgeParts = {};
    for (let i = i0; i <= i1; i++) {
      const r = rows[i], dt = i ? r.t - rows[i - 1].t : 0, v = r.verdict;
      const x = r.reading && r.reading.ok ? r.reading[P.of] : null;
      if (x != null && (peak == null || (P.dir > 0 ? x > peak : x < peak))) peak = x;
      if (!v || !v.ok) { unseenMs += dt; const e = r.reading && r.reading.edge; if (e) { edgeMs += dt; const w = Core.partWords(e.side, e.joint); edgeParts[w] = (edgeParts[w] || 0) + dt; } continue; }
      if (v.inPosition) inPosMs += dt;
      if (v.raised) for (const k of P.keep) if (v.good && v.good[k] === false) bad[k] = (bad[k] || 0) + dt;
    }
    return { peak, inPosMs, unseenMs, edgeMs, edgeParts, bad, targetMs: cfg.holdTargetSec * 1000, settleMs: cfg.settleMs, returnMs: cfg.returnMs || 0, raiseAt: P.raiseAt, downAt: P.downAt, dir: P.dir, unit: P.unit,
      top: P.band ? bandRange(P.band, cfg) : null };
  }
  /* movements that fell short of a rep: between reps, the reading left the start line, got at
     least four tenths of the way to the line a rep begins at, and came back without one beginning */
  function misses(result, move) {
    const P = progressOf(move, result.cfg); if (!P) return [];
    const rows = result.rows, out = []; let cur = null;
    const gap = P.raiseAt - P.downAt; if (!gap) return [];
    const close = () => { if (cur) { const share = (cur.peak - P.downAt) / gap; if (share >= 0.4 && share < 1) out.push({ t0: cur.t0, t1: cur.t1, tPeak: cur.tPeak, peak: cur.peak, share, raiseAt: P.raiseAt, unit: P.unit }); } cur = null; };
    for (const r of rows) {
      const o = r.out, down = o && o.ready && o.phase === 'down';
      if (!down) { cur = null; continue; }   // an excursion still open when a rep begins is its run-up, not a miss
      const x = r.reading && r.reading.ok ? r.reading[P.of] : null, atStart = !!(r.verdict && r.verdict.ok && r.verdict.atStart);
      if (cur) { cur.t1 = r.t; if (x != null && (P.dir > 0 ? x > cur.peak : x < cur.peak)) { cur.peak = x; cur.tPeak = r.t; } if (atStart) close(); }
      else if (x != null && !atStart) cur = { t0: r.t, t1: r.t, peak: x, tPeak: r.t };
    }
    return out;
  }

  function reps(result, move) {
    const rows = result.rows; if (!rows.length) return [];
    const segs = [];
    if (move.reps) {
      let cur = null, lastReps = 0, pauseFrom = rows[0].t;
      /* the faults judged at rest — at all times, or only between reps — in the move's order */
      const setup = (move.faults || []).filter((id) => (move.setup || []).includes(id) || (move.when && move.when[id] === 'between'));
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
          n: s.counted ? n : null, counted: s.counted, open: !!s.open, t0: s.t0, t1: s.t1, i0: s.i0, i1: s.i1,
          holdMs: Math.max(0, s.holdMs || 0), lowerMs: s.lowerAt != null ? s.t1 - s.lowerAt : null,
          early: result.cues.some((c) => c.id === 'early' && c.t >= s.t0 && c.t <= s.t1 + 1),
          why: account(result, move, s.i0, s.i1),
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

  /* ---- the reps classified by a person, and the numbers that follow ----
     A label is what a person said of one rep (or of one movement that fell short of a
     rep): { t0, t1, tag: 'clean' | 'faults' | 'skip' | 'rep', faults: [ids] }. It is kept by its
     time, not by its index, so the same label finds its rep again after a band edge moves
     and the reps are cut afresh. 'skip' is a stretch that was not an attempt at all; 'rep'
     marks a short movement that was one, which the lift line should have let through. */
  const overlap = (a, b) => Math.max(0, Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0));
  function labelOf(labels, seg) {
    let best = null, most = 0;
    for (const l of labels || []) { const o = overlap(l, seg); if (o > most && o >= 0.5 * Math.min(l.t1 - l.t0, seg.t1 - seg.t0)) { best = l; most = o; } }
    return best;
  }
  /* the most extreme level a reading held for `ms` inside a window: the frames sorted from
     the far end and walked until their time adds up — a one-frame spike is not a level */
  function sustained(samples, side, ms) {
    const s = samples.slice().sort((a, b) => (side === 'above' ? b.v - a.v : a.v - b.v));
    let acc = 0; for (const x of s) { acc += x.dt; if (acc >= ms) return x.v; }
    return s.length ? s[s.length - 1].v : null;
  }
  /* the frames a fault is judged on inside a rep, as the coach judges it: at the top (raised),
     through the rep, in the pause before it, or both. `id` is a fault's id, whose own `when`
     is used, or one of the window names itself. windowIdx gives the rows' indices, so a
     series read over the whole run can be sliced without matching times again. */
  const WHENS = ['top', 'rep', 'between', 'always'];
  function windowIdx(result, move, rep, id) {
    const w = WHENS.includes(id) ? id : (move.when && move.when[id]) || 'top', rows = result.rows, out = [];
    const inRep = (r) => r.t >= rep.t0 && r.t <= rep.t1;
    const before = (r) => !!rep.before && r.t >= rep.before.t0 && r.t < rep.before.t1;
    const keep = w === 'between' ? before : w === 'always' ? (r) => inRep(r) || before(r) : (w === 'rep' || !move.reps) ? inRep : (r) => inRep(r) && r.verdict && r.verdict.ok && r.verdict.raised;
    rows.forEach((r, i) => { if (keep(r)) out.push(i); });
    return out;
  }
  const windowOf = (result, move, rep, id) => windowIdx(result, move, rep, id).map((i) => result.rows[i]);
  const unitOf = (m) => { const kind = m ? m.kind : 'angle'; return ['angle', 'tilt', 'floor', 'down', 'bend', 'rise'].includes(kind) ? '\u00b0' : kind === 'distance' ? '%' : ''; };
  const nameOfM = (m) => m.of || m.key;
  /* For every fault, the edge that would agree with the person: clean reps (and reps marked
     with other faults) must stay inside it, reps marked with the fault must cross it. In the
     fault's own direction: the clean reps' furthest level is one wall, the marked reps'
     nearest is the other; an edge between them with a little room is recommended, the current
     one kept when it already does the job, and when the two overlap the cut that gets most reps
     right, with the ones it gets wrong counted. The lift line is checked the same way against
     the reps a person called reps.
     Several recordings are judged together: `runs` is [{ result, reps, labels, misses, name }]
     and their reps are pooled (every run shares the numbers of the first run's result). The
     old form, recommend(move, result, reps, labels, misses), is one run. A label may name a
     fault the file does not have ('+' and words, see discover); there is no edge to move for
     it, so it is passed over here. */
  function recommend(move, runs, reps, labels, misses) {
    if (!Array.isArray(runs)) runs = [{ result: runs, reps, labels, misses }];
    runs = runs.filter((r) => r && r.result);
    const out = { labelled: 0, skipped: 0, unlabelled: 0, recordings: runs.length, faults: [], lines: [] };
    if (!runs.length) return out;
    const cfg = runs[0].result.cfg, persist = cfg.persistMs || 0;
    const byKey = {}; for (const m of move.measurements || []) byKey[m.key] = m;
    const settings = settingsOf(move); const settingOf = (k) => settings.find((x) => x.key === k) || null;
    const labelled = [];
    runs.forEach((run, i) => {
      const take = run.name == null ? i : run.name;
      for (const rep of run.reps || []) {
        const label = labelOf(run.labels, rep);
        if (!label) out.unlabelled++; else if (label.tag === 'skip') out.skipped++; else labelled.push({ run, take, rep, label });
      }
    });
    out.labelled = labelled.length;
    for (const f of (move.spec && move.spec.faults) || []) {
      const m = byKey[f.measure]; if (!m || !m.band || !['above', 'below'].includes(f.side)) continue;
      const b = m.band, sym = !!b.sym, key = f.side === 'above' ? (b.sym || b.hi || b.max) : (b.sym || b.lo || b.min);
      if (!key || typeof cfg[key] !== 'number') continue;
      const unit = unitOf(m), step = unit === '\u00b0' ? 1 : unit === '%' ? 1 : 0.5;
      /* in the fault's own direction: 'above' as it is, 'below' with the sign turned, a symmetric band as the distance from zero */
      const sign = sym || f.side === 'above' ? 1 : -1;
      const toward = (v) => (sym ? Math.abs(v) : v * sign), back = (v) => v * (sym ? 1 : sign);
      const edgeNow = toward(cfg[key]);
      const clean = [], bad = [], by = [];
      labelled.forEach(({ run, take, rep, label }, i) => {
        const rows = windowOf(run.result, move, rep, f.id), samples = [];
        for (let k = 0; k < rows.length; k++) { const r = rows[k], v = r.reading && r.reading.ok ? r.reading[nameOfM(m)] : null; if (v == null) continue; samples.push({ v: toward(v), dt: k ? Math.max(0, rows[k].t - rows[k - 1].t) : 33 }); }
        if (!samples.length) return;
        const v = sustained(samples, 'above', persist); if (v == null) return;
        const has = label.tag === 'faults' && (label.faults || []).includes(f.id);
        (has ? bad : clean).push({ v, n: rep.n, t0: rep.t0, take, i, fired: rep.faults.some((x) => x.id === f.id) });
        by.push({ take, n: rep.n, t0: rep.t0, v: Math.round(back(v) * 10) / 10, marked: has });
      });
      if (!clean.length && !bad.length) continue;
      const cMax = clean.length ? Math.max(...clean.map((x) => x.v)) : -Infinity, fMin = bad.length ? Math.min(...bad.map((x) => x.v)) : Infinity;
      const nowFalse = clean.filter((x) => x.fired).length, nowMiss = bad.filter((x) => !x.fired).length;
      const round = (v) => Math.round(v / step) * step;
      let value, status, wrongClean = 0, wrongBad = 0;
      const ok = (T) => T >= cMax - 1e-9 && T < fMin;
      if (cMax < fMin) {
        if (ok(edgeNow) && !nowFalse && !nowMiss) { value = edgeNow; status = 'fine'; }
        else {
          const span = fMin - cMax, margin = Number.isFinite(span) ? Math.min(step, span / 4) : step;
          const low = clean.length ? cMax + margin : -Infinity, high = bad.length ? fMin - margin : Infinity;
          let T = Math.min(Math.max(edgeNow, low), high);
          if (!Number.isFinite(T)) T = Number.isFinite(low) ? low : high;
          T = round(T);
          if (!ok(T)) T = Number.isFinite(span) ? (cMax + fMin) / 2 : T;   // the rounding crossed a wall: the middle, unrounded
          value = T; status = 'move';
        }
      } else {
        /* the clean and the marked reps overlap: the cut that gets the most right, nearest the edge now */
        const vals = [...new Set(clean.concat(bad).map((x) => x.v))].sort((a, b) => a - b);
        const cands = [vals[0] - step].concat(vals.slice(1).map((v, i) => (vals[i] + v) / 2), [vals[vals.length - 1] + step]);
        let best = null;
        for (const T of cands) {
          const wc = clean.filter((x) => x.v > T).length, wb = bad.filter((x) => x.v <= T).length, score = wc + wb;
          if (!best || score < best.score || (score === best.score && Math.abs(T - edgeNow) < Math.abs(best.T - edgeNow))) best = { T, score, wc, wb };
        }
        value = round(best.T); wrongClean = best.wc; wrongBad = best.wb; status = 'overlap';
      }
      /* back into the setting's own direction and range */
      let setting = sym ? value : value * sign;
      const sdef = settingOf(key); if (sdef) setting = Math.min(sdef.max, Math.max(sdef.min, setting));
      setting = Math.round(setting * 10) / 10;
      /* the reps the recommended edge still gets wrong: a clean rep that would fire (false), a marked one it would miss */
      const T = sym ? setting : setting * sign;
      const wrong = clean.filter((x) => x.v > T).map((x) => ({ take: x.take, n: x.n, t0: x.t0, kind: 'false', i: x.i }))
        .concat(bad.filter((x) => x.v <= T).map((x) => ({ take: x.take, n: x.n, t0: x.t0, kind: 'miss', i: x.i }))).sort((p, q) => p.i - q.i).map(({ i, ...w }) => w);
      out.faults.push({ id: f.id, label: f.label || f.id, measure: m.label || m.key, key, setting: sdef ? sdef.label : key, unit, side: f.side, sym,
        now: cfg[key], value: setting, status: status === 'fine' ? 'fine' : setting === Math.round(cfg[key] * 10) / 10 ? 'fine' : status,
        clean: { n: clean.length, lo: clean.length ? back(Math.min(...clean.map((x) => x.v))) : null, hi: clean.length ? back(Math.max(...clean.map((x) => x.v))) : null },
        bad: { n: bad.length, lo: bad.length ? back(Math.min(...bad.map((x) => x.v))) : null, hi: bad.length ? back(Math.max(...bad.map((x) => x.v))) : null },
        nowFalse, nowMiss, afterFalse: wrong.filter((w) => w.kind === 'false').length, afterMiss: wrong.filter((w) => w.kind === 'miss').length,
        wrong, recordings: runs.length, by });
    }
    /* the lift line: every rep a person called a rep has to cross it */
    const P = progressOf(move, cfg);
    if (P && P.raiseAt != null) {
      const peaks = labelled.filter((x) => x.rep.why && x.rep.why.peak != null).map((x) => x.rep.why.peak);
      for (const run of runs) for (const mm of run.misses || []) { const l = labelOf(run.labels, mm); if (l && l.tag === 'rep') peaks.push(mm.peak); }
      if (peaks.length) {
        const nearest = P.dir > 0 ? Math.min(...peaks) : Math.max(...peaks);
        const short = P.dir > 0 ? nearest < P.raiseAt : nearest > P.raiseAt;
        const sdef = settingOf(move.spec.progress.raiseAt);
        let value = P.raiseAt;
        if (short) { value = nearest - P.dir * Math.max(1, Math.abs(nearest - P.downAt) * 0.1); if (sdef) value = Math.min(sdef.max, Math.max(sdef.min, value)); value = Math.round(value); }
        out.lines.push({ key: move.spec.progress.raiseAt, setting: sdef ? sdef.label : 'a rep starts past', measure: P.label, unit: P.unit, now: P.raiseAt, value, status: short ? 'move' : 'fine', nearest, n: peaks.length });
      }
    }
    return out;
  }

  /* ---- measures the exercise lacks that separate the reps a person marked ----
     recommend answers "where should the edge of a fault I have go?". This answers the
     question after it: which measurement, not yet in the file, would tell the reps marked
     with a fault from the clean ones? Every measurement the file's language can write over
     the landmarks the recording trusts is read with Spec.measure — the function the coach
     will run once it is in the file — smoothed as the coach smooths, and the level each rep
     held for the persist time inside the fault's own window is taken.
     Three facts shape the scoring. With n labelled reps of which m are marked, a measurement
     that carries no information at all still puts the marked reps on one side of the clean
     ones with probability 2 / C(n, m) — two in three at two clean and one marked — so a
     perfect split is nearly worthless on its own and the count of reps a cut gets right
     cannot rank candidates. What carries information is the size of the gap between the two
     groups against the pose model's own wobble on that geometry: a 25° gap on a shin that
     wobbles 2° is a thing a person can see in the video, a 3° gap is not. And the wobble is
     not one number: a landmark jitters by a few tenths of a percent of the picture, which on
     a 7% foot is ±5° and on a 20% trunk ±1.5°, so the floor has to come from the segment
     lengths. So: rank by the gap in noise units, gate on it, say how many candidates would
     split these reps by luck alone, and hand back the per-rep values so the person can judge
     the separation with their own eyes. */
  const OTHER = { L: 'R', R: 'L' };
  const SLOTS = Spec.SLOT_KEYS;
  const pointsOf = (m) => SLOTS.map((k) => m[k]).filter(Boolean).map((x) => (Array.isArray(x) ? x[0] : x)).filter((x) => x !== Spec.FLOOR);
  const needsOf = (m) => pointsOf(m).concat(m.per || []);
  const geometryOf = (m) => Object.assign({ kind: m.kind }, ...SLOTS.filter((k) => m[k]).map((k) => ({ [k]: m[k] })), m.per ? { per: m.per, times: m.times } : {}, m.fromStart ? { fromStart: m.fromStart } : {});
  /* tilt, floor, rise and down are one direction angle in four sign conventions, and bend is
     180 less the angle: a candidate is the same thing as an existing measurement when the
     family, the points and the reference agree */
  const FAMILY = { angle: 'angle', bend: 'angle', tilt: 'dir', floor: 'dir', rise: 'dir', down: 'dir', distance: 'len' };
  const sigOf = (m) => (FAMILY[m.kind] || m.kind) + ':' + pointsOf(m).slice().sort().join('|') + ':' + (m.fromStart || '');
  const BONES = [['ear', 'shoulder'], ['shoulder', 'elbow'], ['elbow', 'wrist'], ['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle'], ['ankle', 'heel'], ['ankle', 'toe'], ['heel', 'toe']];
  const SPANS = [['shoulder', 'wrist'], ['hip', 'ankle'], ['hip', 'heel'], ['knee', 'heel'], ['knee', 'toe'], ['shoulder', 'knee'], ['ear', 'hip']];
  const TRIPLES = [['ear', 'shoulder', 'hip'], ['shoulder', 'elbow', 'wrist'], ['hip', 'shoulder', 'elbow'], ['hip', 'shoulder', 'wrist'], ['ear', 'shoulder', 'elbow'], ['shoulder', 'hip', 'knee'], ['shoulder', 'hip', 'ankle'],
    ['hip', 'knee', 'ankle'], ['hip', 'knee', 'heel'], ['knee', 'ankle', 'toe'], ['knee', 'ankle', 'heel'], ['toe', 'heel', 'knee']];
  const BENDS = [['shoulder', 'hip', 'ankle'], ['shoulder', 'hip', 'heel'], ['ear', 'shoulder', 'hip']];
  const ACROSS = ['shoulder', 'hip', 'knee', 'ankle', 'heel', 'wrist'];
  const REFS = [['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle']];
  const REF_WORDS = { 'shoulder|hip': 'trunk', 'hip|knee': 'thigh', 'knee|ankle': 'shin' };
  const FLOOR = { angle: 2, bend: 2, tilt: 1.5, rise: 1.5, floor: 1.5, down: 1.5, distance: 2 };   // the least wobble a kind is given, in its unit
  const RANGE = { angle: [0, 180], bend: [-180, 180], tilt: [-90, 90], rise: [-90, 90], floor: [0, 180], down: [0, 180], distance: [0, 400] };
  const KIND_WORDS = { angle: 'the angle at', tilt: 'the lean from upright of', rise: 'the rise of', bend: 'the bend at', distance: 'the length of' };
  const WHEN_WORDS = { top: 'at the top', rep: 'through the rep', between: 'before the rep', always: 'at all times' };
  const TIMES = ['', 'once', 'twice', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
  const median = (xs) => { const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
  const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  const pointIn = (rd, n) => Spec.pointOf(n, rd.points, { [rd.side]: rd.points, [rd.side === 'L' ? 'R' : 'L']: rd.other }, rd.side, rd.facing) || null;
  const round1 = (v) => Math.round(v * 10) / 10;
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

  /* The catalogue: every measurement worth writing over the landmarks in play, as plain geometry,
     each with a prior for the tie-breaks — a bone or a joint angle before a spanning line, a
     length last. One of rise or tilt per segment — listing the four direction kinds would show
     one thing four times and multiply the luck count by four — rise when the segment lies nearer
     level at the median, tilt when nearer plumb, with the lower point first so a tilt reads near
     0 and a rise reads "b above a", the way the files are written; the same segments as lengths
     against the reference (the trunk, else the thigh, else the shin: the first that is steady);
     the angles at the joints; the three body-line bends, where the sign is the point; and the
     lines across the body when the far side is in play. A front view keeps only the unsigned
     kinds, since which way the body faces is a coin toss there. Every member twice: as it is,
     and as the change from the start position. */
  function catalogue(move, names, at, ref) {
    const front = move.view === 'front', out = [];
    const has = (ns) => ns.every((n) => names.includes(n));
    const length = (a, b) => { if (ref && !(ref.includes(a) && ref.includes(b))) out.push({ kind: 'distance', a, b, per: ref, times: 100, prior: 0.7 }); };
    for (const [p, q] of BONES.concat(SPANS)) {
      if (!has([p, q])) continue;
      const [a, b] = at(p).y >= at(q).y ? [p, q] : [q, p], prior = BONES.some(([x, y]) => x === p && y === q) ? 1 : 0.85;
      const level = Math.abs(Core.rise(at(a), at(b)) || 0) < 45;
      out.push(level || front ? { kind: 'rise', a, b, prior } : { kind: 'tilt', base: a, top: b, prior });
      length(a, b);
    }
    for (const [a, b, c] of TRIPLES) if (has([a, b, c])) out.push({ kind: 'angle', a, b, c, prior: 1 });
    if (!front) for (const [a, b, c] of BENDS) if (has([a, b, c])) out.push({ kind: 'bend', a, b, c, prior: 0.85 });
    for (const n of ACROSS) if (has([n, 'other.' + n])) { out.push({ kind: 'rise', a: 'other.' + n, b: n, prior: 0.85 }); length(n, 'other.' + n); }
    if (has(['other.knee', 'hip', 'knee'])) out.push({ kind: 'angle', a: 'other.knee', b: 'hip', c: 'knee', prior: 0.85 });
    if (has(['other.wrist', 'shoulder', 'wrist'])) out.push({ kind: 'angle', a: 'other.wrist', b: 'shoulder', c: 'wrist', prior: 0.85 });
    return out.concat(out.map((m) => Object.assign({}, m, { fromStart: 'change' })));
  }

  /* Every candidate read over every row of one run, smoothed as the coach smooths its readings.
     The context is what the move's own read() builds: the points in square space, both sides
     under the reading's side, its facing, the run's own numbers. A frame in which a landmark the
     candidate needs is not trusted gives no value and leaves the smoother as it was — the
     model's guess at a hidden heel is not a reading. A change from the start is taken against
     the median of the second up to the coach's own snapshot (the first ready row), which is what
     the coach will read it against once it is in the file; a run that never got ready, or with
     fewer than three values in that second, has no baseline and its change variants are null. */
  function seriesOf(cands, result) {
    const cfg = result.cfg, rows = result.rows;
    const sm = cands.map(() => new Core.Smoother(cfg.smooth)), out = cands.map(() => new Array(rows.length).fill(null)), need = cands.map(needsOf);
    const bare = cands.map((m) => Object.assign({}, m, { fromStart: undefined }));
    rows.forEach((r, i) => {
      const rd = r.reading; if (!rd || !rd.ok) return;
      const ctx = { P: rd.points, both: { [rd.side]: rd.points, [OTHER[rd.side]]: rd.other }, cfg, facing: rd.facing, Core, values: {}, side: rd.side };
      const ok = {}; const good = (n) => (ok[n] == null ? (ok[n] = Core.trusted(pointIn(rd, n), cfg)) : ok[n]);
      cands.forEach((m, j) => { if (need[j].every(good)) out[j][i] = sm[j].of('x', Spec.measure(bare[j], ctx).x); });
    });
    const ri = rows.findIndex((r) => r.out && r.out.ready);
    cands.forEach((m, j) => {
      if (!m.fromStart) return;
      let base = null;
      if (ri >= 0) { const pick = []; for (let k = ri; k >= 0 && rows[k].t > rows[ri].t - 1000; k--) if (out[j][k] != null) pick.push(out[j][k]); base = pick.length >= 3 ? median(pick) : null; }
      out[j] = base == null ? null : out[j].map((v) => (v == null ? null : v - base));
    });
    return { series: out, ready: ri >= 0 };
  }
  /* the most a candidate rose and the most it fell inside a window, each held for the persist time */
  function extremesOf(vals, rows, idx, persist) {
    const samples = [];
    for (let k = 0; k < idx.length; k++) { const v = vals[idx[k]]; if (v == null) continue; samples.push({ v, dt: k ? Math.max(0, rows[idx[k]].t - rows[idx[k - 1]].t) : 33 }); }
    return samples.length ? { hi: sustained(samples, 'above', persist), lo: sustained(samples, 'below', persist) } : null;
  }
  /* The pose model's wobble on a candidate's geometry, in its own unit: one landmark's jitter
     (sigma, a share of the picture's height) spread over the lengths it is read across — a short
     segment turns the same jitter into more degrees — floored per kind, and times root two for a
     change from the start, which is two noisy readings. The smoothing roughly halves the jitter
     and the sustained extreme adds about one sigma of tail back, so the unsmoothed sigma is used
     as it is: a deliberate, slightly conservative floor. */
  function noiseOf(m, lenOf, sigma) {
    const L = (a, b) => Math.max(0.02, lenOf(a, b) || 0.1);
    let s;
    if (m.kind === 'angle' || m.kind === 'bend') s = Core.DEG * sigma * Math.sqrt(1 / L(m.a, m.b) ** 2 + 1 / L(m.b, m.c) ** 2);
    else if (m.kind === 'distance' && m.per) { const ref = L(m.per[0], m.per[1]); s = 100 * Math.SQRT2 * sigma / ref * Math.sqrt(1 + (L(m.a, m.b) / ref) ** 2); }
    else { const p = pointsOf(m); s = Core.DEG * Math.SQRT2 * sigma / L(p[0], p[1]); }
    return Math.max(FLOOR[m.kind] || 2, s) * (m.fromStart ? Math.SQRT2 : 1);
  }
  /* One candidate against one group. 'above' is judged on each rep's high, 'below' on its low:
     the gap is the marked reps' nearest level less the clean reps' furthest, the side the one
     that opens wider, and sep is that gap in units of what the clean reps wobble by (their own
     scatter, floored at the noise). With no split on either side, the cut among the midpoints
     of the sorted values (and a step beyond each end) that gets the fewest reps wrong, ties
     toward the clean reps' far wall; it makes an overlap row only with enough reps and the two
     groups' medians at least two noises apart. */
  function scoreOf(ex, marked, noise) {
    const sides = ['above', 'below'].map((side) => {
      const dir = side === 'above' ? 'hi' : 'lo', c = [], b = [], values = ex.map((e, i) => { (marked[i] ? b : c).push(e[dir]); return e[dir]; });
      const wall = side === 'above' ? Math.max(...c) : Math.min(...c), far = side === 'above' ? Math.min(...b) : Math.max(...b);
      const gap = side === 'above' ? far - wall : wall - far, mc = median(c);
      const spread = Math.max(noise, 1.4826 * median(c.map((v) => Math.abs(v - mc))));
      if (gap > 0) return { side, gap, sep: gap / spread, wrong: 0, cut: null, c, b, values, wall, far };
      const vals = [...new Set(c.concat(b))].sort((p, q) => p - q);
      const cuts = [vals[0] - 1].concat(vals.slice(1).map((v, i) => (vals[i] + v) / 2), [vals[vals.length - 1] + 1]);
      let best = null;
      for (const T of cuts) {
        const w = side === 'above' ? c.filter((v) => v > T).length + b.filter((v) => v <= T).length : c.filter((v) => v < T).length + b.filter((v) => v >= T).length;
        if (!best || w < best.wrong || (w === best.wrong && Math.abs(T - wall) < Math.abs(best.cut - wall))) best = { wrong: w, cut: T };
      }
      return { side, gap, sep: null, wrong: best.wrong, cut: best.cut, apart: Math.abs(median(b) - mc), c, b, values, wall, far };
    });
    return Object.assign(sides.sort((p, q) => ((q.gap > 0) - (p.gap > 0)) || (p.wrong - q.wrong) || (q.gap - p.gap))[0], { noise });
  }
  /* The edge: a third of the way from the clean wall toward the marked one, never nearer the
     clean reps than half the noise — they are usually the majority and the better known, and a
     marked rep milder than the mildest seen still has two thirds of the gap to be caught in —
     rounded to the step, or the unrounded middle when rounding crossed a wall. An overlap row's
     edge is its cut. */
  function edgeOf(s, step) {
    if (s.gap <= 0) return Math.round(s.cut / step) * step;
    const room = Math.max(s.noise / 2, s.gap / 3), e = Math.round((s.side === 'above' ? s.wall + room : s.wall - room) / step) * step;
    const ok = s.side === 'above' ? e >= s.wall - 1e-9 && e < s.far : e <= s.wall + 1e-9 && e > s.far;
    return ok ? e : (s.wall + s.far) / 2;
  }
  const camel = (words) => (Spec.words && Spec.words.camel ? Spec.words.camel(words) : String(words).toLowerCase().replace(/[^a-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')));
  const fmtN = (v) => String(Math.round(v)).replace('-', '−');
  const rangeWords = (vals, unit) => { const lo = Math.round(Math.min(...vals)), hi = Math.round(Math.max(...vals)); return lo === hi ? fmtN(lo) + unit : fmtN(lo) + (lo < 0 || hi < 0 ? ' to ' : '–') + fmtN(hi) + unit; };
  const timesWords = (k) => { const r = Math.round(k); return r >= 12 ? `${r} times` : r === 2 ? 'twice' : r <= 1 ? 'about once' : `${TIMES[r]} times`; };
  /* what a candidate is called, from the file's own describer unless the caller brings one */
  const describeOf = (describe, move) => (m) => {
    const d = describe ? describe(m) : Spec.words && Spec.words.describe ? Spec.words.describe(m, move.spec || {}) : null;
    if (d && d.what) return d;
    const p = pointsOf(m), what = (m.kind === 'angle' || m.kind === 'bend' ? `${KIND_WORDS[m.kind]} ${m.b} (${p.join('–')})` : `${KIND_WORDS[m.kind] || m.kind} ${p.join('–')}`) + (m.fromStart ? ', as the change since the start' : '');
    return { what, meaning: '', unit: unitOf(m), short: p.join('') + (m.fromStart ? 'change' : ''), hud: null };
  };

  /* A scored candidate as a row: the measurement as the file would carry it — a band on the
     marked side, a setting whose range covers the values seen with room, optional when it uses
     a landmark the move does not insist on (else judge() would fail the frame when that point
     is hidden) — the default at the edge, the fault that would use it, and the words. The key
     comes from the describer's short name (the caller may rename). */
  function rowOf(f, rank, also, G, ctx) {
    const { labelled, marked, describe, taken, move } = ctx, m = f.m, unit = unitOf(m), step = 1, edge = edgeOf(f, step), split = f.gap > 0;
    const d = describe(m), what = d.what, note = f.side === 'above' ? 'at most' : 'at least';
    let key = String(d.short || pointsOf(m).join('')).toLowerCase().replace(/[^a-z0-9]/g, '') || 'reading';
    if (/^[0-9]/.test(key)) key = 'm' + key;
    if (m.fromStart && !/change$/.test(key)) key += 'change';
    if (taken.has(key)) { let i = 2; while (taken.has(key + i)) i++; key += i; } taken.add(key);
    const skey = key + (f.side === 'above' ? 'max' : 'min');
    const nat = m.fromStart ? [-RANGE[m.kind][1], RANGE[m.kind][1]] : RANGE[m.kind] || [-Infinity, Infinity];
    const pad = Math.max(3 * f.noise, split ? f.gap : 0, 5);
    const scale = [Math.max(nat[0], Math.floor((Math.min(...f.values) - pad) / 5) * 5), Math.min(nat[1], Math.ceil((Math.max(...f.values) + pad) / 5) * 5)];
    const needed = move.needed || [], joints = move.joints || [], names = [...new Set(needsOf(m))];
    const measurement = Object.assign({ key }, geometryOf(m), names.some((n) => !needed.includes(n)) ? { optional: true } : {},
      { label: what, hud: d.hud || key.slice(0, 5).toUpperCase(), note, band: f.side === 'above' ? { max: skey } : { min: skey }, scale,
        settings: [{ key: skey, label: `${cap(what)}, ${note} (${unit === '%' ? 'percent' : 'degrees'})`, min: scale[0], max: scale[1] }],
        why: `Found from the recordings on ${new Date().toISOString().slice(0, 10)}: clean reps ${rangeWords(f.c, unit)}, reps marked "${G.label}" ${rangeWords(f.b, unit)}.` });
    /* the fault: for a fault the person named, a placeholder that says its own name until it is given words; for
       a fault the move has, a second detector beside the old one, said only when the old one is quiet — with the
       re-point of the old fault as the other way; none when the existing measurement already carries this fault */
    const measure = f.ex ? f.ex.key : key, whenPart = G.when !== 'top' ? { when: G.when } : {};
    const faultIds = ((move.spec && move.spec.faults) || []).map((x) => x.id);
    const unique = (id) => { let out = id, i = 2; while (faultIds.includes(out)) out = id + i++; return out; };
    let fault = null, repoint;
    if (f.ex && f.ex.hasFault) fault = null;
    else if (G.old) {
      fault = Object.assign({ id: unique(G.old.id + '2'), measure, side: f.side }, whenPart, { label: G.old.label, text: G.old.text }, G.old.deep ? { deep: G.old.deep } : {}, G.old.tone ? { tone: G.old.tone } : {}, { unless: [G.old.id] });
      repoint = { measure, side: f.side };
    } else { const words = G.id === '*' ? 'A fault' : G.label; fault = Object.assign({ id: unique(camel(words)), measure, side: f.side }, whenPart, { label: words.slice(0, 26), text: words, tone: 'plain' }); }
    /* the words */
    const n = f.c.length + f.b.length, pts = pointsOf(m).length, bone = pts === 2 && BONES.some(([x, y]) => pointsOf(m).includes(x) && pointsOf(m).includes(y));
    const shape = m.kind === 'distance' ? `a length against the ${REF_WORDS[(m.per || []).join('|')] || 'reference'}` : pts === 2 ? (bone ? 'two points on one bone' : 'two points') : 'three points';
    const why = split ? `The two groups are ${fmtN(f.gap)}${unit} apart, ${timesWords(f.sep)} the model's wobble on this ${m.kind === 'distance' ? 'length' : pts === 3 ? 'joint' : 'segment'}; ${shape}.`
      : `No clean split: this cut gets ${n - f.wrong} of ${n} reps right.`;
    const whenWords = (Spec.words && Spec.words.whenWords && move.spec ? Spec.words.whenWords(move.spec, G.when) : null) || (!move.reps && G.when === 'rep' ? 'in the hold' : WHEN_WORDS[G.when] || WHEN_WORDS.rep);
    const sentence = `${cap(what)} — clean reps ${rangeWords(f.c, unit)}, ${G.id === '*' ? 'reps marked with any fault' : 'marked reps'} ${rangeWords(f.b, unit)}; suggest ${note} ${fmtN(edge)}${unit} ${whenWords}`;
    const cls = (x) => (x.sep == null ? null : x.sep >= 4 ? 'clear' : 'fair');
    return Object.assign({ rank, status: !split ? 'overlap' : f.ex ? 'existing' : 'new', side: f.side, measurement, defaults: { [skey]: round1(edge) }, fault }, repoint ? { repoint } : {},
      { landmarks: names.filter((x) => !joints.includes(x)), existing: f.ex, edge: round1(edge), step, unit, gap: round1(f.gap), noise: round1(f.noise), sep: f.sep == null ? null : +f.sep.toFixed(2), class: cls(f), wrong: f.wrong,
        clean: { n: f.c.length, lo: round1(Math.min(...f.c)), hi: round1(Math.max(...f.c)) }, marked: { n: f.b.length, lo: round1(Math.min(...f.b)), hi: round1(Math.max(...f.b)) },
        values: labelled.map((x, i) => ({ take: x.take, n: x.rep.n, t0: x.rep.t0, marked: marked[i], v: round1(f.values[i]) })),
        why, words: { what, meaning: d.meaning || '', unit: d.unit || unit, sentence, why },
        also: also.map((g) => ({ measurement: geometryOf(g.m), sep: g.sep == null ? null : +g.sep.toFixed(2), class: cls(g), existing: g.ex })) });
  }

  /* discover(move, runs, opts): runs = [{ result, reps, labels, name }], one per recording;
     opts = { sigma: one landmark's wobble as a share of the picture (0.004), max: rows per
     group (8), describe: (m) → { what, meaning, unit, short, hud } for the words (the file's
     own describer when absent), windows: { [groupId]: ['top'|'rep'|'between'|'always'] } }.
     A label's `faults` may name a fault the file does not have, as '+' and the words
     ('+Feet sliding'): each such name is a group here, as is every known fault id the
     labels name, and '*' — every marked rep against the clean ones — when two or more are
     named. Clean for a group is every labelled rep not marked with it, as recommend counts.
     Returns { labelled, candidates: { total, kept, skipped: { untrusted, noStart, leaping } }, reference, groups, ms }. */
  function discover(move, runs, opts) {
    const t0 = Date.now(), o = opts || {}, sigma = o.sigma == null ? 0.004 : o.sigma, max = o.max == null ? 8 : o.max, describe = describeOf(o.describe, move);
    runs = (runs || []).filter((r) => r && r.result && r.result.rows && r.result.rows.length);
    const out = { labelled: 0, candidates: { total: 0, kept: 0, skipped: { untrusted: [], noStart: 0, leaping: 0 } }, reference: null, groups: [], ms: 0 };
    const done = () => { out.ms = Date.now() - t0; return out; };
    const labelled = [];
    runs.forEach((run, ri) => { for (const rep of run.reps || []) { const label = labelOf(run.labels, rep); if (label && label.tag !== 'skip') labelled.push({ run: ri, take: run.name == null ? 'take ' + (ri + 1) : run.name, rep, label }); } });
    out.labelled = labelled.length;
    if (!labelled.length) return done();
    const cfg = runs[0].result.cfg, persist = cfg.persistMs || 0;
    /* the landmarks in play, and the share of the labelled reps' frames in which each is trusted */
    const inside = runs.map((run, ri) => run.result.rows.map((r) => labelled.some((x) => x.run === ri && r.t >= (x.rep.before ? x.rep.before.t0 : x.rep.t0) && r.t <= x.rep.t1)));
    const seen = []; runs.forEach((run, ri) => run.result.rows.forEach((r, i) => { if (inside[ri][i] && r.reading && r.reading.ok) seen.push(r.reading); }));
    if (!seen.length) return done();
    const inPlay = Spec.LANDMARKS.concat(Spec.LANDMARKS.map((n) => 'other.' + n).filter((n) => (move.joints || []).includes(n) || move.view === 'front'));
    const share = {}; for (const n of inPlay) share[n] = seen.filter((rd) => Core.trusted(pointIn(rd, n), cfg)).length / seen.length;
    const trusted = inPlay.filter((n) => share[n] >= 0.9), untrusted = inPlay.filter((n) => share[n] < 0.9);
    const pos = {}, lens = {};
    const at = (n) => pos[n] || (pos[n] = { x: median(seen.map((rd) => { const p = pointIn(rd, n); return p ? p.x : null; })) || 0, y: median(seen.map((rd) => { const p = pointIn(rd, n); return p ? p.y : null; })) || 0 });
    const lengths = (a, b) => seen.map((rd) => { const p = pointIn(rd, a), q = pointIn(rd, b); return p && q ? Math.hypot(p.x - q.x, p.y - q.y) : null; }).filter((v) => v != null);
    const lenOf = (a, b) => { const k = a + '|' + b; if (lens[k] == null) lens[k] = median(lengths(a, b)); return lens[k]; };
    /* the reference for lengths: the first steady segment — a limb turning toward the camera is no ruler */
    const steady = ([a, b]) => { if (!trusted.includes(a) || !trusted.includes(b)) return false; const L = lengths(a, b), mean = L.reduce((s, v) => s + v, 0) / L.length; return mean > 0 && Math.sqrt(L.reduce((s, v) => s + (v - mean) ** 2, 0) / L.length) / mean <= 0.1; };
    const ref = REFS.find(steady) || null; out.reference = ref;
    const all = catalogue(move, inPlay, at, ref);
    let cands = all.filter((m) => !needsOf(m).some((n) => untrusted.includes(n)));
    const read = runs.map((run) => seriesOf(cands, run.result)), S = read.map((x) => x.series);
    /* a smoothed reading that leaps between neighbouring frames inside a labelled rep has wrapped or flipped sign: not a measurement */
    const leaps = (j) => runs.some((run, ri) => { const s = S[ri][j]; if (!s) return false; let prev = null; for (let i = 0; i < s.length; i++) { if (!inside[ri][i] || s[i] == null) continue; if (prev != null && Math.abs(s[i] - prev) > (cands[j].kind === 'distance' ? 60 : 90)) return true; prev = s[i]; } return false; });
    const leaping = cands.map((m, j) => leaps(j));
    const usable = cands.map((m, j) => !leaping[j] && S.every((s) => s[j] != null));
    out.candidates = { total: all.length, kept: usable.filter(Boolean).length,
      skipped: { untrusted: untrusted.map((n) => ({ landmark: n, share: +share[n].toFixed(2), need: all.filter((m) => needsOf(m).includes(n)).length })), noStart: read.filter((x) => !x.ready).length, leaping: leaping.filter(Boolean).length } };
    const byKey = {}; for (const m of move.measurements || []) byKey[m.key] = m;
    const specFaults = (move.spec && move.spec.faults) || [];
    /* the groups: each fault the labels name, then every fault together */
    const ids = [...new Set([].concat(...labelled.map((x) => (x.label.tag === 'faults' ? x.label.faults || [] : []))))];
    if (ids.length > 1) ids.push('*');
    const taken = new Set(Object.keys(byKey));
    for (const id of ids) {
      const known = id !== '*' && !id.startsWith('+') && (move.faults || []).includes(id), old = known ? specFaults.find((x) => x.id === id) || null : null;
      const label = id === '*' ? 'Any fault' : id.startsWith('+') ? id.slice(1).trim() : (move.cues && move.cues[id] && move.cues[id].label) || id;
      const isMarked = (l) => l.tag === 'faults' && (id === '*' ? (l.faults || []).length > 0 : (l.faults || []).includes(id));
      const marked = labelled.map((x) => isMarked(x.label));
      const nB = marked.filter(Boolean).length, nC = marked.length - nB, n = nC + nB;
      const whens = (o.windows && o.windows[id]) || (known ? [(move.when && move.when[id]) || 'top'] : ['rep', 'between']);
      const G = { id, label, known, old, when: whens[0], n: { clean: nC, marked: nB }, luck: null, firm: false, status: 'few', note: `Mark at least two clean reps and one with ‘${label}’, and I will look for a measure that tells them apart.`, rows: [] };
      out.groups.push(G);
      if (nC < 2 || nB < 1) continue;
      /* the gate: a split of at least two wobbles; three with only one marked rep or only two clean ones, where luck is cheapest */
      const gate = nB === 1 || nC === 2 ? 3 : 2;
      const own = old && byKey[old.measure] ? pointsOf(byKey[old.measure]) : [];
      const existing = {}; for (const m of move.measurements || []) if (m.kind !== 'sum') existing[sigOf(m)] = { key: m.key, label: m.label || m.key, hasBand: !!m.band, hasFault: specFaults.some((x) => x.id === id && x.measure === m.key) };
      for (const when of whens) {
        const idx = labelled.map((x) => windowIdx(runs[x.run].result, move, x.rep, when));
        const feats = []; let kept = 0;
        cands.forEach((m, j) => {
          if (!usable[j]) return;
          const ex = labelled.map((x, i) => extremesOf(S[x.run][j], runs[x.run].result.rows, idx[i], persist));
          if (ex.some((e) => !e)) return;   // a rep it cannot be read on is a rep it cannot be judged against
          kept++;
          const pts = pointsOf(m), shared = pts.some((p) => own.includes(p));
          feats.push(Object.assign({ m, j, pts: pts.length, prior: (m.prior || 0.7) + (shared ? 0.05 : 0), ex: existing[sigOf(m)] || null }, scoreOf(ex, marked, noiseOf(m, lenOf, sigma))));
        });
        if (G.luck == null) { G.luck = round1(2 * kept / choose(n, nB)); G.firm = G.luck < 0.5; }
        /* a split passes the gate; a cut makes an overlap row only with six reps or more, at most a fifth of them wrong and the medians two noises apart — under that, four right of five is what luck gives */
        const pool = feats.filter((f) => (f.gap > 0 ? f.sep >= gate : n >= 6 && f.wrong <= Math.floor(0.2 * n) && f.apart >= 2 * f.noise));
        const cls = (f) => (f.sep == null ? 0 : f.sep >= 4 ? 2 : 1);
        const rank = (p, q) => ((q.gap > 0) - (p.gap > 0)) || (p.wrong - q.wrong) || (cls(q) - cls(p)) || (q.prior - p.prior) || (p.pts - q.pts) || (!!p.m.fromStart - !!q.m.fromStart) || ((q.sep || 0) - (p.sep || 0));
        pool.sort(rank);
        /* One physical thing, once: a candidate joins an earlier row's fold when it has the row's point set, or shares a landmark
           with it and follows it frame by frame (|r| ≥ 0.9 over the window frames of the labelled reps, ten at least) — frames,
           not the per-rep values, since with three reps any two splitting candidates agree per rep while over frames a candidate
           that only wobbles does not follow one that steps between two levels. The representative: an existing measurement when
           it passes the gate itself and separates at least half as well as the fold's best (tuning a number is cheaper than
           adding one, but a measurement the file has that barely separates must not hide one that does); else the member highest
           in the ranking whose separation is at least seven tenths of the best. */
        const rho = (() => { const memo = {}; return (p, q) => { const k = p.j < q.j ? p.j + ':' + q.j : q.j + ':' + p.j; if (memo[k] != null) return memo[k]; const xs = [], ys = []; labelled.forEach((x, i) => { for (const r of idx[i]) { const a = S[x.run][p.j][r], b = S[x.run][q.j][r]; if (a != null && b != null) { xs.push(a); ys.push(b); } } }); let v = 0; if (xs.length >= 10) { const n2 = xs.length, mx = xs.reduce((s, a) => s + a, 0) / n2, my = ys.reduce((s, a) => s + a, 0) / n2; let xy = 0, xx = 0, yy = 0; for (let i = 0; i < n2; i++) { xy += (xs[i] - mx) * (ys[i] - my); xx += (xs[i] - mx) ** 2; yy += (ys[i] - my) ** 2; } v = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0; } return (memo[k] = v); }; })();
        const same = (a, b) => pointsOf(a.m).slice().sort().join() === pointsOf(b.m).slice().sort().join();
        const shares = (a, b) => pointsOf(a.m).some((p) => pointsOf(b.m).includes(p));
        const folds = [];
        for (const f of pool) {
          const fold = folds.find((x) => x.members.some((g) => same(g, f)) || (shares(x.members[0], f) && Math.abs(rho(x.members[0], f)) >= 0.9));
          if (fold) fold.members.push(f); else if (folds.length < max) folds.push({ members: [f] });
        }
        if (!folds.length) continue;
        const sepOf = (f) => (f.sep == null ? -Infinity : f.sep);
        G.rows = folds.map((x, i) => {
          const best = Math.max(...x.members.map(sepOf));
          const rep = x.members.find((f) => f.ex && f.gap > 0 && f.sep >= gate && f.sep >= 0.5 * best) || x.members.find((f) => sepOf(f) >= 0.7 * best) || x.members[0];
          const also = x.members.filter((f) => f !== rep).sort((p, q) => sepOf(q) - sepOf(p));
          return rowOf(rep, i + 1, also, G, { labelled, marked, describe, taken, move });
        });
        G.when = when; G.status = 'ok'; G.note = '';
        break;
      }
      if (!G.rows.length) { G.status = 'none'; G.note = `Nothing I can measure from these landmarks tells the ${nB} reps you marked ‘${label}’ from the ${nC} clean ones, above the model's wobble.` + (G.luck >= 1 ? ` About ${Math.round(G.luck)} measures would have split them by luck, so a near miss means little.` : ''); }
      delete G.old;
    }
    return done();
  }

  /* ---- a trace on disk: compact arrays, one file ---- */
  function pack(meta, frames) {
    return Object.assign({ v: 1 }, meta, {
      frames: frames.map((f) => Object.assign({ t: Math.round(f.t), lm: f.lm ? f.lm.map((p) => [+p.x.toFixed(4), +p.y.toFixed(4), +(p.z || 0).toFixed(4), +(p.visibility == null ? 1 : p.visibility).toFixed(3)]) : null }, f.scene ? { s: [f.scene.luma, f.scene.dark, f.scene.bright, f.scene.body, f.scene.bg, f.scene.colour] } : {})),
    });
  }
  function unpack(json) {
    const d = typeof json === 'string' ? JSON.parse(json) : json;
    if (!d || d.v !== 1 || !Array.isArray(d.frames)) throw new Error('not a trace');
    const frames = d.frames.map((f) => Object.assign({ t: f.t, lm: f.lm ? f.lm.map((p) => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] })) : null }, f.s ? { scene: { luma: f.s[0], dark: f.s[1], bright: f.s[2], body: f.s[3], bg: f.s[4], colour: f.s[5] } } : {}));
    const { frames: _, ...meta } = d;
    return { meta, frames };
  }

  return { settingsOf, defaults, bandRange, run, stretches, faultIds, verdicts, reps, misses, progressOf, pack, unpack, labelOf, sustained, windowOf, windowIdx, recommend, discover, noiseOf };
});
