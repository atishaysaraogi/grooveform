<!-- A copy of the Claude Doc at https://claude.ai/code/artifact/add87051-4876-45b0-8041-2bf19cfa2733, which is the living version (the flow drawing lives there). Exported 2026-10-01, after the decisions of that day. -->

# OnTrack product plan: users, journeys, features

2026-10-01 · Atishay Saraogi

## Who the app is for

Three kinds of people use OnTrack, and the app has to work on an entry-level Android phone propped against a wall in a small room, with the sound on and often no Wi-Fi.

| User | Who they are | Typical setup | What they want from the app |
| --- | --- | --- | --- |
| Coach or physio | A physiotherapist (clinic or home-visit), a sports or fitness coach, a yoga or rehab trainer. Sees 15 to 60 clients a week. | Own phone plus a laptop or tablet at the clinic; builds plans between sessions, checks progress on the phone | Build a plan once, assign it to many, see who did what and how well, change a plan without a visit |
| Trainee of a coach | Someone recovering from an injury or surgery, or training under a coach, aged anywhere from 16 to 75; often a family member sets the phone up for the older ones | One phone shared with the family, 4 GB RAM or less, Jio or Airtel data, a bedroom or living-room floor, a chair or a wall | Do today's exercises right without the coach present, know they counted, and have the coach see it |
| Individual, own or premade plan | A person with a sore back, a stiff shoulder or a knee, or someone keeping fit, who found the app themselves | Their own phone, often a mid-range Android; some on iPhone | Pick a programme for their problem, trust the counts and the corrections, see improvement over weeks |

**The India context.** Figures below come from search-result summaries; the source pages were not openable from this session, so treat them as approximate.

| Fact | Figure | What it means for the app |
| --- | --- | --- |
| Smartphone users | \~690 million, about 47% of the population; Android \~92% | Build for Android Chrome first; iPhone second |
| Entry-level phones (under US$100) | \~16% of shipments and the fastest-growing segment; 4 to 8 GB RAM is the largest band | The pose model must run on a weak phone; keep the lite model and a frame-rate budget |
| WhatsApp | \~536 million users in India, roughly three of four smartphone users | Sharing plans and reports goes through WhatsApp links, not email |
| Older adults (60+) | \~60% own a smartphone, but most find daily use hard; rural ownership is far lower | Big text, voice, one button per screen, and a family member's phone as the usual device |
| Home exercise adherence | 35% to 60% adherent in most studies; forgetting, pain, doubt and no time are the stated reasons | Reminders, counts the person can trust, and the coach seeing the data are the levers |

