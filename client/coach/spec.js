/* ============================================================
   Move spec compiler — turns a declarative move (written in the
   Studio by a physio, saved as JSON) into a library exercise.

   A spec holds no code: measurements are named landmarks and a
   kind ('angle', 'vertical', 'tilt', 'dist', 'offset', 'lean',
   'pelvis'), the progress rule is a start/target pair, and each
   fault is a metric, a comparison and a threshold. The Studio
   simulates a spec over recorded takes with exactly this compiler,
   so what the physio saw firing on the recordings is what ships.

   Landmark names are relative to the working side S:
     NOSE EAR SH EL WR HIP KNEE ANK HEEL FOOT     working side
     oEAR oSH oEL oWR oHIP oKNEE oANK oHEEL oFOOT the other side
     mSH mHIP                                      midpoints
   ============================================================ */
(function (root) {
  'use strict';

  const NAMES = ['EAR', 'SH', 'EL', 'WR', 'HIP', 'KNEE', 'ANK', 'HEEL', 'FOOT'];
  const KINDS = {
    angle:    { n: 3, unit: '°',  label: 'Angle at the middle joint',              help: 'Interior angle a–b–c, 0–180°. Knee: HIP–KNEE–ANK. Elbow: SH–EL–WR.' },
    vertical: { n: 2, unit: '°',  label: 'Segment from hanging straight down',    help: '0° = hanging down, 90° = horizontal, 180° = straight up. Arm raise: SH–EL.' },
    tilt:     { n: 2, unit: '°',  label: 'Segment from horizontal',               help: '0° = flat, 90° = upright. Thigh in a wall sit: HIP–KNEE.' },
    dist:     { n: 2, unit: '%',  label: 'Distance, as % of torso length',        help: 'Shrinks or grows with the movement. Shrug: EAR–SH.' },
    offset:   { n: 3, unit: '%',  label: 'How far a point sits off a line',        help: 'Third point off the line through the first two, % of that line. + = below. Plank sag: SH–ANK, HIP.' },
    lean:     { n: 0, unit: '°',  label: 'Trunk lean from vertical',               help: 'Shoulders relative to hips, signed. + = toward the working side.' },
    pelvis:   { n: 0, unit: '°',  label: 'Pelvis tilt (front view)',               help: '+ = the working hip is higher than the other.' },
  };

  function describeKind(kind) { return KINDS[kind] || null; }

  /* --- landmark resolution --- */
  function resolve(name, pts, S, k) {
    const { SIDE, mid } = k;
    if (name === 'NOSE') return pts[0];
    if (name === 'mSH') return mid(pts[11], pts[12]);
    if (name === 'mHIP') return mid(pts[23], pts[24]);
    const other = name.startsWith('o');
    const base = other ? name.slice(1) : name;
    const side = SIDE[other ? (S === 'L' ? 'R' : 'L') : S];
    const idx = side[base];
    if (idx === undefined) throw new Error('unknown landmark ' + name);
    return pts[idx];
  }
  function indexOf(name, S, k) {
    if (name === 'NOSE') return 0;
    if (name === 'mSH' || name === 'mHIP') return null;
    const other = name.startsWith('o'); const base = other ? name.slice(1) : name;
    return k.SIDE[other ? (S === 'L' ? 'R' : 'L') : S][base];
  }
  function torso(pts, k) { return Math.max(k.dist(k.mid(pts[11], pts[12]), k.mid(pts[23], pts[24])), 0.05); }

  function evalMetric(m, pts, S, k) {
    const P = (i) => resolve(m.pts[i], pts, S, k);
    switch (m.kind) {
      case 'angle': return k.angle(P(0), P(1), P(2));
      case 'vertical': return k.armAngle(P(0), P(1));
      case 'tilt': return k.segTilt(P(0), P(1));
      case 'dist': return 100 * k.dist(P(0), P(1)) / torso(pts, k);
      case 'offset': return 100 * k.lineOffset(P(0), P(1), P(2));
      case 'lean': { const l = k.trunkLean(pts); return l * k.outward(pts, S); }
      case 'pelvis': return k.pelvisTilt(pts, S === 'L');
      default: throw new Error('unknown metric kind ' + m.kind);
    }
  }

  /* Landmarks a metric reads, as BlazePose indices for the given side. */
  function metricLandmarks(m, S, k) {
    if (m.kind === 'lean') return [11, 12, 23, 24];
    if (m.kind === 'pelvis') return [23, 24];
    const out = [];
    for (const n of m.pts || []) { const i = indexOf(n, S, k); if (i === null) out.push(11, 12, 23, 24); else out.push(i); }
    return out;
  }

  const SEVERITY_WEIGHT = { 1: 1, 2: 2, 3: 3 };
  const PHASE_DEFAULTS = { persist: 400, cooldown: 5000 };

  /* --- validation of the spec itself (before it becomes an exercise) --- */
  function checkSpec(spec) {
    const problems = [];
    const need = (cond, msg) => { if (!cond) problems.push(msg); };
    need(spec && typeof spec === 'object', 'spec must be an object');
    if (!spec) return problems;
    need(/^[a-z][a-z0-9_]*$/.test(spec.id || ''), 'id: lower-case letters, digits, underscores');
    need(spec.name, 'name is missing');
    need(spec.group, 'group is missing');
    need(['reps', 'hold'].includes(spec.type), 'type must be reps or hold');
    need(['front', 'side'].includes(spec.view), 'view must be front or side');
    need(spec.summary, 'summary (one line for the tile) is missing');
    need(spec.setup, 'setup (where the camera goes) is missing');
    need(spec.why, 'why (why this camera angle can measure it) is missing');
    const mOk = (m, where) => {
      if (!m || !KINDS[m.kind]) { problems.push(where + ': pick a measurement'); return false; }
      const n = KINDS[m.kind].n; if ((m.pts || []).length < n) { problems.push(where + ': needs ' + n + ' landmarks'); return false; }
      return true;
    };
    if (spec.type === 'reps') {
      need(spec.progress, 'progress measurement is missing');
      if (spec.progress && mOk(spec.progress.metric, 'progress')) {
        need(Number.isFinite(spec.progress.start) || spec.progress.start === 'calibrated', 'progress: start value');
        need(Number.isFinite(spec.progress.target) || (typeof spec.progress.target === 'string' && spec.progress.target.startsWith('opt:')), 'progress: target value');
        if (Number.isFinite(spec.progress.start) && Number.isFinite(spec.progress.target)) need(spec.progress.start !== spec.progress.target, 'progress: start and target are the same');
      }
    } else {
      need(spec.hold && Array.isArray(spec.hold.conditions) && spec.hold.conditions.length, 'hold: at least one position condition');
      for (const c of (spec.hold && spec.hold.conditions) || []) if (mOk(c.metric, 'hold condition')) need(Number.isFinite(c.min) || Number.isFinite(c.max), 'hold condition: min or max');
    }
    need(Array.isArray(spec.faults) && spec.faults.length, 'at least one fault');
    const ids = new Set();
    for (const f of spec.faults || []) {
      const w = 'fault "' + (f.label || f.id || '?') + '"';
      need(f.id && /^[a-z][a-z0-9_]*$/.test(f.id), w + ': id');
      need(!ids.has(f.id), w + ': duplicate id'); ids.add(f.id);
      need(f.label, w + ': label'); need(f.cue, w + ': spoken cue'); need(f.tip, w + ': written tip');
      if (f.cue) need(f.cue.trim().split(/\s+/).length <= 8, w + ': cue longer than 8 words');
      need([1, 2, 3].includes(+f.severity), w + ': severity 1–3');
      if (f.rule === 'shallow' || f.rule === 'fast') { if (f.rule === 'fast') need(Number.isFinite(f.minMs), w + ': minimum rep time'); }
      else if (mOk(f.metric, w)) { need(['>', '<'].includes(f.op), w + ': comparison'); need(Number.isFinite(f.threshold), w + ': threshold'); }
    }
    const g = spec.guide || {};
    need(g.surface, 'guide: surface'); need(g.stop, 'guide: when to stop'); need(g.cannotSee, 'guide: what the camera cannot see');
    need(Array.isArray(g.regions) && g.regions.some((r) => r.name && (r.points || []).some((p) => p.t)), 'guide: at least one region with a form point');
    need(Array.isArray(spec.targets) && spec.targets.length && spec.targets.includes(spec.defaultTarget), 'targets and a default');
    return problems;
  }

  /* Lenient mode (the Studio, mid-authoring): a spec with the measurements filled in but the words
     still missing compiles anyway, so takes can be simulated before the guide is written. */
  function withDefaults(spec) {
    const s = JSON.parse(JSON.stringify(spec || {}));
    s.id = /^[a-z][a-z0-9_]*$/.test(s.id || '') ? s.id : 'draft';
    for (const k of ['name', 'group', 'summary', 'setup', 'why']) if (!s[k]) s[k] = '—';
    if (!s.type) s.type = 'reps'; if (!s.view) s.view = 'front';
    if (!Array.isArray(s.targets) || !s.targets.length) s.targets = [10]; if (!s.targets.includes(s.defaultTarget)) s.defaultTarget = s.targets[0];
    s.faults = (s.faults || []).filter((f) => f.rule ? true : (f.metric && KINDS[f.metric.kind] && (f.metric.pts || []).length >= KINDS[f.metric.kind].n && Number.isFinite(f.threshold)))
      .map((f, i) => ({ ...f, id: f.id || 'fault' + i, label: f.label || 'Fault ' + (i + 1), cue: f.cue || '—', tip: f.tip || '—', severity: [1, 2, 3].includes(+f.severity) ? +f.severity : 2, op: f.op || '>', minMs: f.rule === 'fast' ? (f.minMs || 2000) : f.minMs }));
    if (s.type === 'hold' && s.hold) s.hold.conditions = (s.hold.conditions || []).filter((c) => c.metric && KINDS[c.metric.kind] && (c.metric.pts || []).length >= KINDS[c.metric.kind].n && (Number.isFinite(c.min) || Number.isFinite(c.max)));
    s.guide = { surface: '—', stop: '—', cannotSee: '—', regions: [{ name: '—', points: [{ t: '—', tracked: false }] }], ...(s.guide || {}) };
    if (!s.guide.surface) s.guide.surface = '—'; if (!s.guide.stop) s.guide.stop = '—'; if (!s.guide.cannotSee) s.guide.cannotSee = '—';
    if (!Array.isArray(s.guide.regions) || !s.guide.regions.some((r) => r.name && (r.points || []).some((p) => p.t))) s.guide.regions = [{ name: '—', points: [{ t: '—', tracked: false }] }];
    if (!s.faults.length) s.faults = [{ id: 'placeholder', rule: 'shallow', label: '—', cue: '—', tip: '—', severity: 1 }];
    return s;
  }

  /* --- compile --- */
  function compile(spec, k, { lenient = false } = {}) {
    if (lenient) spec = withDefaults(spec);
    const problems = checkSpec(spec).filter((p) => !lenient || /pick a measurement|needs \d+ landmarks|start value|target value|min or max|comparison|threshold|refers to option/.test(p));
    if (problems.length) throw new Error('spec "' + (spec && spec.id) + '": ' + problems.join('; '));
    const { FULL, ATTEMPT, BAND } = k;
    const S0 = spec.sided ? null : 'L';
    const metrics = [];
    const useMetric = (m) => { metrics.push(m); return m; };
    const prog = spec.type === 'reps' ? spec.progress : null;
    if (prog) useMetric(prog.metric);
    const holdConds = spec.type === 'hold' ? spec.hold.conditions : [];
    holdConds.forEach((c) => useMetric(c.metric));
    const liveFaults = spec.faults.filter((f) => f.rule !== 'shallow' && f.rule !== 'fast');
    liveFaults.forEach((f) => useMetric(f.metric));

    const required = new Set([11, 12, 23, 24]);
    for (const S of ['L', 'R']) for (const m of metrics) metricLandmarks(m, S, k).forEach((i) => required.add(i));
    if (!spec.upperBody) [25, 26, 27, 28].forEach((i) => required.add(i));

    const options = [];
    if (prog && typeof prog.target === 'string') {
      const key = prog.target.slice(4); const o = (spec.options || []).find((x) => x.key === key);
      if (!o) throw new Error('progress target refers to option "' + key + '" which is not defined');
    }
    for (const o of spec.options || []) options.push({ key: o.key, label: o.label, values: o.values.slice(), unit: o.unit, default: o.default });
    if (spec.band) options.push(BAND(spec.band === true ? 'none' : spec.band));

    const focusName = spec.focus || (prog ? prog.metric.pts && prog.metric.pts[prog.metric.pts.length - 1] : null);

    function calibrate(pts, S, opts) {
      const ref = { torso: torso(pts, k) };
      const side = S || S0 || 'L';
      metrics.forEach((m, i) => { ref['m' + i] = evalMetric(m, pts, side, k); });
      if (prog) {
        ref.start = prog.start === 'calibrated' ? ref.m0 : prog.start;
        ref.target = typeof prog.target === 'string' ? +(opts && opts[prog.target.slice(4)]) : prog.target;
        if (prog.start === 'calibrated' && prog.targetIsDelta) ref.target = ref.start + prog.target;
      }
      ref.work = opts && opts.work ? opts.work : null;
      return ref;
    }
    function measure(pts, S, ref) {
      const side = ref.work || S || S0 || 'L';
      const m = { side, useL: side === 'L', focus: [] };
      if (focusName) { const i = indexOf(focusName, side, k); if (i !== null) m.focus = [i]; }
      const vals = metrics.map((mm) => evalMetric(mm, pts, side, k));
      m.v = vals[0];
      if (prog) { m.p = (vals[0] - ref.start) / (ref.target - ref.start); m.value = vals[0]; }
      else {
        let ok = true;
        holdConds.forEach((c, j) => { const v = vals[j]; const base = c.rel === 'change' ? ref['m' + j] : 0; const d = v - base; if (Number.isFinite(c.min) && d < c.min) ok = false; if (Number.isFinite(c.max) && d > c.max) ok = false; m['h' + j] = d; });
        m.inPosition = ok; m.p = ok ? 1 : 0;
      }
      let idx = (prog ? 1 : 0) + holdConds.length;
      for (const f of liveFaults) { const v = vals[idx]; const base = f.rel === 'change' ? ref['m' + idx] : 0; m['f_' + f.id] = v - base; idx++; }
      return m;
    }

    const faults = spec.faults.map((f) => {
      const common = { id: f.id, label: f.label, cue: f.cue, tip: f.tip, weight: SEVERITY_WEIGHT[+f.severity] || 1, invalidates: !!f.invalidates };
      if (f.rule === 'shallow') return { ...common, onRep: true, check: (rep) => rep.peak < FULL && rep.peak > ATTEMPT };
      if (f.rule === 'fast') return { ...common, onRep: true, check: (rep) => rep.duration < f.minMs };
      const gate = f.minP == null ? 0 : f.minP;
      return {
        ...common, persist: f.persist || PHASE_DEFAULTS.persist, cooldown: f.cooldown || PHASE_DEFAULTS.cooldown,
        phase: f.phase === 'moving' || f.phase === 'rest' ? f.phase : (spec.type === 'hold' ? 'hold' : undefined),
        check: (m) => (spec.type === 'hold' ? m.inPosition !== false : (m.p ?? 0) >= gate) && (f.op === '>' ? m['f_' + f.id] > f.threshold : m['f_' + f.id] < f.threshold),
      };
    });

    const ex = {
      id: spec.id, order: spec.order || 500, name: spec.name, group: spec.group, type: spec.type, view: spec.view, icon: spec.icon || 'move',
      summary: spec.summary, setup: spec.setup, why: spec.why,
      defaultTarget: spec.defaultTarget, targets: spec.targets.slice(),
      options, required: [...required].sort((a, b) => a - b),
      calibrate, measure, faults,
      guide: { surface: spec.guide.surface, stop: spec.guide.stop, cannotSee: spec.guide.cannotSee, regions: spec.guide.regions.filter((r) => r.name && (r.points || []).some((p) => p.t)).map((r) => ({ name: r.name, points: r.points.filter((p) => p.t).map((p) => ({ t: p.t, tracked: !!p.tracked })) })) },
      spec,
    };
    if (spec.sided) ex.sided = { limb: spec.sided.limb, by: spec.sided.by || 'pick' };
    if (spec.upperBody) ex.upperBody = true;
    if (spec.figure) {
      if (root.FyzioAnatomy && root.FyzioAnatomy.register) root.FyzioAnatomy.register(spec.id, spec.figure);
      else (root.__pendingFigures = root.__pendingFigures || []).push([spec.id, spec.figure]);   /* anatomy.js drains this when it loads */
    }
    return ex;
  }

  const api = { KINDS, NAMES, compile, checkSpec, evalMetric, metricLandmarks, describeKind, resolve };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MoveSpec = api;
})(typeof window !== 'undefined' ? window : globalThis);
