/* ============================================================
   Catalogue builder — many moves from compact data.

   The ten hand-written moves are code. Everything else in the library
   is a catalogue entry: the fields a physio fills in (what, where the
   camera goes, how many, what goes wrong and the cue for it, the guide,
   equipment, muscles, level, sources) plus, where one camera can
   actually measure it, a declarative spec that coach/spec.js compiles
   into a real rep counter and fault checks.

   Three tracking tiers, decided per entry:
     form — spec with live fault checks: the camera counts AND judges
     reps — spec that counts reps / times the hold; faults are listed, not watched
     none — nothing a single camera can measure; the guide is shown and
            the set is logged by hand

   Figures: an entry gives its two keyframes as joint ANGLES, and
   poseToFigure turns them into the point keyframes the anatomy figure
   draws. Angles are far easier to write by hand for a hundred moves than
   pixel coordinates, and they cannot produce a limb of the wrong length.
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
    return { view, A, B, hold: !!opts.hold, side: opts.side || 'both', flip, w: pose.work || {}, wall, props, anchors };
  }

  function registerFigure(id, fig) {
    if (root.FyzioAnatomy && root.FyzioAnatomy.register) root.FyzioAnatomy.register(id, fig);
    else (root.__pendingFigures = root.__pendingFigures || []).push([id, fig]);
  }

  const DEFAULTS = {
    reps: { targets: [6, 8, 10, 12, 15], defaultTarget: 10 },
    hold: { targets: [10, 15, 20, 30, 45, 60], defaultTarget: 20 },
  };
  const CANNOT_SEE_DEFAULT = 'Anything that only moves toward or away from the phone.';

  /* One catalogue entry → one library move. `grp` carries the group-level defaults. */
  function build(e, i, grp) {
    const tracking = e.tracking || 'none';
    const type = e.type || 'reps';
    const dflt = DEFAULTS[type];
    const targets = e.targets || dflt.targets, defaultTarget = e.defaultTarget || dflt.defaultTarget;
    const guide = Object.assign({ cannotSee: CANNOT_SEE_DEFAULT }, e.guide || {});
    const physio = {
      region: e.region || grp.region, equipment: e.equipment || grp.equipment || [], muscles: e.muscles, level: e.level || 'beginner',
      tempo: e.tempo, dosage: e.dosage, progression: e.progression, regression: e.regression, contraindications: e.contraindications,
      sources: [...(grp.sources || []), ...(e.sources || [])], camera: e.camera || grp.camera,
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
        summary: e.summary, setup: e.setup, why: e.why, defaultTarget, targets, options: e.options || [],
        required: e.required || [11, 12, 23, 24], faults: docFaults(false), guide,
      };
      if (e.sided) ex.sided = e.sided;
      if (e.upperBody) ex.upperBody = true;
    } else {
      /* A counted move needs at least one thing the counter can judge; "did you reach the
         target" and "too fast" hold for any rep-based move, so they are the floor. */
      const specFaults = live.slice();
      if (type === 'reps' && !specFaults.length) {
        specFaults.push({ id: 'shallow', rule: 'shallow', label: 'Not reaching the target', cue: 'All the way', tip: 'Take each rep through the full range you set — half reps count as partials.', severity: 1 });
        specFaults.push({ id: 'fast', rule: 'fast', label: 'Too fast', cue: 'Slow it down', tip: 'Control both directions; momentum takes the work away from the muscle.', severity: 1, minMs: e.minMs || 1500 });
      }
      /* For a timed hold the one thing any camera can watch is the held position itself: the
         first hold condition, turned around, fires the moment the person drifts out of it. */
      if (type === 'hold' && !specFaults.length) {
        const c = e.hold && e.hold.conditions && e.hold.conditions[0];
        if (!c) throw new Error('catalogue "' + e.id + '": a tracked hold needs hold.conditions');
        const byMin = Number.isFinite(c.min);
        specFaults.push({ id: 'drift', label: 'Drifting out of position', cue: 'Back into position', tip: 'The hold only counts while you are in the position — ease back in and keep breathing.', severity: 1,
          metric: c.metric, rel: c.rel, op: byMin ? '<' : '>', threshold: byMin ? c.min : c.max, phase: 'hold', persist: 600, cooldown: 6000 });
      }
      const spec = {
        id: e.id, order, name: e.name, group: e.group || grp.group, type, view: e.view || 'front', icon: e.icon || 'move',
        summary: e.summary, setup: e.setup, why: e.why, targets, defaultTarget, options: e.options || [],
        progress: e.progress, hold: e.hold, faults: specFaults, guide, sided: e.sided, upperBody: e.upperBody, band: e.band, focus: e.focus,
      };
      ex = SPEC.compile(spec, lib.kinematics);
      ex.faults = [...ex.faults, ...docFaults(true)];
      ex.spec = spec;
    }
    Object.assign(ex, physio, { tracking, vetted: !!e.vetted, catalog: true });
    if (e.pose) registerFigure(e.id, poseToFigure(ex.view, e.pose, { hold: type === 'hold', posture: (physio.camera || {}).posture, side: e.pose.side || (e.sided && ex.view === 'front' ? 'R' : 'both') }));
    return ex;
  }

  /* defineCatalog(group, entries): group = { region, group, order, equipment, camera, sources } */
  function defineCatalog(grp, entries) {
    return entries.map((e, i) => lib.define(() => build(e, i, grp)));
  }

  const api = { defineCatalog, poseToFigure, sidePose, frontPose, build };
  if (isNode) module.exports = api; else root.FyzioCatalog = api;
})(typeof window !== 'undefined' ? window : globalThis);
