# Adding a move: what I need from a physiotherapist

This is the intake for putting a new exercise into the camera coach. It is written for a PT to work through with someone from the build side, and it is deliberately blunt about the two things that decide whether a move can ship: **is it visible to one camera**, and **can every fault be written as a number**.

Budget per exercise: about 25 minutes of the PT's time — ten minutes on the form, ten on the recording, five reviewing the result a week later. Ten moves is an afternoon.

> **This intake now has a tool.** `/studio/` on the site walks a physio through these same steps with the camera on: it records takes, plots the measurements, and shows each fault threshold firing (or not) on the recordings before the move is exported. `docs/STUDIO.md` is the session runbook. This document remains the reasoning behind each field.

---

## 0. First: the screening test

Most exercises in a home programme cannot be coached by a phone camera. Screening first saves everyone from speccing a move that will be thrown away. Six questions, and a "no" to any of the first four is a rejection.

1. **Is the movement big?** The joint angle changes by more than about 15°, or a landmark travels more than about 5 cm. Scapular retraction is 2 cm of shoulder-blade travel — below the noise floor of the pose model, and it will not work.
2. **Does it happen across the camera, not toward it?** A leg swinging sideways in front of the lens is measurable. An arm pushing straight forward is not — it just gets shorter in the picture.
3. **From one camera position, can you see the joints that matter?** Face-down exercises hide the arms under the body. Anything facing a wall puts the working side away from the lens.
4. **Can a person set that camera up at home?** Floor level, hip height on a shelf, chest height on a stand — all fine. "Directly overhead" or "two metres up a wall" is not.
5. **Does the failure mode show as geometry?** "Not bracing" is invisible. "Hips sagging" is a measurable offset from a line.
6. **Would the coaching actually help?** Some moves people do correctly by default; the cueing adds noise. Say so and we skip it.

If a move fails screening but matters clinically, it can still go in the library as an untracked timer with a written guide — the app just counts the hold and says nothing about form. That is honest and sometimes right. Mark it that way rather than pretending.

---

## 1. What kind of move is it?

The engine handles several patterns, and each needs different inputs. Name the type first, because it decides the rest of the form.

| Type | Example already built | What defines a "unit" | What the coach measures |
|---|---|---|---|
| **A · Rep with a range target** | heel slide, shoulder abduction | one out-and-back cycle | a joint angle from a start value to a target |
| **B · Timed hold in a position** | wall sit, plank | seconds inside a position window | whether the body is still in the window |
| **C · Stretch** | calf stretch, upper trap stretch | seconds at a stretch position | the anchor that must not move, more than the stretch itself |
| **D · Unilateral** | hip abduction, shoulder rotation | a rep on a named side | as A or B, plus which side is working |
| **E · Isometric with no movement** | quad sets, neck isometrics | seconds | nothing — camera cannot see a contraction |
| **F · Balance / proprioception** | not built yet | seconds upright | sway of the hips, correction count, foot lifts |
| **G · Functional cycle** | not built yet (sit-to-stand, step-ups) | one cycle through phases | phase transitions, not a single angle |

Types A–D are the ones to bring first; they are what the engine does well today. Type E should be flagged as a timer with no form checking. F and G each need one engine change, so batch them — tell us they are coming rather than filing them one at a time.

---

## 2. The core of it: one number that says "how far through the movement am I"

This is the single most important input, and the one PTs most often skip. For every rep or hold, I need **one measurement, between named body points, with a start value and a finish value.**

Good: *"Knee flexion, measured hip–knee–ankle. Starts at 180° lying flat. Target is 90° by week two."*
Also good: *"Upper arm angle from hanging straight down, measured shoulder-to-elbow. Starts at 0°, finishes at 90° — level with the shoulder, not higher."*
Not usable: *"Until they feel a stretch."* *"Through full range."* *"As far as comfortable."*

Two details that have already bitten us:

**Measure from the segment that defines the movement, not the end of the limb.** Shoulder abduction was originally read shoulder-to-wrist. Someone bending the elbow then registered as a *smaller* raise, so the app quietly praised a worse rep. Reading shoulder-to-elbow instead made the bend a separate, nameable fault.

**Say what the start position is, and what the person does for two seconds so we can measure it.** Every set begins with a calibration frame: the person holds still and we record their baseline. Tell me what that pose is — "lying flat, leg straight" or "standing tall, arms at sides" — because every later measurement is a change from it.

---

## 3. Faults: each one needs a number

For every fault, six things. The first three are the ones that get skipped and the ones that matter.

