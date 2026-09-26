# The exercise file

An exercise is one JSON file in `public/exercises/`, named after its id
(`bridge.json`). The file holds everything the app needs to list it, explain
it, animate it, watch it, coach it and record it. Nothing else has to change
to add an exercise: drop the file in the folder, push, and it is on the site.
`npm test` (and the Pages workflow, which runs the tests before it publishes)
rewrites `index.json` from the folder; the dev server lists the folder itself.

The Build tab of `review.html` writes these files. It checks every change
against the rules below, and when the file is whole it stands in the library
on that browser: the Recordings tab judges videos with it, the Animation tab
draws it, and *Try it live* runs it in the coach.

`public/js/spec.js` is the reader: `Spec.check(file)` lists the problems,
`Spec.compile(file, Core)` makes the move the coach runs, `Spec.blank()` is
the starter.

## The shape

```jsonc
{
  "v": 1,
  "id": "bridge",                 // one word, lowercase: the file's name and the key it is remembered by
  "name": "Glute bridge",
  "order": 4,                     // place in the list (then by name)
  "status": "ready",              // ready | draft (listed with a badge)
  "category": "Glutes and hips",
  "tags": ["floor", "lying"],     // the search finds these
  "equipment": ["a mat"],
  "type": "reps",                 // reps (a movement, counted) | hold (one position, timed)
  "position": "lying",            // standing | lying | sidelying | prone | kneeling | quadruped | seated
  "movement": "hips lifted to a line and lowered",
  "sides": "both",                // both | left | right | alternate (one side per set, the sets alternating)
  "load": "weight",               // none | weight (a kg bubble) | band (light, medium, heavy) | both
  "phone": { ... },
  "words": { ... },
  "muscles": { "glute": 1, "ham": 0.5 },
  "figure": { ... },
  "facing": { "from": "hip", "to": "knee" },
  "side": { "pick": "clearest" },
  "landmarks": { ... },
  "measurements": [ ... ],
  "progress": { ... },            // reps only
  "ready": { ... },               // optional: the start position, as a rule
  "inPosition": ["shin", "hip"],  // optional: which measurements must be good (default: every banded one)
  "prompt": { "id": "raise", "text": "Lift your hips" },   // reps only
  "faults": [ ... ],
  "draw": [ ... ],
  "defaults": { ... },
  "settings": [ ... ]
}
```

## The phone

```jsonc
"phone": {
  "orientation": "wide",     // wide (on its side) | tall (stood up) — the frame the exercise wants
  "view": "side",            // side | front — which way the body faces the camera
  "placement": "Lay the phone on its side on the floor, two or three metres away, side on to where you will be.",
  "distance": "two or three metres",
  "height": "on the floor"
}
```

If the camera gives a frame the other shape, the app says so on screen and out
loud until the phone is turned. In a front view, landmarks are named with a
side: `L.knee`, `R.knee` (see Landmarks).

## The words

| key | what it is |
|---|---|
| `start` | the opening words, said once. Nothing else is said until the start position has been held for the set-up wait. Under 160 characters. |
| `position` | the starting position, for the set-up card |
| `top` | the end position (the top of a rep, or the held position), for the reader |
| `howto` | how to do it, step by step (a list) |
| `cannot` | what the camera cannot see |
| `about` | the numbers, explained, for the exercise page |
| `hint` | one line for a card |
| `lost` | said when nobody is in the frame (every 15 s) — default "Step into the camera, side on" |
| `lower` | reps: the hold at the top is done — default "Lower slowly" |
| `early` | reps: back down before the hold was done — default "Hold it at the top next time" |
| `hold` | into position — default "That is it — hold" |
| `holdLabel` | the label of the hold setting on the exercise page |
| `safety`, `easier`, `harder`, `mistakes` | shown under the numbers on the exercise page |

New words need a clip for the natural voice: run `scripts/voice-pack.py`
once (it reads every text the library can say). Until then a new phrase is
said by the fallback voice.

## Muscles

`"muscles": { "region": effort }` with effort 0 to 1. Regions the figure can
show: `shoulder arm forearm thigh ham calf chest back abs oblique neck glute`.

## The figure

Either joint angles or points.

```jsonc
"figure": { "pose": {
  "A": { "face": "left", "torso": 72, "neck": -15, "thigh": -80, "shin": -80, "foot": -60, "uarm": -20, "farm": 70 },
  "B": { ... },            // leave out (or "hold": true) for a hold
  "wall": "behind",        // behind | ahead | none
  "hold": true
} }
```

Degrees: `torso` from vertical (+ leaning the way the body faces); `thigh`,
`shin` from straight down (+ forward); `foot` from horizontal (+ toes up);
`uarm`, `farm` from straight down. `thighF`, `shinF`, `footF`, `uarmF`,
`farmF` are the far limb when it differs. `face` is `right` (default) or
`left`.

