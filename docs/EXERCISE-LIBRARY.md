# The exercise library

Every move lives in its own file under `client/coach/library/`. That file holds
**everything** about the move — what it is, where the camera goes, what counts as
a rep, how it is measured, the faults with their spoken cues and written tips, and
the full set-up guide. Nothing about a move is spread across other files.

```
client/coach/
  exercise-library.js    the registry: define(), validation, lookup
  engine.js              kinematics, smoothing, rep counting, set review
  library/
    heelslide.js         one move, one file
    hipabd.js
    …
```

`engine.js` publishes a kinematics toolkit into the registry and exposes
`EXERCISES` — the registry's own array, sorted by each move's `order`. The server
derives `/api/exercises` from it, so a new move shows up everywhere at once:
catalogue, exercise page, routine builder, static build.

## Adding a move

Two steps.

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
| `identifyLimb` | `'arm'` / `'leg'` to have the user pick a side by lifting it |
| `calibrate` | reads the still start frame, returns the baselines `measure` compares against |
| `measure` | per frame; returns `p` (0→1 through the movement) plus whatever the faults check |

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
