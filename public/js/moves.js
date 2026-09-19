/* ---------------------------------------------------------------------------
   The exercises. Each one says what it measures, what counts as right, what it
   calls out when it is not, and in what order those corrections come.

   A move is data plus two functions. `read` turns landmarks into named angles;
   `judge` turns those angles into a verdict and a set of faults with how far out
   each one is. Everything after that — the clock, the countdown, the persistence
   and cooldown and the one-at-a-time rule — is in core.js and is the same for
   every move, so adding one means describing it, not rewriting the coaching.

   The `faults` list is in the order they are corrected, and that order is the
   chain of cause rather than a ranking by size: correcting something whose
   position is decided by a fault further down the chain asks for a change the
   body below it will not allow.
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(
    typeof module !== 'undefined' && module.exports ? require('./core.js') : root.Core);
  else root.Moves = factory(root.Core);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  const { angleAt, tiltFromVertical, fromFloor, lineBend, frame } = Core;

  /* =======================================================================
     Wall sit — side on, back against a wall.
     ======================================================================= */
  const wallsit = {
    id: 'wallsit',
    name: 'Wall sit',
    hint: 'Side on, back against a wall, whole body in frame.',
    start: 'Place the camera on the floor and step into the frame, side on, back against the wall.',

    defaults: {
      kneeMin: 85,          // below this the legs are too bent — too low
      kneeMax: 110,         // above this the legs are too straight — too high
      shinMin: 85,          // below this the heels are behind the knees — feet too far in
      shinMax: 95,          // above this the heels are ahead of the knees — feet too far out
      backTilt: 12,         // degrees the torso may lean off vertical
    },

    joints: ['shoulder', 'hip', 'knee', 'ankle', 'heel'],
    needed: ['shoulder', 'hip', 'knee', 'ankle'],
    bones: [['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle'], ['ankle', 'heel'], ['ankle', 'toe'], ['heel', 'toe']],
    dots: ['shoulder', 'hip', 'knee', 'ankle', 'heel'],
    /* which verdict colours which bone */
    limb: { 'shoulder|hip': 'back', 'knee|ankle': 'shin', 'ankle|heel': 'shin', 'ankle|toe': 'shin', 'heel|toe': 'shin' },

    bands: [
      { key: 'knee', of: 'knee', label: 'knee angle', hud: 'KNEE', note: 'target',
        lo: 'kneeMin', hi: 'kneeMax', scale: [50, 150],
        set: [{ key: 'kneeMin', label: 'Knee angle, lowest', min: 40, max: 150 },
              { key: 'kneeMax', label: 'Knee angle, highest', min: 40, max: 170 }] },
      { key: 'shin', of: 'shin', label: 'shin off floor', hud: 'SHIN', note: 'floor',
        lo: 'shinMin', hi: 'shinMax', scale: [50, 130],
        set: [{ key: 'shinMin', label: 'Shin off floor, lowest', min: 40, max: 90 },
              { key: 'shinMax', label: 'Shin off floor, highest', min: 90, max: 140 }] },
      { key: 'back', of: 'tilt', label: 'back off vertical', hud: 'BACK', note: 'vertical',
        sym: 'backTilt', scale: [-40, 40],
        set: [{ key: 'backTilt', label: 'Back allowed off vertical', min: 3, max: 40 }] },
    ],

    faults: ['lost', 'feetback', 'feetfwd', 'high', 'low', 'forward', 'back'],
    cues: {
      feetback: { text: 'Bring your feet back', deep: 'Bring your feet back — your heels are well ahead of your knees' },
      feetfwd: { text: 'Bring your feet forward', deep: 'Walk your feet further out — your heels are behind your knees' },
      high: { text: 'Lower down', deep: 'Slide further down the wall' },
      low: { text: 'Come up a little', deep: 'Come up — that is too deep' },
      forward: { text: 'Press your back flat to the wall', deep: 'Back flat — your shoulders are ahead of your hips' },
      back: { text: 'Bring your hips under your shoulders' },
      lost: { text: 'Step into the camera, side on' },
    },

    read(lm, aspect, cfg) {
      const f = frame(lm, aspect, cfg, wallsit.joints, wallsit.needed);
      if (!f || !f.ok) return f;
      const P = f.points;
      const facing = Math.sign(P.knee.x - P.hip.x) || 1;
      /* The heel is the foot's contact with the floor and the point the shin is
         measured to, but it is the landmark the model is least sure of — when it
         is not trusted the ankle stands in, a couple of centimetres up the same line. */
      const foot = P.heel.v >= cfg.vis ? 'heel' : 'ankle';
      return Object.assign(f, {
        facing, angles: ['knee', 'shin', 'tilt'], shinFoot: foot,
        knee: angleAt(P.hip, P.knee, P.ankle),           // the one that is judged
        shin: fromFloor(P.knee, P[foot], facing),        // the shin against the floor
        tilt: tiltFromVertical(P.hip, P.shoulder, facing),
      });
    },

    judge(r, cfg) {
      if (!r || !r.ok || r.knee == null || r.tilt == null) return { ok: false, inPosition: false, good: {}, faults: {} };
      const faults = {}, good = {};
      good.knee = r.knee <= cfg.kneeMax && r.knee >= cfg.kneeMin;
      if (r.knee > cfg.kneeMax) faults.high = r.knee - cfg.kneeMax;
      else if (r.knee < cfg.kneeMin) faults.low = cfg.kneeMin - r.knee;
      good.shin = r.shin == null || (r.shin <= cfg.shinMax && r.shin >= cfg.shinMin);
      if (r.shin != null && r.shin > cfg.shinMax) faults.feetback = r.shin - cfg.shinMax;
      else if (r.shin != null && r.shin < cfg.shinMin) faults.feetfwd = cfg.shinMin - r.shin;
      good.back = Math.abs(r.tilt) <= cfg.backTilt;
      if (r.tilt > cfg.backTilt) faults.forward = r.tilt - cfg.backTilt;
      else if (r.tilt < -cfg.backTilt) faults.back = -r.tilt - cfg.backTilt;
      return { ok: true, good, faults, inPosition: good.knee && good.shin && good.back };
    },

    /* The knee angle where it is measured, and the shin against a floor line
       drawn at the foot — where the floor actually is. */
    draw(d, r, v) {
      d.plumb(r.points.hip, 0.3);
      const foot = r.points[r.shinFoot || 'heel'];
      if (r.shin != null) { d.floor(foot); d.angleTo(foot, r.points.knee, r.facing, r.shin, v.good.shin, 0.8); }
      if (r.knee != null) d.angleAt(r.points.knee, r.points.hip, r.points.ankle, r.knee, v.good.knee, 1);
    },
  };

  /* =======================================================================
     Elbow plank — side on, forearms down.
     ======================================================================= */
  const plank = {
    id: 'plank',
    name: 'Elbow plank',
    hint: 'Side on, forearms on the floor, whole body in frame.',
    start: 'Place the camera on the floor and step into the frame, side on, down onto your forearms.',

    defaults: {
      /* The upper arm's lean off vertical, positive toward the head. The shoulder
         belongs over the elbow or a little in front of it; behind it is the joint
         taking the load at its weakest, so the band is not symmetric. */
      stackMin: -5,
      stackMax: 15,
      /* How far the hip may sit off the shoulder→ankle line, in degrees of bend. */
      hipLine: 5,
      /* The bands here are a third of the wall sit's, so the stronger wording has
         to come in a third as far out or it would never be reached. */
      deepAt: 8,
    },

    joints: ['shoulder', 'elbow', 'hip', 'knee', 'ankle'],
    needed: ['shoulder', 'elbow', 'hip', 'ankle'],
    bones: [['shoulder', 'elbow'], ['elbow', 'wrist'], ['shoulder', 'hip'], ['hip', 'knee'],
            ['knee', 'ankle'], ['ankle', 'heel'], ['ankle', 'toe'], ['heel', 'toe']],
    dots: ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'],
    limb: { 'shoulder|elbow': 'stack', 'elbow|wrist': 'stack', 'shoulder|hip': 'line', 'hip|knee': 'line', 'knee|ankle': 'line' },

    bands: [
      { key: 'stack', of: 'stack', label: 'arm off vertical', hud: 'ARM', note: 'forward',
        lo: 'stackMin', hi: 'stackMax', scale: [-35, 45],
        set: [{ key: 'stackMin', label: 'Shoulder behind elbow, most', min: -30, max: 0 },
              { key: 'stackMax', label: 'Shoulder in front of elbow, most', min: 0, max: 40 }] },
      { key: 'line', of: 'hipOff', label: 'hip off the line', hud: 'HIP', note: 'straight',
        sym: 'hipLine', scale: [-30, 30],
        set: [{ key: 'hipLine', label: 'Hip allowed off the line', min: 2, max: 25 }] },
    ],

    faults: ['lost', 'stackback', 'stackfwd', 'hipup', 'hipdown'],
    cues: {
      stackback: { text: 'Bring your shoulders over your elbows', deep: 'Shoulders forward — they are well behind your elbows' },
      stackfwd: { text: 'Bring your shoulders back over your elbows', deep: 'Shoulders back — they are well ahead of your elbows' },
      hipup: { text: 'Lower your hips', deep: 'Lower your hips — shoulders to heels in one line' },
      hipdown: { text: 'Lift your hips', deep: 'Lift your hips — shoulders to heels in one line' },
      lost: { text: 'Step into the camera, side on' },
    },

    read(lm, aspect, cfg) {
      const f = frame(lm, aspect, cfg, plank.joints, plank.needed);
      if (!f || !f.ok) return f;
      const P = f.points;
      /* forward is toward the head, which side-on is whichever way the shoulders
         lie from the hips — the same sense the arm's lean is signed in */
      const facing = Math.sign(P.shoulder.x - P.hip.x) || 1;
      return Object.assign(f, {
        facing, angles: ['stack', 'hipOff'],
        stack: tiltFromVertical(P.elbow, P.shoulder, facing),   // + = shoulder ahead of elbow
        hipOff: lineBend(P.shoulder, P.hip, P.ankle, facing),   // + = hips piked up
      });
    },

    judge(r, cfg) {
      if (!r || !r.ok || r.stack == null || r.hipOff == null) return { ok: false, inPosition: false, good: {}, faults: {} };
      const faults = {}, good = {};
      good.stack = r.stack >= cfg.stackMin && r.stack <= cfg.stackMax;
      if (r.stack < cfg.stackMin) faults.stackback = cfg.stackMin - r.stack;
      else if (r.stack > cfg.stackMax) faults.stackfwd = r.stack - cfg.stackMax;
      good.line = Math.abs(r.hipOff) <= cfg.hipLine;
      if (r.hipOff > cfg.hipLine) faults.hipup = r.hipOff - cfg.hipLine;
      else if (r.hipOff < -cfg.hipLine) faults.hipdown = -r.hipOff - cfg.hipLine;
      return { ok: true, good, faults, inPosition: good.stack && good.line };
    },

    /* The straight line the hips are judged against, drawn from shoulder to ankle
       so the gap between it and the actual hip is the fault, visible as itself. */
    draw(d, r, v) {
      d.guide(r.points.shoulder, r.points.ankle, v.good.line);
      if (r.hipOff != null) d.readout(r.points.hip, r.hipOff, v.good.line, r.hipOff >= 0 ? 1 : -1);
      d.plumb(r.points.elbow, 0.22);   // straight up from the elbow: what the arm is measured against
      if (r.stack != null) d.angleTo(r.points.elbow, r.points.shoulder, 0, r.stack, v.good.stack, 0.9);
    },
  };

  return { wallsit, plank, list: [wallsit, plank] };
});