Sources (search results, not opened): [IDC India smartphone Q3 2025](https://my.idc.com/getdoc.jsp?containerId=prAP53921425), [India smartphone statistics](https://www.grabon.in/indulge/tech/smartphone-usage-statistics/), [WhatsApp users in India](https://www.grabon.in/indulge/tech/whatsapp-statistics/), [older Indians and screens](https://www.orfonline.org/expert-speak/screen-time-may-be-rising-steadily-among-older-indians), [adherence to home exercise programmes](https://www.dovepress.com/adherence-to-home-based-exercise-program-and-its-predictors-among-pati-peer-reviewed-fulltext-article-PPA), [connected health and adherence](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5856927/).

**What the app does today.** Everything runs in the browser on the phone; nothing is uploaded. It has 28 exercises with a pose coach that counts reps, times holds and speaks corrections; six programmes for frozen shoulder, knee and back; plans a person can copy, adjust (range of motion, faults to leave alone, counts) and share as a link or a file; a session review with a film, the cue log and a how-did-it-feel form; a builder for new exercises; and a Review page that tunes an exercise against recordings. It has no accounts, no server and no history beyond the phone's own storage, which is what this plan adds.

## Profiles

Five people stand for the users; each profile says what the app must ask of them, show them and let them share. Ask for the least biography that changes the coaching; everything else is optional and asked later, in context.

**Dr. Meera, 34, physiotherapist, Pune.** Runs a two-room clinic, sees 40 patients a week, half post-operative knees and shoulders, the rest backs. Writes home programmes on paper or WhatsApp photos today and hears "I did them" with no way to know. Wants: a plan built in five minutes from a library she trusts, assigned by phone number, a weekly view of who did what, a flag when someone stops or reports pain, and the ability to change a range or switch an exercise off without a visit. Fears: being blamed for a fall or a flare-up, and patients who cannot set the phone up. Device: an Android phone and a laptop.

**Rohan, 27, strength coach, Bengaluru.** Trains 25 clients online and in a gym. Wants to see form, not just counts: a film of the bad reps, the depth reached, the tempo, load progression over weeks. Builds his own exercises and variants. Will pay for a coach seat if clients find him through it.

**Sunita, 58, after a total knee replacement, Jaipur, trainee of a physio.** Her daughter installed the app and props the phone. Hindi first, reads English slowly. Needs: one big Start button, the voice in Hindi, the figure showing the move, no settings on the way, and the daughter able to see the day's result on her own phone. Keeps notes about pain and swelling, mostly by voice. Shares everything with the physio by default.

**Arjun, 41, software manager, Hyderabad, own plan for a frozen shoulder.** Found the app himself, no coach. Wants the right programme for his stage, the numbers explained, honest counts, a graph that shows the range of motion improving over weeks, and reminders twice a day. Will adjust the range himself. May later share a report with a doctor.

**Priya, 22, college student, Chennai, premade plan for a sore back.** Uses a mid-range phone in a hostel room with little floor space and poor light. Wants quick sessions, a streak, and to not look silly: the camera's position and the lighting warnings matter more to her than the numbers.

**Biographical details, by who needs them.**

| Detail | Asked of | Why the coaching needs it |
| --- | --- | --- |
| Mobile number | everyone | Sign-in, and how a coach finds a trainee |
| Name or nickname, preferred language | everyone | The voice and the words; Hindi, Tamil, Telugu, Marathi, Bengali, Kannada first |
| Year of birth, sex | trainee, individual | Age bands for defaults (hold times, rest), safety limits, progress norms |
| Height, weight | trainee, individual, optional | Load suggestions, nothing else; never shown to a coach without consent |
| Condition, affected side, date of injury or surgery, surgeon's restrictions | trainee, individual | Picks the programme stage; the side the camera coaches; the range the plan may not exceed |
| Pain today, swelling, sleep | trainee, individual, each session | The flag a coach watches; the reason a plan is eased |
| Equipment at home, floor space, who helps set up | trainee, individual, once | Which exercises to offer; whether a helper's phone is the device |
| Clinic name, registration, specialities, photo | coach | Trust, the trainee's screen, and finding a coach later |
| Working hours, how to be contacted | coach | When flags are sent; WhatsApp or in-app |

**What each role sees, keeps and shares.**

|  | Trainee of a coach | Individual | Coach |
| --- | --- | --- | --- |
| Sees | Today's plan, the step, the count, the correction; a weekly tick sheet; a simple range graph | The same, plus every number and the Adjust panel | Every client's week at a glance; one client's history, films of flagged reps, pain log, notes |
| Keeps | Pain and effort after each session, a voice or text note, a photo of the swelling | The same, plus their own adjustments and plans | Plan versions, per-client notes, assessment measurements (range at the clinic), next visit date |
| Shares | With the coach by default: counts, cues, pain, notes, films of flagged reps (films are opt-in) | With a doctor or family on request: a weekly report as a PDF or a link | With the client: the plan, a note on a step, a message; with another clinician: a report |
| Never without asking | Height, weight, the raw film of a whole set | Anything; nothing leaves the phone unless they share | A client's data with anyone but that client |

## Journeys

Every journey starts from a phone number and ends in a session the coach can see; the drawing after the lists shows how the three roles' flows meet.

**Sign-up and first session, trainee or individual.**

1. Open the link from the coach's WhatsApp, or the app store. The first screen is the number field and a one-line notice: number for sign-in, name for the voice, nothing else collected.
2. OTP by SMS, auto-read on Android, six digits, resend after 30 s, a missed-call or WhatsApp OTP as the fallback when SMS is slow.
3. Name, language, year of birth. Role is not asked: a coach's link puts the person under that coach; anyone else is an individual.
4. A coach's trainee lands on today's plan. An individual answers three taps: what hurts or what you want, since when, any surgery; then a programme is suggested with its stage.
5. The set-up walk-through, once: where to put the phone (a drawing for this room shape), lighting, sound on, a ten-second camera check that says whether the whole body is in view.
6. The first exercise, with the voice counting. At the end: how it felt, pain 0 to 10, one line or a voice note. Saved, synced, and the coach sees it.

**Pain points on the way in.** SMS OTPs that never arrive on a dual-SIM phone with the data SIM in slot 2; a shared family phone where two people need two accounts (profiles on one number); a Hindi speaker shown an English notice; a camera that cannot see the feet in a small room (the room check catches it, the walk-through must say what to move); a low-end phone that drops frames (switch to the lite model and warn once); Chrome asking for the camera again every time (install as a home-screen app).

**Daily use.**

1. A reminder at the time they chose, by push or WhatsApp, with the day's plan in one line.
2. Open today: the steps listed, the done ones ticked, the next one highlighted. One tap starts the camera.
3. Between steps a 30-second screen: what counted, what was said most, the next step's name. Pain is asked only after the last step or when a step was ended early.
4. A week view: seven days, each a tick, a part, or a cross; a streak; the range number for the one exercise that tracks it.

**Pain points daily.** Doing it in the evening with the lights off; a child walking through the frame; the coach's range set too high (the trainee should be able to say "too hard today" and have the step eased by a notch without the coach); no network (the session must run and queue the sync); the voice drowned by a television.

**Review, trainee.** After a session: the counts, what to watch next time, the film with the cues on it, and a share button that sends the coach a flagged-rep clip or a question. Weekly: a one-page report, as a link or a PDF, for a doctor or a family member.

**Sharing with a coach.** By default a coach's trainee shares counts, cues, pain and notes. Films are opt-in per session, with the flagged reps as short clips rather than the whole set. An individual can invite a coach by sharing a code; the coach then sees history from the day of the invite, not before, unless the person opens it.

**Coach: build and assign.**

1. Sign up with the number, then clinic name, registration number, specialities; a coach's account is reviewed before it can assign.
2. Add a trainee by phone number or by sending the invite link on WhatsApp. The trainee's consent screen names the coach and what is shared.
3. Pick a programme or build a plan: steps from the library, each step's counts, range, faults to leave alone, a note in the trainee's language. Save as a template for the next client.
4. Assign with a start date, days of the week, and the stage; set the flags: pain above 5, three days missed, range not improving for two weeks.
5. The dashboard: clients as rows, the week as columns, a colour per day; a flag list on top. Tap a client for the history, the films of flagged reps, the pain log and the notes; tap a step to ease or progress it, which the trainee sees as a changed plan with the coach's note.
6. Review on a visit: the clinic measurement (goniometer range) entered beside the camera's, so both are on the graph.

**Pain points, coach.** Forty clients means the dashboard must show exceptions, not everything; a plan changed mid-week must not lose the week's history; two coaches at one clinic sharing clients (a clinic account with seats); a trainee who switches phones; liability wording when a trainee reports pain and the coach missed it (the flag is sent, the app records that it was sent).

*(Drawing in the Claude Doc: the three roles' flows · coach lane, trainee lane, the server under both.)*

The coach's assignment reaches the trainee as today's plan; the trainee's counts and pain come back as the coach's week view, and a flag there loops into an eased or progressed step, which goes down the same road.

## Review with the physio

A patient sends a rep or a set to their physio with one tap; the physio sees the clip with the app's skeleton and verdicts over it, and answers in under a minute. This is the loop that makes the camera trustworthy: the app's call, the physio's call, and the patient hearing the difference.

**Sending.** The app keeps the last 20 seconds of camera in memory during a set, never on disk unless asked. At the end of a set the rep list shows each rep with what the app said about it. The patient ticks one rep or the whole set and taps *Review with my physio*, adds a line ("it hurts at the top") or a voice note, and sends. The clip is cut to the ticked reps plus a second either side, downscaled to 480p, and uploaded with the pose record of those reps. Nothing goes without the tap. A set can also be sent from history for seven days, while the clip is still on the phone.

**What the physio sees.** A queue, newest first, with the patient's name, the exercise, the step of the plan, the app's verdict ("3 of 5 reps: hip lifting") and the patient's line. Opening one plays the clip with the stick figure drawn over the body from the pose record, the measured angles beside it, and a strip under the video marking where the app called a fault. The physio can scrub, slow to half speed, and compare with the exercise's own figure.

**Judging.** Per rep, or for the set at once, the physio picks one of three:

1. *Looks fine.* The app's fault, if it raised one, is recorded as a false alarm against that rep.
2. *A fault the app knows*: the exercise's own fault list (the file's `faults`, in the physio's words), several allowed, each with a severity (slight, clear, stop).
3. *Something else*: a name, a line describing it, which part of the body, and optionally which of the app's measurements should have caught it. The new fault is saved against the exercise for us to turn into a rule; the physio sees it listed under the exercise from then on and can reuse it.

Then a message to the patient (text, a voice note, or one of the physio's saved phrases), an optional change to the step (ease the range, leave a fault alone, drop a set), and *Send*. The patient gets a notification; the reply sits on the rep in history with the physio's note, and a changed step shows the plan's new numbers with the physio's reason.

**Rules.** A review is answered within two working days or it is marked overdue on the physio's home. A physio sees reviews only from patients linked to them. A clip is kept 180 days, then deleted, unless the patient has opted into the training record. The patient can withdraw a review before it is opened.

## The training record

Every reviewed rep leaves a record that pairs what the camera saw with what the physio said; stored once, in a shape a model can be trained from later without going back to the video.

**What one record holds.**

| Part | Contents | Where |
| --- | --- | --- |
| Pose record | per frame: time, the 33 landmarks (x, y, z, visibility) as the pose model gave them, before any smoothing; frame size, camera facing, frames per second | object storage, one gzipped JSON per rep, about 150 KB for 10 s |
| Measurements | per frame: every measurement of the exercise file by key, and the judge's state (set-up, under way, top, hold, return) | the same file |
| The app's verdicts | per rep: counted or not, peak, hold time, faults raised with their time and the measurement that raised them, the version of the exercise file (a hash of its JSON), the app version, the pose model's name and version | a row in the database |
| The physio's labels | per rep: fine / a known fault id / a new fault; severity; the note; who judged it and when; how long they took | rows in the database |
| Context | exercise id, plan step and its adjustments (range, faults left alone), the patient's year of birth, sex, condition, weeks since surgery or onset, device class, whether it was a shared phone | a row, no name or phone number |
| The clip | 480p, the ticked reps plus a second either side | object storage, deleted at 180 days unless opted in |

**Why the raw landmarks and not the clip.** The clip is what the physio needs; the landmarks are what a model needs, and they are 20 times smaller, carry no face, and can be kept under consent for years. Keeping the measurements beside them means a rule change in an exercise file can be replayed over every old record in seconds to see what it would have called.

**Consent, in two layers.** Sending a review is consent for the physio to see that clip; that is what the tap means and it is written on the button. Using the record to improve the app is a separate box on the profile, off by default, in plain words ("the app may keep the skeleton of my reviewed reps, without my name, to get better at spotting faults"), revocable at any time: revoking drops the records from the training set within a day and deletes clips past their 180 days. A record in the training set carries a consent id, so a revocation is a query, not a search.

**What it is used for, in order.**

1. *False alarms by exercise.* Each fault id gets a count of "the app called it, the physio said fine" and the reverse. This is the first report we read every week of the pilot and it drives the threshold changes in the exercise files.
2. *New faults into rules.* A new fault the physio named three or more times, with its records, is turned into a measurement and a fault in the exercise file by us, then checked against the records that carried it.
3. *A model per exercise*, later: a small classifier over the landmark sequence per rep, trained on the labelled records, that runs beside the rules on the phone. Not before a few hundred labelled reps per exercise.

**Export.** A nightly job writes the labelled records to a dataset bucket as one Parquet file per exercise per month (one row per rep: the landmarks, the measurements, the app's verdicts, the labels, the context), versioned by date. Nothing in the dataset identifies a person; the link back is a record id in the database, which only an admin can resolve.

## Visits and reminders

The physio sets how often they want to see the patient; the app reminds the patient to book, tells the physio who is due, and resets when the visit happens. Exercise reminders are the patient's own, at their time, on the channel that reaches them.

**The visit interval.** On the patient's page the physio sets *See me every* 1, 2, 3, 4 or 6 weeks (or a date), from the last visit. The app shows the next due date to both. Seven days before, and again two days before, the patient gets "Dr. Meera would like to see you around 14 Oct. Book a visit?" with *Booked*, *Remind me in 3 days* and *Call the clinic* (the clinic's number, one tap). The physio's home lists patients due this week and overdue, with the same *Mark visited* that the review-on-a-visit flow already has; marking a visit, or entering a clinic measurement, moves the next date on. The interval, the dates and every reminder sent are kept so the physio can see a patient has been asked three times.

Later, when the clinic has a booking system or we add one, *Booked* becomes a slot picker; the data stays the same.

**Exercise reminders.** The patient picks the days and a time (default: the plan's days at 7 pm) on first use; the app suggests a second slot if the first is missed twice. Quiet hours 10 pm to 7 am. A reminder is cancelled when the day's session is done. Missing three in a row raises the coach's flag the Journeys section already names, and the reminder changes its words ("Two minutes of the knee slides counts").

**Delivery, in order of cost.**

| Channel | Reaches | Cost per message | Notes |
| --- | --- | --- | --- |
| Web push | Android Chrome, installed or not; iPhone only when added to the home screen | free | Android may hold a push for minutes; fine for a 7 pm reminder, not for an OTP |
| WhatsApp utility template | everyone with WhatsApp | about ₹0.12 plus the provider's margin | needs Meta business verification and an approved template; the channel patients prefer |
| SMS | everyone | about ₹0.20 to ₹0.25 | the fallback; needs DLT registration (India's SMS sender registry) |

The rule: push when a working subscription exists, else WhatsApp, else SMS; never more than one channel per reminder. OTPs go by SMS first (deliverability is what matters there), with WhatsApp as the retry.

**What the physio can switch.** Per patient: the visit interval, whether the app may send exercise reminders at all (some patients are reminded by family), and a line added to the reminder in the patient's language.

## Cues and how-tos

The app has to work for Sunita, 58, on a ₹10,000 phone propped against a water bottle, with nobody in the room to explain it. Each item below is a small thing; together they are most of the difference between a patient who does the plan and one who stops after two days.

**Before the first session.**

- A 40-second film of a real person doing one exercise with the app, on the welcome screen, with the sound on: what it says, when it counts.
- The set-up walk-through the app already has, with one addition: a photo of the phone propped the way this exercise needs (floor, chair, wall), taken in a plain Indian living room, not a studio.
- The physio does the first session with the patient in the clinic. The app has a *Clinic set-up* mode for this: the physio's own phone, the patient's account, so the patient goes home having seen it work.

**On the exercise page.**

- The figure loops the movement; under it, three lines at most: where to put the phone, the start position, what the app will say. Everything else is behind *More*.
- A *Why this exercise* line from the programme, in the physio's words when they wrote one.
- One big *Start* button. Reps, sets and hold shown as the plan set them, not editable by the patient unless the physio allows it.

**During.**

- The three-second still-start the app has, with its words on screen as well as spoken: "Lie on your side, facing the phone. Hold still."
- A green edge round the screen while the position is good; amber when a fault is being called; the fault's words in large type at the top, never more than one at a time.
- A short beep on each counted rep and a different one at the end of a set, so the patient need not look at the screen.
- Between sets, a countdown and the one thing to fix, from the set's worst fault.
- *I can't do this today* on the live screen: ends the set, asks why in one tap (pain, tired, no space, the app is not seeing me), and tells the physio.
- *Why did it say that?* after any fault: the figure with the measured angle drawn, the band it should be in, and the exercise's own word for the fault.

**After.**

- The rep list with ticks and the app's words per rep, the *Review with my physio* tick boxes, and *felt* and *pain* as two taps.
- A streak that counts days done out of days planned, not consecutive days, so a missed day is not a reset.
- A weekly card on Sunday evening: days done, the range graph, the physio's replies, the next visit date.

**Words and voice.**

- Every cue has a spoken form and a screen form, both short, both in the exercise file. Hindi arrives as a second column in the same file and a second voice pack; the app picks the profile's language.
- Large-text mode, on by default over 55 years of age, with the live screen laid out for it.
- The physio can record their own voice for the three most common cues of a step, and the app uses it instead of the stock voice for that patient.

**When it does not work.**

- The set-up wait already warns about light, contrast and room. Each warning carries a picture of the fix.
- If the camera loses the person three times in a set, the app offers to switch to *count by tap* (the patient taps per rep, the physio sees the set was uncoached) rather than ending the session.
- *Something is wrong* on every screen: one tap, a sentence, the app attaches what it needs (see the build plan).

## History, notes and smarter coaching

The app already records, per set, every cue with its time, the reps counted and why an attempt did not count, the hold time, the range reached at the top of each rep and how the person felt. The job is to keep that per person, roll it up per week, and show each role the part that changes what they do next.

**What is recorded per session.**

| Record | Where it comes from | Kept for |
| --- | --- | --- |
| Session: plan, step, start time, duration, device, model used, frame rate | the app | the week view, and knowing a slow phone when counts look odd |
| Per set: reps counted, attempts not counted and why (early, short, out of position), hold seconds, best hold | the coach's summary (exists) | counts and quality, not just done or not |
| Per rep: peak of the progress measurement, hold time, faults on | the trace (exists on the Review page) | the range graph, tempo, the clips worth seeing |
| Cues said, with time and count | the cue log (exists) | what to watch next time; the coach's most-said list |
| Set-up: picture warnings (edge, light, room), time to ready | the gate (exists) | why a session was poor; what to tell the person about their room |
| Felt: effort, could do more or less, pain 0 to 10, where, a note (text or voice) | the done screen (exists, extended) | the flags; easing or progressing |
| Flagged clips: three seconds round a rep the coach would want to see, opt-in | the film (exists) | the coach's eyes without the whole film |
| Clinic measurement: a range or a strength grade the coach enters on a visit, dated | the coach | the graph beside the camera's number |

**History each role sees.** The trainee sees a week of ticks and one graph per plan: the range of motion of the exercise that tracks it, camera dots and clinic diamonds on the same line, with the plan's target as a band. The individual sees the same plus every number. The coach sees, per client: the week grid, the graph, the most-said cues, the pain log, the notes, the clips; per clinic: the flag list and a sortable table of clients by last session, adherence and trend.

**Notes.** A trainee's note is one line or a voice clip after a session, tagged to the session; a longer note goes on the plan. A coach's notes are per client and per visit, private to the coach, with a check box to share a line with the client. Both kinds are searchable and dated.

**Progress, measured.** Three numbers carry progress and each is already computed or one step away: adherence (sessions done over sessions planned, by week); quality (reps counted over attempts, and the share of reps with no fault); range (the peak of the progress measurement, median per session, against the plan's target). A trend is the slope over the last three weeks. A plateau is two weeks without improvement at full adherence, which is the coach's cue to progress or change the exercise.

**Smarter exercises.** The recordings the Review page already judges are the raw material. With history across people, the app can: set each exercise's default edges from what real sessions read, by age band and condition, instead of by hand; suggest the next stage when range and quality have been stable for two weeks; show a coach which fault is most called across all their clients for an exercise, which is usually a cue problem, not a client problem; flag an exercise whose counts disagree with how it felt (many "hard" with low counts means the range is set wrong); and learn, per phone model, when to prefer the lite pose model. All of it is sums over sessions; none of it needs a model trained on video.

## Feature wish list

Ranked by what unblocks a real coach-and-trainee pair first; the three columns are what exists, what the first release needs, and what follows. Tick a row to claim it.

| # | Feature | For | Now | Next | Later |
| --- | --- | --- | --- | --- | --- |
| 1 | Pose coach: counts, holds, spoken corrections, 28 exercises, 6 programmes, plans with range and faults, films, review | all | yes |  |  |
| 2 | Accounts by phone number and OTP (SMS, missed call, WhatsApp fallback); profiles on one number for a shared phone | all |  | yes |  |
| 3 | Sync of sessions, plans, notes; offline-first with a queue | all |  | yes |  |
| 4 | Coach assigns a plan by WhatsApp link; trainee consents on the first open | coach, trainee |  | yes |  |
| 5 | Coach week view: clients × days, flags on top (pain, missed, plateau) | coach |  | yes |  |
| 6 | Felt and pain after every session, with a voice note; the flag it raises | trainee, individual | partly | yes |  |
| 7 | Hindi voice and words, then Tamil, Telugu, Marathi, Bengali, Kannada; the voice pack per language | all | English only | Hindi | the rest |
| 8 | Reminders by push and WhatsApp at the person's time | trainee, individual |  | yes |  |
| 9 | Set-up walk-through with a room drawing and a ten-second camera check | all | partly (room, light) | yes |  |
| 10 | Range-of-motion graph: camera dots, clinic diamonds, the target band; adherence and quality per week | all |  | yes |  |
| 11 | Flagged-rep clips (three seconds round a rep) instead of whole films, opt-in | trainee, coach |  | yes |  |
| 12 | "Too hard today": the trainee eases a step one notch without the coach, logged | trainee |  | yes |  |
| 13 | Coach notes per client and per visit; clinic measurements entered by hand | coach |  | yes |  |
| 14 | Plan templates and stages (early, middle, late) with a suggested move-up when stable | coach | programmes |  | yes |
| 15 | Clinic accounts: several coaches, shared clients, seats | coach |  |  | yes |
| 16 | Weekly report as a PDF or link for a doctor or a family member | individual, trainee |  |  | yes |
| 17 | Family helper mode: a second phone sees the day's result and can start the session for an elder | trainee |  |  | yes |
| 18 | Load progression for strength coaches: weight, band, tempo, rest; a lifting library | coach (fitness) | weight and band bubbles |  | yes |
| 19 | Defaults learned from real sessions per age band and condition; cue-problem reports per exercise | coach, product |  |  | yes |
| 20 | Coach discovery: a verified directory, a profile, reviews; paid plans for coaches | coach, individual |  |  | yes |
| 21 | Export everything, delete the account, consent per data use, in the person's language | all |  | yes |  |
| 22 | A native wrapper (TWA or Capacitor) for store listing, camera permission that sticks, and background reminders | all | web app | yes |  |
| 23 | Review with my physio: a rep or a set sent with the clip and the pose record; the physio judges it (fine, a known fault, a new fault) and replies | trainee, coach |  | yes |  |
| 24 | Training record: pose output paired with the physio's labels, under its own consent, exported nightly | product |  | yes |  |
| 25 | Visit interval per patient; book-a-visit reminders; the physio's due list | coach, trainee |  | yes |  |
| 26 | Billing-ready schema: organisation, subscription, entitlements, feature switches; Razorpay when turned on | product |  | schema | payments |
| 27 | Something is wrong: one-tap report with the device, the exercise file version and the last minute of logs; a thumbs-up or down after each session | all |  | yes |  |

Not on the list on purpose: live video calls (WhatsApp does it), a chat (notes and flags carry the conversation; chat becomes a support burden), diet and sleep tracking (another product), and wearables (nothing here needs them).

## What it takes to build

The coaching stays on the phone; what gets built is a thin account and sync layer around it, and the coach's pages. Nothing in the pose pipeline changes.

**Architecture.** Keep the web app as the client, installed to the home screen (a Trusted Web Activity for the Play Store later). Add a small backend: phone-number auth with OTP, a sessions API the phone posts to when it has network, plan storage with versions, and a coach API that reads clients. A managed Postgres plus object storage for clips is enough for the first ten thousand users. Push through Firebase Cloud Messaging; WhatsApp reminders through a Business API provider, which costs per message and needs template approval, so push first and WhatsApp for the invite and the weekly summary.

**OTP.** SMS OTP from a DLT-registered sender (TRAI requires the template to be registered); a missed-call OTP as the fallback that works without data; WhatsApp OTP as the third road. Six digits, five minutes, three tries, a 30-second resend, auto-read on Android. A session token on the phone that lasts 90 days so the OTP is a once-a-quarter thing.

**Data model.**

| Object | Holds | Notes |
| --- | --- | --- |
| Person | phone, name, language, year of birth, sex, role flags, consent records | one phone can hold several profiles for a shared device |
| Coach | clinic, registration, specialities, review state, seats | a clinic groups coaches |
| Link | coach ↔ person, consent date, what is shared (counts, pain, notes, clips), ended date | history before the link is private unless opened |
| Plan | the plan JSON as the app has it today, owner, version, parent template, stage, start date, days | every change is a new version; sessions point at the version they ran |
| Session | person, plan version, step, device, model, start, duration, sets summary, cues, felt, pain, note | the summary the app already makes, plus felt |
| Trace | the per-rep rows (peak, hold, faults) | small; the range graph reads it |
| Clip | session, rep, three seconds of film, opt-in flag | object storage, deleted with the session |
| Measurement | person, date, what, value, by whom | the clinic's goniometer beside the camera |
| Note | author, about whom, date, text or audio, shared flag |  |
| Flag | person, kind, raised at, seen by, resolved | the record that the coach was told |
| Review | session, the reps ticked, clip path, pose record path, the app's verdicts, the patient's line, state (sent, opened, answered, withdrawn), who answered and when | the queue the physio works; overdue after two working days |
| Label | review, rep, verdict (fine, fault, new fault), fault id or new-fault id, severity, note, judge, seconds taken | the physio's half of the training record |
| New fault | exercise, name, description, body part, the measurement it should show in, who named it, times used | the brief for a rule in the exercise file |
| Consent | person, purpose (coach sees, training record, reminders), the notice version shown, given at, withdrawn at | one row per purpose; the Act wants this record |
| Visit | link, interval in weeks, last visit, next due, state (due, booked, done, overdue), reminders sent | the appointment interval the physio sets |
| Reminder | person, kind (exercise, visit, review reply), days, time, time zone, channel order, push subscription, last sent, last result | the scheduler reads this every 15 minutes |
| Organisation, Subscription, Entitlement, Switch | the clinic; its plan (pilot), status, valid-until, seats, provider reference; what the plan allows; per-organisation feature switches | free for everyone now; billing turns on here |
| Report | person, screen, what happened, device and browser, app and exercise file versions, the last minute of logs, a screenshot if offered, state | errors and feedback from the one-tap report |
| Audit | who, did what, to whose data, when | every clip opened, every export, every deletion |

**Privacy and consent, under the Digital Personal Data Protection Act 2023 and its 2025 rules** (from search results; have a lawyer check before launch): a plain notice at sign-up saying the number is for sign-in and the name for the voice, in the person's language; separate consent for sharing with a coach, for clips, and for any use of sessions to improve defaults; withdrawal as easy as giving; export and deletion from the profile page; a parent's verifiable consent for anyone under 18, which for a sports coach's teenage trainees is a real flow, not an edge case; breach notification duties; and health-related data treated as the sensitive kind it is. Films never leave the phone unless the person taps share on a clip.

**Order of work.** Accounts and sync first, because every other feature sits on them; then the coach's assign and week view; then felt, pain and flags; then Hindi; then the graph and clips. Each is a two- to four-week piece on top of the current app.

**Free now, paid later.** Nothing is charged in v1, and no screen mentions money; but the schema carries the four objects billing needs, so turning it on is a payment integration and a settings change, not a rebuild.

- An *organisation* (a clinic or a solo physio) owns coaches, patients and plans. Every physio belongs to one from day one, even a one-person clinic.
- A *subscription* per organisation: plan name (`pilot` for everyone now), status, valid-until, seats, the payment provider and its reference. Every organisation gets a `pilot` row at sign-up.
- *Entitlements* are one function, `can(org, feature)`, read everywhere a paid feature would be gated: patients per physio, reviews per month, clip retention days, Hindi voice, the weekly report. In v1 the `pilot` plan returns yes to everything with no limits; the gates are in the code, returning yes.
- A *feature switch* table lets us turn a feature on for one organisation without a release, the same mechanism a paid tier will use.

When it is time: Razorpay for cards, UPI and UPI Autopay (about 2% a transaction plus about 1% for subscriptions, plus GST on the fee), which needs a registered business with a PAN and a bank account, and a GST number once the business is liable. Likely shapes, to be decided then: per physio seat per month, or per active patient per month, with individuals free. A patient never pays in the first version of billing; the physio or the clinic does.

**Physios modify, they do not build.** The physio's account never sees the builder. What they can change is exactly the plan's adjustment set: sets, reps, hold, range of motion, faults to leave alone, any of the exercise's numbers by name, and a note. A change saves as a named variant of the exercise ("Heel slide, Mrs Rao, week 2") that they can reuse. A new exercise is a request to us, with the review's *something else* records as the brief.

**Decisions for you.**

- [x] Who is the first customer: physios with post-operative patients, or fitness coaches with online clients? The first wants pain, range and clinic measurements; the second wants load, tempo and films. The plan above leans physio.
- [x] Free for individuals and paid per coach seat, or paid by the clinic? This sets whether coach discovery matters early.
- [x] Hindi only in the first release, or Hindi and one southern language? Each language is a voice pack and a translation of every cue.
- [x] Do clips of flagged reps go to the coach by default (opt-out) or only on request (opt-in)? Opt-in is safer under the Act; opt-out is what coaches will ask for.
- [x] Native wrapper from day one for the Play Store, or the web app with an install prompt for the first months?
- [x] Should the app ever read exercises from a coach's own builder files, or only from the vetted library plus the plan's adjustments? The builder exists; opening it to coaches needs a review step.

**Decided on 1 October 2026.**

- The first customer is a physio with patients. Fitness coaches come later; nothing in v1 is built for them alone.
- Free for everyone for now. Billing is designed in from the first schema (an organisation, a subscription, entitlements, a feature switch) and turned on later with Razorpay; no screen in v1 shows a price.
- English voice and words in v1; Hindi is the first language added, after the pilot.
- A rep or a set goes to the physio only when the patient sends it ("Review with my physio"). A separate, revocable opt-in lets the clip and its pose record be used to improve the app.
- A web app, installed to the home screen, for the first months. A store wrapper waits until reminders or the camera permission prove to need it.
- Physios do not build exercises. They modify the prebuilt ones: counts, hold, range of motion, faults to leave alone, any number by name, a note. The builder stays with us.
- A physio sets a visit interval per patient; the app reminds the patient to book the appointment when it comes round.

The step-by-step plan to build and run v1, with the stack, costs and security: [Building v1](build-plan.md) (the second tab of the doc).
