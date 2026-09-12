# Operations

## Daily / weekly

- **Uptime**: point any free pinger (UptimeRobot, Better Stack) at `GET /healthz` every 5 min.
- **Backups**: SQLite on a Fly volume. Fly takes daily volume snapshots (kept 5 days); take your own weekly off-site copy:
  `fly ssh console -C "sqlite3 /data/fyzio.sqlite '.backup /data/backup.sqlite'"` then `fly sftp get /data/backup.sqlite ./backups/$(date +%F).sqlite`. The file is useless without `DATA_KEY`; back the key up separately.
- **Logs**: `fly logs`. Lines are prefixed `[otp]`, `[audit]`, `[payments]`, `[housekeeping]`, `[config]`. Anything with `500` or a stack trace is worth a look.
- **Admin page** (`#/admin`): members, curators, active plans, 7-day sets, 30-day revenue, curator table with verify/unlist, and the last 200 audit events. Check pending verifications weekly.

## Housekeeping (automatic, every 15 minutes)

Deletes expired OTPs, expired sessions and old rate-limit rows; marks lapsed subscriptions `expired`; prunes audit rows older than `AUDIT_RETENTION_DAYS`; hard-deletes users whose erasure grace period has passed (and everything of theirs except tax records).

## Verifying a curator

1. They fill their listing; you see it in Admin with credentials as typed.
2. Check the registration: physiotherapists — the state paramedical/physiotherapy council register or IAP membership; trainers — the certifying body's directory (ACE, NSCA, K11, etc.).
3. Click Verify, type what you checked in the note (it is shown to you only). The badge appears in the directory and profile.
4. Complaints about a listing: Unlist first, ask questions later; log it in the audit note. IT Rules require acknowledgement within 24 h.

## Money

- Failed/abandoned checkouts leave `payments.status='created'` rows; harmless.
- Refund: Razorpay dashboard → Payments → Refund. Then Admin → user → the subscription stays active until you cancel it there; or leave it if you refunded partially.
- Comp a plan (support, partners): Admin → user → grant plan (`PATCH /api/admin/users/:id {grantPlan}`) — the UI button lives on the curator/member rows.
- Price change: env vars, redeploy. Existing periods are unaffected.
- Reconciliation: `SELECT date(paid_at/1000,'unixepoch'), plan, SUM(amount_paise)/100 FROM payments WHERE status='paid' GROUP BY 1,2` against the Razorpay settlement report.

## Deploying updates

`git push` to `main` runs tests and deploys (GitHub Actions + `FLY_API_TOKEN` secret), or `fly deploy` by hand. Zero-downtime is not guaranteed with one machine — deploys take ~10 s of downtime; do them off-peak. Schema changes: `db.js` runs idempotent `CREATE TABLE IF NOT EXISTS` and versioned `meta` migrations at boot; add migrations there, never edit existing ones.

## Incident: suspected data breach

DPDP requires notifying the Data Protection Board and every affected user **without delay, within 72 hours** with what happened, what data, what you did, what they should do.

1. Rotate: `fly secrets set APP_SECRET=<new>` (logs everyone out and invalidates OTPs). Do **not** rotate `DATA_KEY` in place — data encrypted with the old key would become unreadable; if the key leaked, write a re-encryption script first.
2. Scope: `audit_log` (`at`, `action`, `actor_id`, `ip`) and `sessions` tell you who was active in the window.
3. Notify users via the app's notify provider (a one-off script over `users` with `notify.send`), plus a notice on the home page.
4. Write it up: timeline, root cause, fix, notification sent. Keep for the Board.

## Common problems

| Symptom | Cause / fix |
|---|---|
| OTP never arrives | `NOTIFY_PROVIDER` still `console` (code is in `fly logs`); DLT template mismatch (MSG91 returns an error in logs); number not E.164 |
| "Payment could not be verified" | `RAZORPAY_KEY_SECRET` differs from the key id's secret; or test key with live checkout |
| Plan paid but not active | Webhook secret wrong (`Bad signature` in logs) and the browser confirm also failed. Find the order in Razorpay, then `POST /api/admin/users/:id {grantPlan}` |
| Curator not in directory | Curator plan not active, or "Show my listing" unticked, or admin unlisted them |
| Member can't start a sent exercise | Connection ended, or assignment archived — entitlements are recomputed per request |
| Camera black on iPhone | Site must be https; Safari needs a user gesture — the Start button is one; check the browser's camera permission |
| `node:sqlite` error at boot | Node < 22.12 |
