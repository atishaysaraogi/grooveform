/* Upper trapezius stretch — metadata, camera set-up, measurement, faults and guide.
   Registered into the shared exercise library; see docs/EXERCISE-LIBRARY.md. */
(function (root) {
  'use strict';
  const lib = (typeof module !== 'undefined' && module.exports)
    ? require('../exercise-library.js') : root.ExerciseLibrary;

  lib.define((k) => {
    const { SIDE, dist, headTilt, lineTilt, mid } = k;

    return {
      id: 'trapstretch', order: 100, upperBody: true, name: 'Upper trapezius stretch', group: 'Neck', type: 'hold', view: 'front', icon: '🧘', identifyLimb: null,
      enterCue: 'Ear toward the shoulder — and keep the other shoulder down',
      summary: 'Ear toward the opposite shoulder with the stretched-side hand behind your back — checked for the shoulder creeping up, the head turning and the hand coming out.',
      setup: 'Sit or stand facing the camera about 1.5 m away, camera at chest height, head to hips in frame. Put the hand of the side you are stretching behind your back (or sit on it). Tuck the chin slightly, then tilt the ear toward the opposite shoulder; the other hand may rest on the head to add gentle weight. Hold, breathe, keep the stretched shoulder down.',
      why: 'From the front the tilt of the head against the line of the shoulders, a shoulder rising toward the ear, and the nose turning away from the camera are all measured directly.',
      defaultTarget: 20, targets: [15, 20, 30, 45],
      options: [],
      required: [0, 7, 8, 11, 12, 15, 16, 23, 24],
      calibrate(pts, S, opts) {
        return { headTilt0: headTilt(pts), shTilt0: lineTilt(pts[11], pts[12]), earSpan: Math.max(dist(pts[7], pts[8]), 0.02), torso: Math.max(dist(mid(pts[11], pts[12]), mid(pts[23], pts[24])), 0.05), neckL: dist(pts[7], pts[11]), neckR: dist(pts[8], pts[12]), work: (opts && opts.work) || null };
      },
      measure(pts, S, ref) {
        const tilt = headTilt(pts) - ref.headTilt0;                                              // + = head tilting toward image right (right ear down)
        const stretchL = tilt > 0, s = ref.work ? ref.work : stretchL ? 'L' : 'R';              // right ear down stretches the LEFT upper trap
        const j = SIDE[s], other = SIDE[s === 'L' ? 'R' : 'L'];
        const amount = Math.abs(tilt);
        // the stretched shoulder must stay down: its ear→shoulder distance should GROW, and the shoulder line must not tip up on that side
        const shoulderUp = (ref['neck' + s] - dist(pts[j.EAR], pts[j.SH])) / ref.torso + Math.max(0, (s === 'L' ? 1 : -1) * (lineTilt(pts[11], pts[12]) - ref.shTilt0)) / 30;
        const noseOff = Math.abs(pts[0].x - (pts[7].x + pts[8].x) / 2) / ref.earSpan;             // nose off the ear midpoint = head turned
        const handUp = (pts[j.HIP].y - pts[j.WR].y) / ref.torso;                                 // stretched-side hand above the hip = not behind the back
        const inPosition = amount >= 18;
        return { p: 0, inPosition, amount, tilt, shoulderUp, noseOff, handUp, side: s, focus: [j.SH, other.EAR] };
      },
      faults: [
        { id: 'shoulder', label: 'Stretched shoulder creeping up', cue: 'Keep that shoulder down', tip: 'The stretch only reaches the upper trapezius when the shoulder on the stretched side stays down. Press the hand behind your back toward the floor, or sit on it.', weight: 3, persist: 700, cooldown: 5000, check: m => m.inPosition && m.shoulderUp > 0.10 },
        { id: 'turn', label: 'Turning the head', cue: 'Nose forward — tilt, don\'t turn', tip: 'Keep the eyes and nose pointing at the camera; turning the head changes which muscle is stretched and can pinch the neck.', weight: 2, persist: 800, cooldown: 6000, check: m => m.inPosition && m.noseOff > 0.25 },
        { id: 'hand', label: 'Hand not behind the back', cue: 'Put the hand behind your back', tip: 'The arm behind the back anchors the shoulder blade so the stretch goes into the trapezius, not the shoulder joint.', weight: 1, persist: 1200, cooldown: 8000, check: m => m.inPosition && m.handUp > 0.25 },
        { id: 'shallow', label: 'Not tilting enough', cue: 'Ear a little closer to the shoulder', tip: 'Tilt until you feel a clear pull along the side of the neck — gentle, never painful. About 20–30° is usually enough.', weight: 1, persist: 2500, cooldown: 8000, check: m => !m.inPosition && m.amount > 6 },
      ],
      guide: {
        surface: 'Sitting on a firm chair or standing tall, facing the camera. Camera at chest height, about 1.5 m away, so the head and both shoulders are large in the picture.',
        regions: [
          { name: 'Posture', points: [
            { t: 'Sit or stand tall, ribs over hips, weight even. Do not slump — the stretch changes completely if the upper back rounds.', tracked: false },
            { t: 'Tuck the chin slightly first (retract the head as if making a double chin), then keep that tuck while you tilt.', tracked: false },
          ] },
          { name: 'Stretched side (the shoulder that stays down)', points: [
            { t: 'Put that hand behind your back, or sit on it, or hold the chair seat. This anchors the shoulder blade so the stretch goes into the upper trapezius rather than the shoulder joint. The coach checks that the hand is low.', tracked: true },
            { t: 'The shoulder must stay down for the whole hold. The moment it creeps up toward the ear the stretch is lost — this is the fault the coach watches most.', tracked: true },
          ] },
          { name: 'Head & neck', points: [
            { t: 'Tilt the ear toward the OPPOSITE shoulder (right ear to right shoulder stretches the left trapezius). About 20–30° of tilt is enough; the coach counts the hold once the head is tilted.', tracked: true },
            { t: 'Nose and eyes stay pointing at the camera — tilt, do not turn. Turning the head moves the stretch to different muscles and can pinch.', tracked: true },
            { t: 'For a stronger stretch, aim the nose slightly toward the armpit (a little forward bend); never push into pain.', tracked: false },
          ] },
          { name: 'Other arm', points: [
            { t: 'The opposite hand may rest lightly on the head to add gentle weight. It rests; it does not pull. If in doubt, leave it in your lap.', tracked: false },
          ] },
          { name: 'Breathing & intensity', points: [
            { t: 'Breathe slowly; on each breath out let the shoulder sink a little further from the ear. Mild pull along the side of the neck, never pain or tingling.', tracked: false },
            { t: 'Hold 15–30 s, 2–3 times per side. Stretching eases the tightness for a while; pairing it with rows and pull-aparts is what makes it last.', tracked: true },
          ] },
        ],
        stop: 'Dizziness, pins and needles into the arm or hand, sharp pain, or a headache that starts during the stretch.',
      },
    };
  });
})(typeof window !== 'undefined' ? window : globalThis);
