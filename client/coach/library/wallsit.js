/* Wall sit — metadata, camera set-up, measurement, faults and guide.
   Registered into the shared exercise library; see docs/EXERCISE-LIBRARY.md. */
(function (root) {
  'use strict';
  const lib = (typeof module !== 'undefined' && module.exports)
    ? require('../exercise-library.js') : root.ExerciseLibrary;

  lib.define((k) => {
    const { SIDE, angle, dist, fromVertical, lineOffset, mid, segTilt, sideJoints } = k;

    return {
      id: 'wallsit', order: 30, name: 'Wall sit', group: 'Knee & quad', type: 'hold', view: 'side', icon: '🧱',
      summary: 'Quad endurance at a safe 90° knee angle.',
      setup: 'Camera side-on, 2–3 m away, roughly hip height. Back flat on the wall, feet about 50 cm out, shoulder-width apart. Whole body in frame.',
      why: 'From the side the camera reads knee angle and whether your shins are vertical (knees not past toes) — both invisible from the front.',
      defaultTarget: 30, targets: [20, 30, 45, 60],
      required: [11, 12, 23, 24, 25, 26, 27, 28],
      enterCue: 'Slide down the wall until your knees are at ninety',
      calibrate() { return {}; },
      measure(pts, S) {
        const j = sideJoints(pts, S);
        const knee = angle(j.hip, j.knee, j.ank);
        const shinLean = (j.knee.x - j.ank.x) * (j.foot.x > j.heel.x ? 1 : -1) / Math.max(dist(j.knee, j.ank), 0.02); // + = knee forward of ankle toward toes
        const thighTilt = segTilt(j.hip, j.knee);   // 0 = thigh horizontal
        const trunk = fromVertical(j.sh, j.hip);    // trunk angle from vertical — back should be on the wall
        const handOnThigh = Math.abs(lineOffset(j.hip, j.knee, j.wr)) < 0.12 && j.wr.x > Math.min(j.hip.x, j.knee.x) - 0.02 && j.wr.x < Math.max(j.hip.x, j.knee.x) + 0.02 && j.wr.v > 0.5;
        return { p: 0, inPosition: knee <= 118 && knee > 55, seated: knee < 168, knee, shinLean, thighTilt, trunk, handOnThigh, focus: [SIDE[S].KNEE] };
      },
      faults: [
        { id: 'high', label: 'Sitting too high', cue: 'Slide down a little', tip: 'Aim for a 90° knee — thighs parallel to the floor.', weight: 2, persist: 700, cooldown: 3500, check: m => m.seated && m.knee > 108 },
        { id: 'low', label: 'Below 90°', cue: 'Come up a touch — knees at ninety', tip: 'Deeper than 90° increases kneecap load; stay at parallel.', weight: 2, persist: 700, cooldown: 3500, check: m => m.seated && m.knee < 78 },
        { id: 'lean', label: 'Back off the wall', cue: 'Press your back into the wall', tip: 'Shoulder blades, mid-back and hips all stay on the wall; leaning forward shifts load to the knees.', weight: 2, persist: 1500, cooldown: 5000, check: m => m.inPosition && m.trunk > 15 },
        { id: 'hands', label: 'Hands resting on thighs', cue: 'Hands off your thighs', tip: 'Arms at your sides, crossed, or out in front — resting on the thighs takes load off the quads.', weight: 1, persist: 1200, cooldown: 8000, check: m => m.inPosition && m.handOnThigh },
        { id: 'shin', label: 'Knees past toes', cue: 'Walk your feet out — shins vertical', tip: 'Keep the shin vertical so the load stays in the quads, not the kneecap.', weight: 2, persist: 800, cooldown: 5000, check: m => m.inPosition && m.shinLean > 0.35 },
      ],
      guide: {
        surface: 'A flat wall with nothing on it and a non-slip floor. Barefoot or grippy shoes.',
        regions: [
          { name: 'Feet', points: [
            { t: 'Feet hip- to shoulder-width apart, toes pointing straight ahead, both feet flat with weight spread across the whole foot — heels stay down.', tracked: false },
            { t: 'Feet far enough from the wall that when you slide down the shins are vertical and the knees sit directly above the ankles — usually about 50 cm.', tracked: true },
          ] },
          { name: 'Knees', points: [
            { t: 'Knees bent to 90°: thighs parallel to the floor, shins vertical.', tracked: true },
            { t: 'Knees track in line with the second toe — not falling inward toward each other, not pushed out. (Facing the camera side-on, the coach cannot see this; check it yourself in a mirror once.)', tracked: false },
            { t: 'Knees do not travel forward past the toes.', tracked: true },
          ] },
          { name: 'Hips & pelvis', points: [
            { t: 'Hips at the same height as the knees, pressed back into the wall. Pelvis neutral — a small gap at the lower back is normal.', tracked: true },
          ] },
          { name: 'Back', points: [
            { t: 'Whole back — sacrum, mid-back and shoulder blades — in contact with the wall. Do not let the upper body lean forward off it.', tracked: true },
          ] },
          { name: 'Shoulders, arms & hands', points: [
            { t: 'Shoulders relaxed and back against the wall. Arms hanging at your sides, crossed over the chest, or held straight out in front — never resting on the thighs, which unloads the quads.', tracked: true },
          ] },
          { name: 'Head', points: [
            { t: 'Back of the head touching the wall, chin level, eyes forward.', tracked: false },
          ] },
          { name: 'Breathing', points: [
            { t: 'Breathe steadily throughout; do not hold your breath as it burns. The hold ends when the knee angle or the back on the wall gives way, not when you decide to push through.', tracked: true },
          ] },
        ],
        stop: 'Pain builds behind or around the kneecap (a burn in the front of the thigh is expected; kneecap pain is not).',
      },
    };
  });
})(typeof window !== 'undefined' ? window : globalThis);
