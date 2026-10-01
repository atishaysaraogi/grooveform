<!-- A copy of the Claude Doc at https://claude.ai/code/artifact/add87051-4876-45b0-8041-2bf19cfa2733, which is the living version (the flow drawing lives there). Exported 2026-10-01. -->

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

&#91;embedded content: the three roles' flows · coach lane, trainee lane, the server under both\]

The coach's assignment reaches the trainee as today's plan; the trainee's counts and pain come back as the coach's week view, and a flag there loops into an eased or progressed step, which goes down the same road.

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

**Privacy and consent, under the Digital Personal Data Protection Act 2023 and its 2025 rules** (from search results; have a lawyer check before launch): a plain notice at sign-up saying the number is for sign-in and the name for the voice, in the person's language; separate consent for sharing with a coach, for clips, and for any use of sessions to improve defaults; withdrawal as easy as giving; export and deletion from the profile page; a parent's verifiable consent for anyone under 18, which for a sports coach's teenage trainees is a real flow, not an edge case; breach notification duties; and health-related data treated as the sensitive kind it is. Films never leave the phone unless the person taps share on a clip.

**Order of work.** Accounts and sync first, because every other feature sits on them; then the coach's assign and week view; then felt, pain and flags; then Hindi; then the graph and clips. Each is a two- to four-week piece on top of the current app.

**Decisions for you.**

- [ ] Who is the first customer: physios with post-operative patients, or fitness coaches with online clients? The first wants pain, range and clinic measurements; the second wants load, tempo and films. The plan above leans physio.
- [ ] Free for individuals and paid per coach seat, or paid by the clinic? This sets whether coach discovery matters early.
- [ ] Hindi only in the first release, or Hindi and one southern language? Each language is a voice pack and a translation of every cue.
- [ ] Do clips of flagged reps go to the coach by default (opt-out) or only on request (opt-in)? Opt-in is safer under the Act; opt-out is what coaches will ask for.
- [ ] Native wrapper from day one for the Play Store, or the web app with an install prompt for the first months?
- [ ] Should the app ever read exercises from a coach's own builder files, or only from the vetted library plus the plan's adjustments? The builder exists; opening it to coaches needs a review step.
