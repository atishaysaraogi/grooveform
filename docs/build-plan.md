<!-- A copy of the "Building v1" tab of the Claude Doc at https://claude.ai/code/artifact/add87051-4876-45b0-8041-2bf19cfa2733, which is the living version (the architecture drawing lives there, and the checklist can be ticked there). Exported 2026-10-01. -->

# Building v1

2026-10-01 · Atishay Saraogi

A physio can be using v1 with patients about eight weeks from the day the accounts in stage 0 are opened, running on about ₹3,000 a month, with the data in Mumbai and billing a switch away. The pick is a managed Postgres backend (Supabase, Pro plan) behind the static web app on Cloudflare, with MSG91 for OTPs and WhatsApp; the alternatives and why not are below.

## What v1 is

V1 is done when one physio has three patients doing plans at home, each patient has sent a review and had it answered, a visit reminder has fired, and nothing has needed us in the room for two weeks.

**In.**

- Accounts by phone number and OTP; a physio role and a patient role; one admin (you).
- The physio links a patient by phone number; the patient accepts on first open; the physio assigns a programme and modifies its steps (no builder).
- The app as it is today (28 exercises, 6 programmes, plans, adjustments), with sessions, plans and notes saved to the server and kept working offline.
- Review with my physio, the physio's queue, the three verdicts, the reply; the training record under its own consent.
- Visit interval and book-a-visit reminders; exercise reminders by push, WhatsApp or SMS.
- Felt and pain after a session; the patient's history; the physio's patient page with the week view and flags.
- One-tap *Something is wrong*; a thumbs after each session; error capture.
- Export my data and delete my account; the privacy notice and consent screens; the organisation and subscription objects, all on the free `pilot` plan.

**Out, on purpose.** Hindi (after the pilot), the store wrapper, clinic accounts with several physios (the schema allows it; no screen for it), payments, the weekly PDF, family helper mode, the range graph with clinic diamonds (the numbers are stored; the graph is the first thing after the pilot).

**Who does what.** You: every account, registration, payment and legal step, the physio relationship, and the decisions. Me: the code, the schema, the tests, the deploys, the drafts of every notice and message, each as a pull request you approve. The physio: 30 minutes a week and honest complaints.

## Where it runs

Supabase Pro in Mumbai is the pick: Postgres with row-level security, phone OTP that can send through an Indian provider, private file storage, scheduled functions and daily backups for $25 a month, with nothing for us to patch. The front end stays a static site (it is one today) on Cloudflare Pages, free. Prices are list prices as of October 2026, before GST; the sources are at the end.

| Option | Monthly at 50 people | At 5,000 people | India region | Auth with phone OTP | Security out of the box | Operations on us | Lock-in | Why not |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Supabase Pro** (Postgres, auth, storage, functions) | $25 (about ₹2,100); 8 GB database, 100 GB files, 250 GB egress, 7-day backups | $60 to $120 with a larger compute instance; files and egress by use | yes, Mumbai (AWS ap-south-1) | built in; an SMS hook hands the code to MSG91 | row-level security in the database, private buckets, signed links, encryption at rest | none: no server to patch | low: it is plain Postgres; a dump restores anywhere | the free plan pauses after a week idle, so Pro from day one |
| **Firebase** (Firestore, auth, storage, functions) | $0 to $10; phone OTP $0.01 a verification after 10,000 free a month | $50 to $200, driven by reads | yes, Mumbai (asia-south1) | built in, with an invisible captcha; cheap | security rules per document; good, but every rule is hand-written in a custom language | none | high: Firestore is not a relational database; the physio's week view and the training export fight it | the data shape is tables; moving off Firestore later is a rewrite |
| **A VPS you run** (Hostinger KVM 2 in India, or Hetzner in Germany) with Postgres and a small Node server | ₹800 to ₹1,100 for 2 CPU, 8 GB (Hostinger); Hetzner is €8 but 150 ms from India | one bigger box, ₹3,000; then you are building what Supabase sells | Hostinger yes; Hetzner no | you write it, or run an auth server yourself | whatever you set up: firewall, patches, backups, TLS, all on you | all of it, every month | none | the cheapest line and the most expensive hours; one missed patch is a breach |
| **AWS** (Cognito, RDS Postgres, S3, Lambda) | $35 to $60; the smallest RDS instance is most of it | $150 to $400 | yes, Mumbai | Cognito, SMS through SNS (needs its own India sender registration) | strong, if configured; the configuration is the job | IAM, VPC, patches of the instance, cost control | medium | right at 50,000 people; for 50 it is a week of setup and a bill |
| **Cloudflare only** (Pages, Workers, D1, R2) | $0 to $5 | $25 to $50 | no data-residency pin for D1 or R2 (location hint only) | none built in; you write OTP and sessions in a Worker | good edge; the database is SQLite with per-row limits and no row-level security | the auth code is yours to get right | medium | writing authentication by hand for a health app is the one thing not to do |

