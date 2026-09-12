# Fyzio marketplace — setup, step by step

This document takes you from a zip file to a live app in India with real OTP sign-in and real Razorpay payments. Every step you have to do yourself is marked **You:**. Everything else the app does on its own.

## 0. What you are deploying

One Node 22 process serving a static web app and a JSON API, with one SQLite file as the database. There is nothing to `npm install` — the server uses only Node's built-in modules (`node:sqlite`, `node:crypto`, `fetch`). The camera coach runs entirely in the browser; the server never receives video.

Money flow: subscribers pay the app (Pro plan) and curators pay the app (Curator plan). Anything a curator charges their clients is between them and the client; the app takes no cut and does not process it. Both plans are prepaid periods, not auto-renewing mandates, so there is no e-mandate / recurring-payment registration to do.

## 1. Run it on your laptop (10 minutes)

**You:** install Node 22.12 or newer from nodejs.org (the built-in SQLite module needs ≥ 22.12).

```
unzip fyzio-market.zip && cd fyzio-market
ADMIN_IDENTIFIER=you@example.com npm run dev
```

Open http://localhost:8080. In development:

- OTP codes are printed in the terminal **and** pre-filled in the sign-in form.
- Payments are in mock mode: clicking a plan activates it after a confirm dialog, no money moves.
- Encryption keys are ephemeral dev keys; the database is `./data/fyzio.sqlite`.

Try the whole product in this order: open a free exercise without signing in and run a set → "Sign in to save" → the set lands in your history. Sign in as `you@example.com` (you are admin). Sign in as a second identity in a private window, choose "Physio / trainer", fill in a listing, buy the Curator plan, and you will appear in Find a curator. Connect the two, send a routine, do it, comment.

## 2. Accounts you need before going live

**You:** create these (all have free tiers or trial modes):

| Service | For | Notes |
|---|---|---|
| Fly.io (recommended) or Render | hosting | Fly's `bom` (Mumbai) region keeps data in India. Render's nearest region is Singapore. |
| Razorpay | payments | Indian company registration/PAN and a bank account are needed for live keys; test keys are instant. Enable UPI, cards, netbanking in Dashboard → Settings → Payment methods. |
| MSG91 (or Twilio) | SMS OTP | Indian SMS requires DLT registration of your sender ID and template on your telecom operator's portal (Jio/Airtel/Vi TrueConnect). Takes a few days. Until then, use email OTP. |
| Resend (or any SMTP-free email API) | email OTP | Verify your domain; two DNS records. |
| A domain | | e.g. fyzio.in. Point it at Fly; Fly issues the TLS certificate. |

## 3. Configure

**You:** copy `.env.example` and fill it in. The variables that matter:

- `DATA_KEY`, `APP_SECRET` — run `npm run keygen` once and paste the output. **Back these up** in a password manager: `DATA_KEY` encrypts names, contact details, notes and comments at rest; without it the database is unreadable and cannot be recovered.
- `PUBLIC_URL` — your https origin (cookies and links depend on it).
- `ADMIN_IDENTIFIER` — your own mobile or email. The first time you sign in with it you become platform admin (verify curators, comp plans, disable accounts, read the audit log). Only one admin identifier is supported by env; promote others from the database if needed.
- `FREE_EXERCISES` — comma-separated exercise ids free for everyone. Default `wallsit,plank`. Ids: `heelslide`, `hipabd`, `wallsit`, `plank`, `calfstretch`, `shoulder_er`, `shoulder_abd`, `band_row`, `pullapart`, `trapstretch`.
- `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
- `PRICE_*` — prices in paise, GST-inclusive. Change them any time; existing subscriptions keep what they paid.
- `NOTIFY_PROVIDER` and the provider's keys.
- `CONSENT_VERSION` — bump it whenever you change the privacy notice text (in `server/api.js`, `privacyNotice()`); everyone re-consents at next sign-in.
- `GRIEVANCE_CONTACT` — the email shown in the privacy notice; DPDP requires one.

## 4. Deploy to Fly.io

**You:**

```
curl -L https://fly.io/install.sh | sh
fly auth signup            # or fly auth login
fly launch --no-deploy     # accept the existing fly.toml; pick a unique app name; region bom
fly volumes create fyzio_data --region bom --size 1
fly secrets set DATA_KEY=… APP_SECRET=… PUBLIC_URL=https://<app>.fly.dev ADMIN_IDENTIFIER=+91… \
  NOTIFY_PROVIDER=msg91 MSG91_AUTHKEY=… MSG91_TEMPLATE_ID=… \
  PAYMENT_PROVIDER=razorpay RAZORPAY_KEY_ID=rzp_test_… RAZORPAY_KEY_SECRET=… RAZORPAY_WEBHOOK_SECRET=…
