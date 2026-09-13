# Grooveform Studio — building moves with a physio

`/studio/` is the authoring tool. It lives next to the app (same engine, same
pose model, same move library) and runs entirely in the browser, so it works on
GitHub Pages and on a laptop with no server. A physio and one person from the
build side sit down with it, and a move that survives the session comes out as
a file that drops straight into `client/coach/library/`.

It is the executable version of `docs/PT-INTAKE.md`. Read that first for the
*why*; this is the *how*.

## What comes out

For each move:

- **`<id>.js`** — the move file. It carries no code, only a spec: measurements as
  named landmarks, a start/target pair for progress, each fault as a metric, a
  comparison and a threshold. `coach/spec.js` compiles it into exactly the shape
  the hand-written moves have, so the app cannot tell the difference.
- **The demo figure** — two keyframes lifted out of the physio's own clean take
  (start pose, peak of the best rep), with the muscles they chose.
- **The session file** — every move worked on that day plus every take: label,
  side, the landmark stream at 30 fps, and (optionally) the video. Keep it. When a
  threshold turns out wrong in the field, it is re-checked against these takes in
  minutes, without another recording session.

## The session

### Kit

- Laptop with a camera, on a stand at about chest height. Chrome or Edge.
- 2.5–3 m of clear floor in front of it; a plain wall behind the person helps.
- Someone to demonstrate. The physio, or a model the physio directs. The camera
  needs a body doing the move — a description is not enough.
- Band set (tan → black), mat, chair, a usable wall. Shoes.
- The physio's shortlist of moves.

Open `/studio/` on the laptop. Allow the camera when asked. The first time it
loads the pose model (about 10 MB) it needs the internet; after that it is cached.

### Order that works

**Screen everything first.** Step 1 takes two minutes per move and drops the
ones a camera cannot coach before anyone gets up. Six yes/no questions; a "no"
on any of the first four is a rejection. Do the whole shortlist, then start
recording the survivors.

**Per move, about 25 minutes.**

| minutes | step | who does what |
|---|---|---|
| 5 | 2 · Describe | physio talks, builder types: name, type, view, side, camera height and distance, band or not, targets, calibration pose, the three page lines |
| 8 | 3 · Record | physio (or model) performs; builder labels each take before recording it |
| 8 | 4 · Measure, 5 · Faults | builder drives; physio decides — see below |
| 4 | 6 · Guide | physio dictates the form points, marks which the camera checks; builds the figure |

**Recording order, every move:**

1. Two **clean** takes — five or six reps each, the way it should be done.
2. One take **per fault**, exaggerating that one fault and nothing else. Label
   it with the fault before pressing record (the label chips are populated from
   step 5, so it is fine to name the faults first and come back).
3. Two **borderline** takes — a rep the physio would accept but only just, and
   one they would cue. These are the most valuable takes in the file: they are
   where the threshold actually sits.
4. The **other side**, for one-sided moves. One clean take is enough.
5. One **awkward set-up** — camera a bit low, person a bit close, whatever a
   real living room does. Shows what the checks tolerate.

Every take begins with the person **holding the start position, still, for
two seconds**. That is the calibration window the coach uses, and the Studio
reads its baselines from the same window. A take that starts mid-movement
simulates wrong.

Keyboard, when the builder is at the laptop and the physio is in frame:
<kbd>space</kbd> starts and stops, <kbd>1</kbd>–<kbd>4</kbd> choose the next
take's label (clean, fault, borderline, set-up).

Videos recorded on a phone can be dropped in with **Analyze a video file**; the
Studio runs the pose model over them at the video's own pace.

### Measure and faults — the part that needs the physio in the room

**The progress number.** Pick the measurement kind (angle at a joint, segment
from vertical, segment from horizontal, distance as % of torso, a point's offset
from a line, trunk lean, pelvis tilt) and the landmarks. The chart under it shows
the metric across every take, coloured by label. Press *Suggest* and the start
and target come from the clean takes. Two rules that cost a rebuild each to
learn:

- Measure from the segment that *defines* the movement. A shoulder raise is
  shoulder→elbow; shoulder→wrist reads a bent elbow as a lower raise.
- If the target should be the user's choice (rehab range that grows weekly),
  turn on the *range option*; the page then offers those values.

The lower chart is the engine's own progress trace with the counted reps dotted.
A clean take must count all its reps. If it counts none, the start/target are
wrong or the take did not start still.

**Faults.** Each needs a name, a spoken cue (six words or fewer — it is said
mid-rep), a written tip (read after the set), a severity, and a measurement with
a threshold. *Suggest* sets the threshold halfway between the clean takes' edge
and the fault take's typical value, and says so if the fault take does not
separate from the clean ones on that measurement — in which case the
measurement is wrong, not the threshold. The chart shades where the rule
fires on each take; the strip below it says how many clean / fault / borderline
takes it fired on. Green means: quiet on every clean take, fires on every take of
that fault. Anything else, adjust and look again. This is where a textbook number
meets a real body, and the body wins.

Built-in rules that need no measurement: *not reaching the target* and *too
fast*.

Rep-level questions the physio answers per fault: does it invalidate the rep
(rep does not count) or only cost a cue; only once the rep is under way, or at any
time; how long it must persist before it counts (0.4 s is the usual answer).

### Guide

Surface, what the camera **cannot** see (required — it is shown to the user so
they know what to check themselves), when to stop, and form points by region,
each marked *camera* or *you*. Dosage, harder, easier. Muscles for the figure.
Then *Build from the best clean take* makes the demo figure.

### Check & export

Step 7 lists anything missing in plain words, then what is worth fixing (no
borderline take, a clean take that still fires a fault, no figure). *Download
`<id>.js`*. *Try it in the app* opens Grooveform with the draft added — in this
browser only — so the physio can run a set against the real coach before leaving.

At the end of the day: **Save session file** (top right). One JSON with every
move and take. Send it with the move files.

## Built-in moves

The dropdown also lists the ten hand-written moves. Their rules cannot be edited
in the Studio, but takes can be recorded against them and step 5 shows how their
current faults fire. That is how the field complaint "it keeps telling me to
stop shrugging" gets a recording, a look at the shrug metric on that recording,
and a corrected threshold.

## Installing a move

1. Copy `<id>.js` into `client/coach/library/`.
2. Add `<script src="coach/library/<id>.js"></script>` to `client/index.html`
   next to the others, and to `client/studio/index.html`.
3. `npm test` — `test/library.test.js` checks the file and the tag agree and the
   move carries everything the page renders; `test/spec.test.js` covers the
   compiler.
4. Optionally add it to a playlist in `server/api.js` → `PREBUILT`.

A spec move can be hand-tuned afterwards by editing the numbers in the file; or
re-open the session file in the Studio, change it there, and export again.

## Where things are

```
client/coach/spec.js        spec → exercise compiler (also validates a spec, in the physio's words)
client/studio/index.html    the Studio page
client/studio/studio.js     screens, recorder, simulator, charts, figure builder, export
client/studio/studio.css
client/coach/coach.js       FyzioAnatomy.register(id, figure) — spec moves supply their own keyframes (drawn as the animated stick figure; the anatomical renderer is archived in coach/archive/)
test/spec.test.js           a spec compiles, counts reps, fires faults as the numbers say
test/e2e.test.js            "studio:" step — the whole flow in a browser with a synthetic stream
```

The Studio keeps drafts in `localStorage` and takes in IndexedDB, per browser.
Nothing is uploaded anywhere; the session file is the only way data leaves the
machine.
