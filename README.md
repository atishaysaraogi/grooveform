# Form Coach

A side-on coach for held positions, running entirely in the browser. Put the
phone on the floor, step into the frame, and it watches the angles that decide
whether the position is right, says the one thing to change, counts down the
hold, and hands you a recording of the set with the cues on it.

**Live:** https://atishaysaraogi.github.io/grooveform/

Two exercises so far: **wall sit** and **elbow plank**. Nothing is uploaded —
the pose model, the coaching and the video file are all made on the device.

## Starting

The front camera opens first, because it is the one you can see while you are
setting the phone down. Starting the camera *is* starting the set: it says out
loud where to put the phone and to step into the frame, and it is already
recording by the time you are in position. Asking for a second tap would be
asking someone to walk back to a phone they have just put on the floor.

The picture and the set button sit together at the top of the page, so nothing
has to be scrolled to from the floor.

**Which way round the phone goes.** A wall sit is a standing body and fits a
frame either way up. A plank is long and low: in a tall frame it either loses
the feet or shrinks to a line across the middle, and angles read off a handful
of pixels are not worth reading. So the plank asks for the phone on its side,
asks the camera for a wide frame, and if what arrives is taller than it is wide
it says so — on screen and out loud — until it is turned.

**Nothing is ever stretched.** The canvas takes the shape the move wants, and the
camera frame is fitted inside it whole: all of the picture, none of it distorted,
with bars at the edges when the two shapes differ. Filling the canvas by
stretching would be worse than a border, because a squashed body reads squashed
angles and every threshold here is an angle. The skeleton is drawn into that
fitted rectangle rather than the whole canvas, and the angles are worked out in
the camera frame's own proportions, so the numbers do not move when the shapes
do. The box on screen is the canvas's shape, so what you watch and what
downloads are the same picture.

**Turning the phone mid-session.** Laying the phone down changes the frame the
camera gives. Between sets the canvas follows it, which is how turning the phone
takes effect. During a set it does not: a recording that changes shape halfway
through is not a file most players will take, so the canvas is held and the
fitting absorbs the change instead.

**Out loud.** Every cue is spoken as well as written. Three things make a
browser swallow speech quietly, and all three are handled rather than left to
chance: Safari only begins speaking from inside a user gesture, so the engine is
woken silently on the tap that starts the camera, long before the first cue —
by the time the camera and the model have loaded, the gesture is gone. Chrome
drops an utterance queued in the same turn as a cancel, so the next one waits a
tick. And Chrome leaves the engine paused after a spell of silence, so every cue
resumes it first. If the browser has no speech at all, the voice button says so
instead of the page just being silent.

## What it measures

**Wall sit** — side on, back against a wall.

| | |
|---|---|
| **Knee angle** | at the knee, between hip and ankle. 90° is thighs parallel to the floor. The band is **85–110°**: above it the legs are too straight, below it you are too deep. |
| **Shin** | the angle the knee→heel line makes with the floor. Plumb is 90° and the band is **85–95°**. Past 95° the heels are ahead of the knees, under 85° they are behind them, so one number carries both the fault and the direction the feet have to move. |
| **Back** | how far the hip→shoulder line leans off vertical, allowed **±12°**. |

**Elbow plank** — side on, forearms down.

| | |
|---|---|
| **Arm** | the upper arm's lean off vertical, which is where the shoulder sits over the elbow. Allowed from **5° behind to 15° in front**: the band is not symmetric because a shoulder behind the elbow is the joint taking the load at its weakest, while a little in front is normal. |
| **Hip** | how far the hip sits off the straight line from shoulder to ankle, as the angle the body bends at the hip. Allowed **±5°**. Above the line the hips are piked and are told to come down; below it they are sagging and are told to lift. |

The plank wants the phone on its side; the wall sit takes it either way.

Every threshold is a setting. Both numbers are on screen, on a meter with the
target band marked, and burnt into the recording.

**Degrees, not distances.** Every measurement is an angle, so none of them
change with how far away the camera is or how tall you are. One threshold means
the same thing on every body and at every range, and a test can prove it: the
plank suite reads the same plank at half the size in frame and checks the
numbers do not move.

**What it cannot see.** The spine rounding between hip and shoulder. No pose
model gives a mid-spine point, so both moves judge that line by its ends and
nothing more.

## What it says

One cue at a time, spoken and written, and only when it has held for half a
second — an instruction given for a flicker is noise. The same cue is not
repeated inside its cooldown (4 s by default), and no two cues are said within
1.5 s of each other, so two faults coming ready together are spoken one after
the other rather than on top of each other.

