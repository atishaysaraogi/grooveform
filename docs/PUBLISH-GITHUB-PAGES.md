# Publishing on GitHub Pages — and letting Claude push updates

The app in solo mode needs no server: `node scripts/build-static.js` writes a `dist/` folder with the client plus the JSON it fetches as plain files. `.github/workflows/pages.yml` builds that on every push to `main`, runs the tests, and deploys it to GitHub Pages. Once set up, every update is: change → commit → push → live in about a minute.

Note what Pages can and cannot do: everything in solo mode works (camera coach, playlists, settings, diagnostics download). Anything that needs the server — accounts, history, curators, payments — needs Fly.io (`docs/SETUP.md`) instead. The static build is always solo mode.

## Part A — one-time setup (about 15 minutes)

1. **Create the repository.** On github.com: New repository → name `grooveform` → Public (Pages on a private repo needs a paid plan) → no README, no .gitignore → Create.
2. **Push the code.** The zip already contains a git repository with one commit. In a terminal inside the unzipped folder:
   ```
   git remote add origin https://github.com/<you>/grooveform.git
   git branch -M main
   git push -u origin main
   ```
   (If `git` asks who you are: `git config --global user.name "Your Name"` and `user.email`.) GitHub will prompt for a password; use a personal access token or, simpler, install the GitHub CLI and run `gh auth login` first.
3. **Turn on Pages.** Repository → Settings → Pages → under "Build and deployment", set Source to **GitHub Actions**. Nothing else to pick.
4. **Watch the first deploy.** Repository → Actions → "Publish to GitHub Pages" should be running (it started with your push). When it goes green, the URL is `https://<you>.github.io/grooveform/`. If the workflow shows "pages not enabled", do step 3 and re-run it (Actions → the run → Re-run all jobs).
5. **Open it on your phone.** It is HTTPS, so the camera works everywhere without tunnels. Add to Home Screen for a full-screen app.

## Part B — let Claude push updates automatically

Claude needs a way to push to the repo. Two options; the first is the one to use.

**Option 1 — connect GitHub to Claude (recommended).**
1. In Claude (claude.ai) open Settings → Integrations (or Connectors) and connect **GitHub**. It installs the Claude GitHub app; grant it access to the `grooveform` repository only.
2. Start a new Claude Code / Cowork session from that repository (in the Claude Code area, choose the repo when creating the session). Claude then clones the repo, and `git push` from that session goes straight to GitHub with the app's credentials.
3. Ask for a change ("make the rest default 45 s"). Claude edits, runs the tests, commits and pushes to `main`; the Actions workflow rebuilds and redeploys. If you'd rather review first, say "open a pull request" and merge it yourself on GitHub — Pages deploys when it lands on `main`.

**Option 2 — a token, when the integration is not available.**
1. GitHub → Settings → Developer settings → Fine-grained personal access tokens → Generate. Repository access: only `grooveform`. Permissions: Contents → Read and write. Expiry: 90 days.
2. Give the token to Claude in the session in which it should push (it is used only in that session's environment; rotate it if it ever leaks). Claude adds the remote as `https://x-access-token:<token>@github.com/<you>/grooveform.git` and pushes.
3. Revoke the token in GitHub when you're done.

Either way, the flow after that is the same: you ask, Claude changes and tests, pushes, Pages updates.

## Day-to-day

- `npm test` runs before every deploy; a failing test blocks the deploy — the Actions run goes red and the previous version stays live.
- Custom domain: Settings → Pages → Custom domain → `grooveform.fit` (or whatever you register), then add the CNAME at your registrar as GitHub shows. HTTPS is issued automatically.
- The repo is public; nothing secret is in it (`.env` is git-ignored). Keep it that way — never commit real keys.
- To test the static build locally before pushing: `node scripts/build-static.js` then `npx serve dist` (or any static server) and open the URL it prints.