fly deploy
fly certs add fyzio.in     # after pointing your domain's A/AAAA records at the app; then set PUBLIC_URL to https://fyzio.in
```

`fly.toml` keeps exactly one machine running (`auto_stop_machines = "off"`, `min_machines_running = 1`) because SQLite lives on that machine's volume. Do not scale to two machines.

Render alternative: push the folder to GitHub, "New → Blueprint", pick the repo; `render.yaml` defines the service and disk. Add the secret env vars in the dashboard.

## 5. Razorpay: test mode → live

**You:**

1. Dashboard → Settings → API keys → generate **test** keys. Put them in secrets, deploy, buy a plan with a test card (`4111 1111 1111 1111`, any future expiry, any CVV) or test UPI (`success@razorpay`). The Account page should show the plan active.
2. Dashboard → Settings → Webhooks → Add: URL `https://<your-domain>/api/billing/webhook/razorpay`, secret = the value you set as `RAZORPAY_WEBHOOK_SECRET`, events `payment.captured` and `order.paid`. The webhook is the safety net for the case where the customer paid but closed the tab before the browser reported back; the server settles the order idempotently whichever arrives first.
3. Complete Razorpay KYC (business details, bank account, website with terms/refund/contact pages — see docs/COMPLIANCE-INDIA.md for what those pages need). When activated, generate **live** keys and swap the secrets. Razorpay's live-mode "Website" check wants a Privacy Policy, Terms, Refund Policy and Contact page reachable on your domain; the app serves the privacy notice in-app, so host those four pages (static HTML in `client/` works: add `client/terms.html` etc.).

Refunds are manual from the Razorpay dashboard; after refunding, cancel the subscription from Admin (`PATCH /api/admin/users/:id`) or let it lapse.

## 6. OTP: MSG91 (SMS)

**You:**

1. Register on a telecom DLT portal as a Principal Entity; register a Sender ID (6 letters, e.g. `FYZIOA`) and a template with one variable: `Your Fyzio sign-in code is ##OTP##. Valid 5 minutes. Do not share it.`
2. In MSG91, add the DLT template id to a Flow/OTP template; copy the template id and your auth key into `MSG91_TEMPLATE_ID` / `MSG91_AUTHKEY`.
3. `NOTIFY_PROVIDER=msg91`. Email addresses still go through `RESEND_API_KEY` if set, so you can support both.

Twilio works internationally but is expensive and slow for Indian numbers; use it only for non-Indian users.

## 7. First day checklist

- Sign in with `ADMIN_IDENTIFIER`; you land on Admin. Check the audit log shows your sign-in.
- Create a real curator account of your own (second identity) and walk the flow; verify it from Admin so the badge exists in the directory.
- Confirm `https://<domain>/healthz` returns `{"ok":true}` and set up an uptime ping (see OPERATIONS.md).
- Take a first backup: `fly ssh console -C "sqlite3 /data/fyzio.sqlite '.backup /data/backup.sqlite'"` then `fly sftp get /data/backup.sqlite`.
- Publish the four legal pages (privacy, terms, refunds, contact) and link them from the footer text in `client/index.html` if you want them visible.

## 8. Changing prices, plans, free exercises

Prices: env vars, redeploy. Plan structure (period lengths, what each grants): `server/config.js` → `plans`. Free exercises: `FREE_EXERCISES`. Prebuilt routines: `server/api.js` → `PREBUILT` (seeded once on an empty database; edit later from the database or add an admin route).

## 9. Adding an exercise

Exercises live in `client/coach/engine.js` (`EXERCISES`) with their position guides in `client/coach/guide.js`. The server derives the catalogue from the same file, so a new exercise appears everywhere (catalogue, builder, routines) once added there. Mark it free or not with `FREE_EXERCISES`.