| Field | Question to answer | Example |
|---|---|---|
| **Where it shows** | Which body points would you watch? | the shoulder rising toward the ear |
| **How much is too much** | A number, in degrees or in body-segment lengths | more than about a tenth of the torso length |
| **When it counts** | Only while moving? Only at the top? Any time? | only past a third of the way up |
| **How long you'd wait** | Before you would say something out loud | about half a second of it |
| **How bad** | 3 = ruins or endangers the exercise · 2 = meaningfully wrong · 1 = worth mentioning | 3 |
| **What you'd say** | Six words maximum — it is spoken mid-rep | "Shoulder down, push the hand away" |
| **Why it matters** | One sentence, shown afterwards in the recap | "If the shoulder rises the upper trap does the lift instead of the cuff." |

Also flag, per fault: **does it invalidate the rep** (not counted) or just earn a cue?

And name **the one fault that matters most** — the thing that, if wrong, makes the exercise pointless or unsafe. It gets cue priority over everything else, because only one thing can be said at a time.

### Where thresholds actually come from

Most PTs cannot give a number cold, and should not guess. Say "I don't know, but I know it when I see it" — then we get it from the recording session in section 4. This is not a formality:

On standing hip abduction I wrote a hip-hiking rule from the textbook description. In the real recordings, the pelvis tilted with *every* raise, clean or not — roughly 0.4° of tilt per degree of abduction, the same on reps the user rated as fine and on deliberately exaggerated ones. The rule fired constantly on good reps. The number from the page was worse than useless; the number from the data worked.

So: thresholds come from recordings. The form captures your judgement of *what* is wrong and *how much it matters*. The recording tells us *where the line sits*.

---

## 4. The recording session

Per exercise, about ten minutes with a phone. The app exports every set as a diagnostics file (joint positions per frame, no video) — that file is what tunes the thresholds.

Record, in this order:

- **Three to five clean reps**, at the tempo you would want. This is also the reference rep for the demo animation.
- **Each fault, deliberately exaggerated**, three reps each. Obvious enough that nobody would disagree it is wrong.
- **Each fault, borderline** — the version you would let go without comment. This is the most valuable recording of the lot, because the threshold has to sit between "borderline" and "exaggerated", and nothing else tells us where that is.
- **Both sides**, for anything unilateral.
- **One awkward setup** — camera too low, or the person a bit too close, or wearing loose clothing. It shows us how the tracking degrades.

Practical notes: fitted clothing, plain floor, decent daylight, whole body in frame. Two people is faster than one (one moves, one watches the screen and labels the takes). Label each take out loud at the start — "clean, rep one" — so the files can be matched up afterwards.

If a second body type is available, a second person doing the same set is worth a lot; every threshold expressed as a fraction of a limb length should hold across builds, and that is the cheapest way to check.

---

## 5. Set-up and the written guide

The camera checks maybe six things. The written guide has to carry the rest, and it is what the person reads before their first attempt. I need it by body region, and I need you to mark each line **camera** or **self-check** — we show that distinction in the app, because a guide that implies the camera is watching your foot rotation when it is not is a lie.

Regions to cover, as relevant: feet and stance · the working limb · hips and pelvis · back and trunk · shoulders, arms and hands · head and gaze · breathing and tempo.

Also needed:

- **Surface and equipment.** Mat, wall, chair, band. If a band: which colours are sensible starting points, and when to move up.
- **Camera position** in plain words — height, distance, which way the person faces.
- **What you cannot see from there.** A required field, not an optional one. Foot rotation, weight distribution, breath-holding, whether it hurts. Whatever the camera misses becomes a self-check line in the guide.

---

## 6. Dosage, progression, safety

- **Starting dose** and the range of sensible options: reps, sets, hold seconds, rest between sets.
- **Tempo** as three numbers: out, hold, back. ("Two seconds up, one at the top, three down.") The engine flags reps faster than the floor you set.
- **Progression** — what changes first when it gets easy: more range, more reps, a heavier band, a harder variation? Give the ladder.
- **Regression** — the easier version for someone who cannot do this one, if there is one.
- **Stop signals** — what should make a person stop immediately, in the words a non-clinician would recognise. This is shown on every exercise page.
- **Who should not do this**, and what is expected discomfort versus what is not. We do not ask users for a pain score; the app records effort instead, and we deliberately collect no conditions or diagnoses.

A note on framing, which affects how you write all of this: the app is a consumer fitness tool, not a medical service. The copy says so, we collect no clinical data, and cues are general guidance. Write the guides as a knowledgeable coach would speak, not as a treatment plan — no diagnoses, no "this will fix your X".

---

## 7. Things to note that are easy to forget

- **Which muscles do the work** — primary and assisting, in plain groups (shoulder, upper back, front of thigh). The figure on the exercise page warms those regions as the movement progresses. It is a teaching picture driven by the movement, not a measurement, and should never carry a percentage.
- **Which side is working**, and how a person indicates it. We currently ask them to lift the limb they are about to work; say if that is wrong for a given move.
- **Common substitutions you see in clinic** that are not on anyone's fault list. These are usually the most valuable lines on the whole form.
- **What people get wrong when nobody is watching** — different from what they do in front of you, and that is precisely the case the app is for.
- **Names.** A consumer name and a clinical name. In the app a person sees "shoulder" and "side of the neck"; the clinical names are kept for the curator's view, where another PT is reading.
- **Anything post-operative** — protocol range limits by week, so a target cannot be set past what a surgeon allows.

