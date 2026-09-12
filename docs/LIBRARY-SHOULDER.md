# Fyzio exercise library — shoulder & neck (exercises 6–10)

Companion to the five-exercise library. These five were picked from two shoulder home-exercise handouts (HEP2go / HEP.video programmes, 30 exercises between them) using the same test as before: one camera, a large joint movement in the camera plane, faults that show up as geometry the pose model can measure. The same conventions apply (landmark indices, `p`, persist/cooldown, calibration after 1.2 s of stillness). Each move — rules, faults and position guide — is one file in `client/coach/library/` (see [EXERCISE-LIBRARY.md](EXERCISE-LIBRARY.md)).

## Screening the handouts

| Handout exercise | Verdict | Why |
|---|---|---|
| Band shoulder external rotation (standing, elbow at side) | **built** (`shoulder_er`, ER variant) | forearm swings across the frontal plane; elbow drift, shrug and torso twist all visible |
| Band shoulder internal rotation | **built** (`shoulder_er`, IR variant) | identical geometry, mirrored direction |
| Band shoulder abduction (straight arm, to the side) | **built** (`shoulder_abd`) | same geometry as standing hip abduction, for the arm |
| Band rows | **built** (`band_row`, side view) | elbow behind the torso line, shrug and lean-back are plain side-on |
| Band bilateral horizontal abduction (pull-apart) | **built** (`pullapart`) | arms open into a T in the camera plane |
| Upper trapezius stretch (hand behind back) | **built** (`trapstretch`) | head roll vs pelvis line, shoulder rise and head turn measurable with ears/nose |
| Band bilateral shoulder extension | not now | from the front the arms move toward the camera; side view shows only one arm and the band anchor blocks it |
| Scapular retractions (no band) | no | a few centimetres of shoulder-blade travel — below the model's noise floor |
| Serratus wall slide | no | facing the wall, back to the camera; forearms hidden |
| Side-lying ER with weight | no | movement toward the camera from any practical placement; floor occlusion |
| Ball on wall circles | no | small hand circles, nothing measurable |
| Prone Y / T / W | no | face down; arms partly under the body from a floor camera |
| Plank plus | later | the plank exists; the "plus" is 5 cm of protraction — too small |
| D2 diagonal (flex-abd) | later | trackable front-on (hand path from opposite hip to overhead), but the band anchor and the crossing arm need a real recording before rules are set |
| Chin tucks, cervical extension with towel, isometric neck, suboccipital, levator, deep neck flexor stretch | later | head-on-neck movements of 1–3 cm; possible with the face-mesh model, not the 33-point body model |
| Band head retraction (seated, plank) | no | as above, plus the band across the face hides landmarks |

Sources used for form and faults are listed at the end.

---

## 6. Standing shoulder rotation with a band (`shoulder_er`)

**Group:** rotator cuff. **Pattern:** reps, per arm, with a rotation target (45 / 60 / 75 / 90°) and a direction (external / internal). **View:** facing the camera, camera at chest height, ~2 m. Before the countdown the app asks you to lift the arm you'll be working, then lower it, to fix the working side.

### Purpose
The standard rotator-cuff strengthening exercise after impingement, cuff tendinopathy, post-op cuff repair (once cleared) and for shoulder instability; internal rotation is prescribed alongside to balance the pair.

### What good form looks like (from the sources)
- Elbow bent to 90° and **glued to the side** for the whole rep — "the most important rule"; once it drifts "the rotator cuff is no longer the primary driver". A folded towel between elbow and ribs is the classic cue.
- Rotate the forearm outward (ER) or inward (IR) through a comfortable range; do not force end range.
- Shoulders down and level; no shrugging, no rolling forward.
- Torso square — turning the trunk "fakes range".
- Wrist straight, in line with the forearm.
- Tempo 2 s out, 2–3 s controlled return.

### Measurement
- Calibration: for each arm, upper-arm length (shoulder→elbow, in-plane when the elbow hangs at the side), the elbow's lateral offset from the shoulder, the wrist's lateral offset from the elbow (the start rotation), ear→shoulder distance; shoulder width; trunk lean.
- **Forearm length problem:** with the elbow at the side the forearm points at the camera for most of the rep, so its image length is `true length × |sin(rotation)|` and the true length is never directly visible. The engine uses `max(observed forearm, 0.85 × upper arm)`. Rotation = `asin(lateral wrist offset ÷ forearm)`, measured from the calibrated start; sign flipped for the IR variant so `p` always rises in the trained direction. `p = rotation ÷ target`.
- `drift` = elbow's lateral offset from the shoulder, in upper-arm lengths, minus calibration. `shrug` = shrink of ear→shoulder distance ÷ torso length. `twist` = 1 − shoulder width ÷ calibrated. `lean` = |trunk lean − baseline|.

