# Testing

Three layers, all with no dependencies except Playwright for the browser layer.

## 1. Engine unit tests — `test/engine.test.js`

Rep counting hysteresis, hold timing, fault persistence/cooldown, smoothing, and the ten vetted moves' fault rules driven by synthetic keypoint frames with known reps and known faults. These are the oracle that proved the data versions of those moves count and cue exactly as the hand-written code did. `test/spec.test.js` covers the measurement language itself: every kind on a frame built to read a known value, gates, scaled thresholds, the return rule, automatic side following. The same file runs the oracle recordings through a phone that is propped crooked (rolled 12°) and a person turned 20° off the ideal view, and requires the same reps and faults back — the proof behind the camera corrections in `FormEngine.Camera`. `test/replay.test.js` checks the replay's timeline (reps, fault spans, cues) and that the exported report is one self-contained page with the recording and the player inside it. It also checks that a set's video never reaches that page. `test/spec.test.js` covers the demonstrated target: a plausible held pose replaces the file's number, one that barely left the start or reads wildly is refused. The oracle covers following the moving limb when the other one was picked. Run: `npm test` (runs with the API tests).

## 2. API tests — `test/api.test.js`

Boots the real server on a random port with a throwaway SQLite file, `NOTIFY_PROVIDER=console`, `PAYMENT_PROVIDER=mock`, and exercises the HTTP API as several users. 11 scenarios:

1. Anonymous catalogue: free vs locked exercises, prebuilt routines, empty directory.
2. Self-serve registration by OTP; consent gate (428) before any personal-data route.
3. Free member: saving a free exercise works; locked exercise → 402; building a routine → 402.
4. Pro: mock checkout → confirm → entitlements; build, copy, edit routines; cancel keeps access to period end.
5. Curator: registration, profile, not listed until the Curator plan is active; accepting a member requires the plan.
6. The central marketplace rule: connection → curator sends routine → member's locked exercises in it unlock → member completes → ending the connection revokes the grant.
7. Curator sees only sessions from routines they sent, and can comment.
8. Curator invites a member by identifier.
9. Admin: verify, list/unlist, comp a plan, disable a user, audit log.
10. Encryption at rest (raw DB has no plaintext name/phone), export contains everything, erasure request + grace period.
11. Razorpay signature verification (unit-level, no network).

Run: `npm test`. ~3 s.

## 2b. The library files — `test/library.test.js` and `test/studio-save.test.js`

The moves are data (`client/data/`), so the tests read the files the way the app does: every move file
opens with its `_about` guide and the guide names exactly the fields a move may use; every file checks
clean; a mistake is reported with the file, the move and a suggestion (`"sumary" — did you mean
"summary"?`); the files are in the one style the tools write (`node scripts/catalog.js format`); every
declared figure contact holds still; the tracking tier is honest. `studio-save.test.js` boots the server
in development mode against a scratch copy of the data folder and exercises the Studio's *Save into
the project* route: one exercise is written as its own file and listed by its region, the library is
re-read, editing it again rewrites that file alone, and a bad move, a bad id, an unknown region and
an id another region already uses are each refused with nothing written.

Without a server: `node scripts/catalog.js check` runs the same file checks.

## 3. Browser end-to-end — `test/e2e.test.js`

Drives the real UI in Chromium with a synthetic pose stream (`?mock=1` → `window.__mockPose(t)`), so a whole coached set runs without a camera. The Studio steps build a move from a recording and open an existing one as a copy — every catalogue move must round-trip through the Studio to the identical compiled move — and save it back into its file. Steps across five browser contexts (a phone-sized anonymous visitor who becomes a free member, a curator, a Pro member, an admin):

visitor home and locks → free exercise coached set → "Sign in to save" → registration + consent → set saved → notes / session note / history filter → free-tier limits → curator registration + listing → hidden until subscribed → mock Curator checkout → appears in directory with filters → member requests, curator accepts → curator builds a routine with targets/notes and sends it → member sees it, pro exercise unlocked, completes it with effort + note → curator sees the set and comments → member sees the comment → ending the connection re-locks → Pro member checkout, copy prebuilt, edit, cancel keeps access → export + erasure → admin verifies → badge public → CSRF guard, zero JS errors.

Screenshots of every screen are written to `docs/screenshots/`.

Setup (once):

```
npm i -g playwright@1.56.0
npx playwright install --with-deps chromium     # or point CHROMIUM_PATH at an existing Chromium
```

Run:

