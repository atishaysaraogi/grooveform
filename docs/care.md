# OnTrack Care: the physio, the patient, the review

`care.html` is the app with a layer on it: an account by phone number, a
physio who assigns and modifies a plan, a patient who does it at home and
sends a rep for review, the physio's verdict and reply, a visit interval with
its reminders, exercise reminders, a one-tap report, and the person's own
data. `index.html` is unchanged; the layer is a second page on the same
site, built from the first (`scripts/care-page.js`, run by
`node scripts/library.js index`).

## Two ways to run it

**The care server** (`npm run care`, `scripts/care-server.js`) serves the
site and, under `/api`, the care logic. One JSON file is the store
(`data/care.json`, written whole after every change), a folder holds the
clips and pose records (`data/files`), and a scheduler inside the process
sends the reminders due every minute and does the night's housekeeping at
three. Nothing but node. Messages (codes, invitations, reminders, replies)
go out through MSG91 when its keys are in the environment, and otherwise
land in an outbox the admin page shows, which is how a pilot runs before
DLT registration is through.

```
CARE_PORT=8000 CARE_DATA=/var/ontrack CARE_ADMIN_PHONES=+919876543210 \
CARE_BASE_URL=https://care.example.in/ MSG91_AUTHKEY=… MSG91_SMS_TEMPLATE=… MSG91_SENDER=ONTRCK \
node scripts/care-server.js
```

`CARE_DEMO_CODE=123456` makes every sign-in code that number (a demo, a
test; never in production). `CARE_LOCAL=1` lets a person set their own role.
`/health` answers with the version. Put it behind Caddy or nginx for HTTPS;
the camera needs a secure origin. The server sends a content security policy
(its own files, the pose model and its runtime, the fonts, nothing else) in
report-only mode; after a session on a real phone shows no violations in
the browser's console, `CARE_CSP=enforce` turns it on. Codes are limited to
five an hour per number and thirty an hour per address.

**The sandbox.** On a static host (GitHub Pages) `care-config.js` says
`api: 'local'` and the same logic runs inside the browser, its store in
localStorage and its clips in IndexedDB. One phone can be the physio and the
patient in turn (sign out, sign in as the other number; the code is always
123456), and nothing leaves the phone. The messages that would have gone are
listed under My data. It is for trying the flows, not for a patient.

## The logic, in one place

`public/js/care-core.js` is the server's logic, written once and run in
node, in the browser's sandbox and in the tests. It is handed a store, a
clock, a source of randomness, a message transport and a file store, and
every call is `call(method, token, args)`. The methods and who may call them:

