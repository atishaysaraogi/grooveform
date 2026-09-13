# The exercise library

Every move lives in its own file under `client/coach/library/`. That file holds
**everything** about the move — what it is, where the camera goes, what counts as
a rep, how it is measured, the faults with their spoken cues and written tips, and
the full set-up guide. Nothing about a move is spread across other files.

```
client/coach/
  exercise-library.js    the registry: define(), validation, lookup
  engine.js              kinematics, smoothing, rep counting, set review
  spec.js                compiles a declarative spec into a move
  catalog.js             builds many moves from compact physio data + joint-angle figures
  library/
    heelslide.js         one hand-written, vetted move per file
    hipabd.js
    …
  catalog/
    knee.js              one body region per file, a dozen or so moves each
    hip.js  ankle.js  shoulder.js  spine.js  core.js  elbow_wrist.js
    gym_lower.js  gym_upper.js
```

`engine.js` publishes a kinematics toolkit into the registry and exposes
`EXERCISES` — the registry's own array, sorted by each move's `order`. The server
derives `/api/exercises` from it, so a new move shows up everywhere at once:
catalogue, exercise page, routine builder, static build.

## Three ways to write a move

A move is **hand-written** (a factory returning the object below — the ten
vetted moves), a **spec** written in the Studio (`/studio/`, see
`docs/STUDIO.md`): a JSON of named landmarks and thresholds that
`coach/spec.js` compiles into the same shape at load time, or a **catalogue
entry**: the physio's record of a move (what, where the phone goes, dosage,
faults, guide, sources) plus, where one camera can measure it, the same spec
fields. All three register through `define()` and pass the same validator.
Spec moves are the normal path for a move that comes out of a session with a
physio; hand-written ones are for anything the spec language cannot say (a
phase machine, a custom side rule); the catalogue is the breadth — every
physio and gym move we could document, whether or not a phone can track it.

## Tracking tiers and the vetted flag

Every move states honestly what the camera does with it, in `tracking`:

| tier   | the camera…                                   | the app…                                              |
|--------|-----------------------------------------------|-------------------------------------------------------|
| `form` | counts reps / times the hold **and** judges form | runs the live coach with spoken cues                   |
| `reps` | counts reps / times the hold only             | runs the live coach; form faults are listed for you    |
| `none` | cannot measure anything useful                | shows the guide and a counter or timer; you log by hand|

`vetted: true` marks the moves that have been checked rep by rep against
recordings (today: the ten hand-written ones). The switch in the topbar shows
either the vetted moves or the full library; a direct link to any move works
in both. The exercise page, tiles and routine builder carry a badge for the tier.

Validation follows the tier: a `none` move has no `calibrate`/`measure` and its
faults have no `check`; a `reps` move's faults may be documentation only
(`tracked: false`); a `form` move must have at least one fault the camera
actually checks live.

## The catalogue

`client/coach/catalog/<region>.js` calls `FyzioCatalog.defineCatalog(group, entries)`.
The group carries defaults (region, camera, sources); each entry is the record a
physio fills in:

```js
{
  id: 'slr', name: 'Straight leg raise', type: 'reps', view: 'side', tracking: 'form',
  level: 'beginner', equipment: ['none'], muscles: { primary: ['quadriceps'], secondary: [] },
  sided: { limb: 'leg', by: 'camera' },
  summary, setup, why,                         // the same text fields as any move
  camera: { height: 'floor', distance: '2 m', posture: 'lying' },
  tempo: 'Lift 2 s, hold 2 s, lower 3 s.', dosage: '2–3 × 10 each leg.',
  progression: '…', regression: '…', contraindications: '…',
  progress: { metric: { kind: 'vertical', pts: ['HIP', 'KNEE'] }, start: 'calibrated', target: 35, targetIsDelta: true },
  faults: [
    // with metric/op/threshold → checked live (the move is then at least `reps`, `form` if any fault is live)
    { id: 'kneebend', label: 'Knee bending', cue: 'Lock the knee', tip: '…', severity: 3, metric: KNEE, op: '<', threshold: 165 },
    // without → listed for the person to watch
    { id: 'arch', label: 'Lower back arching', cue: 'Back flat', tip: '…', severity: 2 },
  ],
  guide: { surface, stop, cannotSee, regions: [{ name, points: [{ t, tracked }] }] },
  pose: { A: { face: 'right', torso: -90, thigh: 90, shin: 90 }, B: { …, thigh: 125, shin: 125 }, work: { thigh: 1 } },
}
```

`pose` gives the two keyframes of the figure as **joint angles** (see the header
of `catalog.js` for the conventions) and `catalog.js` turns them into the
points the anatomy figure draws, so a hundred figures can be written by hand
without any of them getting a limb of the wrong length. `face` is the way the
front of the body points ('right' by default), which is what puts the chest
and quads on one side and the back and glutes on the other. Both keyframes
are placed with one transform and the joint that is on the floor in both
(the planted foot) is held still, so a sit-to-stand keeps its feet where they
were; `anchor` names another joint (or `null` for none), `lift` raises the
second keyframe (a jump), `raise` lifts both off the floor (a hang). `props`
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

`test/library.test.js` checks every catalogue entry: the physio fields, at least
two faults with a cue that differs from the tip and is short enough to speak,
a `cannotSee` line, a figure, and that the tier is honest (a `none` move has no
checks and no guide point claiming the camera watches it; a `form` move has a
live fault).

## Adding a move

For a catalogue move: add an entry to the matching `client/coach/catalog/<region>.js`
(or a new region file, listed in `index.html` after `coach/catalog.js`) and run
`npm test`. For a hand-written move, two steps.

1. Create `client/coach/library/<id>.js` (filename must equal the move's `id`).
2. Add one line to `client/index.html`, next to the others:
   `<script src="coach/library/<id>.js"></script>`

That is all. `engine.js` finds the file by itself on the server and in tests; the
`<script>` tag is only because the browser cannot read a directory.
`test/library.test.js` fails if the folder and `index.html` disagree, so a
forgotten tag is caught rather than silently dropping the move in the browser.

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
| `cooldown` | milliseconds before the same cue is spoken again |
| `phase` | limit it to `'moving'` / `'hold'` |
| `onRep` | judge the finished rep instead of each frame: `check: (rep) => …` |
| `check` | `(m) => boolean` over the object `measure` returned (or `(rep)` when `onRep`) |

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