Two things decided it. Row-level security means the rule "a physio sees only linked patients" lives in the database, checked on every query, not in each screen. And Postgres means the training record export, the physio's week view and the false-alarm report are queries, not code.

**What stays where it is.** The exercise files, programmes and the pose model are static files in the app (Cloudflare Pages, free, cached worldwide), versioned by their hash. Pose estimation runs on the phone, as today; the server never sees video except the clips a patient sends.

## Where the data lives

Rows (people, plans, sessions, labels) live in the Postgres database in Mumbai. Clips and pose records live in Supabase's file storage, also Mumbai, for the pilot, and move to Cloudflare R2 only if the egress bill from physios watching clips ever matters. Nothing is stored outside India in v1.

**Clips and records.** A 10-second 480p clip is 1 to 2 MB; its pose record about 150 KB. Fifty people sending ten reviews a week for three months is under 10 GB.

| Store | Storage per GB a month | Egress | Free each month | India | Notes |
| --- | --- | --- | --- | --- | --- |
| Supabase Storage (Pro) | $0.021 past 100 GB | $0.09 per GB past 250 GB | 100 GB and 250 GB egress in the plan | Mumbai | signed links, row-level rules on files; the pick for v1 |
| Cloudflare R2 | $0.015 | free | 10 GB | no pin; a location hint only | the move if clips ever cost real money; same S3 API |
| Backblaze B2 | $6.95 per TB | free up to three times what is stored | 10 GB | no | cheapest at scale; another account and key to mind |
| AWS S3 Mumbai | about $0.025 | about $0.11 per GB | 5 GB for a year | Mumbai | right if everything else moves to AWS |

**OTPs, reminders and replies.** Every message goes out through one provider so there is one bill and one place to look when a message is late.

