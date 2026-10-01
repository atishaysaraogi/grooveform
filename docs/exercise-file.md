# The exercise file

An exercise is one JSON file in `public/exercises/`, named after its id
(`bridge.json`). The file holds everything the app needs to list it, explain
it, animate it, watch it, coach it and record it. Nothing else has to change
to add an exercise: drop the file in the folder, push, and it is on the site.
`npm test` (and the Pages workflow, which runs the tests before it publishes)
rewrites `index.json` from the folder; the dev server lists the folder itself.

The Build tab of `review.html` writes these files. It checks every change
against the rules below, and when the file is whole it stands in the library
on that browser: the Recordings tab judges videos with it, the Build tab
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
| `edge` | said when a needed landmark is at the picture's edge, on the same slow clock as `lost` and instead of it; `{joint}` is filled with the part — "left foot", "right hand" — default "Your {joint} is at the edge of the picture — move so all of you is in" |
| `framing` | said once during the set-up wait when a needed landmark is inside the picture but within two margins of its edge — default "Your {joint} is close to the edge of the picture — move back a little, so there is room round you". Neither is one of the person's faults: not in the fault order, never in a rep's account |
| `dark`, `backlit`, `blend` | the light and the background, said once a set during the set-up wait when the picture calls for it: too dark (mean brightness under 0.22, or half the picture crushed black); a window or lamp behind (a good share of the picture blown white round a dark body); the body within 0.07 of the rest in brightness and 0.08 in colour — defaults "It's dark here — turn a light on, or face one", "You're against the light — turn so the light falls on you", "You blend into the background — a plain wall behind you, or a different top, would help" |
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

A point may carry a third number, its depth: how far from the camera, + away,
in the same units. The camera's view ignores it; the editor's *From above*
tab draws x against depth with the camera at the bottom of the picture and
drags depth alone (what hangs off a joint comes along), and *Isometric* shows
both together, as a look. A point without a depth sits at the camera's own
plane; a far limb (`knF`, `anF`, `heF`, `ftF`, `elF`, `wrF`) a little behind.
`"second": "top"` or `"iso"` on the points makes the exercise page show that
angle as a plain stick figure under the muscle figure, for a movement that
comes toward the camera or goes away from it, which the camera's view alone
cannot show.

Points are what the figure editor in the Build tab drags (a 400×175 space, floor at y 163);
`props` are the equipment the figure module can draw (box, bar, disc, band).
Every exercise page draws the figure from its file, nothing else, so an
edited file is what shows.

### Editing an existing exercise's animation

1. Open `review.html` (the ◔ button) and pick the exercise in the dropdown.
2. Build tab → *Edit a copy of the exercise selected above*. It is a draft now,
   and step 2 of the form, *The movement, drawn*, holds its figure. A figure
   the file gives as angles is turned into points there.
3. Press *A — start* or *B — end* and drag the joints. As in the old Studio's
   figure builder, dragging a joint turns the bone above it and carries
   everything below it round, so every limb keeps its length; the hip drags
   the whole body; the other keyframe sits behind, faint. *Stretch limbs*
   (or shift for one drag) moves the joint itself and changes the bone's
   length instead. *Copy this pose onto the other* and *Undo my edits* are
   there for the rest. The feet — heel and toe — are handles too, added to a
   figure that lacked them. Set *Holds still*, *Faces*, *Working side*, the
   wall, and under *Muscles working* the sliders. Every drag goes straight
   into the draft; nothing has to be copied across.
4. The problems list should stay clear. *Try it live* opens the exercise's
   page in the coach with the new figure animating over the top half.
5. *Download the file* and replace `public/exercises/<id>.json` with it, then
   commit and push. Then *Drop the draft* on either page, so the browser uses
   the library's copy again.

### Building an exercise from nothing

The Build tab starts from a pose: side on or facing the phone × standing,
seated, kneeling, on the back, on the front, on all fours, on the side. The
pose sets the body position, the phone's orientation, which way the body
faces, the placement words and the opening words; each stays the template's
until edited, and a *use the template* link puts it back.

