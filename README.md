# jodd.io — camera-guided exercise

(Repository name: grooveform. The product is called jodd.io in the app.)

**Current mode: solo.** `SOLO_MODE=true` (the default) hides sign-in, plans, prices and curators and makes every exercise free; the app runs entirely anonymously on the device. Set `SOLO_MODE=false` to bring the marketplace back (accounts, Pro/Curator plans, directory) — all of that code and its tests are still here.

Working name was Fyzio; the folder, docs and some identifiers still say so.

A phone or laptop camera watches your form (pose estimation runs on the device, video never leaves it), counts reps, times holds and speaks corrections. Some exercises are free for anyone with no account. The rest unlock with a **Pro** subscription — or when a **curator** (physiotherapist or trainer, who subscribes to a Curator plan) sends you a routine. Anyone signed in keeps history and notes; Pro members and curators build custom routines; a **Find a curator** directory lets professionals advertise.

Zero-dependency Node 22 server, one SQLite file, OTP sign-in (MSG91/Twilio/Resend), Razorpay payments, DPDP-ready.

```
ADMIN_IDENTIFIER=you@example.com npm run dev     # http://localhost:8080 — OTP codes print to the terminal, payments are mocked
npm test                                         # engine + API tests (~3 s)
NODE_PATH=$(npm root -g) npm run test:e2e        # marketplace browser end-to-end with a synthetic camera (needs Playwright)
NODE_PATH=$(npm root -g) npm run test:solo       # solo-mode browser checks
npm run build:static                             # dist/ for GitHub Pages or any static host
```

Docs: [RUN-LOCALLY](docs/RUN-LOCALLY.md) (laptop + phone in 10 minutes) · [PUBLISH-GITHUB-PAGES](docs/PUBLISH-GITHUB-PAGES.md) (free hosting + Claude pushes updates) · [SETUP](docs/SETUP.md) (laptop → Fly.io with real SMS and Razorpay, step by step) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [COMPLIANCE-INDIA](docs/COMPLIANCE-INDIA.md) · [OPERATIONS](docs/OPERATIONS.md) · [TESTING](docs/TESTING.md). Screenshots of every screen are in `docs/screenshots/` after running the e2e suite.

Ten vetted moves: heel slide, standing hip abduction, wall sit, plank, wall calf stretch, plus five shoulder & neck exercises (band external/internal rotation, band abduction, band rows, band pull-apart, upper trapezius stretch) — each with a full-body position guide and fault detection checked against recordings. Behind them, the rest of a **library of 135** physio and gym moves (no machines), every one of them editable JSON in `client/data/moves/` — each file opens with a guide to every field — each with the fields a physio fills in (dosage, tempo, progression, contraindications, faults with cues, sources) and an honest tracking tier — *form coached*, *counts reps* or *no camera* (logged by hand). The whole library is listed, vetted moves first. Edit a move in the Studio, in a text editor or with `node scripts/catalog.js` — see [docs/EXERCISE-LIBRARY.md](docs/EXERCISE-LIBRARY.md) for the tiers, the file format and how to add a move; shoulder rules and sources in [docs/LIBRARY-SHOULDER.md](docs/LIBRARY-SHOULDER.md). New moves are built with a physio in the **Studio** (`/studio/` on the site): screen, record takes, pick the measurement, set fault thresholds against the recordings, save into the library — [docs/STUDIO.md](docs/STUDIO.md), reasoning in [docs/PT-INTAKE.md](docs/PT-INTAKE.md).
