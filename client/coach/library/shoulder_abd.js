/* Shoulder abduction (band) — metadata, camera set-up, measurement, faults and guide.
   Registered into the shared exercise library; see docs/EXERCISE-LIBRARY.md. */
(function (root) {
  'use strict';
  const lib = (typeof module !== 'undefined' && module.exports)
    ? require('../exercise-library.js') : root.ExerciseLibrary;

  lib.define((k) => {
    const { SIDE, FULL, ATTEMPT, BAND, angle, armAngle, dist, mid, stickySide, trunkLean } = k;

    return {
      id: 'shoulder_abd', order: 70, upperBody: true, name: 'Shoulder abduction (band)', group: 'Shoulder — rotator cuff', type: 'reps', view: 'front', icon: '🙋', identifyLimb: 'arm',
      summary: 'Straight-arm raise out to the side against a band, to shoulder height — checked for shrugging, leaning, bending the elbow and swinging too high.',
      setup: 'Stand on the band, hold the other end at your side. Face the camera about 2.5 m away, camera at chest height, whole body in frame. Raise the arm straight out to the side, thumb slightly up, no higher than shoulder level, then lower slowly.',
      why: 'From the front the arm swings across the camera plane, so the raise angle, a bending elbow, a rising shoulder and a trunk leaning the other way are all measured directly — the same geometry that makes standing hip abduction easy to track.',
      defaultTarget: 10, targets: [6, 8, 10, 12, 15],
      options: [{ key: 'rom', label: 'Raise target', values: [45, 60, 75, 90], unit: '°', default: 90 }, BAND('yellow')],
      required: [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24],
      calibrate(pts, S, opts) {
        const base = { rom: (opts && opts.rom) || 90, work: (opts && opts.work) || null };
        for (const s of ['L', 'R']) { const j = SIDE[s]; base['arm' + s] = armAngle(pts[j.SH], pts[j.EL]); base['neck' + s] = dist(pts[j.EAR], pts[j.SH]); }   /* raise is read from the upper arm so a bending elbow is flagged, not mis-read as a lower raise */
        base.lean0 = trunkLean(pts); base.torso = Math.max(dist(mid(pts[11], pts[12]), mid(pts[23], pts[24])), 0.05);
        return base;
      },
      measure(pts, S, ref) {
        const rL = armAngle(pts[11], pts[13]) - ref.armL, rR = armAngle(pts[12], pts[14]) - ref.armR;
        const useL = ref.work ? ref.work === 'L' : stickySide(ref, rL, rR) === 'L'; const s = useL ? 'L' : 'R'; const j = SIDE[s]; const raise = useL ? rL : rR;
        const elbow = angle(pts[j.SH], pts[j.EL], pts[j.WR]);
        const shrug = (ref['neck' + s] - dist(pts[j.EAR], pts[j.SH])) / ref.torso;
        const away = Math.sign(pts[useL ? 12 : 11].x - pts[j.SH].x) || 1;                        // image direction from the working shoulder toward the other one
        const leanAway = (trunkLean(pts) - ref.lean0) * away;                                    // + = trunk tipping away from the lifting arm
        const wristAboveShoulder = (pts[j.SH].y - pts[j.WR].y) / ref.torso;
        return { p: raise / ref.rom, raise, elbow, shrug, leanAway, wristAboveShoulder, useL, side: s, focus: [j.WR] };
      },
      faults: [
        { id: 'shrug', label: 'Shrugging', cue: 'Shoulder down — push the hand away, not up', tip: 'If the shoulder rises toward the ear the upper trapezius does the lift. Set the shoulder blade down first; think of reaching the hand toward the wall rather than lifting it.', weight: 3, persist: 400, cooldown: 4500, phase: 'moving', check: m => m.p > 0.3 && m.shrug > 0.09 },
        { id: 'lean', label: 'Leaning away', cue: 'Stay tall — no leaning', tip: 'Tipping the trunk the other way makes the arm look higher without the shoulder working. Keep the torso upright and accept a smaller raise.', weight: 2, persist: 450, cooldown: 5000, phase: 'moving', check: m => m.p > 0.3 && m.leanAway > 10 },
        { id: 'bend', label: 'Elbow bending', cue: 'Keep the arm straight — soft elbow', tip: 'A bending elbow shortens the lever and shifts work to the biceps. Keep a small soft bend and hold it fixed for the whole rep.', weight: 2, persist: 400, cooldown: 5000, phase: 'moving', check: m => m.p > 0.3 && m.elbow < 150 },
        { id: 'high', label: 'Raising above shoulder height', cue: 'Stop at shoulder height', tip: 'Above about 90° the shoulder blade has to rotate and the space under the acromion narrows; for rehab, stop with the hand level with the shoulder.', weight: 2, persist: 300, cooldown: 5000, phase: 'moving', check: m => m.raise > 100 },
        { id: 'shallow', label: 'Not reaching the target', cue: 'A little higher', tip: 'Aim for the raise target without shrugging or leaning; if it hurts before then, lower the target.', weight: 1, onRep: true, check: rep => rep.peak < FULL && rep.peak > ATTEMPT },
        { id: 'fast', label: 'Too fast', cue: 'Slower — two up, pause, three down', tip: 'Swinging the arm lets momentum lift it. Two seconds up, a one-second pause at the top, three seconds down.', weight: 1, onRep: true, check: rep => rep.duration < 2200 },
      ],
      guide: {
        surface: 'Standing on the middle of the band with the foot on the working side (or both feet), holding the other end at your thigh. Firm floor, shoes on so the band cannot slip.',
        regions: [
          { name: 'Feet & legs', points: [
            { t: 'Feet hip-width, knees soft, weight even. The band runs from under the foot straight up to the hand.', tracked: false },
          ] },
          { name: 'Trunk & pelvis', points: [
            { t: 'Stand tall with the trunk still. Leaning the body away from the arm makes the arm look higher without the shoulder working — the coach measures trunk lean against your start position.', tracked: true },
            { t: 'Ribs down, no arching. If you have to lean or swing, the band is too strong.', tracked: false },
          ] },
          { name: 'Working arm', points: [
            { t: 'Arm straight with a soft elbow — set the tiny bend before the first rep and keep it fixed. A bending elbow is flagged.', tracked: true },
            { t: 'Raise straight out to the side, slightly in front of the body line (about 30° forward — the "scapular plane"), thumb pointing slightly up. Palm down with the thumb dropped is harder on the joint.', tracked: false },
            { t: 'Stop at shoulder height (hand level with the shoulder, 90°). Higher than that the shoulder blade has to rotate and the joint is more easily pinched; the coach flags raises past ~100°.', tracked: true },
            { t: 'Lead with the elbow, not the hand; think of pushing the hand toward the far wall rather than lifting it.', tracked: false },
          ] },
          { name: 'Shoulders & neck', points: [
            { t: 'Shoulder blade set down and back before each rep; the shoulder must not rise toward the ear as the arm goes up. This is the fault the coach watches most closely.', tracked: true },
            { t: 'Neck long, chin level, eyes forward.', tracked: false },
          ] },
          { name: 'Other arm', points: [
            { t: 'Hanging relaxed or hand on hip. Do not hold a chair on that side — it invites leaning.', tracked: false },
          ] },
          { name: 'Breathing & tempo', points: [
            { t: 'Breathe out on the way up, in on the way down.', tracked: false },
            { t: '2 s up, 1 s pause at the top, 3 s down. No swinging — every rep starts from a dead stop.', tracked: true },
          ] },
        ],
        stop: 'A sharp catch or "painful arc" partway up, pain on top of the shoulder that lingers after the set, or any pins and needles in the hand.',
      },
    };
  });
})(typeof window !== 'undefined' ? window : globalThis);
