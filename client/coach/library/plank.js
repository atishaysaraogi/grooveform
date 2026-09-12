/* Plank — metadata, camera set-up, measurement, faults and guide.
   Registered into the shared exercise library; see docs/EXERCISE-LIBRARY.md. */
(function (root) {
  'use strict';
  const lib = (typeof module !== 'undefined' && module.exports)
    ? require('../exercise-library.js') : root.ExerciseLibrary;

  lib.define((k) => {
    const { SIDE, angle, dist, lineOffset, segTilt, sideJoints } = k;

    return {
      id: 'plank', order: 40, name: 'Plank', group: 'Core', type: 'hold', view: 'side', icon: '📏',
      summary: 'Straight-line hold with live sag / pike correction.',
      setup: 'Camera on the floor, side-on, 2–3 m away. Forearm or straight-arm plank. Whole body in frame.',
      why: 'The only view where the hip line, shoulder-over-elbow stacking and head position can all be measured at once.',
      defaultTarget: 30, targets: [20, 30, 45, 60, 90],
      required: [11, 12, 13, 14, 23, 24, 27, 28],
      enterCue: 'Get into your plank — body in one straight line',
      calibrate() { return {}; },
      measure(pts, S) {
        const j = sideJoints(pts, S);
        const lineAng = angle(j.sh, j.hip, j.ank);
        const hipOff = lineOffset(j.sh, j.ank, j.hip);
        const neck = angle(j.ear, j.sh, j.hip);
        const stack = (j.sh.x - j.el.x) * (j.foot.x > j.heel.x ? -1 : 1) / Math.max(dist(j.sh, j.el), 0.02); // + shoulders behind elbows
        const bodyTilt = segTilt(j.sh, j.ank);
        const kneeAng = angle(j.hip, j.knee, j.ank);
        const kneesDown = j.knee.y > j.ank.y - 0.03;                            // knee at floor level → knees-down variant
        return { p: 0, inPosition: bodyTilt < 35 && lineAng > 140 && j.hip.y < 0.98, lineAng, hipOff, neck, stack, kneeAng, kneesDown, focus: [SIDE[S].HIP] };
      },
      faults: [
        { id: 'sag', label: 'Hips sagging', cue: 'Lift your hips — squeeze your glutes', tip: 'Tuck the pelvis slightly and brace; sagging loads the lower back.', weight: 3, persist: 500, cooldown: 4000, check: m => m.inPosition && m.hipOff > 0.055 },
        { id: 'pike', label: 'Hips too high', cue: 'Lower your hips into a straight line', tip: 'A high pike takes the work out of the core.', weight: 2, persist: 600, cooldown: 4000, check: m => m.inPosition && m.hipOff < -0.075 },
        { id: 'knees', label: 'Knees bending', cue: 'Straighten your legs — squeeze the thighs', tip: 'Pull the kneecaps up so the legs are part of the line; bent knees drop the hips.', weight: 1, persist: 900, cooldown: 8000, check: m => m.inPosition && !m.kneesDown && m.kneeAng < 160 },
        { id: 'stack', label: 'Shoulders not over elbows', cue: 'Bring your shoulders over your elbows', tip: 'Stack the shoulder directly above the elbow to protect the shoulder joint.', weight: 1, persist: 900, cooldown: 8000, check: m => m.inPosition && Math.abs(m.stack) > 0.45 },
        { id: 'neck', label: 'Head dropping', cue: 'Eyes to the floor ahead — neck long', tip: 'Keep the head in line with the spine.', weight: 1, persist: 800, cooldown: 8000, check: m => m.inPosition && m.neck < 140 },
      ],
      guide: {
        surface: 'Mat on a firm floor. Camera on the floor, side-on.',
        regions: [
          { name: 'Hands, forearms & elbows', points: [
            { t: 'Forearm plank: elbows directly under the shoulders, forearms parallel or hands lightly clasped, palms down or fists. Straight-arm plank: hands directly under the shoulders, fingers spread, elbows soft, not locked.', tracked: true },
            { t: 'Press the floor away so the upper back is broad — do not sink between the shoulder blades.', tracked: false },
          ] },
          { name: 'Shoulders', points: [
            { t: 'Shoulders stacked over the elbows (or wrists), pulled down away from the ears.', tracked: true },
          ] },
          { name: 'Head & neck', points: [
            { t: 'Head in line with the spine; eyes on the floor about 30 cm ahead of the hands. Do not look forward or let the head hang.', tracked: true },
          ] },
          { name: 'Back, core & hips', points: [
            { t: 'One straight line from the shoulder through the hip to the ankle. Squeeze the glutes and tuck the tailbone slightly so the lower back does not sag.', tracked: true },
            { t: 'Brace the abdominals as if expecting a poke; ribs drawn down, not flared.', tracked: false },
            { t: 'Hips neither sagging toward the floor nor piked up.', tracked: true },
          ] },
          { name: 'Legs & feet', points: [
            { t: 'Legs straight, knees pulled up (quads on), thighs squeezed together or hip-width apart — both are fine, just be consistent.', tracked: true },
            { t: 'On the balls of the feet, heels pushing back. Feet together is harder, hip-width is easier.', tracked: false },
            { t: 'Knees-down variant: knees on the mat, shins relaxed, and the same straight line from shoulder through hip to knee.', tracked: true },
          ] },
          { name: 'Breathing', points: [
            { t: 'Slow steady breaths into the sides of the ribs; never hold your breath. Stop the hold when the line breaks rather than when it burns.', tracked: true },
          ] },
        ],
        stop: 'Lower-back pain, wrist pain that does not ease on the forearms, or shaking so hard the line cannot be held.',
      },
    };
  });
})(typeof window !== 'undefined' ? window : globalThis);