| call | who | what |
|---|---|---|
| `requestCode`, `verify` | anyone | a six-digit code to the number (five an hour), checked (five tries, then a quarter of an hour's lock); a token good for ninety idle days |
| `me`, `updateProfile`, `consent`, `devices`, `signOut`, `signOutAll` | signed in | the person, the plan, the links, what is unread; name, year of birth (over eighteen), sex, language, condition; one consent row per purpose with the notice's version |
| `setRole`, `requestPhysio` | admin (self in the sandbox) | a physio's role, set after a look at the registration number; a physio gets an organisation on the `pilot` plan |
| `addPatient`, `acceptLink`, `linkInfo`, `endLink` | physio; the patient | the invitation by number, the patient's say-so on first open, the link ended by either side |
| `patients`, `patient`, `addNote`, `myNotes` | physio | the list with the week, the flags (pain, days missed, a visit overdue, a review waiting), the due list, the queue count; one patient whole |
| `assignPlan`, `myPlan`, `easeStep` | physio; patient | a plan as a new version each time, checked against the library; the patient's current plan; "too hard today", one notch down, logged |
| `saveSession`, `sessions`, `thumbs` | patient | the session (sets, reps with their faults and times, how it felt), the same row updated when the feel is saved; a pain stop told to the physio |
| `sendReview`, `myReviews`, `withdraw`, `queue`, `review`, `judge`, `newFaults` | patient; physio | the clip and the pose record stored, the physio told; the queue oldest first, overdue after two working days; opening leaves an audit row; the verdict per rep or per set (fine, a known fault, a new one), the message, a change to the step as a new plan version |
| `setVisit`, `markVisited`, `visitAction`, `setPatientReminders` | physio; patient | the interval, the next date, booked, snoozed, visited with a clinic measurement; reminders off for one patient, a line in them |
| `setReminders`, `setPush`, `tick` | patient; the scheduler | days, time, channel; what is due now, sent once (exercise reminders at the time on the days, not after a session, not at night; visit reminders a week and two days before, and once overdue) |
| `report`, `reports`, `replyReport`, `seenReply` | anyone; admin | what happened, with the device, the versions and the last minute of cues; the reply reaches the person |
| `exportData`, `myAudit`, `deleteAccount` | the person | everything as JSON; who opened what; deletion at once, the clips with it, the labels kept nameless only under the research consent |
| `users`, `stats`, `outbox`, `falseAlarms`, `trainingExport`, `nightly` | admin | the people and roles; the numbers; what went out; per exercise and fault, called-and-fine against confirmed and missed; one row per labelled rep; clips gone at 180 days, reports at 90 |

Free for everyone: every organisation is on the `pilot` plan and `can(org,
feature)` says yes. Billing turns on there.

## The review, end to end

During a set the app hands the layer every frame (`window.__careFrame`): the
landmarks, the reading, the verdict, the clock. The layer keeps a pose
record of the set, twenty frames a second, and the reps as the coach runs
them: when the phase goes from down to up a rep is open; counted when it
returns from lower; an attempt when it comes down before the hold. The
faults called during a rep are on it.

At the end of the session the rep list shows under *Review with my physio*,
each with what the app said. The ticked reps, plus a second either side, are
cut from the session's film without re-encoding where the page encoded it
itself (a keyframe every two seconds), and the pose record of those moments
goes with them, gzipped. Where the browser's own recorder made the film the
whole film goes, with the time to seek to. The physio's page plays the clip
with the skeleton drawn over the body from the record, the measurements
beside it, and a strip marking the reps and where the app called a fault;
half speed, skeleton on or off. The verdict is per rep or for the set at
once: *Looks fine* (the app's fault, if any, is recorded as a false alarm),
*A fault the app knows* (the exercise's own list), or *Something else* (a
name, a line, where; saved against the exercise for us to turn into a rule,
and offered again next time). A message to the patient, and optionally a
change to the step, which becomes a new version of the plan with the reason.

The training record: `trainingExport` gives one row per labelled rep for
patients who ticked the research box, with the paths of the record and the
clip, the app's call, the labels and the context (year of birth, sex,
condition), never a name. The false-alarm report is the first thing to read
each week of a pilot.

## Testing

`test/care.test.js` runs the logic in node with a fake clock, the messages
caught and the files in memory: the code and its limits, the roles, the
link, the plan versions, sessions and flags, the review judged with a new
fault and a change, the visit reminders a week and two days out, exercise
reminders once and not after a session, reports, export, deletion, the
night's housekeeping, the door on every call.

`npm run smoke:care` starts the care server in the test and drives two
browsers, the physio's and the patient's: the sign-in, the invitation and
the link, a plan assigned and seen, a session driven by the pose stand-in
and saved with how it felt, the reps sent with a clip cut from the film and
a record of 132 numbers a frame, the queue, the clip playing with the
skeleton painted over it, the verdict with the step changed, the reply on
the patient's home, the visit set, booked and marked with a measurement, a
shared note, reminders, a report and its reply, My data with the audit log,
a reload keeping the sign-in, the plain page untouched, and the sandbox mode
on the static server with one phone as both roles.

## The flows, recorded

`node test/care-journeys.mjs` walks the people from the product plan through
the page against the care server, each flow recorded as a video in
`docs/videos` with a caption on the picture saying what is being done: Dr.
Meera signing in and inviting Sunita, Sunita opening the invitation, the plan
built from the exercise pages and assigned with a visit interval, Sunita's
session and the rep sent for review, Dr. Meera judging it on the clinic
laptop, the reply and the visit booked, Arjun on his own with no physio,
Rohan the coach and Priya his client with a new fault named, and one phone as
every role in the sandbox. The videos are what the flows look like; the smoke
is what holds them.