```jsonc
"figure": { "points": { "A": { "h": [380, 144], "sh": [362, 150], ... }, "B": { ... }, "flip": true, "side": "both", "wall": 340, "props": [] } }
```

Points are what the Animation tab drags (a 400×175 space, floor at y 163);
`props` are the equipment the figure module can draw (box, bar, disc, band).

## Landmarks

```jsonc
"landmarks": {
  "joints": ["shoulder", "hip", "knee", "ankle", "heel", "toe"],   // scored for which side is clearer
  "needed": ["shoulder", "hip", "knee", "heel", "toe"],            // the frame is unusable without these
  "bones": [["shoulder", "hip"], ["hip", "knee"], ["knee", "ankle"]],
  "dots": ["shoulder", "hip", "knee", "ankle"],
  "limb": { "hip|knee": "hip", "knee|ankle": "shin" }              // which measurement colours each bone
}
```

Landmarks: `ear shoulder elbow wrist hip knee ankle heel toe`. Plain names
are taken from the side being measured; `L.knee` / `R.knee` name a side (a
front view).

`facing` says which way the body faces: from the first landmark toward the
second (`sign(to.x − from.x)`). Tilt, floor and bend readings are signed by
it, and the floor line is drawn along it.

`side` says which side is measured:

| pick | meaning |
|---|---|
| `clearest` | the side the model is surer of over `joints` (the default) |
| `left`, `right` | that side always |
| `highest` + `joint` | the side whose joint is higher (the donkey kick's knee) |
| `measure` + `measure` | the side whose measurement is larger (the knee raise's thigh) |

## Measurements

Each is a named number read every frame and smoothed.

```jsonc
{ "key": "shin", "of": "shinAngle",           // key: the band's name; of (optional): the reading's name when it differs
  "label": "toe, heel, knee", "hud": "SHIN", "note": "target",   // the live page's card, the picture's corner
  "kind": "angle", "a": "toe", "b": "heel", "c": "knee",
  "offset": 0, "times": 1, "optional": false,
  "band": { "lo": "shinMin", "hi": "shinMax" }, "scale": [40, 170],
  "settings": [{ "key": "shinMin", "label": "Shin angle, lowest", "min": 30, "max": 165 }, ...],
  "why": "a note" }
```

| kind | landmarks | reads |
|---|---|---|
| `angle` | `a`, `b`, `c` | the angle at joint b between a and c |
| `tilt` | `base`, `top` | how far base→top leans off vertical, + the way the body faces |
| `floor` | `at`, `to` | the angle at→to makes with the floor: 90 plumb, more the way the body faces |
| `bend` | `a`, `b`, `c` | how far b sits off the straight line a→c, as the bend at b, + above |
| `rise` | `a`, `b` | how far b sits above a, as the angle of the line off level, signed |
| `down` | `from`, `to` | how far from→to is lifted from straight down: 0 hanging, 90 level |
| `distance` | `a`, `b`, `per` | the distance a→b as a share of the distance per[0]→per[1] (unitless) |
| `sum` | `terms` | other measurements added: `[{ "measure": "back" }, { "kind": "rise", "a": "hip", "b": "knee", "times": -1 }]` |

`to` may be a list (`["heel", "ankle"]`): the first the model trusts is
used, and the drawing can name it as `shin:to`. `offset` is added and
`times` multiplied first (the donkey kick's arm is a tilt plus 90).
`optional` means a reading the model cannot make is not a fault and does not
fail the frame (the wall sit's shin, when the heel is hidden).

A **band** makes the measurement judged, gives it a lane on the Review page,
a card on the live page and a line on the HUD: `{lo, hi}` between two edges,
`{sym}` within ± one number, `{min}` at least, `{max}` at most. Each names a
key in `defaults`; `settings` lists the edges the person may tune, with the
slider's range. `scale` is the meter's two ends. A measurement without a band
is read, smoothed and drawn but never judged: it tells the phases apart or
picks a side.

## The movement (reps)

```jsonc
"progress": { "measure": "hip", "raiseAt": "raiseAt", "downAt": "downAt", "direction": "up" },
"prompt": { "id": "raise", "text": "Lift your hips", "tone": "up" },
"ready": { "atStart": true, "ranges": { "shin": [45, 150] } },
"inPosition": ["shin", "hip", "over", "foot"]
```

The progress measurement says how far into the rep the person is. Going
`up`, the rep is under way once it reaches `raiseAt` and counts once it is
back down to `downAt`; going `down` (a squat's knee angle) the other way
round. The hold at the top runs while the measurement is past `raiseAt` and
every measurement in `inPosition` (default: every banded one) is good. The
prompt asks for the movement and is never red.

`ready` is the start position: nothing is coached until it has been held for
the set-up wait (`readyMs`). By default a rep move's start is being below
`downAt` and a hold's is being seen; `ranges` adds readings that must be in
range (the bridge: lying with the knees bent).

## Faults

In the order they are corrected — the chain of cause, not size: what the rest
of the body stands on comes first (feet before knees before hips; hands and
arms before the back before the leg). When several are wrong the earliest is
said, whatever their sizes.

```jsonc
{ "id": "feetFar", "measure": "shin", "side": "above",
  "label": "Feet too far out",                 // on the picture: 26 characters at most
  "text": "Walk your feet in",                 // said
  "deep": "Walk your feet in toward you — they are well out",   // said when far past the band (deepAt)
  "setup": true,                               // coached at the start, before the movement is asked for
  "requires": ["foot"],                        // only judged while these measurements are good
  "unless": ["liftHigh"],                      // not while these faults are on
  "tone": "walking in" }
```

`side` is `above` or `below` the band. Tones: `tick` (default), `plain`,
`up`, `down`, `walking in`, `walking out`, `hold`, `done`, `call`.

## Drawn on the picture

Shown when angles are switched on; the skeleton's colours and the words show
the verdict without them.

```jsonc
"draw": [
  { "kind": "arc", "measure": "knee", "size": 1, "tone": "none", "goodOf": ["lift", "over"] },
  { "kind": "readout", "measure": "over", "at": "hip", "side": 1 },      // side: 1 below, -1 above, "sign"
  { "kind": "plumb", "at": "hip", "share": 0.3 },                         // negative share: downward
  { "kind": "floor", "at": "shin:to", "dir": -1 },                        // dir 1 the way the body faces
  { "kind": "line", "from": "knee", "to": "shoulder", "good": "hip" }
]
```

An arc is drawn where its measurement is taken: at the joint for `angle`,
from vertical for `tilt`, from the floor for `floor`, from straight down for
`down`, showing the raw geometric value.

## The numbers

`defaults` holds every number the exercise is judged and timed by: the band
edges the measurements name, `raiseAt`/`downAt`, and any of the shared
settings a file wants to change. The shared ones and their app-wide defaults:

| key | default | meaning |
|---|---|---|
| `holdTargetSec` | 60 | a hold's target; a rep's hold at the top |
| `callAtSec` | [45, 30, 10, 5] | seconds left at which the time is called |
| `repCount` | — | reps in a set (10 in every file so far) |
| `setCount` | 3 | sets in a session |
| `lowerSec` | — | "lower slowly" is judged: a lowering quicker than this is remarked on |
| `restSec` | 2 | the quiet after a rep is counted |
| `readyMs` | 2000 | the start position held this long before coaching begins |
| `deepAt` | 18 | degrees past the band at which the stronger words are used |
| `persistMs` | 500 | a fault holds this long before it is said |
| `cooldownMs` | 4000 | the same cue not again inside this |
| `gapMs` | 1500 | no two cues inside this |
| `settleMs` | 700 | in position this long before the clock starts |
| `lostEverySec` | 15 | "I can't see you" every this |
| `smooth` | 0.35 | smoothing on the readings (1 = none) |
| `vis` | 0.5 | a landmark below this is not trusted |

`settings` lists the exercise's own numbers offered under "Every number" on
its page (a band's edges are offered by the measurement):

```jsonc
"settings": [
  { "key": "repCount", "label": "Reps in a set", "min": 1, "max": 50 },
  { "key": "raiseAt", "label": "Hip angle that counts as lifted", "min": 120, "max": 175 }
]
```

## What a new exercise may need, and where it goes

- **Front-on moves** (squats, lateral raises, hip abduction): `phone.view:
  "front"`, landmarks named `L.knee` / `R.knee`, `distance` for a gap
  between the knees against the ankles, `angle` and `tilt` as usual.
- **Moves that go down first** (a squat, a lunge): `progress.direction:
  "down"`.
- **One side at a time**: `sides: "left"` / `"right"` with `side.pick` the
  same, or `"alternate"` for a set per side.
- **A weight or a band**: `load`. The page offers the bubble; the number is
  remembered per exercise and written in the history.
- **A stretch or a timed position**: `type: "hold"` with bands on the angles
  that make the position.
- **Symmetry** (both sides together): a `sum` of two readings with one
  `times: -1`.
- **A base that decides the rest** (feet before hips): `setup` faults,
  `requires`, and the order of the list.
- **Equipment in the picture**: `figure.points.props`, drawn behind the figure.
- **Tempo**: `lowerSec` judges the way down. The way up is not judged yet.
- **A per-rep alternation** (lunges swapping legs each rep) and two-phase
  movements are not in the coach yet; the file has no field for them, so a
  file cannot ask for them by mistake.
