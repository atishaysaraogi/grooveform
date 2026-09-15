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
the project* route: a clean file is written and the library re-read, a bad one is refused with its
problems and nothing is written, a new region file lands in the manifest.

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
14. Studio step 7 → Check against another video: a fresh video is cut into reps with the coach's verdict per rep; saying what each shows marks agree/disagree and nothing is added to the takes.
15. Studio → Upload a video… with a phone video that starts with walking in and lying down: the analysis steps through the whole file, the take calibrates after the walk-in (the player's "calibration window" ends where the person went still), and the split finds every rep the live coach would count.
12. After the set, Watch it back: play, scrub, tap the timeline; Download report opens as a page on its own with the replay working; Download video produces a playable file (Chrome, Android; Safari may hide the button).

## CI

`.github/workflows/ci.yml` runs unit + API tests, then the browser suite with Playwright's Chromium, then a Docker build, on every push; pushes to `main` that pass deploy to Fly.