| | |
|---|---|
| heels ahead of the knees | *Bring your feet back* |
| heels behind the knees | *Bring your feet forward* |
| legs too straight | *Lower down* / *Slide further down the wall* |
| too deep | *Come up a little* / *Come up — that is too deep* |
| back off the wall | *Press your back flat to the wall* |
| hips ahead of the shoulders | *Bring your hips under your shoulders* |
| shoulders behind the elbows | *Bring your shoulders over your elbows* |
| shoulders too far forward | *Bring your shoulders back over your elbows* |
| hips piked | *Lower your hips — shoulders to heels in one line* |
| hips sagging | *Lift your hips — shoulders to heels in one line* |
| just right | *That is it — hold*, once, and the clock starts |

Each fault has a stronger form used when it is well past its band.

**The order.** When more than one is wrong they are corrected in the chain of
cause, not by how far out each is: **feet, then knee, then back** for the wall
sit, **shoulders, then hips** for the plank. Where the feet or the elbows are
decides what the rest of the body can reach, so a correction further along the
chain asks for something the base will not give. A shoulder six degrees behind
the elbow is said before hips twenty degrees off the line, and that is the
point of the rule rather than a flaw in it.

## The set

Sixty seconds, counted down from the moment the position is right. The clock is
spent from time **in position**, so coming out of it pauses the clock rather
than running it down — sixty seconds means sixty seconds of the exercise. It
starts after 0.7 s in the bands and stops the instant any of them is broken.
The time left is called out at 45, 30, 10 and 5 seconds, and those calls jump
the 1.5 s queue, because "ten seconds left" said two seconds late is a lie. The
target and the moments it is called are both settings.

## The recording

The canvas **is** the recording: camera frame, skeleton, every angle drawn where
it is measured, the lines each is judged against, the readings, the countdown and
the cue banner are all painted onto it, so the file you download is the picture
you watched. Cues are also mixed in as tones — a browser will not let a page
capture its own speech, so the words are on the picture and a matching tone is
on the audio track. MP4 where the browser can write one, WebM where it cannot.
There is a plain-text cue log with timings beside it.

## Running it

```sh
npm run dev        # http://localhost:8000 — localhost counts as secure, so the camera works
npm test           # the measuring and the coaching, against bodies posed to a known angle
npm run smoke      # a real browser: canvas, cues, MediaRecorder  (needs playwright)
```

No dependencies and no build step. `public/` is the site; the Pages workflow
uploads it as it stands.

```
public/
  index.html
  styles.css
  js/core.js       geometry, the hold clock, the countdown, the cue rules — no move knows
  js/moves.js      the exercises: what each measures, allows and says, and in what order
  js/app.js        camera, drawing, voice, recording
test/
  wallsit.test.js  the wall sit, against synthetic bodies
  plank.test.js    the plank, likewise
  smoke.mjs        the browser, with the pose model stood in for
```

## Adding a move

A move is data plus two functions. `read` turns landmarks into named angles;
`judge` turns those into a verdict and a set of faults with how far out each one
is. Everything after that — the clock, the countdown, the persistence and
cooldown and the one-at-a-time rule — is in `core.js` and is the same for every
move. The readouts, the settings inputs, the heads-up display and the skeleton's
colours are all built from the move's own description of itself, so adding an
exercise means describing it, not rewriting the app.

Settings are remembered in the browser per exercise, and the store carries a
version: when a default band changes, a store written under the old one is
dropped rather than quietly holding the old band on a page that says it uses the
new one.

## Testing

Every number the app acts on is held against a body built to read exactly that
number. Each rig builds the body backwards from the angles wanted, and builds
them independently: the wall sit's shin is laid down at the angle asked for and
the thigh swung off it by the knee angle; the plank's arm and body are built
apart, and the body is bent *at the hip* so every limb keeps its length whatever
the sag is. A rig that could not pose one fault without the other could not tell
you the cues were right.

`smoke.mjs` then drives a real browser with the pose model stood in for, through
both exercises, and ends by downloading the video and checking there are frames
in it. It also watches what is handed to the speech engine: headless Chromium
makes no sound, but a cue that never reaches the engine is silent on a real
phone too, so the suite checks that every cue in the log was also spoken.

## History

Everything before this — a whole exercise library and coaching engine — is on
the `archive/ontrack` branch, untouched. To bring it back:
`git checkout archive/ontrack`.
