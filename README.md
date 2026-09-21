# Form Coach

A side-on coach for held positions, running entirely in the browser. Put the
phone on the floor, step into the frame, and it watches the angles that decide
whether the position is right, says the one thing to change, counts down the
hold, and hands you a recording of the set with the cues on it.

**Live:** https://atishaysaraogi.github.io/grooveform/

Three exercises so far: **wall sit**, **elbow plank** and **standing knee
raise**. Nothing is uploaded — the pose model, the coaching and the video file
are all made on the device.

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

**The canvas is the frame.** Whatever the camera hands over is what the canvas
becomes, the same size and the same way up, and the box on screen is given that
shape too — so a phone held upright gives a portrait picture that fills its box,
with no bars and nothing bent. A move that wanted the other shape says so in
words; it does not get the picture forced into one.

The camera is asked for the same thing whatever the exercise: its own landscape
resolution, 1280×720, and nothing about which way up. Width and height in a
camera request describe the *sensor's* frame, before the phone turns it to match
how it is being held. A phone stood on its end turns a 1280×720 capture into a
720×1280 picture by itself. Asked for 720×1280 instead, it obliges by cropping a
tall strip out of the sensor — which it then turns, the same as always, into a
wide band on screen with the head and feet gone. That was the landscape picture
with the legs missing, and it was the request that caused it. So the shape is left
to the phone, which knows which way up it is, and the exercise only says in words
which way up it would like to be. When the picture is the wrong shape for the
exercise, the notice says so and says what size the camera is actually giving.

Nothing is ever stretched. Where a box and a picture do end up different shapes,
the picture is fitted inside whole rather than filled to the edges, because a
squashed body reads squashed angles and every threshold here is an angle. The
skeleton is drawn into that fitted rectangle, and the angles are worked out in the
frame's own proportions, so the numbers do not move when the shapes do.

**Turning the phone mid-session.** Laying the phone down changes the frame the
camera gives. Between sets the canvas follows it, which is how turning the phone
takes effect. During a set it does not: a recording that changes shape halfway
through is not a file most players will take, so the canvas is held and the
fitting absorbs the change instead.

**When the phone does not turn the picture itself.** Nearly every browser hands
over the frame the way the phone is being held, and a picture that is already
upright must not be turned — doing it on a hunch is how an app takes something
correct and lays it on its side. So nothing is turned unless it is asked for.

The setting is there for the few devices that really do give the sensor's own
frame whatever way the phone is held, which arrives as a body lying down. A
quarter turn puts it back, and turns the landmarks with it, because every angle
taken against vertical or the floor is a quarter turn wrong on a sideways frame:
a shin is only plumb with respect to gravity. There is a test that reads a body
from an upright frame and from a sideways one put right, and requires the same
numbers — and checks the converse too, that an angle at a joint is the same
either way, which is why the turn has to happen before the reading and not after.

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

**Wall sit** — side on, back against a wall, phone stood up.

| | |
|---|---|
| **Knee angle** | at the knee, between hip and ankle. 90° is thighs parallel to the floor. The band is **85–110°**: above it the legs are too straight, below it you are too deep. |
| **Shin** | the angle the knee→heel line makes with the floor. Plumb is 90° and the band is **85–95°**. Past 95° the heels are ahead of the knees, under 85° they are behind them, so one number carries both the fault and the direction the feet have to move. |
| **Back** | how far the hip→shoulder line leans off vertical, allowed **±12°**. |

**Elbow plank** — side on, forearms down, phone on its side.

| | |
|---|---|
| **Arm** | the upper arm's lean off vertical, which is where the shoulder sits over the elbow. Allowed from **5° behind to 15° in front**: the band is not symmetric because a shoulder behind the elbow is the joint taking the load at its weakest, while a little in front is normal. |
| **Hip** | how far the hip sits off the straight line from shoulder to ankle, as the angle the body bends at the hip. Allowed **±5°**. Above the line the hips are piked and are told to come down; below it they are sagging and are told to lift. |

**Standing knee raise** — side on, standing tall, one knee up, phone stood up.

| | |
|---|---|
| **Knee** | the angle at the raised knee, between hip and ankle. A right angle, **80–100°**. |
| **Foot** | the angle at that heel, between the toe and the knee — the foot's own line against the shin's. Allowed **60–100°**. Past 100° the foot is pointing away and the toes come up; under 60° they are pulled too far. |

Ten seconds held, lowered slowly, and the rep counts when you are back to
standing. Ten reps.

The foot is measured at the **heel** rather than the ankle, because the heel is
where the foot meets the floor and is the end of the segment being measured. It
is a different number from the angle at the ankle, and where a comfortable foot
falls within it depends on where the pose model puts your heel relative to your
ankle — so the band is a setting. Watch the reading on yourself for a rep and
move the band if it sits off. So is how long each rep is held, and how many of
them there are.

*One thing worth saying about this one.* Those two right angles do not by
themselves describe a knee raise: a heel tucked up behind makes both of them
just as well. So how far the thigh has to come up is a setting, used to tell a
raise from standing still and from the next rep starting, and it is not marked
or coached — the two angles asked for stay the only things being judged. Widen
or narrow it in the settings; make it a band of its own if you want it called.

