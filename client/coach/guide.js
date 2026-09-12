/* ============================================================
   Position guides — full-body set-up and form detail for each
   exercise. `tracked: true` = the camera checks it; otherwise it
   is a self-check the app can only instruct.
   Rendered on the setup page and exported to the library.
   ============================================================ */
(function (root) {
  const GUIDES = {
    heelslide: {
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
    hipabd: {
      surface: 'Standing on a firm floor, barefoot or in flat shoes. A chair back, counter or wall within reach of one hand.',
      regions: [
        { name: 'Stance & feet', points: [
          { t: 'Stand tall on the standing leg, weight through the middle of the foot, knee straight but not locked back.', tracked: true },
          { t: 'Both feet point straight ahead. As the leg lifts the working foot stays pointing forward — toes do not turn up to the ceiling. Turning the foot out switches the work to the hip flexors.', tracked: false },
          { t: 'Working leg lifts straight out to the side, in line with the body, not drifting forward.', tracked: false },
        ] },
        { name: 'Working leg', points: [
          { t: 'Knee straight throughout; lead with the heel.', tracked: true },
          { t: 'To add load, loop a resistance band around both ankles (start yellow/light; move up a colour when 15 clean reps are easy). The band must not pull the standing leg over — if it does, go lighter.', tracked: false },
          { t: 'Raise to 25–35°: about 30–40 cm off the floor for most people. Higher than this the pelvis has to tilt.', tracked: true },
          { t: 'Lower under control to just above the floor, then lift again without resting the foot.', tracked: true },
        ] },
        { name: 'Hips & pelvis', points: [
          { t: 'Pelvis level and facing forward. Imagine a glass of water balanced on each hip bone.', tracked: true },
          { t: 'No sway or hitch: the hip of the working leg should not pop up as the leg lifts.', tracked: true },
        ] },
        { name: 'Back & trunk', points: [
          { t: 'Torso upright and still; ribs stacked over the pelvis. Leaning the trunk away makes the leg look higher without the glute doing more.', tracked: true },
          { t: 'Gently brace the abdominals as if about to be nudged.', tracked: false },
        ] },
        { name: 'Shoulders, arms & hands', points: [
          { t: 'Fingertips of one hand resting lightly on the support — for balance only, not weight. Gripping and leaning on it hides trunk lean and takes load off the glute.', tracked: false },
          { t: 'Other hand on the hip (to feel the pelvis stay level) or hanging relaxed.', tracked: false },
          { t: 'Shoulders level and down.', tracked: false },
        ] },
        { name: 'Head', points: [
          { t: 'Eyes forward at the camera, chin level. Looking down at the leg tips the trunk.', tracked: false },
        ] },
        { name: 'Breathing & tempo', points: [
          { t: 'Breathe out as the leg lifts, in as it lowers.', tracked: false },
          { t: '2 s up, brief pause, 2 s down. No swinging.', tracked: true },
        ] },
      ],
      stop: 'Pinching at the front of the hip, low-back pain, or you cannot keep balance without gripping the support.',
    },
    wallsit: {
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
    plank: {
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
    calfstretch: {
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
    /* ================= Shoulder & neck ================= */
    shoulder_er: {
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
    shoulder_abd: {
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
    band_row: {
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
    pullapart: {
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
    trapstretch: {
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
  if (typeof module !== 'undefined' && module.exports) module.exports = GUIDES; else root.FormGuides = GUIDES;
})(typeof window !== 'undefined' ? window : globalThis);
