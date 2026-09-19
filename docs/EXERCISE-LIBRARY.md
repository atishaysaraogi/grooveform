# The exercise library

The library is **data**. Every one of the 145 moves — the fifteen vetted ones
included — is its own JSON file at `client/data/moves/<id>.json`, and
`_about.json` beside it explains every field a move may contain: what it means,
what good and bad input look like. Edit the file, reload the page, and the move
is different. Nothing about a move is code.

One exercise to a file is deliberate: the Studio writes back exactly the move
someone edited, a pull request that changes one exercise touches one file, and
two people editing different exercises never touch the same bytes. What a move
does *not* state comes from its region.

```
client/data/
  manifest.json          which files make up the library (add a line, add a file)
  settings.json          numbers and words every move shares: rep thresholds, fault timing,
                         band colours, scoring, the standard faults
  shared.json            named measurements ("knee"), fault templates ("lean"), pose presets
                         ("standing"), hold sets ("balance") — referred to by name from the moves
  _about.json            the field guide: every field a move may use, with good and bad examples
  regions/
    knee.json            what its moves inherit (region, group, order, camera, sources) and the
    hip.json  …          ids it holds, in the order the app shows them
  moves/
    wallsit.json         one exercise, one file, named by its id
    seated_knee_ext.json  quad_set.json  …  (145 of them)
client/coach/
  exercise-library.js    the registry: define(), validation, lookup
  engine.js              kinematics, smoothing, rep counting, set review
  spec.js                compiles a declarative move into a rep counter and fault checks
  catalog.js             reads the data files, checks every field name, builds the moves and
                         the joint-angle figures
scripts/catalog.js       the offline tool: check · list · new · remove · format
```

`engine.js` publishes a kinematics toolkit into the registry and exposes
`EXERCISES` — the registry's own array, sorted by each move's `order`. The server
derives `/api/exercises` from it, so a new move shows up everywhere at once:
catalogue, exercise page, routine builder, static build.

## Editing the library

There are three ways in, all ending in the same JSON file:

**In the Studio** (`/studio/`, see `docs/STUDIO.md`). Pick any move from the
dropdown — it opens as an editable copy — or *New move*. The seven steps edit
every field, and step 7 either **saves the move into the project** — when the
site is run locally with `npm run dev` — or **downloads `<id>.json`** to drop
into `client/data/moves/`. Either way it is checked inside its region, against
every other id in the library, before anything is written. A move the region has
not seen before is added to that region's list; nothing else is touched.

**In a text editor.** Open `client/data/moves/<id>.json`. `_about.json` explains
every field with good and bad examples. Copy a move that looks like the new one,
change every field, give it a new id and its own file, and add that id to its
`regions/<name>.json`. Save; reload. A mistake — a missing comma, a mistyped
field, a fault with a measurement but no threshold — is shown on screen in place
of the exercise list, naming the file, the move and (for a field name) the
nearest correct spelling.

**From the command line**, no server needed:

```
node scripts/catalog.js check              every file: parse, field names, names in shared.json, the library's rules
node scripts/catalog.js list [knee]        ids and names, by region
node scripts/catalog.js new knee my_move   write moves/my_move.json from a template and list it under knee
node scripts/catalog.js remove my_move     delete moves/my_move.json and take it off its region's list
node scripts/catalog.js format             rewrite every file in the shared style
```

`npm test` runs the same checks, so nothing wrong can be pushed unnoticed.

Anything written as a **word instead of an object** — `"metric": "knee"`,
`"template": "lean"`, `"preset": "standing"`, `"conditions": "balance"` — is
looked up in `shared.json`. When a measurement, a fault or a pose would be
typed twice, put it there once. Any field beginning with `_` is a note for
people (`"_note": "physio wants this re-checked"`) and is ignored.

Things that are **not** per move live in `settings.json`: when a rep counts
(`rep`), how long a fault must hold before it is spoken (`fault`), the standard
rep and hold choices, the band colours, the score. Its `_about` explains each.
A change there moves all 145 moves at once; restart the server to pick it up.

## The measurement language