Step 3, *What is measured*, works as the old Studio's did, and the drawing
has no say in it: dragging the figure changes the demo and the values shown
on the cards, nothing else; the figure itself is not repeated in this step.
*Add a measurement* makes a card; on it, the
kind — angle at a joint, segment from vertical, segment from the floor,
lifted from hanging, height of a point over another, distance as % of a
segment, a point's offset from a line — and a slot for each of the kind's
points. A slot opens a list of every landmark (ear, shoulder, elbow, wrist,
hip, knee, ankle, heel, toe; the side being measured and the other side, or
left and right in a front view), or a tap on the figure below fills the slot
being edited and moves on to the next. On an angle with nothing filled, one
tap on a joint fills all three slots from the limbs meeting there. Each
finished measurement reads its value at A and at B off the drawing, for
reference.

*Measured as* says what the reading is: the value as is; the change from where
it stood at the start (`fromStart: "change"`); or a percentage of where it
stood at the start (`fromStart: "ratio"`) — so a segment's length as seen by
the camera can be judged against its own length at the start, which is how a
foot turning away from the camera, or a limb coming towards it, shows. The
coach takes the baseline the moment the set-up wait ends.

Each card carries a role:

| role | in the file |
|---|---|
| tracks the rep | `progress` on it, `raiseAt`/`downAt` as settings, a band it must be inside at the top with a short and a too-far fault |
| must be right | a band, in `inPosition` — the hold clock stops while it is out — with faults either side |
| a note | a band and faults, left out of `inPosition`: called, but the count goes on |
| just a reading | no band: on the picture only |

The rule is written as a sentence: *when* it is checked — at the top of the
rep, through the whole rep, or at all times, before the rep too — then *it
must be* between two edges, at least, at most, or within ± of zero, the
numbers typed with their units (degrees, or percent for a length); the rep's
two thresholds the same way. Each starts from a default for the kind. *From the drawing* fills them from
the figure on request: the edges around the value at B, the thresholds
between A and B. Every band comes with a fault a side, worded from a
template and rewritten on the card; *Add a fault* adds another. Landmarks,
`needed`, bones, the skeleton's colours and the drawing list are derived from
the measurements; everything else the file allows is under *More* on each
card and each step. A new rep exercise asks for no hold at the top: the rep
counts on reaching the top and coming back, until the hold field says
otherwise.

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
front view); `other.knee` names the side *not* being measured — the resting
leg, which is how the straight leg raise measures its lift against the leg
on the floor rather than the floor itself, and needs no shoulders in the
picture. A `needed` list of hips and below is enough for a frame; the
shoulders only have to be seen if a measurement uses them.

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

`hold` keeps a side once picked: `{ "margin": 0.25, "frames": 5 }` means the
other side is measured only once it leads by a quarter of the hip-to-joint
distance (for `measure`, by that much of the measurement) for five frames in
a row, or at once when the held side can no longer be seen. Without it the
higher of two level knees changes from frame to frame on the model's wobble,
and the drawn leg and every number jump between the two sides' points (a
recorded straight leg raise flipped 47 times in a minute; with the hold, once).
Each new session starts afresh.

## Measurements

Each is a named number read every frame and smoothed.

