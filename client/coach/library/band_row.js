/* Band rows — metadata, camera set-up, measurement, faults and guide.
   Registered into the shared exercise library; see docs/EXERCISE-LIBRARY.md. */
(function (root) {
  'use strict';
  const lib = (typeof module !== 'undefined' && module.exports)
    ? require('../exercise-library.js') : root.ExerciseLibrary;

  lib.define((k) => {
    const { SIDE, FULL, ATTEMPT, BAND, angle, dist, sideJoints, trunkLean } = k;

    return {
      id: 'band_row', order: 80, vetted: true, tracking: 'form', camera: { height: 'chest', distance: '2 m', posture: 'standing' }, upperBody: true, name: 'Band rows', group: 'Shoulder — scapula & back', type: 'reps', view: 'side', icon: '🚣', enterCue: null,
      summary: 'Pull the band to your ribs with the elbows close — checked for shrugging, leaning back, flaring elbows and incomplete pulls.',
      setup: 'Anchor the band at waist height in front of you. Stand side-on to the camera about 2.5 m away, camera at chest height, whole body in frame. Arms straight toward the anchor with light tension. Draw the elbows straight back past your ribs, squeeze the shoulder blades together, pause, and let the arms straighten slowly.',
      why: 'From the side the elbow travelling behind the line of the torso, the shoulder rising, and the trunk leaning back are all plain to see; from the front they are hidden behind the body.',
      defaultTarget: 10, targets: [6, 8, 10, 12, 15],
      options: [BAND('red')],
      required: [7, 8, 11, 12, 13, 14, 15, 16, 23, 24],
      calibrate(pts, S, opts) {
        const j = sideJoints(pts, S); const upper = Math.max(dist(j.sh, j.el), 0.03);
        const dir = Math.sign(j.wr.x - j.sh.x) || 1;                                            // image direction toward the anchor
        return { upper, dir, eb0: ((j.el.x - j.sh.x) * -dir) / upper, neck0: dist(j.ear, j.sh), lean0: trunkLean(pts), torso: Math.max(dist(j.sh, j.hip), 0.05), full: 0.45 };
      },
      measure(pts, S, ref) {
        const j = sideJoints(pts, S);
        const elbowBack = ((j.el.x - j.sh.x) * -ref.dir) / ref.upper;                            // + = elbow behind the shoulder line
        const p = (elbowBack - ref.eb0) / (ref.full - ref.eb0);
        const shrug = (ref.neck0 - dist(j.ear, j.sh)) / ref.torso;
        const leanBack = (trunkLean(pts) - ref.lean0) * -ref.dir;                                // + = shoulders moving away from the anchor
        const elbowHigh = (j.sh.y - j.el.y) / ref.upper;                                         // + = elbow above the shoulder
        const elbow = angle(j.sh, j.el, j.wr);
        return { p, elbowBack, shrug, leanBack, elbowHigh, elbow, side: S, focus: [SIDE[S].EL] };
      },
      faults: [
        { id: 'shrug', label: 'Shrugging', cue: 'Shoulders down as you pull', tip: 'Pull the shoulder blades down and back, not up. If the shoulder rises toward the ear the upper trapezius is doing the row.', weight: 3, persist: 400, cooldown: 4500, phase: 'moving', check: m => m.p > 0.3 && m.shrug > 0.09 },
        { id: 'lean', label: 'Leaning back', cue: 'Stand tall — pull with the arms, not the body', tip: 'Rocking the torso back uses body weight instead of the back muscles. Brace the abdomen and keep the trunk still; if you must lean, the band is too strong.', weight: 2, persist: 450, cooldown: 5000, phase: 'moving', check: m => m.p > 0.3 && m.leanBack > 8 },
        { id: 'flare', label: 'Elbows flaring up', cue: 'Elbows down, close to your ribs', tip: 'Elbows at shoulder height turn this into a high row that loads the neck. Keep the elbows low and brushing your sides.', weight: 2, persist: 400, cooldown: 5000, phase: 'moving', check: m => m.p > 0.4 && m.elbowHigh > -0.15 },
        { id: 'shallow', label: 'Not pulling all the way back', cue: 'Elbows further back — squeeze the blades', tip: 'The squeeze at the end is the point of the exercise: the elbow should pass behind your ribs before you pause.', weight: 1, onRep: true, check: rep => rep.peak < FULL && rep.peak > ATTEMPT },
        { id: 'fast', label: 'Too fast', cue: 'Slower — pause at the back', tip: 'Two seconds back, hold the squeeze for a count, three seconds forward. Do not let the band snap the arms out.', weight: 1, onRep: true, check: rep => rep.duration < 2200 },
        { id: 'return', label: 'Not letting the arms straighten', cue: 'Let the arms reach forward fully', tip: 'Each rep starts with the arms long so the shoulder blades can glide forward and then be pulled back through the full range.', weight: 1, onRep: true, check: rep => rep.endP > 0.3 },
      ],
      guide: {
        surface: 'Standing side-on to the camera, band anchored at waist height in front of you (door anchor at handle height, railing, pole). Step back until there is light tension with the arms straight.',
        regions: [
          { name: 'Feet & legs', points: [
            { t: 'Feet hip-width, one foot slightly ahead if that feels steadier, knees soft. Slight hinge at the hips is fine; the trunk then stays at that angle for every rep.', tracked: true },
          ] },
          { name: 'Trunk & pelvis', points: [
            { t: 'Brace like a standing plank: ribs down, abdomen firm, back neutral. The body does not rock back to help the pull — the coach compares your trunk angle to the start position.', tracked: true },
            { t: 'If you feel yourself leaning back or the lower back arching, the band is too strong.', tracked: false },
          ] },
          { name: 'Arms & hands', points: [
            { t: 'Start with the arms long and the shoulder blades allowed to glide forward. Then draw the elbows straight back past the ribs, keeping them close to the body — not flared out to shoulder height.', tracked: true },
            { t: 'Elbows lead; the hands follow. Finish with the hands beside the lower ribs and the elbows behind the line of the torso.', tracked: true },
            { t: 'Wrists straight, grip relaxed — do not curl the band in with the biceps.', tracked: false },
            { t: 'Let the arms straighten fully on the way out so every rep goes through the whole range.', tracked: true },
          ] },
          { name: 'Shoulders & neck', points: [
            { t: 'Squeeze the shoulder blades together and DOWN at the back of each rep. If the shoulders rise toward the ears the upper trapezius is doing the row — the coach flags it.', tracked: true },
            { t: 'Chin level, neck long; do not poke the head forward as you pull.', tracked: false },
          ] },
          { name: 'Breathing & tempo', points: [
            { t: 'Breathe out as you pull, in as the arms lengthen.', tracked: false },
            { t: '2 s back, 1–2 s squeeze, 3 s forward under control. Never let the band snap the arms out.', tracked: true },
          ] },
        ],
        stop: 'Sharp pain at the front of the shoulder, neck pain that builds through the set, or pins and needles in the hands.',
      },
    };
  });
})(typeof window !== 'undefined' ? window : globalThis);
