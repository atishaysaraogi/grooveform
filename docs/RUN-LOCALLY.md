# Running Fyzio on your own computer — and opening it from your phone

Two things matter here: the app itself is trivial to run (one command), but **the camera only works on a secure page**. Browsers allow the camera on `http://localhost` but block it on plain `http://192.168.x.x` addresses, so reaching the app from a phone needs an HTTPS URL. Part B below gives you one in about a minute.

## Part A — run it in your browser (5 minutes)

1. Install Node.js 22.12 or newer from https://nodejs.org (LTS download). Check in a terminal: `node -v` should print `v22.12` or higher.
2. Unzip `fyzio-market.zip`. Open a terminal in that folder (Windows: right-click the folder → "Open in Terminal"; Mac: drag the folder onto the Terminal icon).
3. Start the app:
   - Mac / Linux: `ADMIN_IDENTIFIER=you@example.com npm run dev`
   - Windows PowerShell: `$env:ADMIN_IDENTIFIER="you@example.com"; $env:NODE_ENV="development"; node --watch server/index.js`

   Put your own email or mobile number instead of `you@example.com` — that identity becomes the platform admin.
4. Open http://localhost:8080 in Chrome, Edge or Safari. Allow the camera when asked.
5. Sign in: enter any email or mobile number, and the one-time code is printed in the terminal **and pre-filled in the form** (development mode). Payments are mocked — "buying" a plan just activates it.

Nothing is installed with npm; the server uses only built-in Node modules. Data lives in `data/fyzio.sqlite` in the folder; delete it to start fresh. Stop with Ctrl-C.

## Part B — open it from your phone or another laptop

### Option 1 (recommended): Cloudflare quick tunnel — public HTTPS URL, no account, free

1. Install `cloudflared`: Mac `brew install cloudflared`; Windows `winget install Cloudflare.cloudflared`; Linux: download from https://github.com/cloudflare/cloudflared/releases.
2. With the app running from Part A, open a **second** terminal and run:

   ```
   cloudflared tunnel --url http://localhost:8080
   ```
3. After a few seconds it prints a URL like `https://random-words.trycloudflare.com`. Open that on your phone (any network — it does not need to be on your Wi-Fi). The camera works because it is HTTPS.
4. The URL changes every time you restart `cloudflared`. Anyone with the link can reach the app while the tunnel is up; close the terminal to shut it.

OTP codes are still printed in the laptop's terminal, so when testing on the phone read the code off the laptop (or sign in with the same identity on the laptop first).

Ngrok works the same way (`ngrok http 8080`) but needs a free account and shows an interstitial page on the free tier.

### Option 2: same Wi-Fi, no tunnel — works for browsing, camera needs one flag

1. Find your laptop's local IP: Mac `ipconfig getifaddr en0`; Windows `ipconfig` (look for IPv4 Address); Linux `hostname -I`.
2. On the phone open `http://<that-ip>:8080`. If it does not load, allow port 8080 through the laptop firewall (Windows will usually prompt the first time Node listens).
3. To make the camera work over plain http on **Android Chrome**: open `chrome://flags/#unsafely-treat-insecure-origin-as-secure` on the phone, enter `http://<that-ip>:8080`, enable, relaunch. **iPhone Safari has no such flag** — use Option 1 for iPhones.

### Option 3: proper HTTPS on your LAN (mkcert)

For a permanent home set-up without a tunnel: generate a local certificate with [mkcert](https://github.com/FiloSottile/mkcert), install its root on each phone, and put Caddy in front of the app (`caddy reverse-proxy --from fyzio.local:443 --to localhost:8080`). More setup; only worth it if you will test from several devices daily.

### Option 4: put it on the internet for real

For friends, curators and paying users, deploy to Fly.io in the Mumbai region — 10 minutes, step by step in `docs/SETUP.md`. That gives a permanent `https://your-app.fly.dev` (or your own domain), real SMS OTPs and Razorpay payments.

## Testing the camera coach on a phone

- Prop the phone at chest height (shoulder exercises) or hip height (hip abduction), 2–2.5 m away, landscape or portrait both work.
- Voice cues use the phone's speech synthesis; turn the ringer/media volume up. On iPhone the first tap on "Start camera" is what unlocks audio.
- Add the page to the home screen (Share → Add to Home Screen) and it opens full-screen like an app.
- If the pose model does not load, the phone cannot reach the model CDN (jsDelivr / Google storage) — check the phone's network; the app itself does not proxy it.

## Common problems

| Problem | Fix |
|---|---|
| `node:sqlite` error at startup | Node older than 22.12 — upgrade |
| Port 8080 already in use | `PORT=8090 npm run dev` (and use that port in the tunnel/URLs) |
| Camera button does nothing on the phone | You opened an `http://` address — use the tunnel (Option 1) |
| Phone can't load the LAN address | Laptop firewall, or the phone is on guest Wi-Fi that isolates clients |
| Sign-in code never appears on the phone | It is printed in the laptop terminal in development mode |
| Trycloudflare URL says "connection refused" | The app is not running, or is on a different port than the tunnel's `--url` |
