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
  const { angleAt, tiltFromVertical, fromFloor, fromDown, lineBend, rise, inBand, within, frame, sidePoints } = Core;

  /* =======================================================================
     Wall sit — side on, back against a wall.
     ======================================================================= */
  const wallsit = {
    id: 'wallsit',
    name: 'Wall sit',
    hint: 'Phone standing up on the floor, side on to you, whole body in frame.',
    start: 'Stand the phone up on the floor, then step into the frame, side on, back against the wall.',
    position: 'Stand side on to the phone with your back against the wall and your feet a step out from it.',
    camera: 'tall',                 // a standing body needs the height, not the width
    /* the move, drawn: seated in the air against a wall, held */
    pose: { A: { torso: 0, thigh: 90, shin: 0, uarm: 8, farm: 8 }, wall: 'behind', hold: true },
    muscles: { thigh: 1, calf: .45, glute: .55, abs: .3 },     // what works, for the muscle figure
    extra: [{ key: 'setCount', label: 'Sets', min: 1, max: 10 }],

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
      feetback: { label: 'Feet ahead of knees', text: 'Bring your feet back', deep: 'Bring your feet back — your heels are well ahead of your knees' },
      feetfwd: { label: 'Feet behind knees', text: 'Bring your feet forward', deep: 'Walk your feet further out — your heels are behind your knees' },
      high: { label: 'Too high', text: 'Lower down', deep: 'Slide further down the wall' },
      low: { label: 'Too deep', text: 'Come up a little', deep: 'Come up — that is too deep' },
      forward: { label: 'Leaning forward', text: 'Press your back flat to the wall', deep: 'Back flat — your shoulders are ahead of your hips' },
      back: { label: 'Hips ahead of shoulders', text: 'Bring your hips under your shoulders' },
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
      good.knee = inBand(r.knee, cfg.kneeMin, cfg.kneeMax);
      if (r.knee > cfg.kneeMax) faults.high = r.knee - cfg.kneeMax;
      else if (r.knee < cfg.kneeMin) faults.low = cfg.kneeMin - r.knee;
      good.shin = r.shin == null || inBand(r.shin, cfg.shinMin, cfg.shinMax);
      if (r.shin != null && r.shin > cfg.shinMax) faults.feetback = r.shin - cfg.shinMax;
      else if (r.shin != null && r.shin < cfg.shinMin) faults.feetfwd = cfg.shinMin - r.shin;
      good.back = within(r.tilt, cfg.backTilt);
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
    hint: 'Phone on its side on the floor, side on to you, forearms down, whole body in frame.',
    start: 'Lay the phone on its side on the floor, then get into your plank, side on, down onto your forearms.',
    position: 'Side on to the phone, down on your forearms and toes, elbows under your shoulders, body in one line.',
    /* a plank is long and low, so the frame has to be too */
    camera: 'wide',
    pose: { A: { face: 'left', torso: 72, neck: -15, thigh: -80, shin: -80, foot: -60, uarm: -20, farm: 70 }, hold: true },
    muscles: { abs: 1, oblique: .8, shoulder: .55, thigh: .45, back: .3 },
    extra: [{ key: 'setCount', label: 'Sets', min: 1, max: 10 }],

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
      stackback: { label: 'Shoulders behind elbows', text: 'Bring your shoulders over your elbows', deep: 'Shoulders forward — they are well behind your elbows' },
      stackfwd: { label: 'Shoulders ahead of elbows', text: 'Bring your shoulders back over your elbows', deep: 'Shoulders back — they are well ahead of your elbows' },
      hipup: { label: 'Hips piked', text: 'Lower your hips', deep: 'Lower your hips — shoulders to heels in one line' },
      hipdown: { label: 'Hips sagging', text: 'Lift your hips', deep: 'Lift your hips — shoulders to heels in one line' },
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
      good.stack = inBand(r.stack, cfg.stackMin, cfg.stackMax);
      if (r.stack < cfg.stackMin) faults.stackback = cfg.stackMin - r.stack;
      else if (r.stack > cfg.stackMax) faults.stackfwd = r.stack - cfg.stackMax;
      good.line = within(r.hipOff, cfg.hipLine);
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

  /* =======================================================================
     Standing knee raise — side on, standing tall, one knee up and held.
     The first move here that is a set of reps rather than one long hold.
     ======================================================================= */
  const kneeraise = {
    id: 'kneeraise',
    name: 'Knee raise',
    hint: 'Phone standing up, side on to you, whole body in frame.',
    start: 'Stand the phone up on the floor, then stand side on, tall, and raise one knee.',
    position: 'Stand side on to the phone, tall, feet together, arms relaxed at your sides.',
    camera: 'tall',                 // a standing body needs the height, not the width
    reps: true,
    holdLabel: 'Hold each rep for',
    /* standing, then one knee up to a right angle, the other leg holding */
    pose: { A: { torso: 0, thigh: 0, shin: 0, uarm: 8, farm: 8 },
            B: { torso: 0, thigh: 90, shin: 0, foot: 0, uarm: 8, farm: 8, thighF: 0, shinF: 0, footF: 0 } },
    muscles: { thigh: .8, abs: .5, calf: .3 },

    defaults: {
      kneeMin: 80, kneeMax: 100,    // the angle at the knee, hip to ankle: a right angle, 10° either way
      /* The foot, taken at the heel between the toe and the knee — the foot's own
         line against the shin's. The heel rather than the ankle because the heel is
         where the foot meets the floor and is the end of the segment being measured.
         The band is not centred on a right angle and is not meant to be. */
      footMin: 60, footMax: 100,
      /* Where the thigh has to get to before this counts as a raise, and where it
         has to come back to before the rep is finished. These are not coached and
         are not judged — they are how the phases are told apart, and they are wide
         on purpose so that the two angles above are the only things being marked. */
      raiseAt: 45,
      downAt: 20,
      holdTargetSec: 10,
      callAtSec: [5],
      repCount: 10,
      lowerSec: 1,                  // "lower slowly": the way down should take at least this long
      restSec: 2,                   // the quiet after a rep is counted, before the next is asked for
      deepAt: 8,                    // tight bands, so "a long way out" has to be tighter too
    },
    extra: [{ key: 'repCount', label: 'Reps in a set', min: 1, max: 50 },
            { key: 'raiseAt', label: 'Thigh angle that counts as raised', min: 20, max: 89 },
            { key: 'lowerSec', label: 'Lowering takes at least, seconds', min: 0, max: 10 },
            { key: 'restSec', label: 'Quiet after a rep, seconds', min: 0, max: 10 },
            { key: 'setCount', label: 'Sets', min: 1, max: 10 }],

    joints: ['shoulder', 'hip', 'knee', 'ankle', 'heel', 'toe'],
    needed: ['hip', 'knee', 'ankle', 'heel', 'toe'],
    bones: [['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle'], ['ankle', 'heel'], ['ankle', 'toe'], ['heel', 'toe']],
    dots: ['shoulder', 'hip', 'knee', 'ankle', 'heel', 'toe'],
    limb: { 'hip|knee': 'knee', 'knee|ankle': 'knee', 'ankle|toe': 'foot', 'ankle|heel': 'foot', 'heel|toe': 'foot' },

    bands: [
      { key: 'knee', of: 'knee', label: 'knee angle', hud: 'KNEE', note: 'target',
        lo: 'kneeMin', hi: 'kneeMax', scale: [40, 180],
        set: [{ key: 'kneeMin', label: 'Knee angle, lowest', min: 40, max: 175 },
              { key: 'kneeMax', label: 'Knee angle, highest', min: 45, max: 180 }] },
      { key: 'foot', of: 'foot', label: 'toe, heel, knee', hud: 'FOOT', note: 'target',
        lo: 'footMin', hi: 'footMax', scale: [40, 170],
        set: [{ key: 'footMin', label: 'Foot angle, lowest', min: 30, max: 165 },
              { key: 'footMax', label: 'Foot angle, highest', min: 35, max: 170 }] },
    ],

    faults: ['lost', 'raise', 'kneeOpen', 'kneeShut', 'toesDown', 'toesUp'],
    prompts: ['raise'],
    cues: {
      raise: { text: 'Raise one knee' },
      kneeOpen: { label: 'Knee too open', text: 'Bend your knee more', deep: 'Bend your knee to a right angle' },
      kneeShut: { label: 'Knee too closed', text: 'Open your knee a little', deep: 'Open your knee out to a right angle' },
      /* the ankle angle grows as the toes point away and shrinks as they come up */
      toesDown: { label: 'Foot pointing away', text: 'Pull your toes up', deep: 'Pull your toes up — your foot is pointing away' },
      toesUp: { label: 'Toes pulled up', text: 'Ease your toes down', deep: 'Ease your toes down — your toes are pulled too far up' },
      lower: { text: 'Lower slowly' },
      early: { text: 'Hold it to the end of the count next time' },
      lost: { text: 'Step into the camera, side on' },
    },

    /* Side-on the two legs sit on top of each other, so the usual "whichever is
       clearer" is no help: both are. The leg being raised is the one to measure, so
       the thigh that is higher wins, and visibility only decides when neither is up. */
    read(lm, aspect, cfg) {
      if (!lm || lm.length < 33) return null;
      const opts = [];
      for (const side of ['L', 'R']) {
        const P = sidePoints(lm, aspect, side);
        if (!P) return null;
        const ok = kneeraise.needed.every((k) => P[k].v >= cfg.vis);
        opts.push({ side, P, ok, thigh: fromDown(P.hip, P.knee) || 0,
          vis: kneeraise.joints.reduce((a, k) => a + P[k].v, 0) / kneeraise.joints.length });
      }
      const usable = opts.filter((o) => o.ok);
      if (!usable.length) {
        return { ok: false, side: opts[0].side, vis: Math.max(...opts.map((o) => o.vis)),
          why: 'Some of you is out of shot or hidden' };
      }
      const pick = usable.slice().sort((a, b) => (b.thigh - a.thigh) || (b.vis - a.vis))[0];
      const P = pick.P;
      /* which way the body faces, taken from the foot rather than the legs, because
         the legs are the thing that moves */
      const facing = Math.sign(P.toe.x - P.heel.x) || 1;
      return {
        ok: true, side: pick.side, vis: pick.vis, facing, points: P,
        angles: ['knee', 'foot', 'thigh'],
        knee: angleAt(P.hip, P.knee, P.ankle),     // hip → knee → ankle
        foot: angleAt(P.toe, P.heel, P.knee),      // toe → heel → knee
        thigh: pick.thigh,                          // 0 standing, 90 thigh level
      };
    },

    judge(r, cfg) {
      if (!r || !r.ok || r.knee == null || r.foot == null) {
        return { ok: false, inPosition: false, raised: false, atStart: false, good: {}, faults: {} };
      }
      const faults = {}, good = {};
      good.knee = inBand(r.knee, cfg.kneeMin, cfg.kneeMax);
      if (r.knee > cfg.kneeMax) faults.kneeOpen = r.knee - cfg.kneeMax;
      else if (r.knee < cfg.kneeMin) faults.kneeShut = cfg.kneeMin - r.knee;
      good.foot = inBand(r.foot, cfg.footMin, cfg.footMax);
      if (r.foot > cfg.footMax) faults.toesDown = r.foot - cfg.footMax;
      else if (r.foot < cfg.footMin) faults.toesUp = cfg.footMin - r.foot;
      const raised = r.thigh >= cfg.raiseAt, atStart = r.thigh <= cfg.downAt;
      return { ok: true, good, faults, raised, atStart,
        inPosition: raised && good.knee && good.foot };
    },

    /* The two angles where they are measured, and the thigh against straight down —
       dim, because it is what tells a raise from standing rather than something
       being marked. */
    draw(d, r, v) {
      d.plumb(r.points.hip, -0.16);
      if (r.thigh != null) d.angleTo(r.points.hip, r.points.knee, 'down', r.thigh, null, 0.55);
      if (r.knee != null) d.angleAt(r.points.knee, r.points.hip, r.points.ankle, r.knee, v.good.knee, 1);
      if (r.foot != null) d.angleAt(r.points.heel, r.points.toe, r.points.knee, r.foot, v.good.foot, 0.7);
    },
  };

  /* =======================================================================
     Glute bridge — lying on the back, side on, knees bent, feet flat, hips
     lifted until knee, hip and shoulder are in a line, and lowered slowly.
     ======================================================================= */
  const bridge = {
    id: 'bridge',
    name: 'Glute bridge',
    hint: 'Phone on its side on the floor, side on to you, lying down with your knees bent and feet flat.',
    start: 'Lay the phone on its side on the floor. I will wait while you get set up: lie down side on to it, knees bent.',
    position: 'Lie on your back, side on to the phone, knees bent, feet flat on the floor, arms by your sides.',
    /* the start position is lying down with the knees bent: hips on the floor and
       the shin standing up off the heel, whatever the feet are doing yet */
    ready: (r, v) => !!(v.atStart && r.shin != null && r.shin >= 45 && r.shin <= 150),
    camera: 'wide',                 // a body lying down is long and low, like the plank
    reps: true,
    holdLabel: 'Hold at the top for',
    /* the move, drawn: the keyframes from a recorded bridge in the OnTrack build,
       lying with the feet to the left, hips up and down */
    figure: { A: { h: [380, 144], sh: [362, 150], hip: [289, 145], kn: [255, 98], an: [254, 150], ft: [230, 157], el: [325, 155], wr: [288, 158],
                   knF: [254, 101], anF: [252, 149], ftF: [230, 158], elF: [323, 144], wrF: [295, 149] },
              B: { h: [386, 144], sh: [368, 150], hip: [304, 122], kn: [254, 95], an: [251, 152], ft: [226, 161], el: [329, 153], wr: [294, 156],
                   knF: [262, 102], anF: [252, 145], ftF: [232, 150], elF: [375, 123], wrF: [380, 136] },
              flip: true },
    muscles: { glute: 1, ham: .5, abs: .3 },

    defaults: {
      /* The shin, taken at the heel between the toe and the knee — the foot's own
         line against the shin's, as in the knee raise. The toes point away from the
         head, so over the band the knee leans toward the head, which is the feet
         out too far from the hips; under it the knee is out over the toes, which is
         the feet in too close. */
      shinMin: 85, shinMax: 110,
      /* The top of the rep: the angle at the hip between knee and shoulder. Straight
         is 180 and the line is asked for to within twenty degrees. */
      hipMin: 160, hipMax: 180,
      /* How far the hip may sit above the knee, as the rise of the knee→hip line.
         Level is 0; the hips are not to go higher than the knees, and the three
         degrees are for the pose model's wobble, not for the person. */
      overMax: 3, overMin: -90,
      /* The foot line, heel against toe, off the floor either way: heels lifting
         tilt it one way, toes lifting the other. */
      footFlat: 10,
      /* Where the hip angle has to get to before this counts as a lift, and where
         it has to come back to before the rep is finished. Not coached, not marked:
         they tell the phases apart. Lying with the knees up the hip reads around
         125–140, so the lift is called at 150 and the return at 140. */
      raiseAt: 150,
      downAt: 140,
      holdTargetSec: 2,             // a squeeze at the top, then down
      callAtSec: [],
      repCount: 10,
      lowerSec: 1,                  // the way down should take at least this long
      restSec: 2,                   // the quiet after a rep is counted, before the next is asked for
      deepAt: 10,
    },
    extra: [{ key: 'repCount', label: 'Reps in a set', min: 1, max: 50 },
            { key: 'raiseAt', label: 'Hip angle that counts as lifted', min: 120, max: 175 },
            { key: 'lowerSec', label: 'Lowering takes at least, seconds', min: 0, max: 10 },
            { key: 'restSec', label: 'Quiet after a rep, seconds', min: 0, max: 10 },
            { key: 'setCount', label: 'Sets', min: 1, max: 10 }],

    joints: ['shoulder', 'hip', 'knee', 'ankle', 'heel', 'toe'],
    needed: ['shoulder', 'hip', 'knee', 'heel', 'toe'],
    bones: [['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle'], ['ankle', 'heel'], ['ankle', 'toe'], ['heel', 'toe']],
    dots: ['shoulder', 'hip', 'knee', 'ankle', 'heel', 'toe'],
    limb: { 'shoulder|hip': 'hip', 'hip|knee': 'hip', 'knee|ankle': 'shin', 'ankle|heel': 'foot', 'ankle|toe': 'foot', 'heel|toe': 'foot' },

    bands: [
      { key: 'shin', of: 'shin', label: 'toe, heel, knee', hud: 'SHIN', note: 'target',
        lo: 'shinMin', hi: 'shinMax', scale: [40, 170],
        set: [{ key: 'shinMin', label: 'Shin angle, lowest', min: 30, max: 165 },
              { key: 'shinMax', label: 'Shin angle, highest', min: 35, max: 170 }] },
      { key: 'hip', of: 'hip', label: 'knee, hip, shoulder', hud: 'HIP', note: 'at the top',
        min: 'hipMin', scale: [90, 180],
        set: [{ key: 'hipMin', label: 'Hip angle at the top, at least', min: 120, max: 179 }] },
      { key: 'over', of: 'over', label: 'hip above knee', hud: 'RISE', note: 'at most',
        max: 'overMax', scale: [-40, 40],
        set: [{ key: 'overMax', label: 'Hip above the knee, at most', min: 0, max: 20 }] },
      { key: 'foot', of: 'foot', label: 'foot off the floor', hud: 'FEET', note: 'flat',
        sym: 'footFlat', scale: [-40, 40],
        set: [{ key: 'footFlat', label: 'Foot off the floor, at most', min: 2, max: 30 }] },
    ],

    /* The chain: the feet flat on the floor, then where they are, then the hips.
       The feet decide what the hips can do, so both foot checks come first and are
       made at the start, before the lift is asked for. At the hip, too high before
       not high enough, because a hip driven past the knees is the one that hurts. */
    faults: ['lost', 'heelsUp', 'toesUp', 'feetFar', 'feetClose', 'raise', 'hipHigh', 'hipLow'],
    setup: ['heelsUp', 'toesUp', 'feetFar', 'feetClose'],
    prompts: ['raise'],
    cues: {
      raise: { text: 'Lift your hips' },
      feetFar: { label: 'Feet too far out', text: 'Walk your feet in', deep: 'Walk your feet in toward you — they are well out' },
      feetClose: { label: 'Feet too close', text: 'Walk your feet out a little', deep: 'Walk your feet out — your knees are out over your toes' },
      heelsUp: { label: 'Heels lifting', text: 'Keep your heels down', deep: 'Heels down — they are coming off the floor' },
      toesUp: { label: 'Toes lifting', text: 'Keep your toes down', deep: 'Toes down — they are coming off the floor' },
      hipHigh: { label: 'Hips above knees', text: 'Not so high — hips no higher than your knees', deep: 'Lower your hips — they are well above your knees' },
      hipLow: { label: 'Hips short of the line', text: 'Lift your hips higher', deep: 'Higher — knees, hips and shoulders in one line' },
      lower: { text: 'Lower slowly' },
      early: { text: 'Hold it at the top next time' },
      lost: { text: 'Lie down side on to the camera, whole body in' },
    },

    read(lm, aspect, cfg) {
      const f = frame(lm, aspect, cfg, bridge.joints, bridge.needed);
      if (!f || !f.ok) return f;
      const P = f.points;
      /* which way the feet are: the knees lie that way from the hips whatever the
         hips are doing */
      const facing = Math.sign(P.knee.x - P.hip.x) || 1;
      return Object.assign(f, {
        facing, angles: ['shin', 'hip', 'over', 'foot'],
        shin: angleAt(P.toe, P.heel, P.knee),        // toe → heel → knee
        hip: angleAt(P.knee, P.hip, P.shoulder),     // knee → hip → shoulder
        over: rise(P.knee, P.hip),                    // + = hip above the knee
        foot: rise(P.toe, P.heel),                    // + = heel above the toe
      });
    },

    judge(r, cfg) {
      if (!r || !r.ok || r.shin == null || r.hip == null || r.over == null || r.foot == null) {
        return { ok: false, inPosition: false, raised: false, atStart: false, good: {}, faults: {} };
      }
      const faults = {}, good = {};
      /* the feet first: the shin's angle is taken at the heel, from the toe, so a
         heel or a toe off the floor moves it — and until the foot is flat again
         the shin is not judged at all, only the foot */
      good.foot = within(r.foot, cfg.footFlat);
      if (r.foot > cfg.footFlat) faults.heelsUp = r.foot - cfg.footFlat;
      else if (r.foot < -cfg.footFlat) faults.toesUp = -r.foot - cfg.footFlat;
      good.shin = inBand(r.shin, cfg.shinMin, cfg.shinMax);
      if (good.foot) {
        if (r.shin > cfg.shinMax) faults.feetFar = r.shin - cfg.shinMax;
        else if (r.shin < cfg.shinMin) faults.feetClose = cfg.shinMin - r.shin;
      }
      good.hip = inBand(r.hip, cfg.hipMin, cfg.hipMax);
      if (r.hip < cfg.hipMin) faults.hipLow = cfg.hipMin - r.hip;
      good.over = inBand(r.over, cfg.overMin, cfg.overMax);
      if (r.over > cfg.overMax) faults.hipHigh = r.over - cfg.overMax;
      const raised = r.hip >= cfg.raiseAt, atStart = r.hip <= cfg.downAt;
      return { ok: true, good, faults, raised, atStart,
        inPosition: raised && good.shin && good.hip && good.over && good.foot };
    },

    /* The line the hips are lifted to, knee to shoulder; the angle at the hip
       against it; the shin's angle at the heel; and a floor line through the knee,
       which is the height the hips are not to pass. */
    draw(d, r, v) {
      d.guide(r.points.knee, r.points.shoulder, v.good.hip);
      if (r.hip != null) d.angleAt(r.points.hip, r.points.knee, r.points.shoulder, r.hip, v.good.hip, 0.8);
      if (r.shin != null) d.angleAt(r.points.heel, r.points.toe, r.points.knee, r.shin, v.good.shin, 0.7);
      d.floor(r.points.knee, -1);                 // run back toward the hips, which is where it matters
      if (r.over != null) d.readout(r.points.hip, r.over, v.good.over, 1);   // under the hip, clear of the arc's number
    },
  };

  /* =======================================================================
     Donkey kick — on hands and knees, side on, one knee kept bent at a right
     angle and the thigh lifted until it is in line with the back, held, and
     lowered. One leg per set; the sets alternate.
     ======================================================================= */
  const donkeykick = {
    id: 'donkeykick',
    name: 'Donkey kick',
    hint: 'Phone on its side on the floor, side on to you, on your hands and knees, whole body in frame.',
    start: 'Lay the phone on its side on the floor, then get on your hands and knees side on to it, and kick one leg up.',
    position: 'On your hands and knees, side on to the phone, hands under your shoulders, knees under your hips, back level.',
    camera: 'wide',
    reps: true,
    holdLabel: 'Hold at the top for',
    alternate: true,                // the sets alternate legs
    /* the move, drawn: on all fours facing left, one leg kicked up level with the back */
    pose: { A: { face: 'left', torso: -88, neck: -25, thigh: 0, shin: -90, foot: 180, uarm: 0, farm: 0 },
            B: { face: 'left', torso: -88, neck: -25, thigh: -90, shin: 180, foot: 60, uarm: 0, farm: 0, thighF: 0, shinF: -90, footF: 180 } },
    muscles: { glute: 1, ham: .5, back: .3, abs: .3 },

    defaults: {
      kneeMin: 80, kneeMax: 100,    // the working knee stays at a right angle
      /* the lift: the angle at the hip between knee and shoulder. Kneeling it is
         about 90; the thigh in line with the back is 180. The top is asked for to
         within fifteen degrees, and not past the line. */
      liftMin: 165, liftMax: 180,
      /* how far the thigh may rise above the back's line, in degrees. Past it the
         lower back is arching to make height, which is the fault every guide names. */
      overMax: 5, overMin: -90,
      /* the arms: the wrist→shoulder line from the floor, 90 plumb; over 90 the
         shoulders are ahead of the wrists (toward the head), under it behind them */
      armMin: 85, armMax: 105,
      elbowMin: 165, elbowMax: 180, // straight arms
      backLevel: 10,                // the hip→shoulder line off level, either way
      raiseAt: 120, downAt: 105,    // the lift that counts as a kick, and the return
      holdTargetSec: 2,
      callAtSec: [],
      repCount: 10,
      lowerSec: 1,
      restSec: 2,
      deepAt: 10,
    },
    extra: [{ key: 'repCount', label: 'Reps in a set', min: 1, max: 50 },
            { key: 'raiseAt', label: 'Hip angle that counts as a kick', min: 100, max: 160 },
            { key: 'lowerSec', label: 'Lowering takes at least, seconds', min: 0, max: 10 },
            { key: 'restSec', label: 'Quiet after a rep, seconds', min: 0, max: 10 },
            { key: 'setCount', label: 'Sets', min: 1, max: 10 }],

    joints: ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'],
    needed: ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'],
    bones: [['shoulder', 'elbow'], ['elbow', 'wrist'], ['shoulder', 'hip'], ['hip', 'knee'], ['knee', 'ankle'], ['ankle', 'heel'], ['ankle', 'toe']],
    dots: ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'],
    limb: { 'shoulder|elbow': 'arm', 'elbow|wrist': 'arm', 'shoulder|hip': 'back', 'hip|knee': 'lift', 'knee|ankle': 'knee' },

    bands: [
      { key: 'knee', of: 'knee', label: 'knee angle', hud: 'KNEE', note: 'bent',
        lo: 'kneeMin', hi: 'kneeMax', scale: [40, 180],
        set: [{ key: 'kneeMin', label: 'Knee angle, lowest', min: 40, max: 175 },
              { key: 'kneeMax', label: 'Knee angle, highest', min: 45, max: 180 }] },
      { key: 'lift', of: 'lift', label: 'knee, hip, shoulder', hud: 'LIFT', note: 'at the top',
        min: 'liftMin', scale: [60, 180],
        set: [{ key: 'liftMin', label: 'Lift at the top, at least', min: 120, max: 179 }] },
      { key: 'over', of: 'over', label: 'thigh above the back', hud: 'OVER', note: 'at most',
        max: 'overMax', scale: [-40, 40],
        set: [{ key: 'overMax', label: 'Thigh above the back, at most', min: 0, max: 30 }] },
      { key: 'arm', of: 'arm', label: 'arm from the floor', hud: 'ARM', note: 'target',
        lo: 'armMin', hi: 'armMax', scale: [50, 130],
        set: [{ key: 'armMin', label: 'Arm angle, lowest', min: 50, max: 90 },
              { key: 'armMax', label: 'Arm angle, highest', min: 90, max: 130 }] },
      { key: 'elbow', of: 'elbow', label: 'elbow', hud: 'ELBOW', note: 'straight',
        min: 'elbowMin', scale: [90, 180],
        set: [{ key: 'elbowMin', label: 'Elbow angle, at least', min: 120, max: 179 }] },
      { key: 'back', of: 'back', label: 'back off level', hud: 'BACK', note: 'level',
        sym: 'backLevel', scale: [-40, 40],
        set: [{ key: 'backLevel', label: 'Back off level, at most', min: 3, max: 30 }] },
    ],

    /* The chain: the hands, then the arms, then the back they carry, then the leg —
       the knee's bend before the lift, and too high before not high enough, because
       a thigh past the back's line is the lower back arching. The hands, arms and
       back are the set-up, coached before the kick is asked for. */
    faults: ['lost', 'armBack', 'armFwd', 'elbowBent', 'backSag', 'backRound', 'raise', 'kneeOpen', 'kneeShut', 'liftHigh', 'liftLow'],
    setup: ['armBack', 'armFwd', 'elbowBent', 'backSag', 'backRound'],
    prompts: ['raise'],
    cues: {
      raise: { text: 'Kick up' },
      armBack: { label: 'Shoulders behind wrists', text: 'Shoulders forward over your wrists', deep: 'Shoulders forward — you are sitting back on your heels' },
      armFwd: { label: 'Shoulders ahead of wrists', text: 'Shoulders back over your wrists', deep: 'Shoulders back — they are well ahead of your wrists' },
      elbowBent: { label: 'Elbows bent', text: 'Straighten your arms', deep: 'Straighten your arms — the elbows are well bent' },
      backSag: { label: 'Back sagging', text: 'Lift your belly — your back is sagging', deep: 'Belly up — your back is sagging toward the floor' },
      backRound: { label: 'Back rounding', text: 'Flatten your back', deep: 'Flatten your back — it is rounding up' },
      kneeOpen: { label: 'Knee straightening', text: 'Keep the knee bent — sole to the ceiling', deep: 'Bend the knee to a right angle — the leg is straightening' },
      kneeShut: { label: 'Knee too closed', text: 'Open the knee a little', deep: 'Open the knee out to a right angle' },
      liftHigh: { label: 'Thigh above back', text: 'Not so high — thigh in line with your back', deep: 'Lower it — the thigh is past your back and the back is arching' },
      liftLow: { label: 'Thigh short of the line', text: 'Lift higher — thigh level with your back', deep: 'Higher — knee, hip and shoulder in one line' },
      lower: { text: 'Lower slowly' },
      early: { text: 'Hold it at the top next time' },
      lost: { text: 'Get onto your hands and knees, side on to the camera' },
    },

    /* Side-on the two legs sit on top of each other. The one being kicked is the one
       to measure, so the knee that is higher wins; visibility decides when neither is. */
    read(lm, aspect, cfg) {
      if (!lm || lm.length < 33) return null;
      const opts = [];
      for (const side of ['L', 'R']) {
        const P = sidePoints(lm, aspect, side);
        if (!P) return null;
        const ok = donkeykick.needed.every((k) => P[k].v >= cfg.vis);
        opts.push({ side, P, ok, up: -P.knee.y, vis: donkeykick.joints.reduce((a, k) => a + P[k].v, 0) / donkeykick.joints.length });
      }
      const usable = opts.filter((o) => o.ok);
      if (!usable.length) {
        return { ok: false, side: opts[0].side, vis: Math.max(...opts.map((o) => o.vis)), why: 'Some of you is out of shot or hidden' };
      }
      const pick = usable.slice().sort((a, b) => (b.up - a.up) || (b.vis - a.vis))[0];
      const P = pick.P;
      /* the head end: the shoulders lie that way from the hips */
      const facing = Math.sign(P.shoulder.x - P.hip.x) || 1;
      return {
        ok: true, side: pick.side, vis: pick.vis, facing, points: P,
        angles: ['knee', 'lift', 'over', 'arm', 'elbow', 'back'],
        knee: angleAt(P.hip, P.knee, P.ankle),                 // hip → knee → ankle
        lift: angleAt(P.knee, P.hip, P.shoulder),              // knee → hip → shoulder
        /* the thigh's rise over the back's line: the knee above the hip plus the
           shoulder above the hip is zero when the three are in a line, positive
           when the knee is past it */
        over: rise(P.hip, P.knee) + rise(P.hip, P.shoulder),
        arm: 90 + tiltFromVertical(P.wrist, P.shoulder, facing),   // 90 plumb, more = shoulder ahead
        elbow: angleAt(P.shoulder, P.elbow, P.wrist),
        back: rise(P.hip, P.shoulder),                          // + = shoulders above hips: sagging
      };
    },

    judge(r, cfg) {
      if (!r || !r.ok || ['knee', 'lift', 'over', 'arm', 'elbow', 'back'].some((k) => r[k] == null)) {
        return { ok: false, inPosition: false, raised: false, atStart: false, good: {}, faults: {} };
      }
      const faults = {}, good = {};
      good.arm = inBand(r.arm, cfg.armMin, cfg.armMax);
      if (r.arm < cfg.armMin) faults.armBack = cfg.armMin - r.arm;
      else if (r.arm > cfg.armMax) faults.armFwd = r.arm - cfg.armMax;
      good.elbow = inBand(r.elbow, cfg.elbowMin, cfg.elbowMax);
      if (r.elbow < cfg.elbowMin) faults.elbowBent = cfg.elbowMin - r.elbow;
      good.back = within(r.back, cfg.backLevel);
      if (r.back > cfg.backLevel) faults.backSag = r.back - cfg.backLevel;
      else if (r.back < -cfg.backLevel) faults.backRound = -r.back - cfg.backLevel;
      good.knee = inBand(r.knee, cfg.kneeMin, cfg.kneeMax);
      if (r.knee > cfg.kneeMax) faults.kneeOpen = r.knee - cfg.kneeMax;
      else if (r.knee < cfg.kneeMin) faults.kneeShut = cfg.kneeMin - r.knee;
      good.over = inBand(r.over, cfg.overMin, cfg.overMax);
      if (r.over > cfg.overMax) faults.liftHigh = r.over - cfg.overMax;
      good.lift = inBand(r.lift, cfg.liftMin, cfg.liftMax);
      if (r.lift < cfg.liftMin && !faults.liftHigh) faults.liftLow = cfg.liftMin - r.lift;
      const raised = inBand(r.lift, cfg.raiseAt, 180), atStart = inBand(r.lift, 0, cfg.downAt);
      return { ok: true, good, faults, raised, atStart,
        inPosition: raised && good.knee && good.lift && good.over && good.arm && good.elbow && good.back };
    },

    draw(d, r, v) {
      d.guide(r.points.shoulder, r.points.hip, v.good.back);
      if (r.lift != null) d.angleAt(r.points.hip, r.points.knee, r.points.shoulder, r.lift, v.good.lift && v.good.over, 0.8);
      if (r.knee != null) d.angleAt(r.points.knee, r.points.hip, r.points.ankle, r.knee, v.good.knee, 0.7);
      d.plumb(r.points.wrist, 0.3);
      if (r.arm != null) d.angleTo(r.points.wrist, r.points.shoulder, 0, r.arm - 90, v.good.arm, 0.6);
    },
  };

  return { wallsit, plank, kneeraise, bridge, donkeykick, list: [wallsit, plank, kneeraise, bridge, donkeykick] };
});
