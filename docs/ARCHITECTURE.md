# Architecture

## Shape

```
browser (client/)                       server (server/)                      SQLite (one file)
─────────────────────────────           ────────────────────────────────      ─────────────────
index.html + app.js  (SPA, no build)    index.js   static files, CSP, HSTS     users, curator_profiles
coach/engine.js      pose → reps/faults  http.js    router, JSON, CSRF guard   otp_codes, sessions
coach/coach.js       camera, voice, HUD  api.js     all routes + entitlements  consent_records, audit_log
data/moves/*.json    every move, as data auth.js    OTP, sessions, consent     subscriptions, payments
coach/catalog.js     reads and checks it  
coach/exercise-library.js  registry      payments.js mock / Razorpay          routines, routine_items
MediaPipe Pose (CDN, on-device)          db.js      schema + migrations        connections, routine_assignments
Razorpay Checkout (CDN, only at pay)     crypto.js  AES-GCM fields, HMAC ids   exercise_sessions, notes
                                         notify.js  console / msg91 / twilio / resend
```

No framework, no bundler, no npm dependencies. Node ≥ 22.12 for `node:sqlite`.

## Roles and tiers

| Who | How they get it | What they can do |
|---|---|---|
| anonymous | just open the site | run free exercises with the full coach; browse routines and the curator directory |
| member, free | OTP sign-up | + history, notes, effort scores; connect with curators; free prebuilt routines |
| member, pro | Pro subscription | + every exercise, every prebuilt routine, build/copy/edit routines |
| curator | sign up as curator (or switch in Account) + Curator subscription | + listed in directory, accept members, send routines (unlocked for the member), see members' sets for those routines, comment |
| admin | `ADMIN_IDENTIFIER` | + verify/unlist curators, comp plans, disable users, audit log |

`entitlements(user)` in `server/api.js` is the single source of truth. It returns `{tier, pro, curator, admin, exercises[], canBuild, grantedBy[]}` and is computed on every request (subscriptions and assignments can change any minute). `exercises[]` is the list a user may start: free ones, plus everything if pro/curator/admin, plus every exercise in an active routine assignment from a curator whose connection is still `accepted`. When a connection ends or an assignment is archived, the grant disappears on the next request; the client re-fetches `/api/me` and `/api/exercises` on every exercise/routine/dashboard view so locks update without a reload.

Rules enforced server-side, not just hidden in the UI: starting or saving a locked exercise → 402; building routines without `canBuild` → 402; accepting a member or sending a routine without an active Curator plan → 402; curator listing visible only while the plan is active (`listedNow`); curators read only sessions linked to routines they sent (`routine_assignments.curator_id`).

## Request lifecycle

1. `index.js` sets security headers (CSP allowing self + jsDelivr for MediaPipe + Razorpay checkout; HSTS in prod; no inline handlers anywhere) and serves `client/` with cache headers.
2. `/api/*` goes to the `Router`. All mutating requests must carry `X-Requested-With: fetch` (CSRF guard, since cookies are `SameSite=Lax` and third-party sites cannot set that header cross-origin). The Razorpay webhook is the only exception and is authenticated by its HMAC instead.
3. `auth.currentUser(req)` resolves the session cookie (HMAC-hashed token, sliding expiry). Handlers call `requireAuth`, `requireRole`, `requireConsent` (428 when the notice version changed — the client redirects to `#/consent` and returns to what it was doing).
4. Errors are `HttpError(status, message)`; anything else becomes a 500 with a generic message and a server-side log.

## Authentication

OTP only. `POST /api/auth/otp/request` accepts a phone (normalised to E.164, India default) or email, rate-limits per identifier and IP, stores an HMAC of the 6-digit code with a 5-minute TTL and 5 attempts, and sends it via `notify.js`. It reports whether the identifier already has an account so the client can ask a new user for name and role. `POST /api/auth/otp/verify` creates the user on first success (`member` or `curator`; `admin` if the identifier equals `ADMIN_IDENTIFIER`), issues a session cookie (`HttpOnly; Secure; SameSite=Lax`, 30 days sliding), and logs it.

Identifiers are stored twice: encrypted (to display / send OTPs) and as an HMAC (to look up) — the database never holds a plain phone number or email.

## Payments

`payments.js`. `createCheckout(user, plan)` creates a `payments` row (`status=created`) and either a Razorpay Order (server-to-server with key id/secret) or a mock order. The browser opens Razorpay Checkout with the order id; on success it posts `{orderId, paymentId, signature}` to `/api/billing/confirm`, where the server verifies `HMAC_SHA256(key_secret, order_id|payment_id)`. Razorpay also calls `/api/billing/webhook/razorpay` (`HMAC_SHA256(webhook_secret, raw body)`); both paths call `settle()`, which is idempotent (`payments.status='paid'` short-circuits) and inside one transaction marks the payment paid and `grant()`s a subscription. A grant extends from the current period end if one is active, so buying early does not lose days. `cancel()` marks the row cancelled but access runs to `period_end`; housekeeping marks lapsed rows `expired`.

Curator plans require `role=curator` at checkout time; a member can switch role in Account (their history and notes stay).

## Data model highlights

- `routines.owner_id NULL` = prebuilt (seeded from `PREBUILT` once). `tier` on prebuilt routines is `free` if every exercise is free, else `pro`. Custom routines are `kind=custom`; `POST /api/routines/:id/copy` clones any readable routine into the caller's account.
- `routine_items.options_json` holds per-exercise targets (`target`, `sets`, `rom`, `variant`, `side`) validated against the exercise definition; `notes` are plain text (they are instructions, not personal data).
- `connections` is one row per (curator, member). `requested_by` distinguishes a member's request from a curator's invitation. `accepted` is the only state that grants anything; `ended`/`declined` archives that curator's assignments to the member.
- `routine_assignments` links a routine to a member with the curator's message (encrypted). `exercise_sessions.assignment_id` / `routine_item_id` connect a completed set back to the routine it came from; that link is what lets the curator see it.
- `exercise_sessions.review_json` is the scored summary (reps, holds, faults, tips); `diagnostics_enc` is the optional raw keypoint recording (never video), stored only if the user's `store_diagnostics` preference is on.
- Encrypted (`*_enc`): names, identifiers, notes, curator messages and comments, diagnostics, connection messages. Hashed: identifiers, OTP codes, session tokens.

## Client

`client/app.js` is a hash-router SPA (`#/exercise/:id`, `#/routine/:id`, `#/curators?q=…`, …). It keeps `me`, `ent` (entitlements) and the exercise catalogue in memory and re-fetches them on views where locks matter. The coach (`client/coach/`) is embedded: `FyzioCoach.start({exercise, target, options, file, done, exit})` shows the live screen, runs MediaPipe on the camera (or a video file), counts reps / times holds, speaks cues, and calls `done` with the review. `app.js` renders the save panel (effort, note) into `#rv-portal` and posts the session. An anonymous visitor's completed set is parked in `sessionStorage` (`fz.pending`) through sign-up and consent and saved automatically afterwards.

`?mock=1` makes the coach read `window.__mockPose(t)` instead of the camera; the browser tests use this to drive full sets.

## Scaling notes

One process, one SQLite file, WAL mode, is comfortably enough for tens of thousands of users; the heavy work (pose estimation) is on the phone. If you outgrow it: move the SQLite file to LiteFS or switch `db.js` to Postgres (the query layer is ~20 lines), and put the session store behind the same database. Static assets can be moved to a CDN unchanged.
