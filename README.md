# Wall Sit Coach

A side-on wall sit coach that runs entirely in the browser. It watches your knee
angle and your back, says what to change while you hold, and hands you a
recording of the set with the cues on it.

**Live:** https://atishaysaraogi.github.io/grooveform/

Point a phone at yourself side on, back against a wall, whole body in frame.
Nothing is uploaded — the pose model, the coaching and the video file are all
made on the device.

## What it measures

| | |
|---|---|
| **Knee angle** | the angle at the knee between hip and ankle. 90° is thighs parallel to the floor, shins vertical. The band is **85–110°**: above it the legs are too straight, below it you are too deep. |
| **Back** | how far the line from hip to shoulder leans off vertical. Against a wall it should be straight up; the default allows **±12°**. |

Both numbers are on screen, on a meter with the target band marked, and burnt
into the recording. Every threshold is a setting you can change.

**What it cannot see.** The spine rounding between the hip and the shoulder. No
pose model gives a mid-spine point, so "back straight" here means the hip→shoulder
line is vertical and nothing more. A rounded back with the hips and shoulders in
the right places reads as fine.

## What it says

One cue at a time, spoken and written, and only when it has held for half a
second — an instruction given for a flicker is noise. The same cue is not
repeated inside its cooldown (4 s by default). When depth and back are both
wrong, whichever is further out is the one said.

| | |
|---|---|
| legs too straight | *Lower down* — or, more than 18° out, *Slide further down the wall* |
| too deep | *Come up a little* / *Come up — that is too deep* |
| back off the wall | *Press your back flat to the wall* |
| hips ahead of the shoulders | *Bring your hips under your shoulders* |
| just right | *That is it — hold*, once, and the clock starts |

The hold clock runs after 0.7 s in position and stops the instant the position
goes; the longest unbroken hold is kept alongside the total.

## The recording

The canvas **is** the recording: camera frame, skeleton, the angle drawn at the
knee, the plumb line the back is judged against, both readings, the timer and
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
  js/wallsit.js    the measuring and the coaching decision — pure, no DOM, tested
  js/app.js        camera, drawing, voice, recording
test/
  wallsit.test.js  angles and cue timing, against synthetic bodies
  smoke.mjs        the browser, with the pose model stood in for
```

`wallsit.js` takes landmarks and a clock and returns readings and at most one
cue. That is what makes the thresholds checkable: every number the app acts on
is held in `test/wallsit.test.js` against a body built to read exactly that
number, which is the only honest way to know a threshold does what it says.

## Pose model

MediaPipe Pose Landmarker, loaded from the CDN on first use. The **full** model
is the default: a wall sit is a hold, not a fast movement, so there is no reason
to take the faster, shakier read. The lite model is one setting away for an old
phone.

## History

Everything before this — a whole exercise library and coaching engine — is on
the `archive/ontrack` branch, untouched. To bring it back:
`git checkout archive/ontrack`.