Everything a move judges is written with the same small vocabulary, and the
Studio, the coach and the tests all read it through one compiler
(`coach/spec.js`). A measurement is `{ "kind", "pts" }` plus, when needed,
`"per"` (what a percentage is of: `"torso"`, a segment `["KNEE", "ANK"]`, or
`"height"` — the person's stature, estimated from their own trunk, thigh and
shin — measured at calibration so it scales to the person), `"unit"` (`"in"`
or `"cm"`, only with `per: "height"`: the reading and every threshold on it
are then a real length, worked out from the height the person set in the app,
5'11" unless they changed it), `"sign"` (`"outward"`
from the body's midline, or `"forward"` the way the toes point), `"abs"` and
`"flip"` (negate for an option value — external vs internal rotation).

| kind | points | reads |
|---|---|---|
| `angle` | 3 | the angle at the middle joint, 0–180° |
| `vertical` | 2 | the segment's angle from hanging straight down |
| `tilt` | 2 | the segment's angle from horizontal |
| `dist` | 2 | distance, % of the reference length |
| `offset` | 3 | how far the third point sits off the line through the first two |
| `rise` | 1 | how far the point has risen since calibration, % |
| `height` | 2 | how far the first point is above the second, % |
| `ratio` | 2 | the segment's length vs calibration — a limb leaving the camera plane reads short |
| `gap` | 2 | sideways offset of the first point from the second, % |
| `rotation` | 2 | how far a segment has swung toward the camera, degrees |
| `near` | 3 | distance from a point to a segment, % |
| `lean` | 0 | trunk lean, signed |
| `headTilt` | 0 | head roll against the pelvis, signed |
| `pelvis` | 0 | pelvis tilt seen from the front |

A fault is a measurement, `"op"` and `"threshold"`, with `"rel": "change"` to
compare against the calibrated start, `"minP"` to wait until further into the
rep than the default (see **Only during the rep** below), `"persist"` before it
is spoken, and — where a plain threshold is not
enough — `"when"` (gates: an option value, another measurement's comparison,
`"inPosition"` / `"notInPosition"`), `"phase"` (`"moving"`, `"rest"`,
`"any"` for a hold fault that must fire while the person is *out* of position,
or `"start"` — see below) and `"scale"` (a threshold that grows with another
reading). Rules that need no
measurement: `"shallow"`, `"fast"`, `"return"` — these judge the finished rep and
are spoken at the rep, under the same `"cooldown"` as any other cue. Progress has `"startMin"` /
`"startMax"` clamps and `"delta": -1` for a reading that falls during the rep;
`"sided": { "auto": true }` follows whichever limb moves when no side was chosen;
`"display"` names what the live readout shows. The `_about` guide in every
moves file spells each of these out with examples.

That vocabulary is what let the ten hand-written moves become data: each one
was rewritten as an entry, and `test/engine.test.js` — synthetic recordings
with known reps and known faults — proves the data version counts and cues
exactly as the code did. The folder `client/coach/library/` is gone;
`manifest.json` keeps a `code` list for the day something genuinely cannot be
said in data, and it is empty.

## The live screen is data too

What the coach draws during a set comes from the same fields: the readout is
the progress measurement against its target (or the hold condition `display`
names), the ghost limb is that measurement's own segment drawn at the target
angle, and every fault draws its reference line (a `rise` fault draws the
height its point started at, an `offset` fault its line) and, when it fires, an
arrow at its first landmark pointing the way to fix it — worked out from the
kind and the comparison. `coach/coach.js` has no per-move code left.

## Tracking tiers and the vetted flag

Every move states honestly what the camera does with it, in `tracking`:

| tier   | the camera…                                   | the app…                                              |
|--------|-----------------------------------------------|-------------------------------------------------------|
| `form` | counts reps / times the hold **and** judges form | runs the live coach with spoken cues                   |
| `reps` | counts reps / times the hold only             | runs the live coach; form faults are listed for you    |
| `none` | cannot measure anything useful                | shows the guide and a counter or timer; you log by hand|

`vetted: true` marks the moves that have been checked rep by rep against
recordings in the Studio — see *The tuning method* in `docs/STUDIO.md`. The
flag is the author's call: the Studio scores the takes and says when a fault
still misbehaves, but it does not withhold the flag; a move vetted over a
failing report carries the failing faults under `_studio.tuned.override`. Every move is listed; the
vetted ones simply sort into the first group. The exercise page, the move
list and the routine builder all name the tier in the move's meta line.

Four of the fifteen were tuned without recordings of their own: the backward and
forward banded kicks (`standing_hip_ext`, `standing_hip_flex`), the seated banded
kick (`seated_knee_ext`) and the clamshell. Their thresholds come from the
geometry of the movement, checked on synthetic bodies replaying real MediaPipe
residuals — the frame-to-frame wander lifted off the recorded sets in this
project — so a clean take counts its reps and names nothing and each fault take
names its own fault and no other. That is not the same as a rep-by-rep check
against footage of these four movements, which is the thing to do next;
`test/engine.test.js` carries the takes, so a change that breaks one is caught.

Validation follows the tier: a `none` move has no `calibrate`/`measure` and its
faults have no `check`; a `reps` move's faults may be documentation only
(`tracked: false`); a `form` move must have at least one fault the camera
actually checks live.

## The catalogue

A moves file is a group (region, heading, default camera, sources) and a list of
moves. Each move is the record a physio fills in. The `_about` block at the top
of every file documents each field; this is the shape:

```json
{
  "_about": { "…": "what the file is, how to add and remove, and a guide to every field" },
  "region": "knee", "group": "Knee", "order": 1100,
  "camera": { "height": "hip", "distance": "2.5 m", "posture": "standing" },
  "sources": [{ "name": "E3 Rehab — Exercises for knee pain", "url": "https://…" }],
  "moves": [
    {
      "id": "slr", "name": "Straight leg raise", "type": "reps", "view": "side", "tracking": "form",
      "level": "beginner", "equipment": ["none"], "muscles": { "primary": ["quadriceps"], "secondary": [] },
      "sided": { "limb": "leg", "by": "camera" },
      "summary": "…", "setup": "…", "brief": "…", "why": "…",
      "camera": { "height": "floor", "distance": "2 m", "posture": "lying" },
      "tempo": "Lift 2 s, hold 2 s, lower 3 s.", "dosage": "2–3 × 10 each leg.",
      "progression": "…", "regression": "…", "contraindications": "…",
      "progress": { "metric": "thigh_raise", "start": "calibrated", "target": 35, "targetIsDelta": true },
      "faults": [
        { "id": "kneebend", "label": "Knee bending", "cue": "Lock the knee", "tip": "…", "severity": 3,
          "metric": "knee", "op": "<", "threshold": 165 },
        { "id": "arch", "label": "Lower back arching", "cue": "Back flat", "tip": "…", "severity": 2 }
      ],
      "guide": { "surface": "…", "stop": "…", "cannotSee": "…",
        "regions": [{ "name": "Working leg", "points": [{ "t": "…", "tracked": true }] }] },
      "pose": { "A": { "preset": "supine", "thigh": 90, "shin": 90 }, "B": { "preset": "supine", "thigh": 125, "shin": 125 }, "work": { "thigh": 1 } }
    }
  ]
}
```

A fault **with** `metric`, `op` and `threshold` is checked live (the move is
then at least `reps`, and `form` if it says so); one **without** is listed for
the person to watch. A measurement with no number, or a number with no
measurement, is an error rather than a silently dead fault. `"template": "lean"`
with a `"threshold"` pulls a whole fault from `shared.json`; any field written
next to it wins over the template's.

Every field name is checked against a fixed list when the file loads, so
`"sumary"` fails with *did you mean "summary"?* instead of a blank line on the
page. The same list is what the `_about` guide documents, and a test holds the
two equal.

**Reviewing the figures:** `/figures.html` on the site (or `client/figures.html`
locally) draws every move's animation on one page with its id, a search box and
a "looks wrong" tick that collects the ids you flag. It loads the moves the same way the app does, so it can never show a different set.
Quote the ids back with a sentence each on what the body should be doing, and
each one maps to exactly one `pose` block in a moves file.

`pose` gives the two keyframes of the figure as **joint angles** (see the header
of `catalog.js` for the conventions) and `catalog.js` turns them into the
points the stick figure draws (the fuller anatomical figure is parked in `coach/archive/`), so a hundred figures can be written by hand
without any of them getting a limb of the wrong length. `face` is the way the
front of the body points ('right' by default), which is what puts the chest
and quads on one side and the back and glutes on the other. Both keyframes
are placed with one transform and the joint that is on the floor in both
(the planted foot) is held still, so a sit-to-stand keeps its feet where they
were. A seated move (`camera.posture: 'sitting'`) pins the hip instead — the
seat is the contact, and the foot that hangs lowest at the start is in the air
at the end.

`anchor` overrides that: a joint name, `null` for none, or **a list of every
joint in contact**. Moving the body can only pin one joint, which is all a
squat needs, but a push-up rests on the toes *and* the hands. With a list, the
first joint is pinned by moving the body and each one after it by bending its
own limb back onto the mark (a two-bone reach — the segment lengths never
change, so the limb stays anatomical, and an unreachable mark stops short
rather than stretching). `ft`/`ftF` are read as the ankle: the heel stays, the
toes may still lift. A far limb that is the near one drawn again a few pixels
back follows it rather than being solved separately. `test/library.test.js`
fails if a declared contact ends up more than 5 units from its mark, which is
how you find out a pose is asking a limb to be longer than it is. `lift` raises
the second keyframe (a jump), `raise` lifts both off the floor (a hang). `props`
draws the equipment: `{ kind: 'box', at: 'hip' }` is a chair under the hips of
keyframe A (`'B.an'` reads keyframe B; a box always reaches the floor),
`bar` spans two joints or a length, `disc` is a roller, `band` runs from a
joint to the wall (`wall: 'ahead' | 'behind'`). `work` is the heat map (which
muscle regions light up). `sources` on the group or the entry are shown
on the exercise page; the prose is always ours.

A tracked entry (`reps`/`form`) is compiled through `spec.js` exactly like a
Studio move, so anything the spec language offers (metric kinds, hold
conditions, `rule: 'shallow'|'fast'`) is available. A counted move with no live
faults gets the generic "not reaching the target" and "too fast" checks; a
timed hold with none gets "drifting out of position" from its first hold
condition.

`test/library.test.js` checks every data file (every field name, the `_about` guide, the shared style) and every catalogue entry: the physio fields, at least
two faults with a cue that differs from the tip and is short enough to speak,
a `cannotSee` line, a figure, and that the tier is honest (a `none` move has no
checks and no guide point claiming the camera watches it; a `form` move has a
live fault).

## Adding a move

For a catalogue move — the normal case — see *Editing the library* above:
Studio, text editor or `node scripts/catalog.js new <file> <id>`. A new body
region is a new file under `client/data/moves/` plus one line in
`manifest.json`.

Should a move ever need code the data language cannot express, create
`client/coach/library/<id>.js` (a factory returning the object below) and list
it in `client/data/manifest.json` under `code`; `engine.js` and the browser
both read the manifest. No such move exists today.

To make it free without a subscription, add its id to `FREE_EXERCISES` (or leave
`FREE_EXERCISES=all`).

## The shape

```js
/* Move name — metadata, camera set-up, measurement, faults and guide. */
(function (root) {
  'use strict';
  const lib = (typeof module !== 'undefined' && module.exports)
    ? require('../exercise-library.js') : root.ExerciseLibrary;

  lib.define((k) => {
    const { SIDE, FULL, ATTEMPT, angle, dist, sideJoints } = k;   // only what you use

    return {
      id: 'sidelegraise', order: 110, name: 'Side leg raise',
      group: 'Hip strength', type: 'reps', view: 'front', icon: '🦿',
      summary: 'One line for the catalogue tile.',
      setup: 'Where to stand or lie, how far from the camera, at what height.',
      brief: 'What the coach says out loud as the set starts: position, then movement.',
      why: 'Why this camera angle can actually measure this movement.',
      defaultTarget: 10, targets: [6, 8, 10, 12, 15],
      options: [{ key: 'rom', label: 'Raise target', values: [20, 25, 30], unit: '°', default: 30 }],
      required: [23, 24, 25, 26, 27, 28],       // landmarks that must be visible
      calibrate(pts, S, opts) { return { /* baselines from the still start frame */ }; },
      measure(pts, S, ref) { return { p: 0, /* …, */ focus: [27], side: S }; },
      faults: [ /* see below */ ],
      guide: { surface: '…', regions: [ /* … */ ], stop: '…' },
    };
  });
})(typeof window !== 'undefined' ? window : globalThis);
```

`define()` takes a factory so the move can destructure just the kinematics it
needs and never reaches into engine internals. Available in `k`:

`SIDE` `LM` `REST` `ATTEMPT` `FULL` `BAND` · `angle` `armAngle` `armRot` `clamp`
`deg` `dist` `elbowGap` `fromVertical` `headTilt` `lineOffset` `lineTilt` `mid`
`outward` `pelvisTilt` `segTilt` `sideJoints` `stickySide` `trunkLean`

### Fields

| field | meaning |
|---|---|
| `id` | lower-case, matches the filename; stable (it is stored in saved sessions) |
| `order` | where it sits in lists — 10, 20, 30…, leaving gaps to insert later |
| `type` | `reps` (counted) or `hold` (timed) |
| `repHold` | reps only: seconds the top of each rep must be held before it counts — a rep that reaches the top and comes straight down is a partial, cued by the built-in `shortHold` rule ("Hold it there") |
| `band` / `weight` | offer the band-colour or the kilogram bubble with that default (`"none"`, a colour or a number; `true` = offered, default none); the weight bubble's last step lets the person type their own |
| `view` | `front` or `side` — the camera angle the rules assume |
| `targets` / `defaultTarget` | offered rep counts or hold seconds; the default must be one of them |
| `options` | extra per-set choices (band, range, variant); each needs `key`, `label`, `values`, `default` |
| `required` | landmark indices that must be visible before a set can start |
| `upperBody` | `true` when head-to-hips is enough, so the framing check stops asking for legs |
| `sided` | `{ limb, by }` when the move works one limb at a time — see below |
| `calibrate` | reads the still start frame, returns the baselines `measure` compares against |
| `measure` | per frame; returns `p` (0→1 through the movement) plus whatever the faults check |

### One-sided moves

A move that works one limb at a time declares `sided`, and the library then offers a
**Left / Right / Both** choice automatically — you do not add that option yourself.

```js
sided: { limb: 'leg', by: 'pick' }
```

| `limb` | `'leg'`, `'arm'` or `'side'` — only the word used in the UI ("left leg", "right arm") |
|---|---|
| `by: 'pick'` | the person's choice **is** the working limb. For moves facing the camera, where either limb can be worked from the same set-up. |
| `by: 'camera'` | the limb nearest the lens is the working one, so the *pose* decides. The choice only tells the person how to lie or stand, and positioning will not pass until the camera can see the side they picked. Use this for side-on moves. |

Choosing **Both** runs every set on one side, then prompts to switch and repeats on the
other. Nothing in the move has to handle that: it is expanded into two ordinary steps.

### Faults

A fault is one thing that can go wrong, with a **short cue said out loud during
the set** and a **longer tip read afterwards**. Both are required and they must
differ — the cue is shouted mid-rep, the tip explains.

```js
{ id: 'hip', label: 'Hip lifting', cue: 'Keep your hips down',
  tip: 'Lifting the hip cheats the last few degrees. Keep the pelvis flat.',
  weight: 2, persist: 400, cooldown: 5000, phase: 'moving',
  check: (m) => m.p > 0.4 && m.hipRise > 0.15 }
```

| field | meaning |
|---|---|
| `weight` | how much it costs the set score, and how it ranks in the summary tips |
| `persist` | milliseconds it must hold true before it counts — stops flicker |
| `cooldown` | milliseconds before the same cue is spoken again — rep rules obey it too, so "Slow it down" is not said on every rep |
| `maxCues` | how many times it may be spoken in one set at all. `settings.json` caps the `fast` rule at 1; the review still counts every occurrence |
| `phase` | limit it to `'moving'` / `'hold'`, or `'start'` to judge the start position before the set |
| `onRep` | judge the finished rep instead of each frame: `check: (rep) => …` |
| `tentative` | the camera can see it but cannot swear to it: never spoken, never scored, saved up as a reminder after the set (below) |
| `check` | `(m) => boolean` over the object `measure` returned (or `(rep)` when `onRep`) |

#### A fault the coach will not swear to

Some readings sit close to their own noise: a heel a few pixels off the floor,
a pelvis tilt that most of the raise explains anyway. The camera can take the
measurement; it cannot stand behind the verdict. `tentative: true` says so.

Such a fault is measured, counted and attached to the reps it happened on like
any other — what it never does is **speak**. Mid-rep a cue is an instruction,
and an instruction the coach is not sure of is worse than silence: it interrupts
a rep to correct something that may not be wrong. So it is held back to the end
of the set, where the review lists it under *Worth a look* — a reminder to
check rather than an order to obey — and it costs nothing off the score, for the
same reason it does not speak. The spoken summary leaves it out too.

It belongs on a fault the camera actually measures (or a built-in rule). A fault
nobody checks is already only a line in the guide and has nothing to be unsure
about; `checkSpec` refuses that combination.

Today the glute bridge's *foot coming off the floor* is the one move that uses
it, and the reason is written into its tip: side-on, the pose model swaps the
heel and toe labels when a heel lifts, so no threshold separates the two, and
the reading wanders a couple of percent of the shin with the foot flat on the
mat. The camera is right often enough to be worth raising and wrong often
enough that it must not shout.

#### The person has the last word on a rep

The review screen plays each rep back on its own — *Watch this rep* stops the
player at the end of that rep rather than running on into the next — and offers
the move's whole list of faults as toggles. Watching what actually happened, the
person can mark a fault the camera missed or clear one it invented.

The set follows: that fault's count moves by one, the score is worked out again
from the corrected counts (`FormEngine.applyRepFault`, which shares its
arithmetic with `review()`), and *Work on next* is rebuilt. Nothing is
overwritten silently — the fault and the rep are both marked `edited`, shown as
*your call*, and the correction is written into the recording as a `repEdit`
event, so the replay timeline, the downloadable report, the diagnostics and the
saved session all tell the same story as the screen.

### What people see

`listed` says whether a move is offered in the lists people browse — the home
page and Moves. Left out it follows `vetted`, so the library can grow faster
than anyone can check it without burying the moves that were checked. Set it
`true` to show one that is not vetted yet, `false` to hide one that is. It is
about browsing only: a routine that names the move still runs it, and a link
straight to it still opens.

### The target is a range

`progress.target` says where a rep counts. Some movements also have a place
past which the joint is working outside the range the exercise is for, and
`progress.max` is that far end. Write it as a number, or as `{ "delta": n }`
— a distance past the target, so it follows the person's own choice when
they pick their range.

It compiles into a built-in fault, `past_range`, which no move may claim as
an id. That is the point: the far end used to be written out by hand as a
separate fault carrying its own copy of the progress measurement, and a copy
is a second thing to keep in step with the first. `overLabel`, `overCue`
(≤ 8 words) and `overTip` put your own words on it; `overSeverity` and
`overInvalidates` set how it scores.

It is optional. Plenty of movements have no far end.

### More than one angle

A movement is not always one measurement. A squat is the knee bending *and* the
hip folding; a rep that bends the knees without hinging is not the exercise, and
a knee angle alone cannot tell the difference. `and` adds measurements on the
same footing as the first:

```json
"progress": {
  "metric": "knee", "start": "calibrated", "target": 90,
  "and": [{ "metric": "hip_open", "start": "calibrated", "target": 80 }],
  "combine": "min"
}
```

Each gets its own start and target and its own 0–1. `combine` says how they
become the one number the rep counter runs on: `min` (the default — the rep is
only as far through as its least-finished part), `mean`, or `max`. The first
measurement stays the one the live readout shows, the one the aim arrow is
drawn for, and the one a demonstrated pose replaces; `m.parts` carries all of
them for the review and the Studio charts.

`min` is almost always what a physio means. It is the honest reading of "the
rep must reach depth": every requirement has to be met, and the one that is
furthest behind is what the person is told about.

### Checking the start position

Some faults are set-up errors, not movement errors: the heels too far away for a
bridge, the knee already bent, the band already taut. Judged during the set they
are unfixable noise — the reference was taken from that position, so every rep is
measured against the mistake. `"phase": "start"` moves the same detector to where
it can still be acted on.

```json
{ "id": "bentknee", "label": "Knee already bent", "cue": "Straighten the leg",
  "tip": "Start with the working leg straight, or the raise reads short.",
  "severity": 2, "phase": "start",
  "metric": { "kind": "angle", "pts": ["HIP", "KNEE", "ANK"] }, "op": "<", "threshold": 170 }
```

It is the same measurement language, with two differences. There is no rep yet,
so a built-in rule (`shallow`, `fast`, `return`) cannot be a start check, and
`"rel": "change"` is refused, because the position being judged *is* the start.
`minP` does not apply.

The check runs while the person holds still in the positioning step, several
times a second, on a throwaway reference taken from that very frame
(`MoveSpec` `checkStart`, reached through `SetSession.startCheck`). The coach
speaks the heaviest failing cue, lists them all in the overlay's checks, and the
count-in waits. It waits for six seconds; after that a **Start anyway** button
appears, because a threshold can be wrong and the person cannot argue with it.
Whatever was still failing when the set began is counted into the review like
any other fault (`SetSession.noteStart`), and it never fires again mid-set.

In the Studio the phase is a chip row on the fault ("during the set" / "at the
start position"), and the fire report judges a start fault on each take's start
position rather than on its spans.

### A set-up check runs on every rep

`phase: "start"` used to mean "read once, before the count-in". That misses
everything that drifts: feet creep out, a heel shifts, a knee is already bent
by the sixth rep and was not on the first.

The same checks now run again on the position each rep starts from — the
still moment before it, which is the frame that rep is measured from anyway.
What they find is attached to the rep as `rep.startFaults`, counted once per
rep it was true of, and reported in the review as "at the start of 3 reps".
The Studio's firing strip counts those reps too, so a start check is tuned
against reps rather than against one frame.

It is judged once per pause rather than once per frame — `checkStart`
calibrates a throwaway reference of its own, and the answer cannot change
while the person is still — and judged again whenever the rep's start moves,
because a drift during the pause is exactly the case worth catching.

Live, it is spoken at the rep boundary, where there is a pause to act in, and
it outranks the other rep cues: a rep done from the wrong position is not
going to be fixed by a cue about the rep.

### A target the person shows you

Some targets are a number that only means something on the body in front of the
camera: "arms out at shoulder height" reads as one angle on a wide‑shouldered
person square to the lens and another on someone half‑turned, and the band or
dumbbell that makes the move hard to judge is often the very thing hiding the
joints. Such a move can ask for the end of its range once, before the set,
**with the equipment out of the way**:

```json
"show": { "ask": "open your arms wide, as if the band were fully stretched across your chest" }
```

The coach asks for it after the start position is held, waits for the pose to be
still, and what it measures becomes `progress.target` for that set — asked once
per exercise, not once per set, and skippable. `progress.target` is still
required: it is the fallback, and the sanity check — a demonstration under 40 %
or over 250 % of it is refused and the file's number stands. Six moves use it
today (band pull‑apart, lateral and front raise, scaption, wall slide, band
row); it is worth adding wherever the target is a reach-to-height rather than a
joint angle.

### Which limb is being worked

On a front‑on move either limb works from the same set‑up, so the person picks
one — but if they then work the other one, the coach follows the body rather
than stopping them. Whichever limb is further through the rep for half a second
(`settings.json` → `side.follow`) becomes the working one, and the coach says so.
Both sides' baselines are taken at calibration, so the switch costs nothing. On a
`by: "camera"` move the working limb is simply whichever one the lens can see:
lying the other way round is no longer refused, it is reported.

### A phone that is not where the move asked

Everything a move measures is 2‑D image geometry, so a phone off its ideal spot
bends the numbers in known ways. The engine corrects three of them before a
frame reaches `measure` (`FormEngine.Camera`; the skeleton drawn over the video
is left alone so it stays on the body):

| deviation | what happens | what the engine does |
|---|---|---|
| **roll** — the phone propped crooked | the whole picture turns, and every "vertical" reading with it | turns it back. The angle comes from the phone's motion sensor when it has one, otherwise from the body at calibration: a standing or sitting trunk is upright, a lying one lies along the floor (`camera.posture` decides). A sensor that disagrees with the body by more than a few degrees is not trusted. |
| **yaw** — the person not square to the lens | everything in the plane of the move is squashed sideways by cos(yaw) | reads the turn from the shoulder and hip lines — measured outright when the pose model gives depth, guessed from how the width has changed since calibration when it does not — and stretches the picture back out when it was measured. Turning past `camera.tolerance` for `yawPersist` ms mid‑set gets a spoken "turn back". |
| **distance / height** | scale and perspective | already absorbed: readings are `per: "torso"` and faults `rel: "change"`. |

Pitch (the phone tilted back or forward) changes perspective, not which way is
down, so it needs no correction beyond the two above. Numbers live in
`settings.json` → `camera`; a move can set its own `camera.tolerance`. What was
decided for a set is written into the recording as `camera`, so a doubtful
correction can be seen in the review's JSON. `test/engine.test.js` runs the
oracle recordings through a 12° roll and a 20° yaw and requires the same reps
and faults out.

### Notes on the demo figure

A move's `pose` (or `figure`) may carry `notes`: a few words pinned to a joint,
drawn on the animated figure with a line to that joint.

```json
"notes": [{ "at": "kn", "text": "Knee drifts in over the big toe", "kf": "B" }]
```

`at` is a joint of the figure in that view (side: `h sh hip el wr kn an ft`
and the far-side `elF wrF knF anF ftF`; front: `h shL shR elL elR wrL wrR hipL
hipR knL knR anL anR`). `text` is what to look at. `kf` is optional: `"A"` shows
the note at the start position, `"B"` at the end of the movement, and leaving it
out shows it throughout. A note travels with its joint as the figure moves, and
a keyframe-tied one fades in as the figure reaches that keyframe — which is how
a fault that only appears at the top is said at the top. Written in the Studio's
figure builder (step 6), and drawn by `coach.js` `noteSvg`.

### The far side of the body

Side-on, the arm and leg away from the lens are mostly hidden behind the near
ones, and the pose model still returns a position for every joint — a guess,
with a low confidence, that lands somewhere different each frame. The skeleton
does not draw those guesses. Every joint carries how sure the model is; the
smoother (`FormEngine.PoseSmoother`) smooths an unsure joint harder the less
sure it is, and decides per joint whether it is **seen** — confidence over
`settings.json` → `skeleton.show`, with hysteresis so a limb on the edge does
not flicker — and a joint that is not seen takes everything hanging off it
with it (no far foot floating without its leg; `FormEngine.seen`). Between
`show` and `skeleton.dim` a joint draws faint. The live coach, the review's
replay (which repeats the smoother so the report needs nothing from the app)
and the Studio's player all draw by the same rule. Measuring is unchanged: a
metric that needs a hidden joint is skipped as it always was.

### Where a recording settles

Before a set the coach waits for the body to be seen, in the move's view and
still for a second (`FormEngine.positionCheck`, the checks behind the "get
into position" overlay), then calibrates. `FormEngine.Settle` runs the same
test over recorded frames, so a phone video dropped into the Studio calibrates
where the person went still rather than at a fixed moment — walking in and
lying down are not the start position.

### Where a rep starts

A set is not done in one place. The person lies down a little differently on
the fourth bridge than on the first, and a rep measured from where the *set*
began is then read wrong: too far through before it starts, or never back at
rest when it ends.

So each rep is measured from the position held just before it. Between reps,
once the reading has stopped moving for `rep.startAgain.still`, that position
becomes the next rep's start. What stops it drifting into nonsense is
`rep.startAgain.drift`: a start may only wander that share of the way from the
calibrated start toward the target, so a body that settles is followed while
someone who stops half way down does not get to redefine the exercise — that
is still a short rep, and the `return` rule still says so.

Only where the rep is measured from moves. What a fault compares against does
not: a heel that has been off the floor since the first rep is still off the
floor, and a baseline that crept up with it every rep would quietly stop
saying so. A demonstrated target is left alone entirely. Each rep records the
value it was measured from, so the diagnostics show the drift.

### Has the body stopped?

Not "did it move between these two frames". At 55 frames a second a person
lowering themselves onto a mat moves the mid-hip about four thousandths of the
frame from one frame to the next, and the tolerance the coach carried was
twelve — so on a real recorded bridge set the test never once said "moving",
not even in the middle of a rep, and "still" meant no more than "in frame".
Everything hung off it inherited that: the count-in started a second and a bit
after the framing checks passed, whatever the person was doing, and the set-up
check ran while they were still shuffling into place and named faults they were
on their way to fixing.

What separates is how far the hip has travelled over a window
(`FormEngine.Stillness`, `settings.json` → `still`). On that same set, over
400 ms: 0.003 of the frame lying settled, 0.006 between reps, 0.035 through the
count-in — they were still getting comfortable — and 0.064 mid-rep. The
tolerance is 0.02. The clock runs from the oldest frame in the window rather
than from the moment the window filled, so "still for a second" still means a
second and does not quietly cost a spare window on top.

Three things wait on it, and they are the answer to "don't assess anything
until the person is in position":

- the **count-in** starts after `still.hold` (1200 ms) of it, as before;
- the **start position is not judged at all** until `still.judge` (800 ms) of
  it — shorter than the hold, so the verdict is in before the set would begin,
  and nothing is named while the person is on their way there;
- the **count-in waits at zero** for `still.ready` (400 ms) of it before
  calibrating, because everything the set is measured against is read at that
  instant — the baselines, the target, the set-up check counted against the
  whole set — and it should be read from a body that has stopped rather than
  from whichever frame the count landed on. It waits at most `still.readyWait`,
  because someone who cannot hold still should not be locked out of their set.

The same measure decides where a recorded video settles (`FormEngine.Settle`,
which the Studio calibrates from) and how long a demonstrated end position has
to be held.

### Nothing until the person has arrived

A start read while the person was still sitting up puts the resting body most
of the way to the target from the first frame: the counter calls a rep at once,
and the faults judge the person lying down as the exercise. On a recorded bridge
set "heels on the ground" was said with the person lying still, four seconds
before the real start was found by the rebase — and the calibration frame
showed them sitting up with their arms round their knees.

Stillness cannot tell sitting-still from lying-still. What can is a start check
that names the start position: for a bridge, the shoulder–hip–knee angle is 55°
sitting and 120–130° lying, and a `phase: "start"` fault at 100° holds the
count-in until the person has lain back. A move whose start position can be
mistaken for another posture should carry one — it is the only thing that
makes "settled" mean settled *there*. (A gate that held every fault back until
the person had been at rest after calibration was tried and dropped: someone
who starts the first rep the moment the count-in ends never trips it, so their
first rep would go unjudged, and on the recorded set it would not have helped
anyway — the person was briefly at rest, sitting up.)

The rebase itself has a rule about when it may fire, and it is a long wait: the
reading has to sit inside `rep.reread.band` for `rep.reread.still` — three
seconds — before the start is read again. A rep's top looks exactly like a body
that has settled. Someone whose reps fall short of the target, which is what the
`shallow` rule is there for, tops out part way up, and half the library asks for
a pause up there; read again at that top, the start becomes the top of rep one,
every reading after it is negative and the set counts nothing. The asymmetry
decides the number: a body that really has settled stays settled, so waiting
costs it a second and a half of a set that was going to be read wrong anyway.

A video file run through the coach now waits as long as the camera does before
the count-in (`still.file`); the shorter wait it used to have is how a bridge
came to be calibrated on a person still sitting up.

### Only during the rep

A fault that watches the movement is judged only while a rep is actually under
way. On the way up that means once the reading has cleared `rep.attempt`, the
line the counter uses to decide a rep has started: below it the person is at or
around their start position — settling, shifting, walking a heel back in,
lifting a toe to put it down straighter — and none of that is the exercise.
Counting it fills the review with things they did on purpose. On the way down
the rep is the counter's until it closes it, at `rep.rest` or where the reading
settles: a toe that comes up as the hips land is the exercise going wrong, not
an adjustment. On a recorded bridge set the biggest toe lift of the set, 25 %
of shin, was at 18 % of the way up with the hips coming down, and a floor at
the attempt line on both legs of the rep threw it away.

What happens at the start position is not unjudged — it belongs to the start
checks, and they are judged **through** the pause rather than latched on the
first still moment, so what a rep is marked with is the position it actually
began from. Someone whose feet were too close, who walks them out and settles,
has started that rep correctly; on the same recorded set that took "feet too
close" from seven reps to three, and moved "feet too far" onto the first rep,
where it belonged. A move that means to watch outside the rep says so —
`"phase": "rest"` for the pause, `"phase": "any"` for both — and those are left
alone. `minP` is unchanged: an author's extra "not until this far in", on top
of this.

### Which way to move

Over the camera the coach draws one arrow, on the joint that has to travel,
pointing where it has to go — the target on the way out, the position the rep
began from on the way back, green both ways because both are the exercise being
done. While a fault is up it is not drawn at all: the red arrow at the fault is
the only thing to do then, and two arrows saying different things is worse than
one. A ring marks where the moving point belongs, with the number beside it.

What replaced it was a line drawn where the limb should end up, which asks the
person to compare two shapes and work out the difference for themselves. The
geometry is the same either way (`coach.js` `ghostFor`), so every move that had
a line has an arrow: an angle's swinging arm, a joint that travels between two
still ends (a bridge's hip), a segment at a target tilt, a forearm rotated out
— and now also `offset`, `dist`, `gap`, `height` and `rise`, which had no line
at all. For those the reference length is read back off the measurement rather
than re-derived: the engine's number for this frame is the current geometry
over that length, so the geometry at the target is the current geometry times
target over now. A reading sitting at zero draws nothing rather than something
wrong.

### The parts that stay still

The arrow drawn over the camera has to know which end of the movement
is the anchor. It can work that out by watching which end has travelled
furthest — but not on the first rep, and not when the whole body shifts. On
the reported bridge set it never worked it out at all: the person moved
around enough that the shoulder out-travelled the hip, and the line stayed
on the arm that rides up with the hips.

`stable` says it outright: the landmarks that do not move during this
exercise, named the way a measurement names them. A bridge is
`["SH", "KNEE"]` — the hip rises between a shoulder and a knee that stay on
the floor. Told that, the arrow sits on the hip from the first frame and points
at where the hip belongs. Leave it out and the watching heuristic still
applies.

`stable` does a second job, on the drawn skeleton. The ends of the limbs are
the pose model's least certain points: on a real side-on bridge the near toe
travelled about two pixels a frame while the feet were planted, twice what
the ankle it hangs off did, and its apparent distance from the ankle swung
between 9 and 131 pixels — the landmark sliding along the foot, not the foot
moving. Three things in the smoother answer that, for every move: the hands
and feet are smoothed harder; a point cannot jump to an implausible distance
from the joint it hangs off (the ankle-to-toe length is learnt over a second
and a half, a frame that breaks it is held through, and a change that stays
for four frames is real and replaces it); and a landmark the move calls
stable is locked once it has stopped moving, released the moment it plainly
moves. A point a fault watches for its own movement — a heel that must not
lift, the shoulders a lean fault reads — is never locked, or the fault could
never fire; `ex.lockable` is the list that survives that rule. On that bridge
set the toe's worst frames went from 10 pixels of travel to 4 while the reps
and the faults counted the same.

A fourth thing was added later, for the same points. The One Euro filter under
all of this opens up with speed, so a fast limb is not smeared — and it reads
that speed off the point itself, which for a toe is mostly noise: the noise
opens the filter, the open filter passes the next frame of noise. A hand or
foot point is therefore capped at what the joint it hangs off is doing, plus a
little for what it can do on its own (a foot pitching about a still ankle), and
below `LIMB_STILL` — the joint plainly not moving — the speed term is switched
off altogether, which leaves a plain low pass at the point's own cutoff. On the
recorded bridge set that took the toe's frame-to-frame travel down by 28 % and
the heel-to-toe reading's spread over a still second from 1.59 to 1.21 % of
shin.

Two other filters were measured on that recording before settling on this,
because a filter that wins on jitter and loses on lag has not won. Both numbers
were taken against the same ground truth: the signal run forwards and backwards
through a low pass, which has no lag and which no causal filter can beat.

| on a planted foot | 1 s spread | vs truth while moving |
| --- | --- | --- |
| raw | 3.14 | 1.40 |
| One Euro, as shipped before | 1.59 | 1.13 |
| EMA, alpha 0.08 | 1.34 | 0.99 |
| Kalman, constant velocity, tuned | 2.64 | 1.41 |
| One Euro with the speed term off | **1.19** | 1.15 |

A heavy fixed EMA beats One Euro on a foot that is not moving — and on the hip
through the same reps it is 2.3 times worse (error 8.15 against 3.58), because
it cannot tell the difference. A Kalman filter loses on the foot for a reason
worth writing down: its velocity state feeds on the noise, predicts forward on
it and overshoots. On the hip it is the best of the lot (2.40 against One Euro's
3.58, with less jitter than raw) — which is a real option for the progress
measurement, and a different question from this one.

The floor was tried as a reference too: after levelling, a side-on floor move
puts heel, toe, ankle and shoulder on one horizontal line, and its height over
the whole set is an average of hundreds of frames. Judging the heel against it
came out 35 % noisier than judging the heel against the toe (1.89 against 1.40),
because the difference between two points on the same foot cancels the body's
own drift and a fixed line does not. Its one real advantage is that it would see
a whole foot lift off, which heel-to-toe is blind to by construction.

### What a threshold is worth

A threshold is only meaningful against a reading that holds still when the body
does. A hip angle read off shoulder, hip and knee sits within a fraction of a
degree between reps. Heel-to-toe height does not: the two landmarks are a few
pixels apart, near the floor, on a foot the body half hides, and the height
between them wanders a couple of percent of the shin with the feet flat on the
mat. On a real bridge set a "heels rising" written to fire at 1.5 fired on
fourteen reps out of fourteen and took two of the set's cues with it.

Filtering does not reach that. The wander is slower than a second, so a
low-pass tight enough to remove it would lag a real heel lift by as long —
measured on the recording, a rigid-foot fit and a half-second median both left
it where it was.

Knowing it does. Between reps the body has stopped, so the session samples
every reading there (`SetSession.noteQuiet`) and the middle 80 % of what a
reading did, halved, is that reading's own **wobble**, in its own units. A
fault has to clear its threshold *and* the wobble — once, even for a fault
measured as a change from the start of the rep: the start is read from a body
that has stopped (see **Has the body stopped?**), so it sits near the middle of
its own wobble and does not add a whole second one. `fault.noise` in `settings.json` tunes it; a clean
measurement wobbles near zero and is judged exactly as it always was. One
pause is whatever that half-second happened to do, so the figure used is the
middle one of the last few, which also stops it growing when the feet
genuinely move between reps. Rep moves only: a hold has no still moment that
is not the exercise itself.

The end-of-set review carries the figure per fault (`review.wobble`), and the
Studio's check step says so outright when a change threshold is smaller than
the wobble the takes measured — the tuning answer is to raise the threshold
above it or to measure something steadier, not to lower it further.

### Still is not the same as ready

The start position is read while the person holds still. Someone who lies
down with the knees pulled up, is read there, then settles into the real
start reads half a rep up before they have moved — and never comes back
below the resting threshold, so no rep ever closes (a real glute-bridge set:
seventeen bridges, none counted). Two things now catch that.

Before the first rep, a reading that has sat still for a second and a half
somewhere well above the start (between 20 % and 75 % of the way to the
target) is taken to be the start: the baselines are read again there, the
counter begins from it, the readout and the aim arrow follow, and the
diagnostics carry a `recalibrate` event. Only before the first rep, and not
when the person demonstrated the target, which lives on those baselines.

After that, a rep that comes part of the way back and settles there for a
second is over where it settled: it counts (full if the top was reached),
the next rise is the next rep, and a descent from that level to the floor is
not a rep of its own. The "return" rule is where "did not come all the way
back" belongs; the counter no longer waits forever for it.

### Faults watch the rep, not the pause

Between reps the person shifts, adjusts the mat, rests a hand on the floor.
None of that is the exercise, and flagging it is the coach talking over a
pause. A rep move's fault watches the movement unless it says otherwise:
`phase: "rest"` to watch only between reps, `phase: "any"` for both. A hold's
faults are unchanged — they watch the held position.

### Said twice, then recalled

A cue is worth hearing twice. The third time it is nagging, and it buries
whatever else the set needs. `fault.maxCues.perSet` caps every cue at two a
set; a rule name overrides it (`fast` is capped at one), and a move overrides
both with `maxCues` on the fault itself.

Counting does not stop when the cue does, so the review still knows the fault
happened on every rep. A cue that ran out of turns while the fault kept
happening is marked `capped` in the review and always named in the spoken
summary, whatever its weight — the set is not the moment to keep making the
point, and the end of it is.

### What the coach says, and when

Besides the faults, the coach speaks for itself: the opening brief, the
count-in, the number after each rep, a word for a clean one, the line for one
that did not count, a hold's seconds, the summary. Not every move wants all
of them — a set of twenty rarely wants every rep counted aloud, a slow
stretch does not want a countdown, and a clinic may want its own words.

`cues` is a block of stage: setting. `false` silences that moment; a string
replaces its words; `praise` and `mark` take lists. A stage left out behaves
as it always did. The stages, in the order a set meets them: `opening`,
`position`, `start`, `show`, `countIn`, `go`, `count`, `praise`, `partial`,
`fault`, `mark`, `enter`, `finish`, `lost`, `turn`. Step 6 of the Studio has
a row for each.

### Which cue is said

The heaviest due cue is said first — but a fault that has not been said yet
in this set comes before one that has, however heavy. Two faults on cooldown
otherwise take turns for the whole set and a third is never heard. The
cooldown itself — how long before the same cue may repeat — is
`fault.cooldown` in `settings.json`.

### Ignoring the limb the camera cannot see

The section below holds back a fault whose landmarks the model is unsure of.
A move filmed side-on and worked with both sides at once can go further and
say the far limb is not part of the exercise at all: `farSide: "ignore"`.

Then it is not drawn on the skeleton, not required in frame before a set can
start, and not measured — that last one is checked when the move is compiled,
so a progress metric, hold condition or fault naming `oKNEE`, `oANK`,
`oHEEL`, `oFOOT`, `oEL` or `oWR` is refused rather than quietly ignored. The
torso pairs are not the far side in this sense: both shoulders and both hips
are what the trunk is read from and both stay visible, so `oSH` and `oHIP`
remain yours to use.

It is refused on a face-on move, where neither limb is the far one, and on a
one-sided move, which already names the limb it works. The glute bridge sets
it. Which physical side is far is decided at run time from the pose, so a set
filmed from either side behaves the same.

### The limb the camera cannot see

Filmed side-on, the far arm and leg are behind the body. The pose model
still returns positions for them, and they look like positions; the one
thing that says otherwise is the confidence it reports, which on a real
side-on set sits near 1.0 for the near limb and around 0.5 for the far one.

So a fault is judged on what the camera can see. Every landmark it reads
must be at least `fault.unsure.vis` confident for the threshold to be the
threshold. Below that the fault is not silenced — a knee that has plainly
collapsed is worth saying whichever side it is on — but it must clear the
threshold by `fault.unsure.margin`, in the reading's own units, and hold for
`fault.unsure.persist` times as long. Below `fault.unsure.floor` the
landmarks are invention and nothing is said.

This costs the near side nothing: on the reported bridge set the near leg is
judged exactly as before, while the same fault written against the far leg
drops from seventeen firings to one. It is why a side-on move should measure
the limb nearest the lens, and why `oKNEE`-style cross-side points in a
side-on fault will mostly stay quiet.

### Is the foot on the floor?

Yes — it is a `rise` reading of the heel, the toes or the whole foot since
calibration, as a share of shin length; the person's start position is where
the floor is, so nothing has to find the floor line. `shared.json` names the
three (`heel_lift`, `toes_lift`, `foot_lift`) and ships a ready-made fault for
each (`heel_up`, `toes_up`, `foot_up`), so a move writes one line:

```json
{ "template": "heel_up" }
{ "template": "heel_up", "label": "Front heel lifting", "cue": "Front heel down" }
```

Every form‑tracked move whose foot has to stay planted now watches it — the
squats, the hinges, the wall sit, the lunge, the terminal knee extension and
the two that already read it (heel slide, calf stretch) — and the review counts
it like any other fault. The other way round (a foot that must stay *off* the
floor) is the same measurement with `"op": "<"`.

### The spoken opening

A set does not start in silence. As the camera comes up — while the person is
still getting into position — the coach says which side is being worked, the
move's `"brief"`, and the target:

> *"Left leg first. Lie on your back, working leg straight, hips and shoulders
> flat. Slide the heel toward your bottom as far as it will go, then slide it
> back out. Ten reps."*

`"brief"` is the move's own words, one or two sentences, position then movement,
with no camera talk in it — by then the phone is already placed. A both-sides run
is two halves, so the first half is announced as *"first"* and the second as
*"now the other"*; later sets of the same half get only the side and the set
number. A move with no `"brief"` is announced by side and target alone, and
`test/library.test.js` fails any camera-coached move that leaves it out.

Only one cue is spoken per rep. When a live fault and a rep rule are both due at
the same moment, the heavier one wins on a full rep and the rep rule wins on a half
rep (it is the reason the rep did not count); the other keeps its turn for a later
frame. Either way the end-of-set review counts every occurrence, spoken or not.

### Guide

The good-form detail on the set-up page. `tracked: true` marks a point the camera
actually checks; `false` is a self-check the app can only instruct. At least one
point must be `tracked`.

```js
guide: {
  surface: 'Firm floor or mat. Not a bed: a soft surface swallows the heel.',
  regions: [
    { name: 'Body position', points: [
      { t: 'Lie flat on your back, working leg nearest the camera.', tracked: true },
      { t: 'Breathe normally; do not hold your breath.', tracked: false },
    ] },
  ],
  stop: 'Sharp pain, numbness, or pain that lingers after you stop.',
}
```

## Validation

`define()` runs every move through `validate()` and **throws on anything
missing** — a half-filled move fails the build instead of reaching a user as a
blank panel. It checks the text fields, that `defaultTarget` is one of `targets`,
that each option's default is one of its values, that every fault has a cue, a
tip, a weight and a check, and that the guide has a surface, a stop line and
regions whose points all declare `tracked`.

Run `npm test` to check the library.
