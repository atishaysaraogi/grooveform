/* Band pull-apart — metadata, camera set-up, measurement, faults and guide.
   Registered into the shared exercise library; see docs/EXERCISE-LIBRARY.md. */
(function (root) {
  'use strict';
  const lib = (typeof module !== 'undefined' && module.exports)
    ? require('../exercise-library.js') : root.ExerciseLibrary;

  lib.define((k) => {
    const { FULL, ATTEMPT, BAND, angle, dist, mid } = k;

    return {
      id: 'pullapart', order: 90, vetted: true, tracking: 'form', camera: { height: 'chest', distance: '2 m', posture: 'standing' }, upperBody: true, name: 'Band pull-apart', group: 'Shoulder — scapula & back', type: 'reps', view: 'front', icon: '🏹', enterCue: null,
      summary: 'Arms straight at shoulder height, pull the band to your chest — checked for bending elbows, shrugging, the band drifting up or down, and short reps.',
      setup: 'Hold the band in front of you at shoulder height, arms straight, hands a little wider than the shoulders, light tension. Face the camera about 2.5 m away, camera at chest height, head to hips in frame. Pull the hands apart until the band touches your chest, squeeze the shoulder blades together, pause, then return slowly.',
      why: 'Facing the camera the arms open into a T in the camera plane: the distance between the hands, a bending elbow, the shoulders rising, and the hands drifting above or below shoulder height are all read directly.',
      defaultTarget: 12, targets: [6, 8, 10, 12, 15, 20],
      options: [BAND('yellow')],
      required: [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24],
      calibrate(pts, S, opts) {
        const shW = Math.max(dist(pts[11], pts[12]), 0.03); const torso = Math.max(dist(mid(pts[11], pts[12]), mid(pts[23], pts[24])), 0.05);
        // arm length is foreshortened at the start (arms point at the camera), so estimate it from torso length: arm ≈ 1.15 × shoulder–hip
        return { shW, torso, arm: 1.15 * torso, span0: dist(pts[15], pts[16]), neck0: (dist(pts[7], pts[11]) + dist(pts[8], pts[12])) / 2 };
      },
      measure(pts, S, ref) {
        const span = dist(pts[15], pts[16]);
        const p = (span - ref.span0) / (ref.shW + 2 * ref.arm * 0.92 - ref.span0);              // full = hands out at ~92 % of the span
        const elbow = Math.min(angle(pts[11], pts[13], pts[15]), angle(pts[12], pts[14], pts[16]));
        const shrug = (ref.neck0 - (dist(pts[7], pts[11]) + dist(pts[8], pts[12])) / 2) / ref.torso;
        const handDrop = ((pts[15].y + pts[16].y) / 2 - (pts[11].y + pts[12].y) / 2) / ref.torso;   // + = hands below shoulder height
        return { p, span, elbow, shrug, handDrop, side: S, focus: [15, 16] };
      },
      faults: [
        { id: 'bend', label: 'Elbows bending', cue: 'Arms long — pull with the shoulder blades', tip: 'Bending the elbows turns the pull-apart into a row and takes the rear shoulder out of it. Keep a tiny soft bend and hold it fixed.', weight: 3, persist: 400, cooldown: 4500, phase: 'moving', check: m => m.p > 0.45 && m.elbow < 150 },
        { id: 'shrug', label: 'Shrugging', cue: 'Long neck — shoulders down', tip: 'Pull the shoulders gently down before each rep: wide collarbones, then squeeze the blades back. If they climb toward the ears the upper trapezius takes over.', weight: 2, persist: 450, cooldown: 5000, check: m => m.shrug > 0.09 },
        { id: 'low', label: 'Hands dropping below shoulder height', cue: 'Keep the band at shoulder height', tip: 'As you tire the band drifts down toward the stomach and the movement becomes a shoulder extension. Keep the hands level with the shoulders the whole way.', weight: 2, persist: 500, cooldown: 5000, phase: 'moving', check: m => m.p > 0.4 && m.handDrop > 0.28 },
        { id: 'high', label: 'Hands rising above shoulder height', cue: 'Bring the band down to shoulder height', tip: 'Pulling above the shoulders loads the neck. Hands level with the shoulders.', weight: 1, persist: 500, cooldown: 5000, phase: 'moving', check: m => m.p > 0.4 && m.handDrop < -0.28 },
        { id: 'shallow', label: 'Not pulling all the way apart', cue: 'All the way — band to the chest', tip: 'Finish with the band touching the chest and a one-second squeeze. If that is not possible, use a lighter band.', weight: 1, onRep: true, check: rep => rep.peak < FULL && rep.peak > ATTEMPT },
        { id: 'fast', label: 'Too fast', cue: 'Slower — pause with the band on your chest', tip: 'One to two seconds apart, a one-second squeeze, three seconds back. Do not let the band snap the arms together.', weight: 1, onRep: true, check: rep => rep.duration < 2200 },
      ],
      guide: {
        surface: 'Standing or sitting tall, facing the camera. Hold a light band in front of you at shoulder height, hands a little wider than the shoulders, palms down or thumbs up.',
        regions: [
          { name: 'Feet & legs', points: [
            { t: 'Feet hip-width, knees soft (or sit tall on a chair without leaning on the backrest).', tracked: false },
          ] },
          { name: 'Trunk & pelvis', points: [
            { t: 'Ribs down, gentle brace, back neutral — do not lean back or flare the ribs to finish the rep; that is a sign the band is too strong.', tracked: false },
          ] },
          { name: 'Arms & hands', points: [
            { t: 'Arms straight with a tiny soft bend, held fixed. Bending the elbows turns it into a row and takes the rear shoulder out of it — the coach flags elbows bending as the band opens.', tracked: true },
            { t: 'Keep the hands level with the shoulders the whole way. As you tire the band drifts down toward the stomach; the coach flags hands more than a hand-width above or below shoulder height.', tracked: true },
            { t: 'Pull until the band touches the chest with the arms out in a T, pause, then return under control.', tracked: true },
            { t: 'Wrists straight; thumbs up (palms facing each other) is the gentlest variation for irritable shoulders.', tracked: false },
          ] },
          { name: 'Shoulders & neck', points: [
            { t: 'Start the rep by sliding the shoulder blades back, then let the hands follow. Squeeze the blades together at the end without shrugging.', tracked: false },
            { t: 'Shoulders down and away from the ears; long neck, wide collarbones. A rising shoulder is flagged.', tracked: true },
            { t: 'Chin level, eyes on the camera; do not crane the neck forward.', tracked: false },
          ] },
          { name: 'Breathing & tempo', points: [
            { t: 'Breathe out as the band opens, in as it closes.', tracked: false },
            { t: '1–2 s apart, 1 s squeeze, 3 s back together.', tracked: true },
          ] },
        ],
        stop: 'Pinching at the front of the shoulder, neck pain, or numbness in the hands — switch to a lighter band or a wider grip before stopping altogether.',
      },
    };
  });
})(typeof window !== 'undefined' ? window : globalThis);