### Faults

| Fault | Rule | Cue | Persist / cooldown | Weight |
|---|---|---|---|---|
| Elbow leaving your side | p > 0.25 and drift > 0.22 upper-arm lengths | "Elbow glued to your ribs" | 400 ms / 4.5 s | 3 |
| Twisting the torso | p > 0.25 and twist > 0.14 | "Chest to the camera — rotate the arm, not the body" | 450 ms / 5 s | 2 |
| Shrugging | shrug > 0.10 | "Shoulder down, away from your ear" | 500 ms / 5 s | 2 |
| Leaning | lean > 12° | "Stand tall" | 600 ms / 6 s | 1 |
| Not reaching the rotation target | rep peak 0.32–0.85 | "Rotate a little further" | on rep | 1 |
| Too fast | rep < 2.2 s | "Slower — two seconds out, three back" | on rep | 1 |
| Not returning fully | end-of-rep p > 0.25 | "All the way back to the start" | on rep | 1 |

### What it cannot see
Elbow lifting *forward* (toward the camera) — only lateral drift is measured; the towel cue covers it. Wrist bending. Band tension. Rotation past ±90° saturates the asin (irrelevant at rehab ranges).

---

## 7. Shoulder abduction with a band (`shoulder_abd`)

**Group:** rotator cuff / deltoid. **Pattern:** reps, per arm, raise target 45 / 60 / 75 / 90°. **View:** facing the camera, chest height, ~2.5 m, whole body in frame. Arm identified by lifting it before the countdown.

### Purpose
Supraspinatus/deltoid strengthening through the painful-arc range for impingement and cuff rehab, and the general "lateral raise" pattern. The handout prescribes straight-arm abduction to the side; the sources add the scapular-plane and thumb-up refinements.

### What good form looks like (from the sources)
- Stop at shoulder height (90°): higher "shifts work to the trapezius and increases impingement risk".
- Shoulders away from the ears — "the second you shrug, your traps steal the rep"; think of pushing the hand away rather than lifting it.
- Fixed soft elbow bend, set before the first rep. Locked-straight or bending elbows both flagged by coaches.
- No leaning or hip thrust; every rep from a dead stop. Tempo 2 s up, 1 s pause, 2–3 s down.
- Thumb up / arm slightly forward of the body line (scapular plane) is easier on the joint — not measurable, taught in the guide.

### Measurement
- Raise is read from the **upper arm** (shoulder→elbow angle from hanging, 0–180°), not shoulder→wrist, so a bending elbow is reported as a fault rather than as a lower raise. `p = raise ÷ target`. Baseline arm angle, ear→shoulder distance and trunk lean are captured at calibration.
- `elbow` = angle(shoulder, elbow, wrist). `shrug` as above. `leanAway` = trunk-lean change signed toward the other shoulder (positive = tipping away from the lifting arm), sign-safe whichever side of the image the arm is on.

### Faults

| Fault | Rule | Cue | Persist / cooldown | Weight |
|---|---|---|---|---|
| Shrugging | p > 0.3 and shrug > 0.09 | "Shoulder down — push the hand away, not up" | 400 ms / 4.5 s | 3 |
| Leaning away | p > 0.3 and leanAway > 10° | "Stay tall — no leaning" | 450 ms / 5 s | 2 |
| Elbow bending | p > 0.3 and elbow < 150° | "Keep the arm straight — soft elbow" | 400 ms / 5 s | 2 |
| Raising above shoulder height | raise > 100° | "Stop at shoulder height" | 300 ms / 5 s | 2 |
| Not reaching the target | rep peak 0.32–0.85 | "A little higher" | on rep | 1 |
| Too fast | rep < 2.2 s | "Slower — two up, pause, three down" | on rep | 1 |

### What it cannot see
Arm drifting forward of the body (toward the camera) — foreshortening could catch a large drift but is not used yet; thumb orientation; band tension.

---

## 8. Band rows (`band_row`)

**Group:** scapula and mid-back. **Pattern:** reps. **View:** side-on, chest height, ~2.5 m, anchor in front of the person. The near arm is tracked (the far one is hidden behind the body).

### What good form looks like (from the sources)
- "Stand like you are holding a plank": trunk still, ribs down; leaning back or hip shift is the main cheat and means the band is too strong.
- Elbows driven straight back past the ribs and kept close — flared elbows shift the load off rhomboids/mid-trap and onto the neck.
- Shoulder blades squeezed together and **down**; shrugging is the second cheat.
- Full range: arms long at the start, elbows behind the torso at the end; controlled return, never letting the band snap.

