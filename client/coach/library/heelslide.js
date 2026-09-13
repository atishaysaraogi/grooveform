/* Heel slide — metadata, camera set-up, measurement, faults and guide.
   Registered into the shared exercise library; see docs/EXERCISE-LIBRARY.md. */
(function (root) {
  'use strict';
  const lib = (typeof module !== 'undefined' && module.exports)
    ? require('../exercise-library.js') : root.ExerciseLibrary;

  lib.define((k) => {
    const { SIDE, FULL, ATTEMPT, angle, dist, outward, sideJoints } = k;

    return {
      id: 'heelslide', order: 10, vetted: true, tracking: 'form', camera: { height: 'floor', distance: '2 m', posture: 'lying' }, sided: { limb: 'leg', by: 'camera' }, name: 'Heel slide', group: 'Knee range of motion', type: 'reps', view: 'side', icon: '🦵',
      summary: 'Knee flexion range after surgery or injury — measured in degrees, rep by rep.',
      setup: 'Lie on your back on the floor, side-on to the camera at floor level, about 2 m away. The leg you are working should be the one nearest the camera. Start with that leg straight, other leg bent or straight, hips and shoulders flat.',
      why: 'From the side, hip–knee–ankle form a clean triangle in one plane, so knee angle is read directly, and the heel and hip staying on the floor are both visible as height changes.',
      defaultTarget: 10, targets: [6, 8, 10, 12, 15],
      options: [{ key: 'rom', label: 'Flexion target', values: [60, 75, 90, 105, 120], unit: '°', default: 90 }],
      required: [11, 12, 23, 24, 25, 26, 27, 28, 29, 30],
      enterCue: null,
      calibrate(pts, S, opts) {
        const j = sideJoints(pts, S); const shin = Math.max(dist(j.knee, j.ank), 0.03);
        return { kneeRest: Math.max(angle(j.hip, j.knee, j.ank), 160), shin, heel0: j.heel.y, ank0: j.ank.y, hip0: j.hip.y, thigh: Math.max(dist(j.hip, j.knee), 0.03), ear0: j.ear.y, rom: (opts && opts.rom) || 90 };
      },
      measure(pts, S, ref) {
        const j = sideJoints(pts, S);
        const knee = angle(j.hip, j.knee, j.ank);
        const flexion = ref.kneeRest - knee;                                   // degrees bent from straight
        const heelRise = (ref.heel0 - j.heel.y) / ref.shin;                    // + = heel above where it rested
        const hipRise = (ref.hip0 - j.hip.y) / ref.thigh;                      // + = hip lifting off the floor
        // If the knee falls out to the side (toward or away from the camera) the thigh and shin foreshorten in the image.
        // In-plane reps keep the shin ≥ ~0.78 of its calibrated length at peak bend; a leg falling out reads 0.60–0.70.
        const shinRatio = dist(j.knee, j.ank) / ref.shin, thighRatio = dist(j.hip, j.knee) / ref.thigh;
        const legRatio = (dist(j.knee, j.ank) + dist(j.hip, j.knee)) / (ref.shin + ref.thigh);
        const headLift = (ref.ear0 - j.ear.y) / ref.thigh;                    // + = head/ear rising off the floor to watch the knee
        return { p: flexion / ref.rom, knee, flexion, heelRise, hipRise, shinRatio, thighRatio, legRatio, headLift, focus: [SIDE[S].KNEE], side: S };
      },
      faults: [
        { id: 'heel', label: 'Heel lifting off the floor', cue: 'Keep your heel on the floor', tip: 'The heel should slide, not lift. Lifting it turns the movement into a leg raise and loses the knee-bend.', weight: 3, persist: 400, cooldown: 4000, phase: 'moving', check: m => m.p > 0.15 && m.heelRise > 0.12 },
        { id: 'legout', label: 'Knee falling out to the side', cue: 'Knee pointing at the ceiling', tip: 'Keep the knee and toes pointing straight up as you slide, so the bend happens in the knee rather than the leg rolling outward at the hip.', weight: 3, persist: 450, cooldown: 4000, phase: 'moving', check: m => m.flexion > 35 && (m.shinRatio < 0.74 || m.legRatio < 0.80) },
        { id: 'hip', label: 'Hip lifting', cue: 'Keep your hips down', tip: 'Lifting the hip cheats the last few degrees. Keep the pelvis flat and accept the smaller bend for now.', weight: 2, persist: 400, cooldown: 5000, phase: 'moving', check: m => m.p > 0.4 && m.hipRise > 0.15 },
        { id: 'shallow', label: 'Short of the flexion target', cue: 'Slide a little further', tip: 'Ease into the last few degrees on each rep — that is where range is gained. Pain up to mild is expected; sharp pain is not.', weight: 1, onRep: true, check: rep => rep.peak < FULL && rep.peak > ATTEMPT },
        { id: 'fast', label: 'Too fast', cue: 'Slow — hold the bend for a moment', tip: 'Take 2–3 seconds to slide in, hold the bend 2–5 seconds, then 2–3 seconds out.', weight: 1, onRep: true, check: rep => rep.duration < 2500 },
        { id: 'head', label: 'Lifting the head to watch', cue: 'Rest your head down', tip: 'Craning to watch the knee strains the neck and tips the pelvis. The coach is watching the knee for you.', weight: 1, persist: 900, cooldown: 8000, check: m => m.headLift > 0.35 },
        { id: 'return', label: 'Not straightening fully', cue: 'Straighten all the way', tip: 'Full extension at the end of each rep matters as much as flexion.', weight: 1, onRep: true, check: rep => rep.endP > 0.2 },
      ],
      guide: {
        surface: 'Firm floor or exercise mat. Not a bed or sofa: a soft surface swallows the heel and the camera loses it.',
        regions: [
          { name: 'Body position', points: [
            { t: 'Lie flat on your back, legs out straight, the working leg nearest the camera.', tracked: true },
            { t: 'Hips square and level, both buttocks on the floor. The pelvis should not tip toward the working side.', tracked: true },
            { t: 'Lower back relaxed against the floor with its natural small arch — do not force it flat, do not let it arch up.', tracked: false },
          ] },
          { name: 'Working leg & foot', points: [
            { t: 'Heel stays in contact with the floor the whole way; it slides, never lifts. A sock on a smooth floor or a plastic bag under the heel helps it glide.', tracked: true },
            { t: 'Knee and toes point straight at the ceiling throughout. If the knee falls outward the movement rolls into the hip instead of bending the knee.', tracked: true },
            { t: 'Ankle relaxed or gently pulled up toward the shin (dorsiflexed) — do not point the toes.', tracked: false },
            { t: 'Slide until you feel a firm stretch at the front of the knee, hold, then push the heel away until the knee is fully straight and the back of the knee touches the floor.', tracked: true },
          ] },
          { name: 'Other leg', points: [
            { t: 'Straight and relaxed, or bent with the foot flat if that is more comfortable for your back. Keep it still — it should not help.', tracked: false },
          ] },
          { name: 'Arms & hands', points: [
            { t: 'Arms resting on the floor at your sides, palms down. A towel or strap looped around the foot is fine for an assisted slide: pull gently with both hands, elbows on the floor.', tracked: false },
            { t: 'Do not push on the thigh with your hands.', tracked: false },
          ] },
          { name: 'Head & shoulders', points: [
            { t: 'Head resting on the floor or a thin pillow, looking at the ceiling. Do not lift the head to watch the knee — the camera does that for you.', tracked: true },
            { t: 'Shoulders down and relaxed, not shrugged toward the ears.', tracked: false },
          ] },
          { name: 'Breathing & tempo', points: [
            { t: 'Breathe out as the heel slides in, breathe normally during the hold, breathe in as the leg straightens.', tracked: false },
            { t: '2–3 s in, hold 2–5 s at end range, 2–3 s out. Slower is better after surgery.', tracked: true },
          ] },
        ],
        stop: 'Sharp pain, a sudden increase in swelling, or if the knee feels like it locks or gives way.',
      },
    };
  });
})(typeof window !== 'undefined' ? window : globalThis);
