/* ============================================================
   Catalogue — the library, read from data files.

   The ten hand-written moves are code (coach/library/). Everything else
   is an entry in client/data/moves/<region>.json: the fields a physio
   fills in (what, where the camera goes, how many, what goes wrong and
   the cue for it, the guide, equipment, muscles, level, sources) plus,
   where one camera can actually measure it, the measurement and the
   fault thresholds that coach/spec.js compiles into a rep counter and
   live checks. This file turns those entries into moves.

   Three tracking tiers, decided per entry:
     form — live fault checks: the camera counts AND judges
     reps — counts reps / times the hold; faults are listed, not watched
     none — nothing a single camera can measure; the guide is shown and
            the set is logged by hand

   Figures: an entry gives its two keyframes as joint ANGLES, and
   poseToFigure turns them into the point keyframes the stick figure
   draws. Angles are far easier to write by hand than pixel coordinates,
   and they cannot produce a limb of the wrong length.
   ============================================================ */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const lib = isNode ? require('./exercise-library.js') : root.ExerciseLibrary;
  const SPEC = isNode ? require('./spec.js') : root.MoveSpec;

  const D = Math.PI / 180;
  const L = { torso: 44, head: 22, thigh: 30, shin: 30, foot: 14, uarm: 26, farm: 24, hipHalf: 11, shHalf: 18 };

  /* ---- side view: hip is the root; angles in degrees --------------------------------
       torso  from vertical, + = leaning toward the way the body faces
       thigh, shin  from vertical-down, + = forward (knee / ankle toward the facing direction)
       foot   from horizontal-forward, + = toes lifted
       uarm, farm  from vertical-down, + = forward
       *F  the far limb (defaults to the near one, set slightly back so it shows behind)
       face  'right' (default) or 'left' — which way the body faces on screen             */
  function sidePose(a) {
    const dir = a.face === 'left' ? -1 : 1;
    const g = (k, d) => (a[k] === undefined ? d : a[k]);
    const t = g('torso', 0), th = g('thigh', 0), sh = g('shin', 0), ft = g('foot', 0), ua = g('uarm', 0), fa = g('farm', 0);
    const thF = g('thighF', th), shF = g('shinF', sh), ftF = g('footF', ft), uaF = g('uarmF', ua), faF = g('farmF', fa);
    const hip = { x: 0, y: 0 };
    const at = (p, ang, len, fromDown) => fromDown
      ? { x: p.x + Math.sin(ang * D) * dir * len, y: p.y + Math.cos(ang * D) * len }
      : { x: p.x + Math.sin(ang * D) * dir * len, y: p.y - Math.cos(ang * D) * len };
    const shoulder = at(hip, t, L.torso, false);
    const head = at(shoulder, t + g('neck', 0), L.head, false);
    const kn = at(hip, th, L.thigh, true), an = at(kn, sh, L.shin, true);
    const foot = { x: an.x + Math.cos(ft * D) * dir * L.foot, y: an.y - Math.sin(ft * D) * L.foot };
    const el = at(shoulder, ua, L.uarm, true), wr = at(el, fa, L.farm, true);
    const back = { x: -4 * dir, y: 3 };
    const knF = at(hip, thF, L.thigh, true), anF = at(knF, shF, L.shin, true);
    const footF = { x: anF.x + Math.cos(ftF * D) * dir * L.foot, y: anF.y - Math.sin(ftF * D) * L.foot };
    const elF = at(shoulder, uaF, L.uarm, true), wrF = at(elF, faF, L.farm, true);
    const sameF = thF === th && shF === sh && uaF === ua && faF === fa;
    const off = (p) => (sameF ? { x: p.x + back.x, y: p.y + back.y } : p);
    return { h: head, sh: shoulder, hip, kn, an, ft: foot, el, wr, knF: off(knF), anF: off(anF), ftF: off(footF), elF: off(elF), wrF: off(wrF), dir, sameF };
  }

  /* ---- front view: the two hips are the roots ---------------------------------------
       legL/legR   thigh from vertical-down, + = out to that side
       shinL/shinR from vertical-down, + = out (defaults to the thigh angle: a straight leg)
       armL/armR   upper arm from vertical-down, + = out to the side (180 = straight up)
       foreL/foreR forearm from vertical-down, + = out (defaults to the arm angle)
       lean        trunk toward the right, degrees;  headTilt  toward the right, degrees
       squat       how far the hips have dropped, 0..1 (knees bend out, torso stays up)   */
  function frontPose(a) {
    const g = (k, d) => (a[k] === undefined ? d : a[k]);
    const y0 = 0, sq = g('squat', 0);
    const hipL = { x: -L.hipHalf, y: y0 }, hipR = { x: L.hipHalf, y: y0 };
    const lean = g('lean', 0) * D, lx = Math.sin(lean) * L.torso;
    const shL = { x: -L.shHalf + lx, y: y0 - L.torso * Math.cos(lean) }, shR = { x: L.shHalf + lx, y: shL.y };
    const tilt = g('headTilt', 0) * D;
    const h = { x: lx + Math.sin(tilt) * L.head, y: shL.y - Math.cos(tilt) * L.head };
    const leg = (hip, side, thighA, shinA) => {
      const s = side === 'L' ? -1 : 1;
      const kn = { x: hip.x + Math.sin(thighA * D) * s * L.thigh, y: hip.y + Math.cos(thighA * D) * L.thigh };
      const an = { x: kn.x + Math.sin(shinA * D) * s * L.shin, y: kn.y + Math.cos(shinA * D) * L.shin };
      return { kn, an };
    };
    /* a squat shortens the vertical leg while pushing the knees out, hips down */
    const squatOut = 18 * sq;
    const lL = leg(hipL, 'L', g('legL', 0) + squatOut, g('shinL', g('legL', 0)) - squatOut);
    const lR = leg(hipR, 'R', g('legR', 0) + squatOut, g('shinR', g('legR', 0)) - squatOut);
    const arm = (sh, side, upA, foreA) => {
      const s = side === 'L' ? -1 : 1;
      const el = { x: sh.x + Math.sin(upA * D) * s * L.uarm, y: sh.y + Math.cos(upA * D) * L.uarm };
      const wr = { x: el.x + Math.sin(foreA * D) * s * L.farm, y: el.y + Math.cos(foreA * D) * L.farm };
      return { el, wr };
    };
    const aL = arm(shL, 'L', g('armL', 8), g('foreL', g('armL', 8))), aR = arm(shR, 'R', g('armR', 8), g('foreR', g('armR', 8)));
    return { h, shL, shR, elL: aL.el, elR: aR.el, wrL: aL.wr, wrR: aR.wr, hipL, hipR, knL: lL.kn, knR: lR.kn, anL: lL.an, anR: lR.an };
  }

  const FLOOR_Y = 161, CENTRE_X = 306;
  const isPt = (p) => p && typeof p.x === 'number';
  const ptKeys = (pose) => Object.keys(pose).filter((k) => k !== 'dir' && isPt(pose[k]));
  const shift = (pose, dx, dy) => { const o = {}; ptKeys(pose).forEach((k) => { o[k] = { x: pose[k].x + dx, y: pose[k].y + dy }; }); return o; };
  const maxY = (pose) => Math.max(...ptKeys(pose).map((k) => pose[k].y));
  /* The joint to hold still: the first (near foot first, then the far one, then hands, knees)
     that touches the floor in both keyframes. None → the keyframes are simply placed together.
     A seated move is the exception: the chair holds the hips, and the foot that hangs lowest in
     the start pose is in the air at the end of it — anchoring on that drags the body through
     the seat, so `posture: 'sitting'` pins the hip instead. */
  const ANCHOR_ORDER = ['ft', 'an', 'anL', 'anR', 'ftF', 'anF', 'kn', 'knF', 'wr', 'wrF', 'wrL', 'wrR', 'h'];
  function plantedKey(A, B) {
    const fa = maxY(A), fb = maxY(B);
    return ANCHOR_ORDER.find((k) => isPt(A[k]) && isPt(B[k]) && A[k].y > fa - 3 && B[k].y > fb - 3) || null;
  }

  /* ---- contacts that do not slide -------------------------------------------------------
     Moving the whole body pins exactly one joint, which is all a squat or a bridge needs. A
     push-up has two contacts: the toes AND the hands. So `anchor` may be a list — the first
     joint is pinned by moving the body, and each one after it by bending its own limb back onto
     the mark. That is a two-bone reach (planar IK): the segment lengths are the ones every other
     figure uses, so a corrected limb is still anatomical, and an unreachable mark stops short
     rather than stretching. The ankle is the joint that stays for a foot — the toes may still
     lift — so ft/ftF are read as an/anF. */
  const REACH = {
    side: { an: ['hip', 'kn', 'an', 'thigh', 'shin', 'ft'], anF: ['hip', 'knF', 'anF', 'thigh', 'shin', 'ftF'],
            wr: ['sh', 'el', 'wr', 'uarm', 'farm'], wrF: ['sh', 'elF', 'wrF', 'uarm', 'farm'] },
    front: { anL: ['hipL', 'knL', 'anL', 'thigh', 'shin'], anR: ['hipR', 'knR', 'anR', 'thigh', 'shin'],
             wrL: ['shL', 'elL', 'wrL', 'uarm', 'farm'], wrR: ['shR', 'elR', 'wrR', 'uarm', 'farm'] },
  };
  const REACH_ALIAS = { ft: 'an', ftF: 'anF' };
  function reach(pose, chain, target) {
    const [rootK, midK, endK, l1n, l2n, tailK] = chain;
    const R = pose[rootK]; if (!isPt(R) || !isPt(pose[midK]) || !isPt(pose[endK])) return;
    const l1 = L[l1n], l2 = L[l2n], dx = target.x - R.x, dy = target.y - R.y;
    const d = Math.min(l1 + l2 - 0.01, Math.max(Math.abs(l1 - l2) + 0.01, Math.hypot(dx, dy) || 1e-6));
    const base = Math.atan2(dy, dx);
    const a = Math.acos(Math.max(-1, Math.min(1, (d * d + l1 * l1 - l2 * l2) / (2 * l1 * d))));
    /* keep the knee (or elbow) bending the way the author drew it */
    const side = (pose[midK].x - R.x) * dy - (pose[midK].y - R.y) * dx >= 0 ? 1 : -1;
    const end = { x: R.x + Math.cos(base) * d, y: R.y + Math.sin(base) * d };
    if (isPt(pose[tailK])) pose[tailK] = { x: pose[tailK].x + end.x - pose[endK].x, y: pose[tailK].y + end.y - pose[endK].y };
    pose[midK] = { x: R.x + Math.cos(base + side * a) * l1, y: R.y + Math.sin(base + side * a) * l1 };
    pose[endK] = end;
  }

  /* Place both keyframes in the 400x175 diagram space with ONE transform, so a limb that does not
     move stays put between them. B is first shifted so its anchor joint — by default whatever
     touches the floor in A, i.e. the planted foot — sits where A's does; any further anchors are
     reached back onto their marks; then the pair is floored (y 161) and centred (x 306) together.
     pose.anchor names another joint, a list of them, or null for none; pose.lift raises B (a jump,
     landing on a box); pose.raise lifts both off the floor (a hang). */
  function placePair(A, B, pose, posture, view) {
    const named = pose.anchor === undefined ? (posture === 'sitting' ? 'hip' : plantedKey(A, B)) : pose.anchor;
    const anchors = (Array.isArray(named) ? named : [named]).filter(Boolean);
    const anchor = anchors[0];
    let Bs = shift(B, 0, 0);
    if (anchor && isPt(A[anchor]) && isPt(B[anchor])) Bs = shift(Bs, A[anchor].x - B[anchor].x, A[anchor].y - B[anchor].y);
    /* A far limb that only differs from the near one by the depth offset is that same limb drawn
       again a few pixels back, so it follows the near one rather than being solved on its own —
       solving it would ask an arm of the same length to reach a mark the offset moved. */
    const TWINS = [['el', 'elF'], ['wr', 'wrF'], ['kn', 'knF'], ['an', 'anF'], ['ft', 'ftF']];
    const twinned = B.sameF ? TWINS.filter(([n, f]) => isPt(Bs[n]) && isPt(Bs[f]))
      .map(([n, f]) => [n, f, { x: Bs[f].x - Bs[n].x, y: Bs[f].y - Bs[n].y }]) : [];
    const solo = twinned.length ? anchors.slice(1).filter((k) => !twinned.some(([, f]) => f === k)) : anchors.slice(1);
    for (const k of solo) {
      const j = REACH_ALIAS[k] || k, chain = (REACH[view] || {})[j];
      if (chain && isPt(A[j]) && isPt(Bs[j])) reach(Bs, chain, A[j]);
    }
    twinned.forEach(([n, f, off]) => { Bs[f] = { x: Bs[n].x + off.x, y: Bs[n].y + off.y }; });
    if (pose.lift) Bs = shift(Bs, 0, -pose.lift);
    const all = [...ptKeys(A).map((k) => A[k]), ...ptKeys(Bs).map((k) => Bs[k])];
    const maxY = Math.max(...all.map((p) => p.y)), xs = all.map((p) => p.x), cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const raise = pose.raise || 0;
    const fix = (p) => { const o = {}; ptKeys(p).forEach((k) => { o[k] = [Math.round(CENTRE_X + p[k].x - cx), Math.round(FLOOR_Y - raise - (maxY - p[k].y))]; }); return o; };
    return { A: fix(A), B: fix(Bs), anchors };
  }

  /* Equipment, named by the joint it sits at: { kind: 'box', at: 'hip' } is a chair under the hips
     of keyframe A ('B.an' reads keyframe B); a box always reaches the floor. 'bar' spans two joints
     or a length; 'disc' is a roller; 'band' runs from a joint to the wall. */
  function resolveProps(list, A, B, wall) {
    const joint = (ref) => { const [kf, key] = ref.includes('.') ? ref.split('.') : ['A', ref]; const P = kf === 'B' ? B : A; return P[key] ? { x: P[key][0], y: P[key][1] } : null; };
    return (list || []).map((p) => {
      const j = joint(p.at); if (!j) return null;
      if (p.kind === 'box') { const top = j.y + (p.dy || 0), w = p.w || 34; return { kind: 'box', x: Math.round(j.x - w / 2 + (p.dx || 0)), y: Math.round(top), w, h: Math.round(FLOOR_Y - top) }; }
      if (p.kind === 'bar') { const j2 = p.to ? joint(p.to) : null, ext = p.extend || 14, len = p.len || 60; return { kind: 'bar', x1: Math.round(j2 ? Math.min(j.x, j2.x) - ext : j.x - len / 2), x2: Math.round(j2 ? Math.max(j.x, j2.x) + ext : j.x + len / 2), y: Math.round(j.y + (p.dy || 0)) }; }
      if (p.kind === 'disc') return { kind: 'disc', x: Math.round(j.x + (p.dx || 0)), y: Math.round(j.y + (p.dy || 0)), r: p.r || 8 };
      if (p.kind === 'band') return wall == null ? null : { kind: 'band', x1: Math.round(j.x), y1: Math.round(j.y), x2: wall, y2: Math.round(j.y + (p.dy || 0)) };
      return null;
    }).filter(Boolean);
  }

  /* pose: { A: angles, B: angles, work: {region: 0..1}, wall: 'behind'|'ahead'|null, anchor, lift, raise, props } */
  function poseToFigure(view, pose, opts) {
    const build = view === 'front' ? frontPose : sidePose;
    const rawA = build(pose.A || {}), rawB = build(pose.B || pose.A || {});
    const { A, B, anchors } = placePair(rawA, rawB, pose, opts.posture, view);
    let wall = null;
    if (pose.wall && view === 'side') {
      const xs = [...Object.values(A), ...Object.values(B)].map((p) => p[0]);
      const behindIsLeft = (rawA.dir || 1) > 0;
      wall = (pose.wall === 'behind') === behindIsLeft ? Math.min(...xs) - 6 : Math.max(...xs) + 6;
    }
    /* `face` is the way the front of the body points, so the figure's muscles follow it. */
    const flip = view === 'side' ? (rawA.dir || 1) < 0 : false;
    const props = resolveProps(pose.props, A, B, wall);
    return { view, A, B, hold: !!opts.hold, side: opts.side || 'both', flip, w: pose.work || {}, wall, props, anchors, notes: pose.notes || [] };
  }

  function registerFigure(id, fig) {
    if (root.OnTrackAnatomy && root.OnTrackAnatomy.register) root.OnTrackAnatomy.register(id, fig);
    else (root.__pendingFigures = root.__pendingFigures || []).push([id, fig]);
  }

  /* ============================================================
     The data layer — everything below reads the files in client/data/.

       manifest.json   which files to load (settings, shared, the field guide, the regions, the code moves)
       settings.json   numbers and words every move shares (rep thresholds, fault timing, band colours…)
       shared.json     named measurements, fault templates, pose presets, hold sets
       _about.json     the field guide: what every field means, one copy for the whole library
       regions/*.json  one per body region: the defaults its moves inherit (region, group, order,
                       camera, equipment, sources) and the ids it holds, in the order they are shown
       moves/*.json    one file per exercise, named by its id

     One exercise to a file is the point: the Studio writes back exactly the move it edited, and a
     diff of a change to one exercise touches one file. A region file is read first and its defaults
     sit under every move it lists; a move may override any of them.

     A move file is data only. Names in it ("metric": "knee", "template": "lean", "preset":
     "standing") are looked up in shared.json and expanded here; every field name is checked
     against the lists below so a typo is an error with a suggestion, not a silently ignored
     field. Keys starting with "_" are notes for people and are skipped everywhere.
     ============================================================ */
  const KEYS = {
    manifest: ['settings', 'shared', 'about', 'regions', 'code'],
    regionFile: ['region', 'group', 'order', 'camera', 'equipment', 'sources', 'moves'],
    file: ['region', 'group', 'order', 'camera', 'equipment', 'sources', 'moves'],
    entry: ['id', 'name', 'clinicalName', 'type', 'view', 'tracking', 'vetted', 'level', 'equipment', 'muscles', 'sided', 'upperBody',
      'summary', 'setup', 'brief', 'why', 'calibrationPose', 'camera', 'targets', 'defaultTarget', 'options', 'band', 'minMs', 'focus',
      'progress', 'hold', 'faults', 'guide', 'pose', 'figure', 'enterCue', 'display', 'show',
      'tempo', 'dosage', 'progression', 'regression', 'contraindications', 'sources', 'icon', 'order', 'group', 'region'],
    fault: ['template', 'id', 'label', 'cue', 'tip', 'severity', 'metric', 'rel', 'op', 'threshold', 'scale', 'minP', 'persist', 'cooldown', 'maxCues', 'phase', 'when', 'invalidates', 'rule', 'minMs'],
    metric: ['kind', 'pts', 'per', 'sign', 'abs', 'flip'],
    progress: ['metric', 'start', 'startMin', 'startMax', 'target', 'targetIsDelta', 'delta'],
    hold: ['conditions'], condition: ['metric', 'rel', 'min', 'max', 'when'],
    when: ['option', 'is', 'metric', 'rel', 'op', 'threshold'], scale: ['metric', 'rel', 'times'], display: ['label', 'unit', 'from', 'aim', 'condition'],
    guide: ['surface', 'stop', 'cannotSee', 'regions'], region: ['name', 'points'], point: ['t', 'tracked'],
    camera: ['height', 'distance', 'posture', 'tolerance'], show: ['ask'], sided: ['limb', 'by', 'auto'], muscles: ['primary', 'secondary'], source: ['name', 'url'],
    option: ['key', 'label', 'values', 'unit', 'default', 'labels'],
    pose: ['A', 'B', 'work', 'wall', 'anchor', 'lift', 'raise', 'props', 'side', 'notes'],
    note: ['at', 'kf', 'text'],
    kfSide: ['preset', 'face', 'torso', 'neck', 'thigh', 'shin', 'foot', 'uarm', 'farm', 'thighF', 'shinF', 'footF', 'uarmF', 'farmF'],
    kfFront: ['preset', 'legL', 'legR', 'shinL', 'shinR', 'armL', 'armR', 'foreL', 'foreR', 'lean', 'headTilt', 'squat'],
    prop: ['kind', 'at', 'to', 'w', 'dy', 'dx', 'len', 'r', 'extend'],
    shared: ['measurements', 'faults', 'poses', 'holds'],
    settings: ['rep', 'skeleton', 'camera', 'fault', 'targets', 'landmarks', 'cannotSee', 'standardFaults', 'side', 'band', 'score'],
  };
  const isNote = (k) => k.startsWith('_');
  const fail = (where, msg) => { const e = new Error(`${where}: ${msg}`); e.where = where; throw e; };
  /* "did you mean" for a mistyped field name */
  function distance(a, b) {
    const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function checkKeys(obj, kind, where) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail(where, `expected an object with fields ${KEYS[kind].join(', ')}`);
    for (const k of Object.keys(obj)) {
      if (isNote(k) || KEYS[kind].includes(k)) continue;
      const near = KEYS[kind].map((x) => [distance(k.toLowerCase(), x.toLowerCase()), x]).sort((a, b) => a[0] - b[0])[0];
      fail(where, `unknown field "${k}"${near && near[0] <= 3 ? ` — did you mean "${near[1]}"?` : ''} (allowed: ${KEYS[kind].join(', ')})`);
    }
  }
  const strip = (obj) => { const o = {}; for (const k of Object.keys(obj)) if (!isNote(k)) o[k] = obj[k]; return o; };
  const clone = (v) => JSON.parse(JSON.stringify(v));

  /* ---- names → values, from shared.json ---- */
  function resolveMetric(m, shared, where) {
    if (typeof m === 'string') {
      const r = shared.measurements[m];
      if (!r) fail(where, `unknown measurement "${m}" — shared.json knows: ${Object.keys(shared.measurements).join(', ')}`);
      return clone(strip(r));
    }
    checkKeys(m, 'metric', where); return clone(strip(m));
  }
  function resolveWhen(w, shared, where) {
    if (typeof w === 'string') return w;
    checkKeys(w, 'when', where);
    const out = strip(w);
    if (out.metric !== undefined) out.metric = resolveMetric(out.metric, shared, where);
    return out;
  }
  function resolveFault(f, shared, where) {
    checkKeys(f, 'fault', where);
    let out = strip(f);
    if (out.template) {
      const T = shared.faults[out.template];
      if (!T) fail(where, `unknown fault template "${out.template}" — shared.json knows: ${Object.keys(shared.faults).join(', ')}`);
      const { template, ...rest } = out; out = { ...strip(T), ...rest };
      if (out.metric !== undefined && out.threshold === undefined) fail(where, `template "${template}" has no threshold of its own — give the fault one`);
    }
    if (Array.isArray(out.when)) out.when = out.when.map((w, i) => resolveWhen(w, shared, where + ' › when[' + i + ']'));
    if (out.scale && typeof out.scale === 'object') { checkKeys(out.scale, 'scale', where + ' › scale'); if (out.scale.metric !== 'progress') out.scale.metric = resolveMetric(out.scale.metric, shared, where + ' › scale'); }
    if (out.metric !== undefined) {
      out.metric = resolveMetric(out.metric, shared, where + ' › metric');
      /* a measurement without a number to compare against is a fault that can never fire — a mistake, not a choice */
      if (!['<', '>'].includes(out.op)) fail(where, `a fault with a metric needs "op": "<" or ">" (got ${JSON.stringify(out.op)})`);
      if (!Number.isFinite(out.threshold)) fail(where, `"threshold" must be a number (got ${JSON.stringify(out.threshold)})`);
    } else if (!out.rule && (out.op !== undefined || out.threshold !== undefined)) fail(where, 'op / threshold without a metric — add "metric" or remove them');
    return out;
  }
  function resolveKeyframe(kf, shared, view, where) {
    if (kf === undefined) return kf;
    const kind = view === 'front' ? 'kfFront' : 'kfSide';
    checkKeys(kf, kind, where);
    let out = strip(kf);
    if (out.preset) {
      const P = shared.poses[out.preset];
      if (!P) fail(where, `unknown pose preset "${out.preset}" — shared.json knows: ${Object.keys(shared.poses).join(', ')}`);
      const { preset, ...rest } = out; out = { ...strip(P), ...rest };
      checkKeys(out, kind, where + ` (preset ${preset})`);
    }
    return out;
  }
  /* A raw entry → the same entry with every name expanded and every field name checked. */
  function resolveEntry(raw, shared, where) {
    checkKeys(raw, 'entry', where);
    const e = clone(strip(raw));
    if (e.camera) checkKeys(e.camera, 'camera', where + ' › camera');
    if (e.sided) checkKeys(e.sided, 'sided', where + ' › sided');
    if (e.display) checkKeys(e.display, 'display', where + ' › display');
    if (e.show) checkKeys(e.show, 'show', where + ' › show');
    if (e.muscles) checkKeys(e.muscles, 'muscles', where + ' › muscles');
    (e.sources || []).forEach((s, i) => checkKeys(s, 'source', `${where} › sources[${i}]`));
    (e.options || []).forEach((o, i) => checkKeys(o, 'option', `${where} › options[${i}]`));
    if (e.progress) { checkKeys(e.progress, 'progress', where + ' › progress'); e.progress.metric = resolveMetric(e.progress.metric, shared, where + ' › progress'); }
    if (e.hold) {
      checkKeys(e.hold, 'hold', where + ' › hold');
      if (typeof e.hold.conditions === 'string') {
        const H = shared.holds[e.hold.conditions];
        if (!H) fail(where, `unknown hold set "${e.hold.conditions}" — shared.json knows: ${Object.keys(shared.holds).join(', ')}`);
        e.hold.conditions = clone(H);
      }
      e.hold.conditions = (e.hold.conditions || []).map((c, i) => { checkKeys(c, 'condition', `${where} › hold[${i}]`); const o = { ...strip(c), metric: resolveMetric(c.metric, shared, `${where} › hold[${i}]`) }; if (Array.isArray(o.when)) o.when = o.when.map((w, j) => resolveWhen(w, shared, `${where} › hold[${i}].when[${j}]`)); return o; });
    }
    e.faults = (e.faults || []).map((f, i) => resolveFault(f, shared, `${where} › faults[${i}]`));
    if (e.guide) {
      checkKeys(e.guide, 'guide', where + ' › guide');
      (e.guide.regions || []).forEach((r, i) => { checkKeys(r, 'region', `${where} › guide.regions[${i}]`); (r.points || []).forEach((p, j) => checkKeys(p, 'point', `${where} › guide.regions[${i}].points[${j}]`)); });
    }
    if (e.pose) {
      checkKeys(e.pose, 'pose', where + ' › pose');
      e.pose = strip(e.pose);
      e.pose.A = resolveKeyframe(e.pose.A, shared, e.view || 'front', where + ' › pose.A');
      e.pose.B = resolveKeyframe(e.pose.B, shared, e.view || 'front', where + ' › pose.B');
      (e.pose.props || []).forEach((p, i) => checkKeys(p, 'prop', `${where} › pose.props[${i}]`));
      (e.pose.notes || []).forEach((n, i) => {
        const w = `${where} › pose.notes[${i}]`;
        checkKeys(n, 'note', w);
        if (!n.at || typeof n.at !== 'string') fail(w, '"at" must name the joint the note points at');
        if (!n.text || typeof n.text !== 'string') fail(w, '"text" must say what to look at');
        if (n.kf !== undefined && n.kf !== 'A' && n.kf !== 'B') fail(w, '"kf" is "A" (the start), "B" (the end) or left out (both)');
      });
    }
    return e;
  }

  /* One resolved entry → one library move. `grp` carries the file-level defaults. */
  function buildEntry(e, i, grp, ctx) {
    const st = ctx.settings;
    const tracking = e.tracking || 'none';
    const type = e.type || 'reps';
    const dflt = st.targets[type];
    const targets = e.targets || dflt.choices, defaultTarget = e.defaultTarget || dflt.default;
    const guide = Object.assign({ cannotSee: st.cannotSee }, e.guide || {});
    const physio = {
      region: e.region || grp.region, equipment: e.equipment || grp.equipment || [], muscles: e.muscles, level: e.level || 'beginner',
      tempo: e.tempo, dosage: e.dosage, progression: e.progression, regression: e.regression, contraindications: e.contraindications,
      sources: [...(grp.sources || []), ...(e.sources || [])], camera: e.camera || grp.camera,
      clinicalName: e.clinicalName, calibrationPose: e.calibrationPose,
    };
    for (const k of Object.keys(physio)) if (physio[k] === undefined) delete physio[k];
    const order = e.order || (grp.order || 1000) + i;
    const live = (e.faults || []).filter((f) => f.rule || (f.metric && f.op && Number.isFinite(f.threshold)));
    const doc = (e.faults || []).filter((f) => !live.includes(f));
    const docFaults = (withStub) => doc.map((f) => ({ id: f.id, label: f.label, cue: f.cue, tip: f.tip, weight: f.severity || 2, tracked: false, ...(withStub ? { check: () => false } : {}) }));

    let ex;
    if (tracking === 'none') {
      ex = {
        id: e.id, order, name: e.name, group: e.group || grp.group, type, view: e.view || 'front', icon: e.icon || 'move',
        summary: e.summary, setup: e.setup, brief: e.brief, why: e.why, defaultTarget, targets, options: e.options || [],
        required: st.landmarks.always.slice(), faults: docFaults(false), guide,
      };
      if (e.sided) ex.sided = e.sided;
      if (e.upperBody) ex.upperBody = true;
    } else {
      /* A counted move needs at least one thing the counter can judge; "did you reach the
         target" and "too fast" hold for any rep-based move, so they are the floor. */
      const specFaults = live.slice();
      const SF = st.standardFaults;
      if (type === 'reps' && !specFaults.length) {
        specFaults.push({ id: 'shallow', rule: 'shallow', ...SF.shallow });
        specFaults.push({ id: 'fast', rule: 'fast', ...SF.fast, minMs: e.minMs || SF.fast.minMs });
      }
      /* For a timed hold the one thing any camera can watch is the held position itself: the
         first hold condition, turned around, fires the moment the person drifts out of it. */
      if (type === 'hold' && !specFaults.length) {
        const c = e.hold && e.hold.conditions && e.hold.conditions[0];
        if (!c) throw new Error('a tracked hold needs hold.conditions');
        const byMin = Number.isFinite(c.min);
        specFaults.push({ id: 'drift', ...SF.drift, metric: c.metric, rel: c.rel, op: byMin ? '<' : '>', threshold: byMin ? c.min : c.max, phase: 'hold' });
      }
      const spec = {
        id: e.id, order, name: e.name, group: e.group || grp.group, type, view: e.view || 'front', icon: e.icon || 'move',
        summary: e.summary, setup: e.setup, brief: e.brief, why: e.why, targets, defaultTarget, options: e.options || [],
        progress: e.progress, hold: e.hold, faults: specFaults, guide, show: e.show, sided: e.sided, upperBody: e.upperBody, band: e.band, focus: e.focus, figure: e.figure, enterCue: e.enterCue, display: e.display, vetted: !!e.vetted,
      };
      ex = SPEC.compile(spec, lib.kinematics);
      ex.faults = [...ex.faults, ...docFaults(true)];
      ex.spec = spec;
    }
    Object.assign(ex, physio, { tracking, vetted: !!e.vetted, catalog: true });
    return ex;
  }

  function fileGroup(file) { const g = {}; for (const k of Object.keys(file)) if (k !== 'moves' && !isNote(k)) g[k] = file[k]; return g; }
  const shortName = (name) => String(name).replace(/^.*\//, '');
  /* Build every move in one file. `register` = true adds them to the library; false only checks. */
  function buildFile(file, name, ctx, register) {
    const where = shortName(name);
    checkKeys(file, 'file', where);
    if (!Array.isArray(file.moves)) fail(where, '"moves" must be a list of moves');
    const grp = fileGroup(file);
    const out = [];
    file.moves.forEach((raw, i) => {
      const id = raw && raw.id;
      const w = `${where} › ${id || 'move #' + (i + 1)}`;
      try {
        const e = resolveEntry(raw, ctx.shared, w);
        const ex = register ? lib.define(() => buildEntry(e, i, grp, ctx)) : lib.prepare(buildEntry(e, i, grp, ctx));
        ex.file = where; ex.entry = raw;   /* `file` is the region file that lists it: knee.json, gym_lower.json */
        if (e.pose) {
          const fig = poseToFigure(ex.view, e.pose, { hold: ex.type === 'hold', posture: (ex.camera || {}).posture, side: e.pose.side || (e.sided && ex.view === 'front' ? 'R' : 'both') });
          if (register) registerFigure(e.id, fig); else ex.figure = fig;
        }
        out.push(ex);
      } catch (err) {
        if (err.where) throw err;
        const msg = String(err.message).replace(/^(exercise|spec) "[^"]*": /, '');
        fail(w, msg);
      }
    });
    return out;
  }
  function defineAll(data) {
    api.data = data;
    let n = 0;
    for (const f of data.files) n += buildFile(f.json, f.name, data, true).length;
    return n;
  }
  /* Every problem in one file, as messages a person can act on; [] means it would load cleanly.
     `otherIds` are the ids in the files not being checked, for the duplicate test. */
  function checkFile(file, name, ctx, otherIds = []) {
    const problems = []; const seen = new Set(otherIds);
    try {
      checkKeys(file, 'file', shortName(name));
      if (!Array.isArray(file.moves)) fail(shortName(name), '"moves" must be a list of moves');
    } catch (e) { return [e.message]; }
    const grp = fileGroup(file);
    file.moves.forEach((raw, i) => {
      const w = `${shortName(name)} › ${(raw && raw.id) || 'move #' + (i + 1)}`;
      try {
        const e = resolveEntry(raw, ctx.shared, w);
        const ex = lib.prepare(buildEntry(e, i, grp, ctx));
        const taken = lib.get(ex.id);
        if (seen.has(ex.id) || (taken && !taken.catalog)) fail(w, `id "${ex.id}" is used twice${taken && !taken.catalog ? ' — it belongs to a hand-written code move' : ''}`);
        seen.add(ex.id);
        if (e.pose) poseToFigure(ex.view, e.pose, { hold: ex.type === 'hold', posture: (ex.camera || {}).posture, side: 'both' });
      } catch (err) { problems.push(err.where ? err.message : `${w}: ${String(err.message).replace(/^(exercise|spec) "[^"]*": /, '')}`); }
    });
    return problems;
  }
  function checkShared(shared) { checkKeys(shared, 'shared', 'shared.json'); for (const k of KEYS.shared) if (!shared[k] || typeof shared[k] !== 'object') fail('shared.json', `needs a "${k}" section (an object, even if empty)`); }
  function checkSettings(s) { checkKeys(s, 'settings', 'settings.json'); for (const k of KEYS.settings) if (s[k] === undefined) fail('settings.json', `needs "${k}"`); }
  function checkManifest(m) { checkKeys(m, 'manifest', 'manifest.json'); for (const k of ['settings', 'shared', 'about']) if (typeof m[k] !== 'string') fail('manifest.json', `"${k}" must name a file`); for (const k of ['regions', 'code']) if (!Array.isArray(m[k])) fail('manifest.json', `"${k}" must be a list of files`); }

  /* ---- reading the files: from disk (server, tests, CLI) or over HTTP (the apps) ---- */
  function parse(text, name) { try { return JSON.parse(text); } catch (e) { fail(shortName(name), `not valid JSON — ${e.message}. A missing comma or a stray one at the end of a list are the usual causes.`); } }
  /* A region and the moves it lists, gathered back into the one-file-per-region shape the rest of
     this file works in: defaults at the top, `moves` a list of entries. `moveRel` remembers where
     each entry came from, because that is the file a change to it is written back to. */
  function gather(rel, region, load) {
    checkKeys(region, 'regionFile', shortName(rel));
    if (!Array.isArray(region.moves)) fail(shortName(rel), '"moves" must be the list of move ids this region holds');
    const { moves: ids, ...defaults } = region;
    const moves = ids.map((id) => {
      if (typeof id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(id)) fail(shortName(rel), `"${id}" is not a move id — lower-case letters, digits, underscores`);
      return load('moves/' + id + '.json', id);
    });
    return { name: rel, json: { ...defaults, moves }, ids };
  }
  const moveRel = (id) => 'moves/' + id + '.json';
  function readDataSync(dir) {
    const fs = require('node:fs'), path = require('node:path');
    const read = (rel) => parse(fs.readFileSync(path.join(dir, rel), 'utf8'), rel);
    const manifest = read('manifest.json'); checkManifest(manifest);
    const settings = read(manifest.settings); checkSettings(settings);
    const shared = read(manifest.shared); checkShared(shared);
    const about = read(manifest.about);
    const files = manifest.regions.map((rel) => gather(rel, read(rel), (mrel) => read(mrel)));
    return { dir, manifest, settings, shared, about, files };
  }
  async function fetchData(base) {
    const get = async (rel) => {
      const r = await fetch(`${base}/data/${rel}`, { cache: 'no-cache' });
      if (!r.ok) fail(shortName(rel), `could not be loaded (HTTP ${r.status})`);
      return parse(await r.text(), rel);
    };
    const manifest = await get('manifest.json'); checkManifest(manifest);
    const [settings, shared, about] = await Promise.all([get(manifest.settings), get(manifest.shared), get(manifest.about)]);
    checkSettings(settings); checkShared(shared);
    /* every move is its own file, so they are all asked for at once rather than region by region */
    const regions = await Promise.all(manifest.regions.map(async (rel) => [rel, await get(rel)]));
    const wanted = [...new Set(regions.flatMap(([, r]) => (Array.isArray(r.moves) ? r.moves : [])))];
    const loaded = {}; await Promise.all(wanted.map(async (id) => { loaded[id] = await get(moveRel(id)); }));
    const files = regions.map(([rel, r]) => gather(rel, r, (mrel, id) => loaded[id]));
    return { base, manifest, settings, shared, about, files };
  }
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(`${src} failed to load`)); document.head.appendChild(s); });
  /* The browser entry point: read the data, configure the engine, load the code moves the manifest
     lists, then build the catalogue. Resolves with the data; rejects with a message naming the file
     and move at fault. Called once by app.js, the Studio and the figure sheet. */
  async function load(base = '.') {
    if (api.loading) return api.loading;
    api.loading = (async () => {
      const data = await fetchData(base);
      root.FormEngine.configure(data.settings); lib.configure(data.settings);
      for (const src of data.manifest.code) await loadScript(`${base}/${src}`);
      defineAll(data);
      return data;
    })();
    return api.loading;
  }

  /* ---- writing: one JSON style for the CLI, the dev server and the Studio ----
     Short things stay on one line (a metric, the camera, a keyframe); anything longer opens out
     one field per line, so a diff shows the one number that changed. */
  function format(v, indent = '') {
    const inline = (x) => {
      if (x === null || typeof x !== 'object') return JSON.stringify(x);
      if (Array.isArray(x)) return '[' + x.map(inline).join(', ') + ']';
      return '{ ' + Object.keys(x).filter((k) => x[k] !== undefined).map((k) => JSON.stringify(k) + ': ' + inline(x[k])).join(', ') + ' }';
    };
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    const one = inline(v);
    if (one.length <= 100 && !(Array.isArray(v) && v.some((x) => x && typeof x === 'object' && !Array.isArray(x) && one.length > 60))) return one;
    const pad = indent + '  ';
    if (Array.isArray(v)) return v.length ? '[\n' + v.map((x) => pad + format(x, pad)).join(',\n') + '\n' + indent + ']' : '[]';
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);   // an absent field is left out, as JSON.stringify would
    return keys.length ? '{\n' + keys.map((k) => pad + JSON.stringify(k) + ': ' + format(v[k], pad)).join(',\n') + '\n' + indent + '}' : '{}';
  }

  const api = { KEYS, defineAll, buildFile, checkFile, checkShared, checkSettings, checkManifest, readDataSync, fetchData, load, format, resolveEntry, poseToFigure, sidePose, frontPose, data: null };
  if (isNode) module.exports = api; else root.OnTrackCatalog = api;
})(typeof window !== 'undefined' ? window : globalThis);