**Glute bridge** — on your back, side on, knees bent, feet flat, phone on its side.

| | |
|---|---|
| **Feet** | the foot's own line, heel against toe, off the floor: **±10°**. Heels lifting tilt it one way and toes lifting the other, so the cue says which. Checked first, and at the start. |
| **Shin** | the angle at the heel between the toe and the knee, as in the knee raise. Allowed **85–110°**. Under it the knee is out over the toes and the feet are too far from the hips; over it the knee is back behind the heel and they are too close. This is where the feet are, so it too is coached at the start, before the lift is asked for. |
| **Hip** | the angle at the hip between knee and shoulder: the line the hips are lifted to. **At least 160°** at the top. |
| **Rise** | how far the hip sits above the knee, as the rise of the knee→hip line. **At most 3°**: the hips are not to go higher than the knees, and the three degrees are for the pose model's wobble. A floor line is drawn through the knee, which is the height not to pass. |

Two seconds held at the top, lowered slowly, and the rep counts when the hips
are back down. Ten reps.

**"Lower slowly" is judged, not just said.** A move that names how long the way
down should take (a setting, one second for the bridge and the knee raise) is
told when it took less. The rep still counts — it was done — and the remark rides
on the count rather than queueing behind it, so it lands on the rep it is about:
"three — slower on the way down".

**Which way the phone goes.** Every exercise is one of two kinds: phone on its
side, or phone stood up. The plank and the bridge want it on its side; the wall
sit and the knee raise are standing bodies and want it stood up. While the camera
is giving the other shape the page stays a page, with a notice — on screen and
out loud — saying which way to turn it. The moment the shape is right and a set
is under way, the picture takes the whole screen, fitted inside it and never
cropped, with nothing on it but the button that ends the set and one that shows
the page again (for the settings, the voice, the other camera); a tap brings the
picture back, and so does the next set. Turning the phone
mid-set starts the film again from there, since a film cannot change shape and
what came before was a phone being turned. Each asks the camera for
that shape, says so in the words it opens with, and says so again — on screen and
out loud — if what arrives is the other way round.

Every threshold is a setting. Both numbers are on screen, on a meter with the
target band marked, and burnt into the recording.

**Degrees, not distances.** Every measurement is an angle, so none of them
change with how far away the camera is or how tall you are. One threshold means
the same thing on every body and at every range, and a test can prove it: the
plank suite reads the same plank at half the size in frame and checks the
numbers do not move.

**What it cannot see.** The spine rounding between hip and shoulder. No pose
model gives a mid-spine point, so every move judges that line by its ends and
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
| knee not at a right angle | *Bend your knee more* / *Open your knee a little* |
| foot pointing away | *Pull your toes up* |
| toes pulled too far up | *Ease your toes down* |
| a rep held to the end | *Lower slowly*, then the count |
| a knee dropped early | *Hold it to the end of the count next time* |
| shoulders too far forward | *Bring your shoulders back over your elbows* |
| hips piked | *Lower your hips — shoulders to heels in one line* |
| hips sagging | *Lift your hips — shoulders to heels in one line* |
| just right | *That is it — hold*, once, and the clock starts |

Each fault has a stronger form used when it is well past its band.

**The order.** When more than one is wrong they are corrected in the chain of
cause, not by how far out each is: **feet, then knee, then back** for the wall
sit, **shoulders, then hips** for the plank, **knee, then foot** for the knee
raise. Where the feet or the elbows are
decides what the rest of the body can reach, so a correction further along the
chain asks for something the base will not give. A shoulder six degrees behind
the elbow is said before hips twenty degrees off the line, and that is the
point of the rule rather than a flaw in it.

## The set

For the two holds: sixty seconds, counted down from the moment the position is
right. The clock is spent from time **in position**, so coming out of it pauses
the clock rather than running it down — sixty seconds means sixty seconds of the
exercise. It starts after 0.7 s in the bands and stops the instant any of them is
broken. The time left is called out at 45, 30, 10 and 5 seconds, and those calls
jump the 1.5 s queue, because "ten seconds left" said two seconds late is a lie.

For the knee raise and the bridge: the same clock, only per rep. Come to the start, go to the
position, hold it for the count, lower, and come back to standing — and the rep
is counted on that last step, not at the top. The lowering is part of the
exercise, and a knee dropped from the top is not the same as one put down. A
knee that comes down before the count is finished is not counted either, and is
told so, because the alternative is someone quietly doing ten half reps.

The target, the moments it is called and the number of reps all belong to the
exercise rather than to the app: a plank is held for a minute and a knee raise
for ten seconds a rep, and neither inherits the other's clock.

## The recording

**The page makes the film itself.** Thirty times a real second a frame is taken
from the canvas, stamped with the clock's time, and handed to the browser's
encoder (WebCodecs). When the set ends the encoded frames are written into an
MP4 by `mp4.js`, a small writer of this app's own, with those times as their
durations. Nothing in the file is timed by anything but the clock the frames
were taken by, and the file carries its length in its header, so a player shows
it and can seek in it before the download has finished. H.264 where the browser
can encode it, which is every phone; VP9 in the same MP4 where it cannot.