```
NODE_PATH=$(npm root -g) npm run test:e2e
# with a specific browser binary:
CHROMIUM_PATH=/usr/bin/chromium NODE_PATH=$(npm root -g) npm run test:e2e
```

~2 minutes (two full coached sets run in real time). The test picks `FREE_EXERCISES=hipabd,plank` so the free anonymous set can use the hip-abduction pose generator; the shipped default is `wallsit,plank`.

## Manual test plan (before each release, real phone)

1. Android Chrome and iPhone Safari: open the site over https, start a free exercise, allow the camera, complete a set, hear the voice cues.
2. Sign up with a real mobile number; the SMS arrives within 30 s; the parked set appears in history.
3. Buy Pro with a Razorpay test card / UPI; Account shows the plan; build a routine; locked exercise starts.
4. Second phone as a curator: buy the Curator plan, appear in the directory, connect, send, see the set, comment.
5. Account: download data (JSON), request deletion, cancel deletion.
6. Kill the network mid-set: the coach keeps running (pose is on-device); saving fails with a visible error and can be retried.
7. Prop the phone visibly crooked (10–15°) and do a set: the positioning overlay says "phone tilted N°, corrected"; reps still count; the review's JSON has `camera.rollFrom: "sensor"`. Turn 30° away from the lens mid-set: "turn to face the camera" / "turn side-on" within a couple of seconds.
8. Band pull-apart on a real phone: the coach asks for the end position before the set, the target follows what was shown, and skipping it falls back to the file's number.
9. Pick the left leg on a front-on move and work the right one: within about half a second the coach says "following your right leg" and counts from there.
10. Review: Save / Discard (or Start set N / Stop here during a rest) sit at the top and stay there while you scroll; "Work on next" is the first panel under the score and reads as instructions ("Slow it down"), not diagnoses ("Too fast"); the voice reads every major one.
11. Settings → Head on the skeleton: each of the five styles draws sensibly front-on and side-on, live and in the replay.
12. Side-on (a glute bridge, a heel slide): the arm and leg on the far side of the body stay off the skeleton, or draw faint and steady, instead of flailing where the model guesses them — live, in the replay and in the Studio's player. No foot floats without its leg.
13. Studio → Upload a video…: once cut, the first rep plays and pauses on its last frame with a button per label; pressing one (or 1–9 / S) saves it and plays the next; Not a rep drops the take from every chart and count; skipped reps come back via Play and describe.
14. Studio step 4 → the landmark list appears over the slot you tap, moves to the next empty slot, and closes on Escape or a tap outside; nothing stands open while the measurement is complete.
15. Studio → a rep with two faults: both chips stay lit, Next rep moves on, the row reads "Fault: A + Fault: B", and the coverage panel counts it under both.
16. The Moves list offers the shortlist, not the whole library; a move hidden from it still opens by link and still runs inside a routine. Settings → The move's animation switches between the stick figure and the anatomical one, and the second draws muscle warming through the movement.
17. A move with two progress measurements: the live readout still shows the first; a rep that satisfies one but not the other does not count with "every measurement"; the target line stays put through the descent instead of sweeping round.
18. Settings → Voice: the named voice is a natural one, not the device default; Hear this voice plays it; Speaking speed changes it audibly; the choice survives a reload. On a second device the name differs but the character does not.
19. Studio step 6 → Edit the poses: dragging a joint keeps every limb the length it was; the faint figure behind is the other keyframe; a note pinned to a joint is drawn on the exercise page's animation with a line to that joint, and a note tied to the end fades in at the end.
20. A move with a start-position fault: the overlay says what is wrong with the set-up and the count-in waits; fixing it starts the set; Start anyway appears after six seconds and the fault is listed in the review.
21. Studio step 7 → Check against another video: a fresh video is cut into reps with the coach's verdict per rep; saying what each shows marks agree/disagree and nothing is added to the takes.
22. Studio → Upload a video… with a phone video that starts with walking in and lying down: the analysis steps through the whole file, the take calibrates after the walk-in (the player's "calibration window" ends where the person went still), and the split finds every rep the live coach would count.
23. A move with `repHold` (Studio step 2 → Counts → Reps with a hold): at the top the phase word counts the hold down and a chime says it is up; a rep that comes down early is a partial, cued "Hold it there"; the exercise page's meta line says how long the hold is.
24. A dumbbell move (goblet squat): the Weight bubble cycles none → 1 kg → 2 kg → 5 kg → Other…; Other… opens a box, typing 7.5 puts "7.5 kg" on the bubble and the coach's title line; an empty box falls back to no weight.
25. Settings → Your height defaults to 5'11" (180 cm); a fault measured "% of their height" read in inches (Studio step 5 → % of → their height → read in inches) shows inches in the Studio's threshold field and its chart, and a shorter height in Settings makes the same movement read fewer inches.
26. Exercise page → The move: the Stick figure / Muscles toggle beside the heading swaps the animation on the spot and Settings → The move's animation follows it. Studio step 7: Vetted can be turned on while the tuning report is red; the toast names the failing faults and the export carries them under `_studio.tuned.override`.
27. Calibrate in one pose, then settle into the real start and hold it (a bridge with the knees pulled up first): after a second and a half "Start position read again" shows, the readout drops to 0 and the reps then count; the diagnostics file carries a `recalibrate` event and the move's `spec`.
28. Lower only half way between reps and rest there: each rep still counts, and a slow lowering to the floor afterwards adds nothing.
29. A set with three faults: each cue is heard once before any repeats, heaviest first.
30. Glute bridge: the target line is drawn shoulder to hip to knee and stays put as the hips rise; the arm-anchored line of a squat is unchanged.
31. Side-on move, a fault written against the far limb (`oKNEE`…): it stays quiet through a take where the near-limb version of the same fault fires, and only speaks on a plainly large violation.
32. Two faults true at once: the same cue does not repeat inside 8 seconds.
33. A bridge where you lie down slightly differently each rep: every rep still counts, and the diagnostics show each rep's own start drifting a few degrees while the calibrated one stays put.
34. Rest half way down between reps: the start does not follow you all the way there (it stops at the drift cap) and the rep still reads as short.
35. Studio step 4 → Which parts stay still: tick shoulder and knee on a bridge; the target line is drawn shoulder to hip to knee from the first rep and holds its angle as the hips rise.
36. Studio step 6 → What the coach says: silence "The rep number" and run a set — the reps still count on screen, nothing is spoken; type your own words for "Go" and hear them.
37. Studio → split a long recording: playing rep nine starts at rep nine's own place in the video and runs straight through, with a moment of the start position in front of it. No clip begins with the start of the set.
38. Shift, adjust the mat or rest a hand on the floor between reps: nothing is flagged; the same posture during a rep is.
39. A set where one thing goes wrong on every rep: the cue is spoken twice and then stops, the count still climbs, and the end-of-set summary names it.
40. Studio step 4 → Too far is → Past the target by: a second line appears on the chart, Suggest fills both ends, and step 5 shows "Going past the range" as a rule written for you with its own firing strip.
41. A move whose target the user picks: the far end follows their choice (a 20° raise and a 40° raise get different far ends from one { delta } value).
42. Write two faults on the same measurement with the same comparison: step 7 says they read the same number the same way. Write one on the progress measurement: step 7 says it duplicates progress.
43. A side-on move with the abdominal muscles lit (plank, wall sit) in Settings → Muscles: the abdominal wall is drawn on the belly, not the spine.
44. Side-on bridge, feet planted: the drawn toe and heel sit still between reps instead of wandering, and a real toe lift is still called; the far foot no longer flails when the hips rise.
45. A move with `stable` points that no fault watches (a bridge's shoulders): the drawn point holds still once the person has settled and follows again when they shift.
46. A move with a start check (feet too far away, knee already bent): start the set correctly, then drift into the fault mid-set. The cue is said at the next rep boundary, those reps are flagged, and the review says "at the start of N reps".
47. The same move done correctly throughout: nothing is said and no rep is flagged.
48. A side-on both-sides move set to ignore the far limb (glute bridge): the drawn skeleton shows one arm and one leg, the far one never appears, and the same is true watching the set back.
49. Film the same move from the other side: the near limb is still the one drawn, so the choice follows the camera rather than being fixed to left or right.
50. Studio step 2: the far-limb chip appears only on a side-on move that is not one-sided, and writing a fault on oKNEE with it set to Ignored is refused.
51. Studio: record a take whose set-up is wrong throughout, split it into reps, and each rep take names the start fault in its row; the same fault appears per rep in the Check against another video table, and labelling a rep with it counts as agreement.
12. After the set, Watch it back: play, scrub, tap the timeline; Download report opens as a page on its own with the replay working; Download video produces a playable file (Chrome, Android; Safari may hide the button).

## CI

`.github/workflows/ci.yml` runs unit + API tests, then the browser suite with Playwright's Chromium, then a Docker build, on every push; pushes to `main` that pass deploy to Fly.
