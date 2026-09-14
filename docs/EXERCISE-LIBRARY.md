# The exercise library

The library is **data**. Every one of the 144 moves — the ten vetted ones
included — lives in a JSON file under `client/data/moves/`, one file per body
region, and each file opens with a guide to every field it may contain — what
it means, what good and bad input look like. Edit the file, reload the page, and
the move is different. Nothing about a move is spread across other files, and
nothing about a move is code.

```
client/data/
  manifest.json          which files make up the library (add a line, add a file)
  settings.json          numbers and words every move shares: rep thresholds, fault timing,
                         band colours, scoring, the standard faults
  shared.json            named measurements ("knee"), fault templates ("lean"), pose presets
                         ("standing"), hold sets ("balance") — referred to by name from the moves
  moves/
    knee.json            one body region per file, a dozen or so moves each
    hip.json  ankle.json  shoulder.json  spine.json  core.json  elbow_wrist.json
    gym_lower.json  gym_upper.json  dance.json
client/coach/
  exercise-library.js    the registry: define(), validation, lookup
  engine.js              kinematics, smoothing, rep counting, set review
  spec.js                compiles a declarative move into a rep counter and fault checks
  catalog.js             reads the data files, checks every field name, builds the moves and
                         the joint-angle figures
scripts/catalog.js       the offline tool: check · list · new · remove · format · sync-docs
```

`engine.js` publishes a kinematics toolkit into the registry and exposes
`EXERCISES` — the registry's own array, sorted by each move's `order`. The server
derives `/api/exercises` from it, so a new move shows up everywhere at once:
catalogue, exercise page, routine builder, static build.

## Editing the library

There are three ways in, all ending in the same JSON file:

**In the Studio** (`/studio/`, see `docs/STUDIO.md`). Pick any move from the
dropdown and press *Edit a copy*, or *New move*. The seven steps edit every
field, and step 7 either **saves the file into the project** — when the site is
run locally with `npm run dev` — or **downloads the region file** to drop into
`client/data/moves/`. Either way the file is checked before it is written; a
problem is reported by file and move.

**In a text editor.** Open `client/data/moves/<region>.json`. The `_about` block
at the top explains every field with good and bad examples. Copy a move that
looks like the new one, change every field, give it a new id. Save; reload. A
mistake — a missing comma, a mistyped field, a fault with a measurement but no
threshold — is shown on screen in place of the exercise list, naming the file,
the move and (for a field name) the nearest correct spelling.

**From the command line**, no server needed:

```
node scripts/catalog.js check              every file: parse, field names, names in shared.json, the library's rules
node scripts/catalog.js list [knee]        ids and names
node scripts/catalog.js new knee my_move   append a template with placeholder text to fill in
node scripts/catalog.js remove my_move     delete a move from whichever file has it
node scripts/catalog.js format             rewrite every file in the shared style
node scripts/catalog.js sync-docs          copy the field guide from the first moves file to the others
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
A change there moves all 144 moves at once; restart the server to pick it up.

## The measurement language

Everything a move judges is written with the same small vocabulary, and the
Studio, the coach and the tests all read it through one compiler
(`coach/spec.js`). A measurement is `{ "kind", "pts" }` plus, when needed,
`"per"` (what a percentage is of: `"torso"` or a segment `["KNEE", "ANK"]`,
measured at calibration so it scales to the person), `"sign"` (`"outward"`
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
compare against the calibrated start, `"minP"` to wait until the rep is under
way, `"persist"` before it is spoken, and — where a plain threshold is not
enough — `"when"` (gates: an option value, another measurement's comparison,
`"inPosition"` / `"notInPosition"`), `"phase"` (`"moving"`, `"rest"`, or
`"any"` for a hold fault that must fire while the person is *out* of position)
and `"scale"` (a threshold that grows with another reading). Rules that need no
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
recordings in the Studio — see *The tuning method* in `docs/STUDIO.md`. Every move is listed; the
vetted ones simply sort into the first group. The exercise page, the move
list and the routine builder all name the tier in the move's meta line.

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
| `phase` | limit it to `'moving'` / `'hold'` |
| `onRep` | judge the finished rep instead of each frame: `check: (rep) => …` |
| `check` | `(m) => boolean` over the object `measure` returned (or `(rep)` when `onRep`) |

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
