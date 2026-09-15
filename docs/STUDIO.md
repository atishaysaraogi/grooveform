# OnTrack Studio — building moves with a physio

`/studio/` is the authoring tool. It lives next to the app (same engine, same
pose model, same move library) and runs entirely in the browser, so it works on
GitHub Pages and on a laptop with no server. A physio and one person from the
build side sit down with it, and a move that survives the session comes out as
a move in `client/data/moves/<id>.json` — the same file a physio can also edit by hand.

It is the executable version of `docs/PT-INTAKE.md`. Read that first for the
*why*; this is the *how*.

## What comes out

For each move:

- **The move**, as its own file `client/data/moves/<id>.json`. It carries no
  code, only fields: measurements as named landmarks, a start/target pair for
  progress, each fault as a metric, a comparison and a threshold, and the words.
  `coach/spec.js` compiles it into exactly the shape the hand-written moves have,
  so the app cannot tell the difference.
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
| 5 | 2 · Describe | physio talks, builder types: name, type, view, side, camera height and distance, band or not, targets, calibration pose, the three page lines, the **spoken brief** (what the coach says as the set starts — position, then movement, no camera talk), **and the faults by name** — each becomes a take label |
| 8 | 3 · Record | physio (or model) performs; builder labels each take before recording it |
| 8 | 4 · Measure, 5 · Faults | builder drives; physio decides — see below |
| 4 | 6 · Guide | physio dictates the form points, marks which the camera checks; builds the figure |

**One long video is the quick way in.** Rather than a recording per label, take
one video with everything in it — a few clean reps, one deliberately showing
each fault, a borderline one — and hit **Upload a video…**. The Studio steps
through it frame by frame with the pose model (a seek per frame, so a slow
phone reads the same frames as a fast one), finds where the body settles —
the first moment it is seen, in the move's view and still for a second, the
same test the coach applies before a set — and calibrates there, not at a fixed
moment: a phone video starts with someone walking in and lying down, and a
start position read then makes the whole set look like one long rep. It then
cuts the take into its reps: each rep becomes a take of its own, trimmed to the
rep itself, with the last second and a half of that still hold in front of it
so it calibrates exactly as the parent did. The lead-in before the first rep
and the tail after the last are not reps and are dropped; the split says how
much of each it left out. A video with no still hold in it calibrates 1.2 s in
and says so — hold the start position for a second before the first rep.

Each rep arrives labelled **Not said yet**, in pink, and counts for nothing
until you say what it shows — clean, which fault, borderline, or **Not a rep**
for the dead time the cut caught (a shuffle, a rest, a half-hearted extra).
That is deliberate: a rep silently assumed clean would poison every threshold
derived from it, so step 3 is not done and the check will not pass while any
remain. A "Not a rep" take is kept so the call is on record, and is left out of
every chart, threshold and count. There is no limit on how many examples of a
label you give; the coverage panel's numbers are a floor, and a row past its
target reads `Clean 5 ✓` rather than a fraction.

The describing is done in the player, one rep at a time: as soon as a video
has been cut up, the first rep plays with its skeleton and readout and then
waits, paused on its last frame, with a button for each thing it could show —
Clean, each fault, Borderline, Not a rep, Awkward set-up, Other — and Skip.

**A rep can show more than one thing.** Those buttons are toggles, so a rep
that leans *and* rushes says both, and a threshold tuned for either is tuned
against the whole truth about that rep. Clean and Not a rep are the exception:
nothing stacks on them, so they answer and move on in a single tap. Anything
else waits for **Next rep** (or Enter), which is what leaves room for the
second fault. Keys 1–9 are the buttons in order, S skips, space replays.
Skipped reps stay "Not said yet"; **Play and describe N reps** above the takes
list picks them up again, and the label on each row opens the same set of
toggles for a quick correction without re-watching.

Everything downstream reads the set, not one word: a rep labelled with two
faults is evidence for both in the coverage panel and in the tuning table, and
one labelled Not a rep is evidence for nothing.

**A fault can be checked on the start position instead.** The chip row on each
fault says when to check it: during the set, or at the start position before it
begins. A set-up error — heels too far away, knee already bent, band already
taut — is worth catching there, because judged mid-set it is unfixable: the
reference was taken from that position, so every rep is measured against the
mistake. A start check uses the same measurement and threshold; it cannot be a
built-in rule and cannot measure the change from the start, since that is the
position it is judging. The fire report for such a fault reads each take's start
position rather than its spans.

**Checking the finished move against a fresh video** is the last card of step
7: upload a video the takes have never seen and the Studio cuts it into reps
and shows, for each, whether the coach would count it and which faults it
would call — with the whole video's verdict as one set above (reps counted,
score, what it would cue). Say what each rep really shows and the row turns
green or red, with a running "n of m agree" underneath. Nothing from a check is
saved or added to the takes; it is there to catch a threshold that fires on
someone else's clean rep, or misses a fault, before the move ships.

A brand-new move has nothing to find reps with yet — the progress measure is
step 4 — so its video stays whole until you set it, then **Split into N reps**
on that take's row. A rep cut from a kept video still plays from the right place
in it.

**Recording order, every move:**

1. Two **clean** takes — five or six reps each, the way it should be done.
2. One take **per fault**, exaggerating that one fault and nothing else. Label
   it with the fault before pressing record (the label chips are the faults
   named in step 2).
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

Videos recorded on a phone can be dropped in with **Upload a video…**; the
Studio steps through them frame by frame (25 a second) and calibrates where the
body settles, as above.

### Measure and faults — the part that needs the physio in the room

