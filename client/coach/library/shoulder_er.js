/* Standing shoulder rotation (band) — metadata, camera set-up, measurement, faults and guide.
   Registered into the shared exercise library; see docs/EXERCISE-LIBRARY.md. */
(function (root) {
  'use strict';
  const lib = (typeof module !== 'undefined' && module.exports)
    ? require('../exercise-library.js') : root.ExerciseLibrary;

  lib.define((k) => {
    const { SIDE, FULL, ATTEMPT, BAND, angle, armRot, clamp, deg, dist, elbowGap, mid, outward,
      stickySide, trunkLean } = k;

    return {
      id: 'shoulder_er', order: 60, sided: { limb: 'arm', by: 'pick' }, upperBody: true, name: 'Standing shoulder rotation (band)', group: 'Shoulder — rotator cuff', type: 'reps', view: 'front', icon: '💪',
      summary: 'External or internal rotation with the elbow pinned to your side — the classic rotator-cuff exercise, checked for elbow drift, shrugging and trunk twist.',
      setup: 'Anchor the band at elbow height beside you (door handle, railing). Stand facing the camera about 2 m away, camera at chest height, head to hips in frame. Elbow bent to 90° and touching your ribs, forearm across your stomach for external rotation (or out to the side for internal rotation). Rotate the forearm against the band, elbow glued to your side, then return slowly.',
      why: 'Facing the camera, the forearm swings across the picture like a clock hand, so rotation angle is read directly, and the elbow leaving the ribs, the shoulder rising toward the ear and the torso twisting are all visible as changes the camera can measure.',
      defaultTarget: 10, targets: [6, 8, 10, 12, 15],
      options: [
        { key: 'variant', label: 'Direction', values: ['er', 'ir'], labels: { er: 'External (out, away from stomach)', ir: 'Internal (in, toward stomach)' }, default: 'er' },
        { key: 'rom', label: 'Rotation target', values: [45, 60, 75, 90], unit: '°', default: 60 },
        BAND('yellow'),
      ],
      required: [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24],
      calibrate(pts, S, opts) {
        const base = { rom: (opts && opts.rom) || 60, variant: (opts && opts.variant) || 'er', work: (opts && opts.work) || null };
        for (const s of ['L', 'R']) { const j = SIDE[s]; const sh = pts[j.SH], el = pts[j.EL], wr = pts[j.WR];
          base['upper' + s] = Math.max(dist(sh, el), 0.03); base['fore' + s] = Math.max(dist(el, wr), 0.85 * base['upper' + s]);   /* the forearm points toward the camera for most of the rep, so its true length is taken from the upper arm (hanging in-plane) */
          base['lat' + s] = (pts[j.WR].x - pts[j.EL].x) * outward(pts, s); /* start offset in image units; turned into an angle with the best forearm length seen (see measure) */ base['elGap' + s] = elbowGap(pts, s) / base['upper' + s]; base['neck' + s] = dist(pts[j.EAR], sh); }
        base.shW = Math.max(dist(pts[11], pts[12]), 0.03); base.lean0 = trunkLean(pts); base.torso = Math.max(dist(mid(pts[11], pts[12]), mid(pts[23], pts[24])), 0.05);
        return base;
      },
      measure(pts, S, ref) {
        for (const s of ['L', 'R']) ref['fore' + s] = Math.max(ref['fore' + s], dist(pts[SIDE[s].EL], pts[SIDE[s].WR]));   // forearm length is only fully seen when it lies in the camera plane
        const phi0 = s => deg(Math.asin(clamp(ref['lat' + s] / ref['fore' + s], -1, 1)));
        const rot = s => (armRot(pts, s, ref['fore' + s]) - phi0(s)) * (ref.variant === 'ir' ? -1 : 1);   // + = rotating in the trained direction
        const rL = rot('L'), rR = rot('R'); const useL = ref.work ? ref.work === 'L' : stickySide(ref, rL, rR) === 'L'; const s = useL ? 'L' : 'R'; const j = SIDE[s];
        const rotation = useL ? rL : rR;
        const drift = elbowGap(pts, s) / ref['upper' + s] - ref['elGap' + s];                      // elbow moving out from the ribs, in upper-arm lengths
        const shrug = (ref['neck' + s] - dist(pts[j.EAR], pts[j.SH])) / ref.torso;                // shoulder rising toward the ear
        const twist = 1 - dist(pts[11], pts[12]) / ref.shW;                                        // shoulders narrowing in the image = torso turning
        const lean = Math.abs(trunkLean(pts) - ref.lean0);
        const wristDrop = (pts[j.WR].y - pts[j.EL].y) / ref['upper' + s];   /* + = wrist below the elbow (arm straightening), − = wrist above (over-bent); ≈0 at a 90° elbow */
        const elbow = angle(pts[j.SH], pts[j.EL], pts[j.WR]);
        return { p: rotation / ref.rom, rotation, drift, shrug, twist, lean, wristDrop, elbow, useL, side: s, focus: [j.WR, j.EL] };
      },
      faults: [
        { id: 'drift', label: 'Elbow leaving your side', cue: 'Elbow glued to your ribs', tip: 'Once the elbow lifts away from the body the movement becomes a shoulder swing and the rotator cuff stops doing the work. Tuck a folded towel between elbow and ribs and keep it pinned.', weight: 3, persist: 400, cooldown: 4500, phase: 'moving', check: m => m.p > 0.25 && m.drift > 0.22 },
        { id: 'straight', label: 'Elbow opening past 90°', cue: 'Keep the elbow bent at ninety', tip: 'If the elbow straightens the hand swings down and the movement stops being rotation. Forearm level with the floor, elbow at a right angle, for the whole rep.', weight: 2, persist: 500, cooldown: 5000, check: m => m.p > 0.15 && m.wristDrop > 0.45 },
        { id: 'overbent', label: 'Elbow bent past 90°', cue: 'Forearm level — open the elbow to ninety', tip: 'Pulling the hand up toward the chest shortens the lever and shifts the work to the biceps. Keep the forearm parallel to the floor.', weight: 1, persist: 600, cooldown: 6000, check: m => m.p > 0.15 && m.wristDrop < -0.40 },
        { id: 'twist', label: 'Twisting the torso', cue: 'Chest to the camera — rotate the arm, not the body', tip: 'Turning the trunk fakes extra range. Keep both shoulders square to the camera and accept less rotation.', weight: 2, persist: 450, cooldown: 5000, phase: 'moving', check: m => m.p > 0.25 && m.twist > 0.14 },
        { id: 'shrug', label: 'Shrugging', cue: 'Shoulder down, away from your ear', tip: 'When the shoulder creeps up the upper trapezius takes over. Set the shoulder blade down and back before each rep and keep the neck long.', weight: 2, persist: 500, cooldown: 5000, check: m => m.shrug > 0.10 },
        { id: 'lean', label: 'Leaning', cue: 'Stand tall', tip: 'Leaning sideways or back recruits the trunk. Feet hip-width, ribs down, stay upright.', weight: 1, persist: 600, cooldown: 6000, check: m => m.lean > 12 },
        { id: 'shallow', label: 'Not reaching the rotation target', cue: 'Rotate a little further', tip: 'Take the forearm through the full comfortable range each rep; if it is not reachable, lower the target rather than cheat with the elbow.', weight: 1, onRep: true, check: rep => rep.peak < FULL && rep.peak > ATTEMPT },
        { id: 'fast', label: 'Too fast', cue: 'Slower — two seconds out, three back', tip: 'The return against the band is where the cuff works hardest. Two seconds out, brief pause, three seconds back.', weight: 1, onRep: true, check: rep => rep.duration < 2200 },
        { id: 'return', label: 'Not returning fully', cue: 'All the way back to the start', tip: 'Finish each rep back at the start position so the muscle works through its whole range.', weight: 1, onRep: true, check: rep => rep.endP > 0.25 },
      ],
      guide: {
        surface: 'Standing, on a firm floor. Band anchored at elbow height — a door anchor, a railing or a heavy table leg — beside you on the side away from the working arm (external rotation) or on the same side (internal rotation). Light band to start.',
        regions: [
          { name: 'Feet & legs', points: [
            { t: 'Feet hip-width apart, weight even, knees soft. Stand tall; do not brace against the band by leaning.', tracked: true },
          ] },
          { name: 'Trunk & pelvis', points: [
            { t: 'Chest square to the camera for the whole set. The most common cheat is turning the torso to add range: the shoulders narrow in the picture and the coach flags it.', tracked: true },
            { t: 'Ribs down, gentle abdominal brace. No arching the lower back.', tracked: false },
          ] },
          { name: 'Working arm', points: [
            { t: 'Elbow bent to 90° and touching your ribs for the whole rep. A folded towel between elbow and ribs is the classic cue — if it drops, the elbow has drifted.', tracked: true },
            { t: 'External rotation: start with the hand in front of the stomach and rotate the forearm outward like a gate opening; internal rotation: start out to the side and bring the hand to the stomach.', tracked: true },
            { t: 'Wrist straight and firm, in line with the forearm; the band pulls on the hand, not the wrist.', tracked: false },
            { t: 'Rotate to the target angle (45–90°) without the elbow moving; stop where it is comfortable, never into a pinch.', tracked: true },
          ] },
          { name: 'Shoulders & neck', points: [
            { t: 'Both shoulders down and level, away from the ears. The shoulder blade sits back and down before the first rep.', tracked: true },
            { t: 'Neck long, jaw relaxed, eyes on the camera.', tracked: false },
          ] },
          { name: 'Other arm', points: [
            { t: 'Relaxed at your side or resting on your hip. It should not steady the band.', tracked: false },
          ] },
          { name: 'Breathing & tempo', points: [
            { t: 'Breathe out as you rotate against the band, in as you return.', tracked: false },
            { t: '2 s out, brief pause, 3 s back. The slow return is where the rotator cuff works hardest.', tracked: true },
          ] },
        ],
        stop: 'Sharp or pinching pain in the front or top of the shoulder, numbness or tingling down the arm, or pain that does not settle within a few minutes of stopping.',
      },
    };
  });
})(typeof window !== 'undefined' ? window : globalThis);
