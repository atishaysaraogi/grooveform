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
  /* every landmark name a move may write: the working side, the other side, and the midpoints */
  const LM_ALL = [...NAMES, ...NAMES.map((n) => 'o' + n), 'NOSE', 'mSH', 'mHIP', 'mEAR'];
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
  const segKey = (m, S) => (m.per && m.per !== 'torso' ? (m.per === 'height' ? 'height' : m.per.join('-')) : 'torso') + ':' + S;
  /* The person's standing height in image units, estimated from the segments the pose model
     gives on this frame: trunk (mid-shoulder to mid-hip) plus the longer thigh and the longer
     shin, which between them are about 78 % of stature (Drillis & Contini); with the legs out
     of frame the trunk alone, at about 29 %. Measured at calibration, so a bend later in the
     set does not shrink the ruler. */
  const STATURE = { trunk: 0.288, thigh: 0.245, shin: 0.246 };
  function stature(pts, k) {
    const seen = (i) => (pts[i].v ?? pts[i].visibility ?? 1) >= 0.5;
    const trunk = torso(pts, k);
    if ([25, 26, 27, 28].every(seen)) {
      const thigh = Math.max(k.dist(pts[23], pts[25]), k.dist(pts[24], pts[26])), shin = Math.max(k.dist(pts[25], pts[27]), k.dist(pts[26], pts[28]));
      return Math.max((trunk + thigh + shin) / (STATURE.trunk + STATURE.thigh + STATURE.shin), 0.1);
    }
    return Math.max(trunk / STATURE.trunk, 0.1);
  }
  const HEIGHT_UNITS = { in: 1, cm: 2.54 };
  /* A metric in inches or centimetres reads a share of the person's height, then that share of
     the height they gave the app (opts.heightIn, 5'11" when unset). */
  const DEFAULT_HEIGHT_IN = 71;
  function unitScale(m, opts) {
    if (!m.unit) return 1;
    const inch = (opts && Number.isFinite(opts.heightIn) ? opts.heightIn : DEFAULT_HEIGHT_IN) / 100;
    return m.unit === 'cm' ? inch * 2.54 : inch;
  }
  const lenKey = (m, S) => m.pts.join('-') + ':' + S;

  /* The reference length a % kind is divided by: the torso, or the segment `per`, as measured at
     calibration when there is one (ref), else on this frame. */
  function unitLen(m, pts, S, k, ref) {
    if (!m.per || m.per === 'torso') return ref && ref.torso ? ref.torso : torso(pts, k);
    if (m.per === 'height') return ref && ref.stature ? ref.stature : stature(pts, k);
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
    if (m.unit && m.per === 'height') v *= unitScale(m, opts || (ref && ref.opts));
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
    const ref = { torso: torso(pts, k), stature: stature(pts, k), pts0: pts.map((p) => ({ x: p.x, y: p.y, z: p.z, v: p.v })), lens: {}, fwd: {}, base: { L: [], R: [] } };
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
  const RULES = ['shallow', 'fast', 'return', 'shortHold'];
  /* Every moment the coach speaks or writes on its own account, in the order a set meets them.
     A move may silence any of them or put its own words in their place — see `cues`. */
  const STAGES = ['opening', 'position', 'start', 'show', 'countIn', 'go', 'count', 'praise', 'partial', 'fault', 'mark', 'enter', 'finish', 'lost', 'turn'];
  /* When a fault is watched. The first four are inside a running set; "start" is the odd one out —
     it is checked once, on the start position, before the set begins, so a set-up error (feet too
     far away, band already taut, knee already bent) is said while it can still be fixed rather
     than measured against for the whole set. */
  const PHASES = ['moving', 'rest', 'hold', 'any', 'start'];

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
    if (spec.repHold !== undefined && spec.repHold !== null && spec.repHold !== 0) { need(spec.type === 'reps', 'repHold (a hold at the top of each rep) is for a counted move — a timed move is a hold already'); need(Number.isFinite(spec.repHold) && spec.repHold > 0 && spec.repHold <= 30, 'repHold: seconds, more than 0 and at most 30'); }
    if (spec.weight !== undefined && spec.weight !== false) need(spec.weight === true || spec.weight === 'none' || (Number.isFinite(spec.weight) && spec.weight > 0), 'weight must be true, "none" or a number of kilograms');
    if (spec.stable !== undefined) {
      if (!Array.isArray(spec.stable)) problems.push('stable must be a list of landmark names');
      else for (const n of spec.stable) if (!LM_ALL.includes(n)) problems.push('stable: unknown landmark "' + n + '"');
    }
    if (spec.cues !== undefined) {
      if (!spec.cues || typeof spec.cues !== 'object' || Array.isArray(spec.cues)) problems.push('cues must be a block of stage: setting');
      else for (const [stage, v] of Object.entries(spec.cues)) {
        if (!STAGES.includes(stage)) { problems.push('cues: "' + stage + '" is not a stage (' + STAGES.join(', ') + ')'); continue; }
        const listy = stage === 'praise' || stage === 'mark';
        if (v === false || v === true) continue;
        if (listy ? !Array.isArray(v) || !v.length : typeof v !== 'string' || !v.trim()) problems.push('cues.' + stage + ': ' + (listy ? 'true, false or a list' : 'true, false or the words to say'));
      }
    }
    need(['front', 'side'].includes(spec.view), 'view must be front or side');
    need(spec.summary, 'summary (one line for the tile) is missing');
    need(spec.setup, 'setup (where the camera goes) is missing');
    need(spec.why, 'why (why this camera angle can measure it) is missing');
    const optKeys = (spec.options || []).map((o) => o.key);
    const mOk = (m, where) => {
      if (!m || !KINDS[m.kind]) { problems.push(where + ': pick a measurement'); return false; }
      const n = KINDS[m.kind].n; if ((m.pts || []).length < n) { problems.push(where + ': needs ' + n + ' landmarks'); return false; }
      if (m.per !== undefined && m.per !== 'torso' && m.per !== 'height' && !(Array.isArray(m.per) && m.per.length === 2)) problems.push(where + ': per must be "torso", "height" or two landmarks');
      if (m.unit !== undefined && !HEIGHT_UNITS[m.unit]) problems.push(where + ': unit must be "in" or "cm"');
      if (m.unit !== undefined && m.per !== 'height') problems.push(where + ': inches or centimetres need per: "height" — nothing else on the body has a known length');
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
        /* A movement is not always one angle. A squat is the knee bending AND the hip folding, and a
           rep that does one without the other is not the exercise. "and" adds measurements on the
           same footing as the first; each gets its own start and target and its own 0..1, and
           "combine" says how they become one number. */
        if (spec.progress.and !== undefined && !(Array.isArray(spec.progress.and) && !spec.progress.and.length)) {
          need(Array.isArray(spec.progress.and), 'progress: "and" must be a list of further measurements');
          (Array.isArray(spec.progress.and) ? spec.progress.and : []).forEach((a, i) => {
            const w = `progress.and[${i}]`;
            if (!mOk(a && a.metric, w)) return;
            need(Number.isFinite(a.start) || a.start === 'calibrated', w + ': start value');
            need(Number.isFinite(a.target) || (typeof a.target === 'string' && a.target.startsWith('opt:')), w + ': target value');
            if (a.delta !== undefined) need([1, -1].includes(a.delta), w + ': delta must be 1 or -1');
          });
        }
        if (spec.progress.combine !== undefined) need(['min', 'mean', 'max'].includes(spec.progress.combine), 'progress: combine must be min, mean or max');
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
      if (f.phase !== undefined && f.phase !== '') need(PHASES.includes(f.phase), w + ': phase must be one of ' + PHASES.join(', '));
      if (f.phase === 'start') {
        need(!f.rule, w + ': phase "start" needs a measurement of its own — a built-in rule judges a rep, and at the start there is no rep yet');
        need(f.rel !== 'change', w + ': phase "start" cannot measure the change from the start position, because that is the position being judged');
      }
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
    /* How sure the pose model is of the landmarks a fault reads. Filmed side-on the far arm and
       leg are behind the body, and the model returns a confident-looking guess for them; the one
       thing that says so is the visibility it reports, which drops to about half. A fault reading
       those is not silenced — a knee that has plainly collapsed is worth saying either way — but
       it has to clear a bigger margin and hold longer, and below the floor it is not said at all. */
    const unsure = fs.unsure || null;
    const lmCache = new Map();
    const faultLms = (f, S) => { const key = f.id + S; let v = lmCache.get(key); if (!v) { try { v = metricLandmarks(f.metric, S, k); } catch (e) { v = []; } lmCache.set(key, v); } return v; };
    const visAt = (p) => (p && (p.v ?? p.visibility ?? p.score)) ?? 1;
    const S0 = spec.sided ? null : 'L';

    /* every measurement the move reads, once each; the index is how measure() finds its baseline */
    const metrics = []; const idxOf = new Map();
    const use = (m) => { const key = JSON.stringify(m); if (!idxOf.has(key)) { idxOf.set(key, metrics.length); metrics.push(m); } return idxOf.get(key); };
    const prog = spec.type === 'reps' ? spec.progress : null;
    const iProg = prog ? use(prog.metric) : -1;
    /* the progress measurements, the first and any "and" ones, each with its own index */
    const progParts = prog ? [{ ...prog, i: iProg }, ...((prog.and || []).map((a) => ({ ...a, i: use(a.metric) })))] : [];
    const combine = (prog && prog.combine) || 'min';
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
    if (spec.weight !== undefined && spec.weight !== false) options.push(k.WEIGHT(spec.weight === true ? 'none' : spec.weight));

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

    /* Where each measurement starts from and where it is going, read off a set of baselines. */
    function startsFrom(ref, side, opts) {
      return progParts.map((p) => {
        let start = p.start === 'calibrated' ? ref.base[side][p.i] : p.start;
        if (Number.isFinite(p.startMin)) start = Math.max(start, p.startMin);
        if (Number.isFinite(p.startMax)) start = Math.min(start, p.startMax);
        const t = typeof p.target === 'string' ? +(opts && opts[p.target.slice(4)]) : p.target;
        const target = p.start === 'calibrated' && p.targetIsDelta ? start + (p.delta || 1) * t : t;
        return { i: p.i, name: typeof p.metric === 'string' ? p.metric : p.metric.kind, start, target };
      });
    }
    function calibrate(pts, S, opts) {
      const ref = calibrateRef(metrics, pts, k, opts);
      ref.opts = opts || {};
      ref.work = opts && opts.work ? opts.work : null;
      const side = ref.work || S || S0 || 'L';
      if (prog) {
        ref.parts = startsFrom(ref, side, opts);
        /* the first measurement is still "the" one: it is what the readout shows, what the target
           line is drawn for, and what a demonstrated pose replaces */
        ref.start = ref.parts[0].start; ref.target = ref.parts[0].target; ref.dataTarget = ref.target;
        /* what the beginning of the set read, kept so a later rep's start can be held near it */
        ref.parts0 = ref.parts.map((p) => ({ start: p.start, target: p.target }));
        ref.base0 = { L: ref.base.L.slice(), R: ref.base.R.slice() };
      }
      return ref;
    }
    /* ---------- the start of THIS rep ----------
       A set is not done in one place. The person settles a little differently on the fourth bridge
       than on the first, and a rep measured from where the set began is then read wrong — too far
       through before it starts, or never back at rest when it ends. So the position held just
       before a rep becomes that rep's start: the baselines are read again on that frame.

       What stops it drifting into nonsense is the clamp. A start may only wander `drift` of the
       way from the calibrated start toward the target, so a body that settles is followed while
       someone who stops half way down does not get to redefine the exercise — that is still a
       short rep, and the "return" rule still says so. A demonstrated target is left alone. */
    function startAgain(ref, pts, S, cfg) {
      if (!prog || !ref || !ref.parts0 || ref.shown != null) return false;
      const side = ref.work || S || S0 || 'L';
      const opts = ref.opts || {};
      const drift = (cfg && Number.isFinite(cfg.drift)) ? cfg.drift : 0.4;
      const next = []; let moved = false;
      for (let j = 0; j < progParts.length; j++) {
        const p = progParts[j], was = ref.parts0[j], cur = ref.parts[j];
        if (p.start !== 'calibrated') { next.push({ ...cur }); continue; }    /* a start written as a number is a number */
        let v; try { v = evalMetric(metrics[p.i], pts, side, k, ref, opts); } catch (e) { return false; }
        if (!Number.isFinite(v)) return false;
        let start = v;
        if (Number.isFinite(p.startMin)) start = Math.max(start, p.startMin);
        if (Number.isFinite(p.startMax)) start = Math.min(start, p.startMax);
        const lim = Math.abs(was.target - was.start) * drift, off = start - was.start;
        if (Math.abs(off) > lim) start = was.start + Math.sign(off) * lim;
        const t = typeof p.target === 'string' ? +(opts[p.target.slice(4)]) : p.target;
        const target = p.targetIsDelta ? start + (p.delta || 1) * t : was.target;
        /* worth re-reading only when it has actually shifted, so a long rest is not a stream of them */
        if (Math.abs(start - cur.start) > Math.max(0.01 * Math.abs(was.target - was.start), 0.05)) moved = true;
        next.push({ i: p.i, name: cur.name, start, target });
      }
      if (!moved) return false;
      /* only where the rep is measured from moves. What a fault compares against does not: a heel
         that has been off the floor since the first rep is still off the floor, and a baseline that
         crept up with it every rep would quietly stop saying so. */
      ref.parts = next; ref.start = next[0].start; ref.target = next[0].target;
      ref.restarts = (ref.restarts || 0) + 1;
      return true;
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
    /* The start position, before anything is calibrated for real: the frame is its own reference,
       which is why a "start" fault may not measure a change from the start. Returns the faults that
       are true of this position — the coach says them before the count-in, the Studio shows them
       against a take, and neither has to run a set to find out. */
    function checkStart(pts, S, opts) {
      const start = faults.filter((f) => f.atStart); if (!start.length || !pts) return [];
      let m; try { m = measure(pts, S, { ...calibrate(pts, S, opts || {}), opts: opts || {} }); } catch (e) { return []; }
      return start.filter((f) => { try { return !!f.check(m); } catch (e) { return false; } });
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
      if (prog) {
        m.v = vals[iProg]; m.value = vals[iProg];
        const parts = (ref.parts || [{ i: iProg, start: ref.start, target: ref.target, name: 'progress' }]).map((p, j) => {
          const start = j === 0 ? ref.start : p.start, target = j === 0 ? ref.target : p.target;   /* a shown pose moves the first one */
          return { name: p.name, v: vals[p.i], p: (vals[p.i] - start) / (target - start), start, target };
        });
        m.parts = parts;
        const ps = parts.map((p) => p.p);
        /* min: the rep is only as far through as its least-finished part — a squat that bends the
           knee without folding the hip has not been done */
        m.p = ps.length === 1 ? ps[0] : combine === 'mean' ? ps.reduce((a, b) => a + b, 0) / ps.length : combine === 'max' ? Math.max(...ps) : Math.min(...ps);
      }
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
      /* the least confident landmark each fault depends on, on the side being measured */
      if (unsure) { m.conf = {}; for (const f of liveFaults) { let lo = 1; for (const i of faultLms(f, side)) lo = Math.min(lo, visAt(pts[i])); m.conf[f.id] = lo; } }
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
      const byRule = f.rule ? (fs.maxCues || {})[f.rule] : undefined;
      const cap = Number.isFinite(f.maxCues) ? f.maxCues : Number.isFinite(byRule) ? byRule : (fs.maxCues || {}).perSet;
      const common = { id: f.id, label: f.label, cue: f.cue, tip: f.tip, weight: fs.severityWeight[String(+f.severity)] || 1, invalidates: !!f.invalidates, ...(Number.isFinite(cap) ? { maxCues: cap } : {}) };
      if (f.rule === 'shallow') return { ...common, onRep: true, cooldown: f.cooldown || fs.cooldown, check: (rep) => rep.peak < FULL && rep.peak > ATTEMPT };
      if (f.rule === 'fast') return { ...common, onRep: true, cooldown: f.cooldown || fs.cooldown, check: (rep) => rep.duration < f.minMs };
      if (f.rule === 'return') return { ...common, onRep: true, cooldown: f.cooldown || fs.cooldown, check: (rep) => rep.endP > (Number.isFinite(f.threshold) ? f.threshold : 0.25) };
      /* the top was reached but not held for the move's repHold seconds */
      if (f.rule === 'shortHold') return { ...common, onRep: true, cooldown: f.cooldown || fs.cooldown, check: (rep) => !!rep.shortHold };
      const gate = f.minP == null ? 0 : f.minP;
      const confOf = (m) => (m.conf && m.conf[f.id] !== undefined) ? m.conf[f.id] : 1;
      /* what the reading has to beat: the threshold, or the threshold plus a flat margin in the
         reading's own units when the landmarks are guesses */
      const pad = unsure ? (unsure.margin ?? 8) : 0;
      const over = (m) => {
        if (!m.gates[f.id]) return false;
        const v = m['f_' + f.id], c = confOf(m);
        if (unsure && c < (unsure.vis ?? 0.75)) {
          if (c < (unsure.floor ?? 0.4)) return false;
          return f.op === '>' ? v > f.threshold + pad : v < f.threshold - pad;
        }
        return f.op === '>' ? v > f.threshold : v < f.threshold;
      };
      /* and how long it has to hold: longer while the landmarks are unsure */
      const persistFor = unsure ? (m) => (confOf(m) < (unsure.vis ?? 0.75) ? Math.round((f.persist || fs.persist) * (unsure.persist ?? 2.5)) : (f.persist || fs.persist)) : null;
      /* the start position, judged once before the set: no progress gate to pass and no held
         position to be in, because neither exists yet — only the measurement and its threshold */
      if (f.phase === 'start') return { ...common, atStart: true, phase: 'start', persist: f.persist || fs.persist, cooldown: f.cooldown || fs.cooldown, check: over };
      /* Reps: a fault watches the rep. Between reps the person shifts, adjusts the mat, rests a
         hand on the floor — none of that is the exercise, and flagging it is the coach talking over
         a pause. So a rep move's fault watches the movement unless it says otherwise: "rest" to
         watch only between reps, "any" for both.
         Holds: a fault watches the held position unless it says "any" (it is the position itself
         that is missing). */
      const phase = spec.type === 'reps'
        ? (f.phase === 'any' ? undefined : f.phase === 'rest' ? 'rest' : 'moving')
        : (f.phase === 'moving' || f.phase === 'rest' ? f.phase : undefined);
      const needPosition = spec.type === 'hold' && f.phase !== 'any';
      return {
        ...common, persist: f.persist || fs.persist, cooldown: f.cooldown || fs.cooldown, phase,
        ...(persistFor ? { persistFor } : {}),        /* the tracker asks per frame: unsure landmarks hold longer */
        check: (m) => (needPosition ? m.inPosition !== false : (m.p ?? 0) >= gate) && m.gates[f.id] && over(m),
      };
    });

    const ex = {
      id: spec.id, order: spec.order || 500, name: spec.name, group: spec.group, type: spec.type, view: spec.view, icon: spec.icon || 'move',
      summary: spec.summary, setup: spec.setup, brief: spec.brief, why: spec.why, show: spec.show || null, showTarget,
      defaultTarget: spec.defaultTarget, targets: spec.targets.slice(),
      options, required: [...required].sort((a, b) => a - b),
      calibrate, startAgain, measure, checkStart, faults, tracking: spec.tracking || 'form', vetted: !!spec.vetted, repHold: spec.type === 'reps' && spec.repHold ? spec.repHold : 0,
      stable: (spec.stable || []).slice(), cues: spec.cues ? { ...spec.cues } : null,
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

  /* the unit a metric reads in: its own (inches, centimetres) or the kind's (°, %) */
  const unitOf = (m) => (m && m.unit) || ((KINDS[m && m.kind] || {}).unit) || '';
  const api = { KINDS, NAMES, RULES, PHASES, STAGES, compile, checkSpec, evalMetric, calibrateRef, metricLandmarks, describeKind, resolve, stature, unitOf, DEFAULT_HEIGHT_IN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MoveSpec = api;
})(typeof window !== 'undefined' ? window : globalThis);