### Measurement
- Calibration (arms straight toward the anchor): upper-arm length, image direction toward the anchor (`dir`), the elbow's position along that axis relative to the shoulder (`eb0`, negative = ahead), ear→shoulder distance, trunk lean.
- `elbowBack` = (elbow − shoulder) along the anchor axis, in upper-arm lengths, positive behind the shoulder. `p = (elbowBack − eb0) ÷ (0.45 − eb0)` — full rep when the elbow is ~half an upper arm behind the shoulder line.
- `leanBack` = trunk-lean change away from the anchor. `elbowHigh` = (shoulder.y − elbow.y) ÷ upper arm, positive when the elbow is above the shoulder.

### Faults

| Fault | Rule | Cue | Persist / cooldown | Weight |
|---|---|---|---|---|
| Shrugging | p > 0.3 and shrug > 0.09 | "Shoulders down as you pull" | 400 ms / 4.5 s | 3 |
| Leaning back | p > 0.3 and leanBack > 8° | "Stand tall — pull with the arms, not the body" | 450 ms / 5 s | 2 |
| Elbows flaring up | p > 0.4 and elbowHigh > −0.15 (elbow within 0.15 upper-arm lengths of shoulder height or above) | "Elbows down, close to your ribs" | 400 ms / 5 s | 2 |
| Not pulling all the way back | rep peak 0.32–0.85 | "Elbows further back — squeeze the blades" | on rep | 1 |
| Too fast | rep < 2.2 s | "Slower — pause at the back" | on rep | 1 |
| Not letting the arms straighten | end-of-rep p > 0.3 | "Let the arms reach forward fully" | on rep | 1 |

### What it cannot see
The far arm doing something different; elbows flaring *outward* (away from the body sideways — that is toward/away from the camera side-on; only upward flare is measured); grip and wrist.

---

## 9. Band pull-apart (`pullapart`)

**Group:** scapula / posterior shoulder. **Pattern:** reps. **View:** facing the camera, chest height, ~2.5 m.

### What good form looks like (from the sources)
- Arms held at shoulder height, "arms long" with a tiny soft bend held fixed; bending the elbows "turns it into a row" and loses the rear deltoid.
- Start the rep by sliding the shoulder blades back, then let the hands follow; squeeze at the end without shrugging, leaning back or craning the neck.
- Band to the chest, pause, slow 3–4 s return. Ribs down, no flare.

### Measurement
- At the start the arms point at the camera, so their length cannot be read; the engine estimates arm length as 1.15 × torso (shoulder-mid → hip-mid). `p = (hand span − start span) ÷ (shoulder width + 2 × 0.92 × arm − start span)`.
- `elbow` = the smaller of the two elbow angles. `shrug` = mean ear→shoulder shrink ÷ torso. `handDrop` = mean wrist height below the shoulder line ÷ torso (negative = above).

### Faults

| Fault | Rule | Cue | Persist / cooldown | Weight |
|---|---|---|---|---|
| Elbows bending | p > 0.45 and elbow < 150° | "Arms long — pull with the shoulder blades" | 400 ms / 4.5 s | 3 |
| Shrugging | shrug > 0.09 | "Long neck — shoulders down" | 450 ms / 5 s | 2 |
| Hands dropping below shoulder height | p > 0.4 and handDrop > 0.28 | "Keep the band at shoulder height" | 500 ms / 5 s | 2 |
| Hands rising above shoulder height | p > 0.4 and handDrop < −0.28 | "Bring the band down to shoulder height" | 500 ms / 5 s | 1 |
| Not pulling all the way apart | rep peak 0.32–0.85 | "All the way — band to the chest" | on rep | 1 |
| Too fast | rep < 2.2 s | "Slower — pause with the band on your chest" | on rep | 1 |

### What it cannot see
Leaning back and rib flare (toward-camera movement); grip width; whether the band actually touched the chest (the span rule is a proxy).

---

## 10. Upper trapezius stretch (`trapstretch`)

**Group:** neck. **Pattern:** timed hold per side, 15 / 20 / 30 / 45 s. **View:** facing the camera, chest height, ~1.5 m so the head is large in frame.

