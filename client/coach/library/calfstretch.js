/* Wall calf stretch — metadata, camera set-up, measurement, faults and guide.
   Registered into the shared exercise library; see docs/EXERCISE-LIBRARY.md. */
(function (root) {
  'use strict';
  const lib = (typeof module !== 'undefined' && module.exports)
    ? require('../exercise-library.js') : root.ExerciseLibrary;

  lib.define((k) => {
    const { SIDE, angle, dist, fromVertical, sideJoints } = k;

    return {
      id: 'calfstretch', order: 50, sided: { limb: 'leg', by: 'camera' }, name: 'Wall calf stretch', group: 'Foot & ankle', type: 'hold', view: 'side', icon: '🧗',
      summary: 'Gastrocnemius (straight knee) or soleus (bent knee) stretch, verified heel-down and knee-correct.',
      setup: 'Stand facing a wall with both hands on it, side-on to the camera at hip height, 2–3 m away. Step the stretching leg back so it is the leg nearest the camera; toes pointing at the wall. Whole body from hands to back heel in frame.',
      why: 'Side-on, the three things that make or break the stretch — back heel on the floor, back knee straight or bent, shin leaning toward the wall — are each a direct height or angle read.',
      defaultTarget: 30, targets: [20, 30, 45, 60],
      options: [{ key: 'variant', label: 'Variant', values: ['straight', 'bent'], labels: { straight: 'Straight knee (calf)', bent: 'Bent knee (soleus)' }, default: 'straight' }],
      required: [11, 12, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32],
      enterCue: 'Hands on the wall, step the back leg back, and lean in',
      calibrate(pts, S, opts) {
        const j = sideJoints(pts, S);
        return { heel0: j.heel.y, shin: Math.max(dist(j.knee, j.ank), 0.03), variant: (opts && opts.variant) || 'straight' };
      },
      measure(pts, S, ref) {
        const j = sideJoints(pts, S);
        const knee = angle(j.hip, j.knee, j.ank);
        const heelRise = (ref.heel0 - j.heel.y) / ref.shin;
        const shinLean = fromVertical(j.knee, j.ank);                          // shin angle from vertical — dorsiflexion proxy
        const hipAng = angle(j.sh, j.hip, j.knee);
        const bent = ref.variant === 'bent';
        const kneeOk = bent ? (knee >= 135 && knee <= 165) : knee >= 165;
        const reach = Math.abs(j.wr.x - j.sh.x) / Math.max(dist(j.sh, j.el), 0.02);   // arms extended toward the wall
        const engaged = reach > 1.2;                                                   // hands on the wall = set-up position, judge from here
        const inPosition = engaged && shinLean >= 10 && heelRise < 0.08 && kneeOk && hipAng > 150;
        const handHeight = (j.sh.y - j.wr.y) / Math.max(dist(j.sh, j.el), 0.02);  // + = hands above the shoulder, in upper-arm lengths
        const F = SIDE[S === 'L' ? 'R' : 'L']; const frontKnee = angle(pts[F.HIP], pts[F.KNEE], pts[F.ANK]); const frontVis = Math.min(pts[F.HIP].v, pts[F.KNEE].v, pts[F.ANK].v);
        return { p: 0, inPosition, engaged, reach, knee, heelRise, shinLean, hipAng, bent, handHeight, frontKnee, frontVis, focus: [SIDE[S].ANK, SIDE[S].KNEE] };
      },
      faults: [
        { id: 'heel', label: 'Back heel lifting', cue: 'Press the back heel down', tip: 'The stretch only reaches the calf when the heel stays flat. Step the foot closer to the wall if it will not stay down.', weight: 3, persist: 500, cooldown: 3500, check: m => m.engaged && m.heelRise >= 0.08 },
        { id: 'kneebend', label: 'Back knee bending', cue: 'Straighten the back knee', tip: 'For the calf (gastrocnemius) stretch the back knee must stay straight; a bent knee shifts the stretch to the soleus.', weight: 2, persist: 600, cooldown: 4000, check: m => m.engaged && !m.bent && m.knee < 165 },
        { id: 'kneestraight', label: 'Back knee not bent enough', cue: 'Bend the back knee a little more', tip: 'For the soleus variant keep the back knee softly bent, about 20–40°.', weight: 2, persist: 600, cooldown: 4000, check: m => m.engaged && m.bent && m.knee > 165 },
        { id: 'lean', label: 'Not leaning in enough', cue: 'Lean into the wall until you feel the calf', tip: 'Move the hips toward the wall; the shin should tilt forward at least 10–15°.', weight: 2, persist: 900, cooldown: 4000, check: m => m.engaged && m.shinLean < 10 && m.heelRise < 0.08 },
        { id: 'hands', label: 'Hands not at shoulder height', cue: 'Hands on the wall at shoulder height', tip: 'Hands too high pull the shoulders up and arch the back; too low folds you at the waist.', weight: 1, persist: 1200, cooldown: 8000, check: m => m.engaged && (m.handHeight > 0.9 || m.handHeight < -0.7) },
        { id: 'front', label: 'Front knee straight', cue: 'Bend the front knee as you lean', tip: 'The front knee bends toward the wall so the hips can travel forward; a straight front leg blocks the lean.', weight: 1, persist: 1200, cooldown: 8000, check: m => m.engaged && m.frontVis > 0.5 && m.frontKnee > 172 },
        { id: 'hinge', label: 'Bending at the hips', cue: 'Keep your body in a straight line', tip: 'Lean from the ankle, not the waist — shoulders, hips and back knee in one line.', weight: 1, persist: 900, cooldown: 5000, check: m => m.engaged && m.hipAng < 150 },
      ],
      guide: {
        surface: 'Wall or doorframe. Barefoot or in flat shoes. Non-slip floor.',
        regions: [
          { name: 'Hands & arms', points: [
            { t: 'Both palms flat on the wall at shoulder height, shoulder-width apart, arms nearly straight with a soft elbow.', tracked: true },
            { t: 'Lean by bending the elbows slightly and moving the hips toward the wall — the arms guide, they do not push.', tracked: false },
          ] },
          { name: 'Back foot (the stretching leg)', points: [
            { t: 'Stepped straight back, toes pointing directly at the wall — not turned out. Heel flat on the floor and pressed down throughout.', tracked: true },
            { t: 'Foot in line with its hip, not crossed behind the body; hip-width from the front foot.', tracked: false },
            { t: 'Straight-knee (calf) variant: back knee fully straight. Bent-knee (soleus) variant: back knee softly bent 20–40°, heel still down.', tracked: true },
          ] },
          { name: 'Front foot & knee', points: [
            { t: 'Front foot flat, toes at the wall, about 30 cm from it. Front knee bends as you lean and stays over the front foot, not past it.', tracked: true },
          ] },
          { name: 'Hips & pelvis', points: [
            { t: 'Hips square to the wall, both hip bones the same distance from it. Move the hips forward as one unit; do not push one side forward.', tracked: false },
            { t: 'Lean from the ankle, not by folding at the waist — shoulders, hips and back ankle form one straight line.', tracked: true },
          ] },
          { name: 'Back & shoulders', points: [
            { t: 'Spine long and neutral, chest up, shoulders down and relaxed.', tracked: true },
          ] },
          { name: 'Head', points: [
            { t: 'Eyes on the wall in front of you, chin level.', tracked: false },
          ] },
          { name: 'Breathing & intensity', points: [
            { t: 'Ease in until you feel a firm pull in the calf (straight knee) or lower toward the Achilles (bent knee), never pain. Breathe slowly; on each breath out, see if the hips can come a little further forward.', tracked: true },
            { t: 'Hold 20–60 s, 2–3 times per side, ideally after a warm-up or at the end of a walk.', tracked: true },
          ] },
        ],
        stop: 'Sharp pain in the Achilles or the arch, or if the heel cannot stay down without pain — shorten the step instead.',
      },
    };
  });
})(typeof window !== 'undefined' ? window : globalThis);
