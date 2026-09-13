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
    return { h: head, sh: shoulder, hip, kn, an, ft: foot, el, wr, knF: off(knF), anF: off(anF), ftF: off(footF), elF: off(elF), wrF: off(wrF), dir };
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

  /* Place a pose in the 400x175 diagram space: lowest point on the floor (y 161), centred at x 306. */
  function place(pose, view) {
    const keys = Object.keys(pose).filter((k) => k !== 'dir' && pose[k] && typeof pose[k].x === 'number');
    const xs = keys.map((k) => pose[k].x), ys = keys.map((k) => pose[k].y);
    const maxY = Math.max(...ys), cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const out = {};
    keys.forEach((k) => { out[k] = [Math.round(306 + pose[k].x - cx), Math.round(161 - (maxY - pose[k].y))]; });
    return out;
  }

  /* pose: { A: angles, B: angles, work: {region: 0..1}, wall: 'behind'|'ahead'|null, side } */
  function poseToFigure(view, pose, opts) {
    const build = view === 'front' ? frontPose : sidePose;
    const rawA = build(pose.A || {}), rawB = build(pose.B || pose.A || {});
    const A = place(rawA, view), B = place(rawB, view);
    let wall = null;
    if (pose.wall && view === 'side') {
      const xs = Object.values(A).map((p) => p[0]);
      const behindIsLeft = (rawA.dir || 1) > 0;
      wall = (pose.wall === 'behind') === behindIsLeft ? Math.min(...xs) - 6 : Math.max(...xs) + 6;
    }
    const flip = view === 'side' ? A.ft[0] < A.an[0] : false;
    return { view, A, B, hold: !!opts.hold, side: opts.side || 'both', flip, w: pose.work || {}, wall };
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
    if (e.pose) registerFigure(e.id, poseToFigure(ex.view, e.pose, { hold: type === 'hold', side: e.pose.side || (e.sided && ex.view === 'front' ? 'R' : 'both') }));
    return ex;
  }

  /* defineCatalog(group, entries): group = { region, group, order, equipment, camera, sources } */
  function defineCatalog(grp, entries) {
    return entries.map((e, i) => lib.define(() => build(e, i, grp)));
  }

  const api = { defineCatalog, poseToFigure, sidePose, frontPose, build };
  if (isNode) module.exports = api; else root.FyzioCatalog = api;
})(typeof window !== 'undefined' ? window : globalThis);