```jsonc
{ "key": "shin", "of": "shinAngle",           // key: the band's name; of (optional): the reading's name when it differs
  "label": "toe, heel, knee", "hud": "SHIN", "note": "target",   // the live page's card, the picture's corner
  "kind": "angle", "a": "toe", "b": "heel", "c": "knee",
  "offset": 0, "times": 1, "bias": 0, "unseen": null, "gate": null, "optional": false,
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
`times` multiplied first (the donkey kick's arm is a tilt plus 90). `bias`
is taken off last and is for a known slant in the model's landmarks: a
number, or the key of a setting so it can be tuned (the bridge's foot line
reads about nine degrees heel-up when the foot is flat, because the model
puts its heel landmark on the heel bone above the sole; `"bias":
"footBias"` with `footBias: 9` in `defaults` makes flat read level).
`optional` means a reading the model cannot make is not a fault and does not
fail the frame (the wall sit's shin, when the heel is hidden). `unseen` is a
number the measurement reads instead when a landmark it needs is hidden or
below the trust bar: the straight leg raise's lift reads 0 when the far knee
is hidden behind the near one, because a leg the camera cannot see beside its
twin is lying on it — and that landmark is then left out of `needed`, so the
frame is not lost. `gate` makes a reading stand only while an earlier
measurement is within `min`/`max` (numbers, or settings' names); otherwise it
is null, not judged, and with `optional` the frame stands. The side-lying
raise's toe angle is gated on the foot's length against the shin, so it is
read only when the foot is long enough in the picture to be in profile.
`fromStart` reads the measurement against the start position: `"change"` is
the reading less its value when the set-up wait ended, `"ratio"` is percent
of that value. Until the wait ends the baseline follows the person, so the
reading is no change and the start position can be held; then it is frozen
for the set. A length seen by the camera shortens as the limb turns toward
it, and `"ratio"` on a `distance` is how that turning is measured — an arm
raised toward the phone, a thigh drawn up in a front view.

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
every measurement in `inPosition` (default: every banded one) is good. A
banded measurement left out of `inPosition` is still called as a fault but
does not stop the clock: the straight leg raise's position is the knee and
the lift, so a rep with the toes pointed is counted and told about, rather
than never counted (a recorded take held six clean seconds at the top with
the toes pointed and got nothing for it). The prompt asks for the movement
and is never red.

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
  "when": "always",                            // top (default: judged while the rep is up) | rep (up and lowering) | always (between reps too)
  "requires": ["foot"],                        // only judged while these measurements are good
  "unless": ["liftHigh"],                      // not while these faults are on
  "tone": "walking in" }
```

`side` is `above` or `below` the band. `when` says when the fault is judged:
`top`, the default, while the rep is up (the hold at the top); `rep`, from the
lift to the return, lowering included; `always`, between reps as well, so the
feet are coached before the lift is asked for (`setup: true` is the old
spelling of `always`). A hold judges every fault all the time. Tones: `tick` (default), `plain`,
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
| `returnMs` | 400 | back at the start this long before a rep is over: a frame or two of the model swapping the legs is not a return |
| `lostEverySec` | 15 | "I can't see you" every this |
| `smooth` | 0.35 | smoothing on the readings (1 = none), after a median of the last three frames that drops a single wild one |
| `vis` | 0.5 | a landmark below this is not trusted |
| `edge` | 0.03 | a needed landmark nearer the picture's edge than this share of it, or past it, is not trusted — the model goes on placing a foot that has left the frame, at 60–98% certainty in recorded takes |
| `drop` | 0.25 | near the edge (inside three margins), a needed landmark whose certainty has fallen this far below its best of the last ten frames is not trusted — the slide that comes as a limb goes out, caught before the certainty bar is |
| `jump` | 1.5 | a landmark that moves faster than this many body-diagonals a second (never under 5% of the diagonal a frame) has snapped to the background or the legs have swapped: it is held where it was |
| `jumpHold` | 2 | for at most this many frames, after which the new place is believed — a real, fast movement is late by two frames at most |

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
- **A limb that hides behind its twin** (the far leg, side on, when both are
  down): `unseen` on the measurement, and the landmark left out of `needed`.
- **A landmark the model places off the body** (the heel above the sole, the
  hip a little forward): `bias` on the measurement, as a setting.
- **A base that decides the rest** (feet before hips): `setup` faults,
  `requires`, and the order of the list.
- **Equipment in the picture**: `figure.points.props`, drawn behind the figure.
- **Tempo**: `lowerSec` judges the way down. The way up is not judged yet.
- **A per-rep alternation** (lunges swapping legs each rep) and two-phase
  movements are not in the coach yet; the file has no field for them, so a
  file cannot ask for them by mistake.