**The progress number.** Pick the measurement kind (angle at a joint, segment
from vertical, segment from horizontal, distance as % of torso, a point's offset
from a line, trunk lean, pelvis tilt), then tap each empty slot and say which
point goes in it. The list of landmarks appears over the slot being filled and
walks itself on to the next empty one, so a three-point angle is three taps and
the page is not carrying a wall of joint names it does not need. The chart under it shows
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

**The demo figure** is two keyframes: the start position and the end of the
movement. *Build from the best clean take* lifts them out of a recording.
*Edit the poses* opens the builder, where dragging a joint turns the bone above
it and carries everything below round with it, so every limb keeps the length
it was drawn with — a foot through the floor or an arm the pose model guessed
at takes a second to fix. A hip drags the whole body; the other keyframe sits
behind, faint, so an edit can be seen against where the body was; *Copy this
pose onto the other* and *Undo my edits* are there for the rest.

**Stretch limbs** is the other way to drag. Off (the default) a drag turns the
bone above the joint and keeps its length, which is what a body does. On, the
bone follows the pointer exactly and gets longer or shorter, with everything
below carried along unchanged — because a figure is a drawing, not a person: a
leg seen at an angle is drawn shorter, a child's proportions are not an adult's,
and keyframes built from a take inherit whatever length the pose model guessed.
Holding Shift swaps the two for one drag.

**Notes on the animation** are the other half of the builder: a few words
pinned to a joint — "knee drifts in over the big toe" — drawn on the exercise
page's figure with a line to the joint, travelling with it as the figure moves.
A note can be tied to one keyframe, and then it fades in as the figure reaches
it, which is how a fault that only shows at the top gets said at the top. Notes
ride on a move written in preset angles as well, so any library move can be
annotated without being converted; *Edit these poses by hand* does convert one,
turning its presets into plain joint positions, and says so before it does.

### Check & export

Step 7 lists anything missing in plain words, then what is worth fixing (no
borderline take, a clean take that still fires a fault, no figure). Then the
move goes into the library as its own file:

- **Save into the project** — shown when the site is running locally with
  `npm run dev`. The move is written to `client/data/moves/<id>.json` and
  nothing else is touched, except that a move its region has not seen before is
  added to that region's list. It is checked first exactly as the app would load
  it — inside its region, against every other id — and the running server
  re-reads the library. Reload the app and it is there. Commit the file.
- **Download `<id>.json`** — everywhere else (GitHub Pages included). The same
  one-exercise file; drop it into `client/data/moves/` and commit (the download
  note says when the id also has to be added to a region's list).

The **Region** picker above those buttons is where the move's unstated defaults
come from — camera, group, order, sources — and where it sits in the list.

*Try it in the app* opens the app with the draft added — in this browser only —
so the physio can run a set against the real coach before leaving. *Download
as code* still produces the old-style `<id>.js` for anything that must be
hand-written.

At the end of the day: **Save session file** (top right). One JSON with every
move and take. Keep it with the commit: when a threshold is questioned later,
the takes are re-checked in minutes without another recording session.

## The tuning method

Every move — new or existing, vetted or not — is tuned the same way, and the
Studio's step 7 scores it against the rule before it will call it vetted:

1. **Record** at least two clean takes, one take per live fault (exaggerating
   that fault only), and a borderline take.
2. **Measure** — *Suggest* reads start and target off the clean takes; the rep
   chart must count every clean rep.
3. **Faults** — for each live fault, *Suggest* puts the threshold between the
   clean takes' edge and the fault take's middle. The strip under the fault
   must read **quiet on every clean take, fires on every take of that fault**.
   If it cannot, the measurement is wrong, not the number: pick a different
   kind, a different reference length, or add a gate.
4. **Check & save** — the *Tuning* card lists each live fault with its
   clean / fault / borderline counts and a verdict. When every live fault
   passes and the takes are there, the move can be marked **vetted**; the
   entry records when, by whom and on how many takes under `_studio.tuned`.
   Until then the move ships unvetted and lists after the vetted ones.

The same numbers are what the coach runs, so a move that passes here passes on
the person's phone.

## Editing an existing move

The dropdown lists every move in the library. Choosing a catalogue move shows
**Edit a copy**: the move opens as a draft with every field filled — the physio
records against it, watches the current thresholds fire on the takes, moves the
numbers, rewrites the words, and saves. The draft remembers which file and which
move it came from, so saving replaces the original.

There are no code moves left: the ten that were hand-written are entries like
the rest, so "it keeps telling me to stop shrugging" is a recording against
band rows, a look at the shrug measurement on it, and a saved threshold.

## Installing a move

A catalogue move installs itself: it is in the JSON file. `npm test` checks the
file and `node scripts/catalog.js check` does the same without a server. (`manifest.json` still has a `code` list for a hand-written move, should one
ever be needed; it is empty.)

## Where things are

```
client/coach/spec.js        spec → exercise compiler (also validates a spec, in the physio's words)
client/studio/index.html    the Studio page
client/studio/studio.js     screens, recorder, simulator, charts, figure builder, export
client/studio/studio.css
client/coach/catalog.js     reads and checks the data files; OnTrackCatalog.format() writes them
client/data/moves/*.json    where a saved move ends up
client/coach/coach.js       OnTrackAnatomy.register(id, figure) — spec moves supply their own keyframes (drawn as the animated stick figure; the anatomical renderer is archived in coach/archive/)
test/spec.test.js           a spec compiles, counts reps, fires faults as the numbers say
test/e2e.test.js            "studio:" step — the whole flow in a browser with a synthetic stream
```

The Studio keeps drafts in `localStorage` and takes in IndexedDB, per browser.
Nothing is uploaded anywhere; the session file is the only way data leaves the
machine.
