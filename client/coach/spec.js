/* ============================================================
   Move spec compiler — turns a declarative move (an entry in
   client/data/moves/*.json, or a draft in the Studio) into a
   library exercise.

   A spec holds no code: measurements are named landmarks and a
   kind, the progress rule is a start/target pair, and each fault
   is a metric, a comparison and a threshold. The Studio simulates
   a spec over recorded takes with exactly this compiler, so what
   the physio saw firing on the recordings is what ships.

   Landmark names are relative to the working side S:
     NOSE EAR SH EL WR HIP KNEE ANK HEEL FOOT     working side
     oEAR oSH oEL oWR oHIP oKNEE oANK oHEEL oFOOT the other side
     mEAR mSH mHIP                                 midpoints

   A measurement: { kind, pts, per, sign, abs, flip }
     per   what a length is divided by: "torso" (default) or a segment [A, B],
           measured at calibration — so a heel lift is "% of shin length"
           whoever is doing it
     sign  for gap: "outward" (away from the body's midline; front view) or
           "forward" (the way the toes point; side view)
     abs   true = ignore the sign
     flip  { option, when } = negate when that option has that value
           (external vs internal rotation)
   Every kind is listed in KINDS with the number of points it takes.
   ============================================================ */
(function (root) {
  'use strict';

  const NAMES = ['EAR', 'SH', 'EL', 'WR', 'HIP', 'KNEE', 'ANK', 'HEEL', 'FOOT'];
  const KINDS = {
    angle:    { n: 3, unit: '°',  label: 'Angle at the middle joint',              help: 'Interior angle a–b–c, 0–180°. Knee: HIP–KNEE–ANK. Elbow: SH–EL–WR.' },
    vertical: { n: 2, unit: '°',  label: 'Segment from hanging straight down',    help: '0° = hanging down, 90° = horizontal, 180° = straight up. Arm raise: SH–EL.' },
    tilt:     { n: 2, unit: '°',  label: 'Segment from horizontal',               help: '0° = flat, 90° = upright. Thigh in a wall sit: HIP–KNEE.' },
    dist:     { n: 2, unit: '%',  label: 'Distance between two points',           help: 'As % of the reference length (torso, or a segment). Shrinks or grows with the movement. Shrug: EAR–SH.' },
    offset:   { n: 3, unit: '%',  label: 'How far a point sits off a line',        help: 'Third point off the line through the first two, % of that line. + = below. Plank sag: SH–ANK, HIP.' },
    rise:     { n: 1, unit: '%',  label: 'How far a point has risen since the start', help: '+ = above where it was at calibration, as % of the reference length. Heel lifting: HEEL per KNEE–ANK. Hip lifting: HIP per HIP–KNEE.' },
    height:   { n: 2, unit: '%',  label: 'Height of one point above another',    help: '+ = the first point is above the second, % of the reference length. Wrist above the shoulder: WR, SH. Elbow above the shoulder: EL, SH.' },
    ratio:    { n: 2, unit: '%',  label: 'Length of a segment vs its start',       help: '100 = as long as at calibration. A segment that looks shorter has left the camera plane: a leg rolling out reads 60–75. Shoulders narrowing = torso turning.' },
    gap:      { n: 2, unit: '%',  label: 'Sideways offset of a point from another', help: 'First point relative to the second, along the image, % of the reference length. sign "outward" (front view: away from the midline) or "forward" (side view: the way the toes point). Elbow off the ribs: EL, SH per SH–EL.' },
    rotation: { n: 2, unit: '°',  label: 'Rotation of a segment toward the camera', help: 'The angle a segment (second → first point) has swung out of the camera plane, from its apparent shortening. Forearm rotation: WR, EL per SH–EL. Use "Change from start".' },
    near:     { n: 3, unit: '%',  label: 'Distance from a point to a segment',    help: 'How far the first point is from the line between the other two, % of the reference length. Hand resting on the thigh: WR, HIP, KNEE.' },
    lean:     { n: 0, unit: '°',  label: 'Trunk lean from vertical',               help: 'Shoulders relative to hips, signed. + = toward the working side; with sign "forward" (side view), + = leaning the way the toes point.' },
    headTilt: { n: 0, unit: '°',  label: 'Head tilt against the shoulders',       help: 'Roll of the head relative to the pelvis, signed: + = the ear on the working side rising, i.e. tilting away from that side. Use "Change from start".' },
    pelvis:   { n: 0, unit: '°',  label: 'Pelvis tilt (front view)',               help: '+ = the working hip is higher than the other.' },
  };

  function describeKind(kind) { return KINDS[kind] || null; }

  /* --- landmark resolution --- */
  function resolve(name, pts, S, k) {
    const { SIDE, mid } = k;
    if (name === 'NOSE') return pts[0];
    if (name === 'mSH') return mid(pts[11], pts[12]);
    if (name === 'mHIP') return mid(pts[23], pts[24]);
    if (name === 'mEAR') return mid(pts[7], pts[8]);
    const other = name.startsWith('o');
    const base = other ? name.slice(1) : name;
    const side = SIDE[other ? (S === 'L' ? 'R' : 'L') : S];
    const idx = side[base];
    if (idx === undefined) throw new Error('unknown landmark ' + name);
    return pts[idx];
  }
  function indexOf(name, S, k) {
    if (name === 'NOSE') return 0;
    if (name === 'mSH' || name === 'mHIP' || name === 'mEAR') return null;
    const other = name.startsWith('o'); const base = other ? name.slice(1) : name;
    return k.SIDE[other ? (S === 'L' ? 'R' : 'L') : S][base];
  }
  const midIdx = { mSH: [11, 12], mHIP: [23, 24], mEAR: [7, 8] };
  function torso(pts, k) { return Math.max(k.dist(k.mid(pts[11], pts[12]), k.mid(pts[23], pts[24])), 0.05); }
  const segKey = (m, S) => (m.per && m.per !== 'torso' ? m.per.join('-') : 'torso') + ':' + S;
  const lenKey = (m, S) => m.pts.join('-') + ':' + S;

  /* The reference length a % kind is divided by: the torso, or the segment `per`, as measured at
     calibration when there is one (ref), else on this frame. */
  function unitLen(m, pts, S, k, ref) {
    if (!m.per || m.per === 'torso') return ref && ref.torso ? ref.torso : torso(pts, k);
    const key = segKey(m, S);
    if (ref && ref.lens && ref.lens[key]) return ref.lens[key];
    return Math.max(k.dist(resolve(m.per[0], pts, S, k), resolve(m.per[1], pts, S, k)), 0.03);
  }
  /* The way the toes point on side S, +1 = image right. Fixed at calibration so a foot that lifts
     mid-set does not flip every side-view measurement. */
  function forward(pts, S, k, ref) {
    if (ref && ref.fwd && ref.fwd[S]) return ref.fwd[S];
    const j = k.SIDE[S]; return Math.sign(pts[j.FOOT].x - pts[j.HEEL].x) || 1;
  }
  const segDist = (p, a, b) => {
    const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy;
    const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2));
    return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
  };

  /* evalMetric(metric, pts, S, k, ref, opts) — ref is the calibration context from calibrateRef()
     (or from an exercise's own ref); without one, the kinds that compare to the start read as
     "no change" (rise 0, ratio 100) and gap's forward sign is read off this frame. */
  function evalMetric(m, pts, S, k, ref, opts) {
    const P = (i) => resolve(m.pts[i], pts, S, k);
    let v;
    switch (m.kind) {
      case 'angle': v = k.angle(P(0), P(1), P(2)); break;
      case 'vertical': v = k.armAngle(P(0), P(1)); break;
      case 'tilt': v = k.segTilt(P(0), P(1)); break;
      case 'dist': v = 100 * k.dist(P(0), P(1)) / unitLen(m, pts, S, k, ref); break;
      case 'offset': v = 100 * k.lineOffset(P(0), P(1), P(2)); break;
      case 'rise': { const p0 = ref && ref.pts0 ? resolve(m.pts[0], ref.pts0, S, k) : P(0); v = 100 * (p0.y - P(0).y) / unitLen(m, pts, S, k, ref); break; }
      case 'height': v = 100 * (P(1).y - P(0).y) / unitLen(m, pts, S, k, ref); break;
      case 'ratio': { const key = 'len:' + lenKey(m, S); const l0 = ref && ref.lens && ref.lens[key]; v = l0 ? 100 * k.dist(P(0), P(1)) / l0 : 100; break; }
      case 'gap': { const s = m.sign === 'forward' ? forward(pts, S, k, ref) : k.outward(pts, S); v = 100 * (P(0).x - P(1).x) * s / unitLen(m, pts, S, k, ref); break; }
      case 'rotation': {
        /* the segment's true length is only fully seen when it lies in the camera plane, so it is
           the longest seen so far, floored at 85 % of the reference segment */
        const key = 'rot:' + lenKey(m, S); const seen = k.dist(P(0), P(1));
        const floor = m.per && m.per !== 'torso' ? 0.85 * unitLen(m, pts, S, k, ref) : seen;
        let L = Math.max(seen, floor); if (ref && ref.lens) { L = Math.max(L, ref.lens[key] || 0); ref.lens[key] = L; }
        const s = m.sign === 'forward' ? forward(pts, S, k, ref) : k.outward(pts, S);
        v = k.deg(Math.asin(k.clamp((P(0).x - P(1).x) * s / Math.max(L, 1e-3), -1, 1))); break;
      }
      case 'near': v = 100 * segDist(P(0), P(1), P(2)) / unitLen(m, pts, S, k, ref); break;
      case 'lean': { const l = k.trunkLean(pts); v = l * (m.sign === 'forward' ? forward(pts, S, k, ref) : k.outward(pts, S)); break; }
      case 'headTilt': v = k.headTilt(pts) * (S === 'L' ? 1 : -1); break;
      case 'pelvis': v = k.pelvisTilt(pts, S === 'L'); break;
      default: throw new Error('unknown metric kind ' + m.kind);
    }
    if (m.abs) v = Math.abs(v);
    if (m.flip && opts) { const want = Array.isArray(m.flip.when) ? m.flip.when : [m.flip.when]; if (want.includes(opts[m.flip.option])) v = -v; }
    return v;
  }

  /* Landmarks a metric reads, as BlazePose indices for the given side (including its `per` segment). */
  function metricLandmarks(m, S, k) {
    if (m.kind === 'lean') return m.sign === 'forward' ? [11, 12, 23, 24, ...(S === 'L' ? [29, 31] : [30, 32])] : [11, 12, 23, 24];
    if (m.kind === 'headTilt') return [7, 8, 23, 24];
    if (m.kind === 'pelvis') return [23, 24];
    const out = [];
    const names = [...(m.pts || []), ...(Array.isArray(m.per) ? m.per : [])];
    if (m.kind === 'gap' || m.kind === 'rotation') { if (m.sign === 'forward') names.push('FOOT', 'HEEL'); else out.push(11, 12); }
    for (const n of names) { const i = indexOf(n, S, k); if (i === null) out.push(...(midIdx[n] || [11, 12, 23, 24])); else out.push(i); }
    return out;
  }

  /* The calibration context for a set of metrics: baselines per side, the calibration frame,
     the reference lengths, the way the toes point. The Studio uses this to trace a metric over a
     take exactly as the coach would. */
  function calibrateRef(metrics, pts, k, opts) {
    const ref = { torso: torso(pts, k), pts0: pts.map((p) => ({ x: p.x, y: p.y, z: p.z, v: p.v })), lens: {}, fwd: {}, base: { L: [], R: [] } };
    for (const S of ['L', 'R']) {
      const j = k.SIDE[S]; ref.fwd[S] = Math.sign(pts[j.FOOT].x - pts[j.HEEL].x) || 1;
      for (const m of metrics) {
        if (Array.isArray(m.per)) { const key = segKey(m, S); try { ref.lens[key] = Math.max(k.dist(resolve(m.per[0], pts, S, k), resolve(m.per[1], pts, S, k)), 0.03); } catch { } }
        if (m.kind === 'ratio' || m.kind === 'rotation') { const key = (m.kind === 'ratio' ? 'len:' : 'rot:') + lenKey(m, S); try { ref.lens[key] = Math.max(k.dist(resolve(m.pts[0], pts, S, k), resolve(m.pts[1], pts, S, k)), 0.02); } catch { } }
      }
      for (const m of metrics) { try { ref.base[S].push(evalMetric(m, pts, S, k, ref, opts)); } catch { ref.base[S].push(0); } }
    }
    return ref;
  }

  const faultSettings = (k) => { const s = k.settings && k.settings.fault; if (!s) throw new Error('settings.json needs a fault section'); return s; };
  const RULES = ['shallow', 'fast', 'return'];
  const PHASES = ['moving', 'rest', 'hold', 'any'];

  /* --- validation of the spec itself (before it becomes an exercise) --- */
  function checkSpec(spec) {
    const problems = [];
    if (spec.show) {
      if (typeof spec.show.ask !== 'string' || !spec.show.ask.trim()) problems.push('show: needs "ask" — what to say when the pose is asked for');
      if (spec.type !== 'reps' || !spec.progress) problems.push('show: only a counted move with a progress measure can take a demonstrated target');
    }
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
    const optKeys = (spec.options || []).map((o) => o.key);
    const mOk = (m, where) => {
      if (!m || !KINDS[m.kind]) { problems.push(where + ': pick a measurement'); return false; }
      const n = KINDS[m.kind].n; if ((m.pts || []).length < n) { problems.push(where + ': needs ' + n + ' landmarks'); return false; }
      if (m.per !== undefined && m.per !== 'torso' && !(Array.isArray(m.per) && m.per.length === 2)) problems.push(where + ': per must be "torso" or two landmarks');
      if (m.sign !== undefined && !['outward', 'forward'].includes(m.sign)) problems.push(where + ': sign must be outward or forward');
      if (m.flip && !optKeys.includes(m.flip.option)) problems.push(where + ': flip refers to option "' + m.flip.option + '" which is not defined');
      return true;
    };
    const whenOk = (list, where) => {
      for (const w of list || []) {
        if (typeof w === 'string') { need(['inPosition', 'notInPosition'].includes(w), where + ': when must be inPosition or notInPosition'); continue; }
        if (w.option !== undefined) { need(optKeys.includes(w.option), where + ': when refers to option "' + w.option + '" which is not defined'); continue; }
        if (mOk(w.metric, where + ' (when)')) { need(['>', '<'].includes(w.op), where + ': when needs op < or >'); need(Number.isFinite(w.threshold), where + ': when needs a threshold'); }
      }
    };
    if (spec.type === 'reps') {
      need(spec.progress, 'progress measurement is missing');
      if (spec.progress && mOk(spec.progress.metric, 'progress')) {
        need(Number.isFinite(spec.progress.start) || spec.progress.start === 'calibrated', 'progress: start value');
        need(Number.isFinite(spec.progress.target) || (typeof spec.progress.target === 'string' && spec.progress.target.startsWith('opt:')), 'progress: target value');
        if (Number.isFinite(spec.progress.start) && Number.isFinite(spec.progress.target)) need(spec.progress.start !== spec.progress.target, 'progress: start and target are the same');
        if (spec.progress.delta !== undefined) need([1, -1].includes(spec.progress.delta), 'progress: delta must be 1 or -1');
      }
    } else {
      need(spec.hold && Array.isArray(spec.hold.conditions) && spec.hold.conditions.length, 'hold: at least one position condition');
      for (const c of (spec.hold && spec.hold.conditions) || []) { if (mOk(c.metric, 'hold condition')) need(Number.isFinite(c.min) || Number.isFinite(c.max), 'hold condition: min or max'); whenOk(c.when, 'hold condition'); }
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
      if (f.phase !== undefined) need(PHASES.includes(f.phase), w + ': phase must be one of ' + PHASES.join(', '));
      if (f.scale) { need(Number.isFinite(f.scale.times), w + ': scale needs times'); if (f.scale.metric !== 'progress') mOk(f.scale.metric, w + ' (scale)'); }
      whenOk(f.when, w);
      if (RULES.includes(f.rule)) { if (f.rule === 'fast') need(Number.isFinite(f.minMs), w + ': minimum rep time'); }
      else if (f.rule) problems.push(w + ': rule must be one of ' + RULES.join(', '));
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
    const mFull = (m) => m && KINDS[m.kind] && (m.pts || []).length >= KINDS[m.kind].n;
    s.faults = (s.faults || []).filter((f) => f.rule ? true : (mFull(f.metric) && Number.isFinite(f.threshold)))
      .map((f, i) => ({ ...f, id: f.id || 'fault' + i, label: f.label || 'Fault ' + (i + 1), cue: f.cue || '—', tip: f.tip || '—', severity: [1, 2, 3].includes(+f.severity) ? +f.severity : 2, op: f.op || '>', minMs: f.rule === 'fast' ? (f.minMs || 2000) : f.minMs,
        when: (f.when || []).filter((w) => typeof w === 'string' || w.option !== undefined || (mFull(w.metric) && Number.isFinite(w.threshold))) }));
    if (s.type === 'hold' && s.hold) s.hold.conditions = (s.hold.conditions || []).filter((c) => mFull(c.metric) && (Number.isFinite(c.min) || Number.isFinite(c.max)));
    s.guide = { surface: '—', stop: '—', cannotSee: '—', regions: [{ name: '—', points: [{ t: '—', tracked: false }] }], ...(s.guide || {}) };
    if (!s.guide.surface) s.guide.surface = '—'; if (!s.guide.stop) s.guide.stop = '—'; if (!s.guide.cannotSee) s.guide.cannotSee = '—';
    if (!Array.isArray(s.guide.regions) || !s.guide.regions.some((r) => r.name && (r.points || []).some((p) => p.t))) s.guide.regions = [{ name: '—', points: [{ t: '—', tracked: false }] }];
    if (!s.faults.length) s.faults = [{ id: 'placeholder', rule: 'shallow', label: '—', cue: '—', tip: '—', severity: 1 }];
    return s;
  }

  /* --- compile --- */
  function compile(spec, k, { lenient = false } = {}) {
    if (lenient) spec = withDefaults(spec);
    const problems = checkSpec(spec).filter((p) => !lenient || /pick a measurement|needs \d+ landmarks|start value|target value|min or max|comparison|threshold|refers to option|must be/.test(p));
    if (problems.length) throw new Error('spec "' + (spec && spec.id) + '": ' + problems.join('; '));
    const { FULL, ATTEMPT, BAND } = k;
    const fs = faultSettings(k);
    const S0 = spec.sided ? null : 'L';

    /* every measurement the move reads, once each; the index is how measure() finds its baseline */
    const metrics = []; const idxOf = new Map();
    const use = (m) => { const key = JSON.stringify(m); if (!idxOf.has(key)) { idxOf.set(key, metrics.length); metrics.push(m); } return idxOf.get(key); };
    const prog = spec.type === 'reps' ? spec.progress : null;
    const iProg = prog ? use(prog.metric) : -1;
    const holdConds = (spec.type === 'hold' ? spec.hold.conditions : []).map((c) => ({ ...c, i: use(c.metric) }));
    const liveFaults = spec.faults.filter((f) => !f.rule).map((f) => ({ ...f, i: use(f.metric), iScale: f.scale ? (f.scale.metric === 'progress' ? (prog ? use(prog.metric) : -1) : use(f.scale.metric)) : -1 }));
    const gates = (list) => (list || []).map((w) => typeof w === 'string' ? { flag: w } : w.option !== undefined ? { option: w.option, is: Array.isArray(w.is) ? w.is : [w.is] } : { ...w, i: use(w.metric) });
    const faultGates = new Map(spec.faults.map((f) => [f.id, gates(f.when)]));
    const condGates = holdConds.map((c) => gates(c.when));

    const required = new Set(k.settings.landmarks.always);
    for (const S of ['L', 'R']) for (const m of metrics) metricLandmarks(m, S, k).forEach((i) => required.add(i));
    if (!spec.upperBody) k.settings.landmarks.legs.forEach((i) => required.add(i));

    const options = [];
    if (prog && typeof prog.target === 'string') {
      const key = prog.target.slice(4); const o = (spec.options || []).find((x) => x.key === key);
      if (!o) throw new Error('progress target refers to option "' + key + '" which is not defined');
    }
    for (const o of spec.options || []) options.push({ key: o.key, label: o.label, values: o.values.slice(), unit: o.unit, default: o.default, labels: o.labels ? { ...o.labels } : undefined });
    if (spec.band) options.push(BAND(spec.band === true ? 'none' : spec.band));

    const focusNames = (Array.isArray(spec.focus) ? spec.focus : spec.focus ? [spec.focus] : (prog ? [prog.metric.pts[prog.metric.pts.length - 1]] : holdConds.length ? [holdConds[0].metric.pts[0]] : [])).filter(Boolean);
    const autoSide = !!(spec.sided && spec.sided.auto);
    const sideFollow = ((k.settings || {}).side || {}).follow || null;

    /* a gate is met when the option has that value, the hold position is (not) held, or a measurement passes its comparison */
    const gateOk = (g, m, vals, opts) => {
      if (g.flag === 'inPosition') return m.inPosition !== false;
      if (g.flag === 'notInPosition') return m.inPosition === false;
      if (g.option) return g.is.includes(opts ? opts[g.option] : undefined);
      const v = vals[g.i] - (g.rel === 'change' ? m.base[g.i] : 0);
      return g.op === '>' ? v > g.threshold : v < g.threshold;
    };

    function calibrate(pts, S, opts) {
      const ref = calibrateRef(metrics, pts, k, opts);
      ref.opts = opts || {};
      ref.work = opts && opts.work ? opts.work : null;
      const side = ref.work || S || S0 || 'L';
      if (prog) {
        let start = prog.start === 'calibrated' ? ref.base[side][iProg] : prog.start;
        if (Number.isFinite(prog.startMin)) start = Math.max(start, prog.startMin);
        if (Number.isFinite(prog.startMax)) start = Math.min(start, prog.startMax);
        ref.start = start;
        const t = typeof prog.target === 'string' ? +(opts && opts[prog.target.slice(4)]) : prog.target;
        ref.target = prog.start === 'calibrated' && prog.targetIsDelta ? start + (prog.delta || 1) * t : t;
        ref.dataTarget = ref.target;   /* what the file says; a demonstrated pose may replace ref.target */
      }
      return ref;
    }
    /* ---------- a pose the person shows once, before the set ----------
       Some targets are a number that only means anything on the body in front of the camera: "arms
       out at shoulder height" reads as one angle on a wide-shouldered person square to the lens and
       another on someone half-turned, and a band or dumbbell hides the landmarks that would settle
       it. So the move can ask for the end of the range to be demonstrated once, without the
       equipment, and that reading becomes the target. The file's own number stays as the fallback
       and as the sanity check: a demonstration that did not really leave the start position, or that
       overshoots wildly, is refused rather than trusted. */
    function showTarget(pts, ref) {
      if (iProg < 0 || !ref || !Number.isFinite(ref.dataTarget)) return null;
      const side = ref.work || S0 || 'L';
      let v; try { v = evalMetric(metrics[iProg], pts, side, k, ref, ref.opts || {}); } catch (e) { return null; }
      if (!Number.isFinite(v)) return null;
      const want = ref.dataTarget - ref.start, reach = v - ref.start;
      if (!want) return null;
      const frac = reach / want;
      if (!(frac > 0.4 && frac < 2.5)) return null;
      ref.shown = v; ref.target = v;
      return v;
    }
    function measure(pts, S, ref) {
      const opts = ref.opts || {};
      let side = ref.work || S || S0 || 'L';
      const iSel = iProg >= 0 ? iProg : holdConds.length ? holdConds[0].i : -1;
      /* The chosen limb is not the one moving: follow the body rather than ask them to start over.
         Only for a counted move, where "further through the rep" says outright which limb is working,
         and only after the other side has led by a clear margin for half a second, so one noisy frame
         cannot flip it mid-rep. The baselines for both sides were taken at calibration, so switching
         costs nothing but the word. */
      if (ref.work && iSel >= 0 && iProg >= 0 && sideFollow && spec.sided && (spec.sided.by || 'pick') === 'pick') {
        const rel = (s2) => evalMetric(metrics[iSel], pts, s2, k, ref, opts) - ref.base[s2][iSel];
        const dir = (prog.delta || 1) * Math.sign((ref.target ?? 1) - (ref.start ?? 0)) || 1;
        const other = ref.work === 'L' ? 'R' : 'L';
        ref.wrongFor = (rel(other) - rel(ref.work)) * dir > sideFollow.margin ? (ref.wrongFor || 0) + 1 : 0;
        if (ref.wrongFor >= sideFollow.frames) { ref.work = other; ref.wrongFor = 0; ref.switched = (ref.switched || 0) + 1; }
        side = ref.work;
      }
      if (autoSide && !ref.work && iSel >= 0) {
        /* no side chosen: the side whose selecting measurement (progress, or the first hold condition) has moved further, with hysteresis */
        const rel = (s) => evalMetric(metrics[iSel], pts, s, k, ref, opts) - ref.base[s][iSel];
        const vL = rel('L'), vR = rel('R'); const dir = iProg >= 0 ? ((prog.delta || 1) * Math.sign((ref.target ?? 1) - (ref.start ?? 0)) || 1) : 1;
        side = k.stickySide(ref, vL * dir, vR * dir);
      }
      const m = { side, useL: side === 'L', focus: [], base: ref.base[side] };
      for (const n of focusNames) { const i = indexOf(n, side, k); if (i !== null) m.focus.push(i); }
      const vals = metrics.map((mm) => evalMetric(mm, pts, side, k, ref, opts));
      m.readings = vals;
      if (prog) { m.v = vals[iProg]; m.p = (vals[iProg] - ref.start) / (ref.target - ref.start); m.value = vals[iProg]; }
      else {
        let ok = true; m.h = [];
        holdConds.forEach((c, j) => {
          const applies = condGates[j].every((g) => g.option ? gateOk(g, m, vals, opts) : true);
          const v = vals[c.i]; const base = c.rel === 'change' ? ref.base[side][c.i] : 0; const d = v - base; m.h[j] = d;
          if (!applies) return;
          if (Number.isFinite(c.min) && d < c.min) ok = false; if (Number.isFinite(c.max) && d > c.max) ok = false;
        });
        m.inPosition = ok; m.p = ok ? 1 : 0; m.v = holdConds.length ? m.h[0] : 0;
      }
      for (const f of liveFaults) {
        const v = vals[f.i]; const base = f.rel === 'change' ? ref.base[side][f.i] : 0; m['f_' + f.id] = v - base;
        /* a threshold that scales with another reading is folded into the value: v - times × other */
        if (f.iScale >= 0) { const o = vals[f.iScale] - (f.scale.rel === 'change' || f.scale.metric === 'progress' ? ref.base[side][f.iScale] : 0); m['f_' + f.id] -= f.scale.times * o; }
      }
      m.gates = {};
      for (const [id, gs] of faultGates) m.gates[id] = gs.every((g) => gateOk(g, m, vals, opts));
      return m;
    }

    /* Rep rules carry a cooldown as well, so the engine can hold one back when it has just been
       said; without it a rule true on every rep would be repeated on every rep. */
    const faults = spec.faults.map((f) => {
      /* maxCues caps how often one cue may be spoken in a single set. Told once, "slow it down"
         is advice; told every rep it is nagging that buries the cues that matter. A move may set
         its own; otherwise settings.json caps by rule name. */
      const cap = Number.isFinite(f.maxCues) ? f.maxCues : (f.rule && (fs.maxCues || {})[f.rule]);
      const common = { id: f.id, label: f.label, cue: f.cue, tip: f.tip, weight: fs.severityWeight[String(+f.severity)] || 1, invalidates: !!f.invalidates, ...(Number.isFinite(cap) ? { maxCues: cap } : {}) };
      if (f.rule === 'shallow') return { ...common, onRep: true, cooldown: f.cooldown || fs.cooldown, check: (rep) => rep.peak < FULL && rep.peak > ATTEMPT };
      if (f.rule === 'fast') return { ...common, onRep: true, cooldown: f.cooldown || fs.cooldown, check: (rep) => rep.duration < f.minMs };
      if (f.rule === 'return') return { ...common, onRep: true, cooldown: f.cooldown || fs.cooldown, check: (rep) => rep.endP > (Number.isFinite(f.threshold) ? f.threshold : 0.25) };
      const gate = f.minP == null ? 0 : f.minP;
      /* holds: a fault watches the held position unless it says phase "any" (it is the position itself that is missing) */
      const phase = f.phase === 'moving' || f.phase === 'rest' ? f.phase : undefined;
      const needPosition = spec.type === 'hold' && f.phase !== 'any';
      return {
        ...common, persist: f.persist || fs.persist, cooldown: f.cooldown || fs.cooldown, phase,
        check: (m) => (needPosition ? m.inPosition !== false : (m.p ?? 0) >= gate) && m.gates[f.id] && (f.op === '>' ? m['f_' + f.id] > f.threshold : m['f_' + f.id] < f.threshold),
      };
    });

    const ex = {
      id: spec.id, order: spec.order || 500, name: spec.name, group: spec.group, type: spec.type, view: spec.view, icon: spec.icon || 'move',
      summary: spec.summary, setup: spec.setup, brief: spec.brief, why: spec.why, show: spec.show || null, showTarget,
      defaultTarget: spec.defaultTarget, targets: spec.targets.slice(),
      options, required: [...required].sort((a, b) => a - b),
      calibrate, measure, faults, tracking: spec.tracking || 'form', vetted: !!spec.vetted,
      guide: { surface: spec.guide.surface, stop: spec.guide.stop, cannotSee: spec.guide.cannotSee, regions: spec.guide.regions.filter((r) => r.name && (r.points || []).some((p) => p.t)).map((r) => ({ name: r.name, points: r.points.filter((p) => p.t).map((p) => ({ t: p.t, tracked: !!p.tracked })) })) },
      display: spec.display || null, enterCue: spec.enterCue || null, metrics, iProg, holdConds,
      spec,
    };
    if (spec.sided) ex.sided = { limb: spec.sided.limb, by: spec.sided.by || 'pick' };
    if (spec.upperBody) ex.upperBody = true;
    if (spec.figure) {
      if (root.OnTrackAnatomy && root.OnTrackAnatomy.register) root.OnTrackAnatomy.register(spec.id, spec.figure);
      else (root.__pendingFigures = root.__pendingFigures || []).push([spec.id, spec.figure]);   /* drained when the figure renderer loads */
    }
    return ex;
  }

  const api = { KINDS, NAMES, RULES, PHASES, compile, checkSpec, evalMetric, calibrateRef, metricLandmarks, describeKind, resolve };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MoveSpec = api;
})(typeof window !== 'undefined' ? window : globalThis);