### What good form looks like (from the sources)
- Sit or stand tall, chin tucked, ear toward the opposite shoulder; eyes and nose keep pointing forward — tilt, do not turn.
- The stretched-side shoulder must stay down: hand behind the back, or sit on it, or hold the chair. Letting "the shoulder girdle elevate on the side being stretched" is the named compensation.
- Gentle: start slowly, no forcing; 15–30 s holds. The Prehab Guys note that perceived trap tightness is usually weakness — pair the stretch with rows and pull-aparts (which is why the prebuilt "Shoulder & neck reset" routine does).

### Measurement
- `headTilt` = roll of the ear line relative to the **pelvis** line (not the shoulder line, so a rising shoulder cannot mask the tilt); sign-safe whichever way the ears sit in the image. Stretched side = the side whose ear goes *up* (right ear down → left trapezius); may be fixed by the routine's `side` option.
- `inPosition` = |tilt − baseline| ≥ 18°. The timer runs only while in position.
- `shoulderUp` = ear→shoulder shrink on the stretched side ÷ torso, plus any rise of that shoulder against the shoulder line. `noseOff` = nose's horizontal offset from the ear midpoint ÷ ear span. `handUp` = stretched-side wrist height above the hip ÷ torso.

### Faults

| Fault | Rule | Cue | Persist / cooldown | Weight |
|---|---|---|---|---|
| Stretched shoulder creeping up | in position and shoulderUp > 0.10 | "Keep that shoulder down" | 700 ms / 5 s | 3 |
| Turning the head | in position and noseOff > 0.25 | "Nose forward — tilt, don't turn" | 800 ms / 6 s | 2 |
| Hand not behind the back | in position and handUp > 0.25 | "Put the hand behind your back" | 1.2 s / 8 s | 1 |
| Not tilting enough | tilted 6–18° | "Ear a little closer to the shoulder" | 2.5 s / 8 s | 1 |

### What it cannot see
Chin tuck (a few centimetres, toward the camera); forward bend toward the armpit; how hard the resting hand is pulling.

---

## Resistance bands

Every band exercise (and standing hip abduction, with the band around the ankles) has a `band` option using the standard TheraBand colour scale — none, tan (extra light), yellow (light), red (medium), green (heavy), blue (extra heavy), black (special heavy). Defaults: yellow for rotation, abduction and pull-apart; red for rows; none for hip abduction. The colour is shown as a swatch on the chip, in routine summaries, in the live HUD and is stored with every saved set, so progress across colours is visible in history. The engine's rules do not change with the band: form thresholds are the same at any load, which is the point — a heavier band that produces shrugging or elbow drift is flagged and the user should go down a colour.

## Validation status

All five have synthetic-pose unit tests (`test/engine.test.js`: rep counts, partials, and each fault firing on a deliberately faulty rep and staying silent on clean ones) and the browser suite runs a full coached abduction set with arm identification. None has been tuned on a real recording yet — as with the first five, record 3–5 sessions per exercise (clean form plus each deliberate fault), export the diagnostics JSON from the app, and replay them to set the thresholds. The two most likely to need tuning: the ER forearm-length estimate (0.85 × upper arm) and the pull-apart arm-length estimate (1.15 × torso).

## Sources consulted

- [Banded Shoulder External Rotation — Sporty Doctor](https://sportydoctor.com/exercises/banded-shoulder-external-rotation/)
- [Band External Rotation: rotator cuff — Bodybuilding Wizard](https://bodybuilding-wizard.com/band-external-rotation-rotator-cuff/)
- [Rotator Cuff Exercises: form, reps and common mistakes — Meglio](https://mymeglio.com/blogs/blog/rotator-cuff-exercises)
- [Rotator cuff exercises — Sports Injury Clinic](https://www.sportsinjuryclinic.net/rehabilitation-exercises/rotator-cuff-exercises)
- [How to do lateral raises: form, mistakes — FitCraft](https://getfitcraft.com/exercises/lateral-raises)
- [Banded shoulder exercises for rehab — RESPORT Chicago](https://resportchicago.com/resources/physical-therapy/the-3-most-effective-banded-shoulder-exercises/)
- [Resistance band rows — OTF Workout Today](https://otfworkouttoday.com/workouts/resistance-band-rows/)
- [How to do resistance band pull-aparts — Gymreapers](https://www.gymreapers.com/blogs/news/how-to-do-resistance-band-pull-aparts)
- [Band pull aparts: form and mistakes — FitCraft](https://getfitcraft.com/exercises/pull-apart)
- [Trapezius stretches — Shoulder Pain Explained](https://www.shoulder-pain-explained.com/trapezius-stretches.html)
- [Tight upper traps: setting the record straight — The Prehab Guys](https://theprehabguys.com/the-truth-behind-tight-upper-traps/)