---

## 8. What I do not need

Literature reviews, EMG data, muscle activation percentages, anatomical diagrams, or a video from the internet of someone else doing it. If a claim in the guide needs a source I will find it and show you the wording for checking.

---

## 9. What happens after, and how you check it

1. I write the rules and the guide from the form, and tune the thresholds against the recordings.
2. I replay your recordings through the finished engine and send you the result: for every take, which faults fired and when. You are checking one thing — **would you have said the same thing, at the same moment?**
3. Anything that fires on a clean take or stays silent on an exaggerated one comes back to me with a threshold change.
4. Ship when a clean take draws no cues, every exaggerated fault is caught, and the borderline takes fall where you want them.

That last line is the acceptance test. An exercise is not finished because the code runs; it is finished when the PT agrees with what the app said.

---

## Appendix A — blank form

```
MOVE
  Consumer name / clinical name:
  Type (A rep · B hold · C stretch · D unilateral · E untracked timer · F balance · G cycle):
  One line, what it is for:
  Conditions it is commonly given for:

SCREENING
  Movement size (degrees or cm):
  Plane (across the camera / toward it):
  Camera position a person can set up at home:
  Anything hidden from there:

MEASUREMENT
  Progress measured as:            (joint angle, between which points)
  Start value:                     End / target value:
  Target options to offer:
  Calibration pose (held 2 s at the start):
  For holds — the position window (from … to …):

FAULTS  (repeat per fault; mark the primary one)
  Name:
  Where it shows:
  Too much is:                     (number, or "from recordings")
  Applies when:                    (moving / at the end / any time)
  Wait before cueing:
  Severity 1–3:
  Spoken cue (≤6 words):
  Recap tip (one sentence):
  Invalidates the rep? y/n

DOSE
  Reps / sets / hold / rest:       Tempo out-hold-back:
  Progression ladder:              Regression:

GUIDE  (per region: feet · working limb · hips · trunk · shoulders & arms · head · breathing)
  … each line marked CAMERA or SELF-CHECK
  Surface / equipment:
  Stop if:
  Not suitable for:

NOTES
  Muscles — primary / assisting:
  Common substitutions seen in clinic:
  What people do wrong unsupervised:
  Post-op range limits, if any:
```

## Appendix B — a filled-in example

The shortened version of what shoulder abduction with a band looked like when it went in.

```
MOVE      Shoulder raise to the side (band) / standing shoulder abduction, banded
          Type D (unilateral rep). Rotator cuff and deltoid strength through the painful arc.
          Given for: impingement, cuff tendinopathy, post-op cuff once cleared.

SCREENING 0–90° of arm travel, across the camera, facing it at chest height, 2 m.
          Hidden: how far forward of the body the arm drifts.

MEASURE   Upper-arm angle from hanging, shoulder→elbow. Start 0°, target 90° (45/60/75/90 offered).
          Calibration: standing tall, arms at sides, 2 s.

FAULTS    ① Shrugging — PRIMARY. Ear-to-shoulder distance shrinking by more than a tenth of torso
            length, once past a third of the way up. Wait ~0.4 s. Severity 3.
            Cue "Shoulder down, push the hand away."
            Tip: if the shoulder rises the upper trap takes the lift instead of the cuff.
          ② Leaning away — trunk tips more than 10° from its start, past a third of the way up.
            Severity 2. Cue "Stay tall, no leaning."
          ③ Elbow bending — elbow angle under 150° while raising. Severity 2.
            Cue "Keep the arm straight, soft elbow."
          ④ Going above shoulder height — past ~100°. Severity 2. Cue "Stop at shoulder height."
          ⑤ Short of target / too fast — on rep close. Severity 1.

DOSE      10 reps, 2 sets, 45 s rest. Tempo 2 up, 1 hold, 3 down. Yellow band to start.
          Progress: colour first, then reps. Regress: no band.

GUIDE     Stance SELF-CHECK feet hip-width, band under the working-side foot.
          Working arm CAMERA soft elbow held fixed · CAMERA stop level with the shoulder ·
            SELF-CHECK thumb slightly up, arm a little forward of the body line.
          Shoulders CAMERA blade set down before each rep, must not rise.
          Trunk CAMERA upright, no lean · SELF-CHECK ribs down.
          Stop if: a sharp catch partway up, pain on top of the shoulder that lingers, pins and needles.

NOTES     Muscles: shoulder primary; forearm and upper back assisting.
          Substitution seen in clinic: hips swing to throw the arm up on the last two reps.
          Cannot see: arm drifting forward, thumb rotation, band tension.
```