Why not the browser's own recorder: two real sets on a phone came back wrong
from it. The first had 2415 frames in twelve seconds, most two milliseconds
apart, then no picture for the last nine while the sound went on. The second,
made after the canvas was only ever asked for a frame on a clock, had 155
frames — distinct, at the camera's rate, four or five seconds of a set — that the
recorder had stamped as if they fit in nine tenths of a second, with a sound track
that stopped after one. The frames were right and the recorder's clock was not,
and there is nothing a page can do about a recorder's clock except keep its own.

**The film is silent.** The cues are written on the picture, and the cue log
downloads beside it with timings. (Where a browser has no encoder to hand over,
the old way still runs: its recorder takes a stream from the canvas, fed one
frame per tick of the same clock, with the cue tones mixed in — a browser will
not let a page capture its own speech. MP4 where it can write one, WebM where
it cannot.)

**How smooth it is.** The pose model takes long enough per frame that, run on
the page's own thread, it stops the page for that long each time: the canvas is
repainted only when the model lets it, seven or eight times a second on a phone,
and a film taken at thirty a second would carry each real frame three or four
times over. So the model runs in a thread of its own; the page's thread only ever
draws, at the camera's rate, over whichever pose the model last handed back. And
a frame is only taken for the film when the canvas has been drawn since the last
one: a page stalled by anything fires its late timer ticks in a bunch when it
comes back, and the frame before a stall covers the stall rather than being put
in the film twice.

**The screen stays on.** A phone stood on the floor is not being touched, and a
phone not being touched turns its screen off inside a minute; when it does, the
page is hidden and nothing is drawn. A wake lock is held for as long as a set
runs. If the page is hidden anyway and comes back with a set still running, it
says so out loud, because that stretch of the set was not seen.

**Stale copies.** Every script the page loads carries the current version in its
URL, so a phone that cached the last release loads this one rather than running
old code under a new page.

The canvas **is** the recording: camera frame, skeleton, every angle drawn where
it is measured, the lines each is judged against, the readings, the countdown and
the cue banner are all painted onto it, so the file you download is the picture
you watched.

## Running it

```sh
npm run dev        # http://localhost:8000 — localhost counts as secure, so the camera works
npm test           # the measuring and the coaching, against bodies posed to a known angle
npm run smoke      # a real browser: canvas, cues, the encoder and the file  (needs playwright)
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
  js/pose-worker.js the pose model, in a thread of its own so the page only draws
test/
  wallsit.test.js   the wall sit, against synthetic bodies
  plank.test.js     the plank, likewise
  kneeraise.test.js the knee raise, and a whole set of reps
  bridge.test.js    the glute bridge: feet, line, height, flat feet, and the way down
  mp4.test.js       the file the page writes, timed by the clock
  framing.test.js   which way the phone goes, and fitting a frame to a canvas
  smoke.mjs        the browser, with the pose model stood in for
```

## Adding a move

A move is data plus two functions. `read` turns landmarks into named angles;
`judge` turns those into a verdict and a set of faults with how far out each one
is. A move that counts reps also says whether the body is at the start and
whether it is in the position, and the shared coach runs the rest. Everything
after that — the clock, the countdown, the persistence and cooldown and the
one-at-a-time rule — is in `core.js` and is the same for every move, so a set of
reps and a single long hold share one implementation of the clock rather than
having two that can drift apart. The readouts, the settings inputs, the heads-up display and the skeleton's
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

Each rig builds a body backwards from the angles wanted, and builds them so that
one fault can be posed without the others: the knee raise's thigh, knee and
ankle are each measured off the one before it, which is how a leg actually hangs
together, so all three can be set independently. The stand-in camera used in the
browser builds two legs rather than copying one, which is what makes the app's
choice of which leg to measure a real choice there.

One thing the tests found rather than confirmed: a body posed to exactly the edge
of a band reads a ten-thousandth of a degree under it, so a bare comparison marked
the very number the setting says is allowed. "Five degrees either way" has to
include five, and now does, on every move.

`smoke.mjs` then drives a real browser with the pose model stood in for, through
all four exercises. It counts the frames handed to the encoder over two seconds
of a set (the clock's thirty a second, no more), records a set with the model
slowed to a phone's pace and checks the file's length against the clock, and then
reads the file back box by box: index before data, every frame's duration about
what it was on screen for and none of them two milliseconds, the header's length
the played length. `mp4.test.js` holds the writer to the same things in node,
without a browser. The suite ends by downloading the video and checking there
are frames in it (`SMOKE_KEEP=<dir>` keeps the file). It also watches what is handed to the speech engine: headless Chromium
makes no sound, but a cue that never reaches the engine is silent on a real
phone too, so the suite checks that every cue in the log was also spoken.

## History

Everything before this — a whole exercise library and coaching engine — is on
the `archive/ontrack` branch, untouched. To bring it back:
`git checkout archive/ontrack`.