| Channel | Provider | Cost per message | Set-up before it works | When it is used |
| --- | --- | --- | --- | --- |
| SMS, Indian route | MSG91 | about ₹0.25 at small volume, ₹0.16 at a million; 18% GST on top | DLT registration (India's sender registry): the business as an entity, a 6-letter sender id, each message template approved; about ₹6,000 one-time and one to two weeks | OTPs first; reminders when nothing else reaches |
| WhatsApp templates | MSG91 (a Meta partner) | about ₹0.12 for an authentication or utility template, plus MSG91's margin | Meta business verification with the business's documents; a number not used on personal WhatsApp; templates approved | reminders, review replies, the OTP retry |
| Firebase phone auth | Google | $0.01 a verification after 10,000 free | none; works tomorrow | the fallback if DLT drags: OTPs only, and it means a second auth system, so only as a stopgap |
| Web push | the browser | free | a service worker and a key pair | reminders when the person installed the app and allowed it |
| Email | Resend | free to 3,000 a month | the domain's records | you, for reports; never patients |

**Backups.** Supabase Pro keeps daily backups for seven days. A weekly job also dumps the database and copies the clip bucket to a second bucket with a different key, so a lost Supabase account is not a lost product. A restore is rehearsed once before the pilot and once a quarter.

## How the parts fit

*(Drawing in the Claude Doc: v1 architecture · the phone, the static site, Supabase in Mumbai, MSG91, the training bucket.)*

The phone (the web app) runs the camera and the pose model, counts, coaches and speaks; no video leaves it except the clips a patient sends. It keeps a 20-second clip buffer and a pose record per rep, writes sessions, plans and notes locally first, and holds the physio's screens too. It loads from Cloudflare Pages (the static app, exercise files, the model; DNS, HTTPS, the content policy header) and talks to Supabase in Mumbai over HTTPS with its session token: Auth (phone OTP, sessions), Postgres (rows, row-level rules), Storage (clips, pose records), Functions (the OTP hook, notifications), the Scheduler (reminders every 15 minutes) and the Nightly job (retention, the export). The functions send messages through MSG91 (SMS on the DLT route, WhatsApp templates) and write the training record bucket (Parquet per exercise per month, no names); you watch from the Supabase dashboard, Sentry and your inbox.

## Logins

A person signs in with a phone number and a six-digit code and stays signed in on that phone for 90 days; a physio is a person with a role, and a patient is reachable to a physio only through a link the patient accepted.

**The OTP.** The app sends the number; Supabase makes the code and hands it to a function that sends it through MSG91 (SMS, with WhatsApp as the retry after 45 seconds). Six digits, valid five minutes, five tries, then a 15-minute wait; at most five codes an hour to one number and 30 an hour from one address. Test numbers with a fixed code exist for the physio's demo phone and for the automated tests, never in the real list.

**The session.** A short-lived access token (one hour) and a refresh token the app keeps in the browser's storage, rotated on every refresh and revoked if an old one is replayed; the refresh token lasts 90 days without use. A person sees their devices and can sign out all of them. A shared phone holds several profiles under one number, each a row with its own year of birth; switching asks for the profile's four-digit pin, not a new OTP.

**Roles.** `patient` (everyone at sign-up), `physio` (set by you, after a look at the registration number they type and a phone call), `admin` (you, on the Supabase dashboard with two-factor auth, never in the app). A physio belongs to an organisation; v1 makes one per physio.

**The link.** The physio types the patient's number; the patient gets "Dr. Meera at Rao Physio wants to add you on OnTrack" with a link; opening it, after their OTP, shows the consent screen naming the physio, what they will see (sessions, pain, notes, the reviews the patient sends) and *Accept*. Until then the physio sees a pending row and nothing else. The patient can end the link; the physio keeps the records of the time it stood and gets nothing new.

**Where it is enforced.** Every table carries row-level rules: a patient reads and writes their own rows; a physio reads a patient's rows where an accepted link exists; a physio writes plans, labels, visits and notes on linked patients only; an admin bypasses nothing in the app, only on the dashboard. The rules are tested in the test suite as two users (a physio and an unlinked patient) that must each fail to see the other.

## Security built in

The app holds health data about named people, so the rules of the Digital Personal Data Protection Act apply to you as the data fiduciary; the list below is what v1 does about it, and each line says how we know it is true.

| What | How | Checked by |
| --- | --- | --- |
| Only the right person sees a row | row-level security on every table; no table without a policy | a test that signs in as a physio and an unlinked patient and must get nothing from each other's tables; the migration check refuses a table with no policy |
| Clips are private | private buckets; a link to a clip is signed and lasts ten minutes; the path carries no name | the same test tries a clip path without a signature |
| Nobody else's code runs on the page | a Content Security Policy that allows only our own files and the Supabase host; no analytics, no fonts from elsewhere, no third-party script | the browser refuses anything else; the header is in the smoke test |
| Transport | HTTPS only, HSTS, the Cloudflare proxy in front of the site; the Supabase host is HTTPS only | a weekly header check |
| OTP abuse | the limits in Logins; a captcha only after the third code to one number | a test that asks for six codes |
| Admin access | the Supabase dashboard with two-factor auth; the service key lives in the functions' secrets, never in the app, never in the repository | a repository scan for keys on every pull request |
| Secrets | Bitwarden for every password and key; one owner; a recovery sheet offline | you |
| Dependencies | the pose model and the few libraries are pinned by hash and updated by a pull request with the tests green; Dependabot opens them | CI |
| Audit | every opening of a clip, every export and every deletion writes an audit row the person can see on their data page | a test; the row appears in *My data* |
| Retention | clips 180 days; sessions and labels while the account stands; the training record while the consent stands; a report 90 days | a nightly job; the counts are on the admin page |
| The person's rights | export everything as a zip (JSON and the clips) from the app; delete the account from the app, done within seven days, clips at once | a test runs both for a fake person |
| Consent and notice | an itemised notice at sign-up (what is collected, why, for how long, who sees it) and one consent row per purpose, with the notice version | the rows exist for every person; the notice is in the repository with a version number |
| Breach | a written plan: who you call, how the Data Protection Board and the affected people are told within 72 hours, where the logs are | a one-page runbook you keep with the recovery sheet |
| Children | the app asks the year of birth; under 18 is refused in v1 (parental consent needs a verifiable process we do not have) | a test |
| Physio identity | a registration number and a phone call before the role is granted; the clinic's name on every consent screen | you |

**What this is not.** The app coaches exercise form and adherence; it does not diagnose, and the words on every screen and in the notice say so, because software that claims to diagnose or treat falls under India's medical device rules. A lawyer should read the notice, the terms and that sentence before the pilot (budget ₹10,000 to ₹20,000). The Rules of the Act were notified in November 2025 with 18 months for data fiduciaries; building the list above now is cheaper than retrofitting it in 2027.

## Reminders, errors and feedback

**Reminders.** A scheduled function runs every 15 minutes in Mumbai time, reads the reminder rows due in that window, picks the channel (push if a subscription exists and worked last time, else WhatsApp, else SMS), sends, and writes the result on the row. Exercise reminders are cancelled by a session that day; visit reminders fire at seven and two days before the due date; a review reply notifies at once. A person's reminder settings are one screen: days, time, channel, off. Quiet hours are fixed, 10 pm to 7 am. The function is idempotent, so a rerun never sends twice.

**Errors.** Sentry's browser kit (free to 5,000 events a month) catches every uncaught error with the app version, the exercise file hash and the device; phone numbers and names are scrubbed before it leaves the phone. A failing pose model load, a camera refused, an upload that will not finish, all count. You get one email a day with new kinds of error, not one per error.

**Something is wrong.** On every screen, one tap opens a sheet: a sentence (or a voice note), a tick for "attach a picture of the screen", and *Send*. The app attaches the device and browser, the app and exercise file versions, the last minute of its own log (what it said, what it measured, never the camera), and the session id. It lands in the `reports` table and in your inbox through Resend; the person sees "Thanks, we read every one" and, when you answer, the reply in the app. The physio's version of the sheet also has "the app called the wrong fault", which opens the review flow on that rep.

**Feedback.** After each session, a thumbs up or down and an optional line; after each review reply, the same for the patient about the reply. Weekly, the physio gets a 30-second form: what was wrong this week, what a patient asked for. All of it is rows in `reports` with a kind, so one page shows everything people said, newest first.

**Status.** A status page (a free Better Stack or Cloudflare page) says whether the site, the database and the message provider are up, and is linked from the sign-in screen's small print.

## Scaling

The same architecture carries the app from 50 people to 5,000 without a rewrite, because the expensive work (pose estimation) runs on the phone and the server only stores rows and clips; the bill grows with messages and clips, not with sessions.

| | 50 people (the pilot) | 500 people | 5,000 people |
| --- | --- | --- | --- |
| Database and functions | Supabase Pro, $25 | Pro, $25; a small compute add-on if the week view gets slow, +$10 | Pro with a medium instance, $60 to $120; read replicas not yet |
| Clips and records (180-day retention) | under 10 GB, in the plan | about 60 GB, in the plan | about 600 GB: $10 on Supabase, $9 on R2; move to R2 at this point for the egress |
| Egress (physios watching clips) | nil | 50 GB, in the plan | 500 GB: $22 on Supabase, nil on R2 |
| OTPs by SMS (two a person a month) | ₹25 | ₹250 | ₹2,000 |
| WhatsApp reminders and replies (20 a person a month) | ₹120 | ₹1,200 | ₹12,000 |
| Static site | free | free | free |
| Error capture | free | free | Sentry Team, $26 |
| About, a month | ₹2,500 | ₹4,500 | ₹25,000 to ₹30,000 |

**What changes at each step.** At 500, add a database index or two for the physio pages and move the nightly export to run in chunks. At 5,000, a bigger database instance, clips on R2, a queue for uploads (Supabase's queue extension), and a second person on call. The one thing to build right the first time is the training record's layout in object storage (one object per rep, named by session and rep, with the metadata row in the database), because that is what a million rows will be read from.

**What does not scale by itself.** Physio review time. At one minute a review and ten reviews a patient a month, a physio with 40 patients spends seven hours a month in the queue; the false-alarm report and the per-set verdict exist to bring that down, and a paid tier can meter reviews when the time comes.

## Every step, in order

Eight weeks if stage 0 starts this week; the registrations in stage 0 take one to two weeks on their own and gate nothing until stage 4, so the code starts the same day. *You* = only you can do it; *Me* = a pull request for you to approve; *Both* = we do it on a call.

### Stage 0, week 1: the name, the domain, the accounts (You)

- [ ] Decide the name. OnTrack is used by several companies; search the Indian trade mark registry (ipindia.gov.in, public search) and the .com and .in availability before you commit. Keep two candidates.
- [ ] Buy the .com at Cloudflare Registrar (about $10.50 a year, at cost, WHOIS privacy included) and the .in at an Indian registrar (Hostinger or BigRock, about ₹700 to ₹900 a year). Turn on two-factor auth on both and auto-renew.
- [ ] Add the domain to Cloudflare (free plan) and point the .in's name servers at it; the .com is there already. Turn on "always HTTPS" and HSTS.
- [ ] A mailbox on the domain: Zoho Mail (free for up to five users) or Google Workspace (about ₹160 a user a month). Make `hello@`, `security@` and `privacy@`. Add the SPF, DKIM and DMARC records Cloudflare suggests.
- [ ] Bitwarden (free) for every password and key from here on; a printed recovery sheet with the two-factor backup codes, kept at home.
- [ ] GitHub: two-factor auth on your account; branch protection on `main` (CI must pass, no force-push); Dependabot and secret scanning on.
- [ ] Supabase: sign in with GitHub, make an organisation, choose Pro ($25 a month, a card), create the project in **Mumbai (ap-south-1)**, a strong database password into Bitwarden. Turn on two-factor auth for the organisation.
- [ ] Cloudflare Pages: connect the GitHub repository, production branch `main`, build output `public`. Point `app.<domain>` at it. (Pages replaces GitHub Pages; same static files.)
- [ ] MSG91: sign up, complete their KYC with your PAN and address, buy ₹1,000 of SMS credit, add WhatsApp as a channel (they walk you through Meta business verification: you need a phone number not on personal WhatsApp, and business proof; allow two weeks).
- [ ] Udyam registration (free, msme.gov.in) as a sole proprietor: it is the business proof DLT, MSG91 and later Razorpay accept. A company or LLP can wait until money is involved.
- [ ] DLT registration on one operator's portal (Vi, Jio or Airtel; MSG91's guide names one): register the entity with the PAN and Udyam, a 6-letter sender id (for example ONTRCK), and the three templates I will give you (the OTP, the exercise reminder, the visit reminder). Fee about ₹6,000 one-time; one to two weeks. Put the entity id and template ids in Bitwarden.
- [ ] Sentry (free, one user) and Resend (free; verify the domain with the records it gives). Keys into Bitwarden, then into Supabase's secrets, never into the repository.
- [ ] Choose the pilot physio and agree the shape: free, eight weeks, three to five patients, 30 minutes a week with you, honest complaints. I draft a one-page letter of understanding; they sign it.

### Stage 1, weeks 1 to 2: the backend (Me)

- [ ] The schema as a migration: people, profiles, organisations, subscriptions, entitlements, switches, links, plans and plan versions, sessions, traces, clips, reviews, labels, new faults, consents, visits, reminders, reports, audit, measurements, notes, flags. Every table with row-level security from the first migration; a check that fails the build if a table has none.
- [ ] Storage buckets: `clips`, `records`, `exports`, `datasets`, all private; the path rules; signed links of ten minutes.
- [ ] Auth: phone sign-in on, email off; OTP length, expiry and rate limits as in Logins; the Send-SMS hook as a function that calls MSG91 (SMS first, WhatsApp retry); test numbers.
- [ ] Functions: `send-otp`, `request-upload` (a signed upload link for a review), `review-sent` (notifies the physio), `review-answered` (notifies the patient), `reminders` (the 15-minute scheduler), `export-my-data`, `delete-my-account`, `nightly` (retention and the training export).
- [ ] A role-switch test suite: a physio, a linked patient, an unlinked patient, each must see exactly their rows; run in CI against a throwaway Supabase branch.
- [ ] The audit trigger: a row on every clip read, export and deletion.
- [ ] You: approve the migration pull request; apply it from the Supabase dashboard's SQL editor the first time, from CI after that.

### Stage 2, weeks 2 to 3: accounts, roles and sync in the app (Me)

- [ ] The sign-in screen (number, code, resend after 45 seconds, WhatsApp retry), the profile screen (name, year of birth, sex, language, condition), the notice and the consent rows.
- [ ] Sync: sessions, plans, notes and settings written locally first, then to the server by a queue that survives a closed tab; conflicts resolved by last-write per field; a "not yet saved" mark on the screen.
- [ ] The physio's home: patients, a pending link, *Add a patient* by number, the week view with flags, the due-for-a-visit list, the review queue count.
- [ ] The patient page for the physio: history, pain, notes, the plan with *Modify* on each step (sets, reps, hold, range, faults to leave alone, numbers by name, a note), saved as a plan version; the visit interval; reminders on or off.
- [ ] The builder hidden from the physio role; the library and programmes read-only for them.
- [ ] The patient's home: today's steps, the plan, history, the physio's replies, *My data* (export, delete, consents, audit).
- [ ] Clinic set-up mode: the physio's phone signs the patient in for a first session, then signs them out.

### Stage 3, weeks 3 to 4: review with my physio (Me)

- [ ] The 20-second camera ring buffer during a set (MediaRecorder; WebM on Android, MP4 on iPhone), kept in memory; the pose record per rep (the landmarks, the measurements, the judge's states) kept beside it.
- [ ] The rep list after a set with tick boxes, the line or voice note, *Review with my physio*; the cut, the downscale to 480p, the upload through the signed link, with retry; a seven-day window from history.
- [ ] The physio's queue page: the clip with the stick figure drawn from the record over the body, the angles, the fault strip, scrubbing and half speed; the three verdicts per rep or per set, severity, the message, the optional step change; *Send*.
- [ ] The patient's side: the notification, the reply on the rep in history, the changed step with the reason.
- [ ] The training record rows and the nightly export to Parquet; the false-alarm report per exercise on the admin page.
- [ ] Both: the physio judges ten of our own test clips with us watching, before any patient sees the feature.

### Stage 4, week 5: reminders, visits, reports (Me)

- [ ] Web push: the service worker, the key pair, the permission ask after the first finished session (never on first open), the subscription row.
- [ ] The reminder settings screen; the scheduler function; the WhatsApp and SMS templates wired to the ids from DLT and Meta (or SMS only, if WhatsApp verification is still pending).
- [ ] Visits: the interval on the patient page, the due list, the two reminders, *Booked*, *Mark visited*, the clinic's number.
- [ ] *Something is wrong* on every screen; Sentry wired with scrubbing; the thumbs after a session; the physio's weekly form; the reports page for you.
- [ ] The status page.

### Stage 5, week 6: hardening and real phones (Both)

- [ ] A restore rehearsal: restore yesterday's backup to a scratch project, open the app against it, delete the scratch project.
- [ ] The security table above, line by line, with its check run and the result written next to it.
- [ ] Fifty fake people with sessions and reviews, created by a script, to see the physio pages and the export at that size.
- [ ] Three real phones: a ₹10,000 Android (Chrome), an iPhone (Safari, added to the home screen), a two-year-old Android with 3 GB of memory. Every flow on each, on mobile data, with the camera propped on the floor.
- [ ] Large-text mode and the live screen at 150% text.
- [ ] The smoke test extended to sign-in, a review, a reply and a reminder, against a test project; it runs on every pull request.

### Stage 6, weeks 4 to 6 in parallel: words and paper (You, with my drafts)

- [ ] The privacy notice, the terms, the consent texts and the "this is not medical advice" line: I draft, a lawyer reads (₹10,000 to ₹20,000), you publish them at `/privacy` and `/terms` with a version number.
- [ ] The breach runbook, one page, with the recovery sheet.
- [ ] The physio's letter of understanding, signed.
- [ ] A WhatsApp group: you, the physio, me by relay; the place complaints go in week one.

### Stage 7, weeks 7 to 14: the pilot (Both, and the physio)

- [ ] Day 1, in the clinic: the physio's account and role; their first patient signed in on the physio's phone in clinic set-up mode, a programme assigned and modified, the first session done in the room, the reminder time chosen with the patient.
- [ ] Patients two and three in the first week, the same way; no patient starts at home alone in the pilot.
- [ ] You check the reports page and the false-alarm report every morning; anything a patient could not do is fixed that week; the exercise file changes go out as releases with their hash.
- [ ] Week 2: the first reviews answered; Both watch the physio do five on a call.
- [ ] Week 4: a visit reminder has fired and been acted on; a plan has been modified from a review.
- [ ] Week 8: the numbers in The pilot below, written down; the decision on patients four to ten, Hindi, and a second physio.

## The pilot

Eight weeks, one physio, three to five patients, and six numbers written down at the end; the pilot succeeds if patients keep doing the plan and the physio keeps answering reviews without being asked.

| Number | Where it comes from | Good looks like |
| --- | --- | --- |
| Days done out of days planned, per patient | sessions against the plan's days | above 60% in weeks 2 to 8 |
| Reviews sent, and answered within two working days | the reviews table | every patient sends at least one; 90% answered in time |
| False alarms per exercise | the physio's *fine* labels on app-called faults | falling week on week after the file changes |
| Reports of *Something is wrong* per patient per week | the reports table | below one by week 4 |
| Visit reminders acted on | the visits table | each patient books or snoozes; none ignored |
| The physio's weekly minutes in the app | the audit rows | under 45 minutes for five patients |

**What we ask the physio every week.** Which cue was wrong. Which patient you worried about and whether the app told you first. What you changed on a plan and whether the patient saw it. What you would pay for, in one sentence, when the time comes.

**What ends the pilot early.** A patient hurt doing a step the app coached (the physio decides; the step is removed from the library the same day). A data problem of any kind. The physio stopping answering reviews for two weeks.

**After.** Hindi, the range graph with clinic measurements, patients six to ten, a second physio in a different speciality (frozen shoulder if the first was knees), and the billing decision with the physio's one sentence in hand.

## Sources

Prices are list prices found in search results on 1 October 2026; most pricing pages could not be opened from this session, so treat each figure as approximate and check the provider's page before paying.

- Supabase plans, egress and the free plan's pause: [Supabase pricing](https://supabase.com/pricing), [egress usage](https://supabase.com/docs/guides/platform/manage-your-usage/egress), [the Send SMS hook with MSG91](https://medium.com/@shreebhagwat94/implementing-custom-sms-authentication-in-supabase-using-sms-hook-and-msg91-366d13acc81c)
- MSG91 SMS and WhatsApp rates, DLT: [SMS OTP pricing in India](https://www.messagecentral.com/en-in/blog/sms-otp-pricing-india), [MSG91 pricing 2026](https://richautomate.in/blog/msg91-pricing-india-2026), [WhatsApp OTP vs SMS OTP in India](https://quickauth.in/blog/whatsapp-otp-vs-sms-otp-india)
- Firebase phone authentication: [pricing](https://firebase.google.com/docs/phone-number-verification/pricing)
- Cloudflare R2 and Backblaze B2: [R2 pricing explained](https://mecanik.dev/en/posts/cloudflare-r2-pricing-explained-real-costs-vs-s3-and-backblaze/), [B2 pricing](https://www.backblaze.com/cloud-storage/pricing)
- Domains and servers: [Cloudflare registrar prices](https://tld-list.com/registrars/cloudflare), [Hostinger VPS India](https://www.hostinger.com/in/vps-hosting), [Hetzner price adjustment, April 2026](https://www.hetzner.com/pressroom/statement-price-adjustment/)
- Razorpay fees and KYC: [Razorpay fees in India 2026](https://www.skydo.com/compare/razorpay-pricing), [KYC documents by business type](https://razorpay.com/docs/us/payments/business-types-kyc-documents)
- The Act and the Rules: [DPDP Rules 2025 (EY)](https://www.ey.com/en_in/insights/cybersecurity/transforming-data-privacy-digital-personal-data-protection-rules-2025), [breach notification](https://www.bachao.ai/blog/dpdp-data-breach-notification-rules-india), [the phased timeline](https://www.glocertinternational.com/resources/guides/dpdp-rules-2025-compliance-timeline/)
- Web push on phones: [PWA push on iOS, 2026](https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en), [Chrome's push filter](https://pushpad.xyz/blog/new-chrome-filter-may-kill-web-push-notifications)
- Error capture and email: [Sentry free plan](https://costbench.com/software/developer-tools/sentry/free-plan/), [Resend free tier](https://resend.com/blog/new-free-tier)
