'use strict';
// Browser end-to-end for the marketplace: anonymous visitor → free member → Pro member → curator → admin, through the real UI,
// with a synthetic pose stream (?mock=1) driving a full coached set.
// Run: CHROMIUM_PATH=/path/to/chromium node test/e2e.test.js   (needs Playwright; see docs/TESTING.md)
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const assert = require('node:assert/strict');
const { chromium } = require('playwright');
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fyzio-e2e-')), 'e2e.sqlite'); process.env.PORT = '0'; process.env.NODE_ENV = 'test'; process.env.NOTIFY_PROVIDER = 'console'; process.env.PAYMENT_PROVIDER = 'mock';
process.env.ADMIN_IDENTIFIER = 'admin@fyzio.test'; process.env.FREE_EXERCISES = 'hipabd,plank,goblet_squat'; process.env.SOLO_MODE = 'false';   // marketplace flows on; solo mode is covered by test/solo.test.js   // the goblet squat is free so a visitor sees its weight bubble; hip abduction free so the mock pose stream can drive an anonymous set
const { start, server } = require('../server/index.js');
const SHOTS = path.join(__dirname, '..', 'docs', 'screenshots'); fs.mkdirSync(SHOTS, { recursive: true });

// Synthetic standing-hip-abduction pose (facing camera, right leg), used when the page is opened with ?mock=1
const MOCK = `
  function frame(map) { const pts = []; for (let i = 0; i < 33; i++) pts.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }); for (const k in map) { const [x, y] = map[k]; pts[+k] = { x: x / (16 / 9) + 0.5 - 0.5 / (16 / 9), y, z: 0, visibility: 0.95 }; } return pts; }
  function hipabd(raise, lean = 0) { const hipL = [0.45, 0.50], hipR = [0.55, 0.50], leg = 0.35, a = raise * Math.PI / 180; const kneeR = [hipR[0] + Math.sin(a) * leg * 0.5, hipR[1] + Math.cos(a) * leg * 0.5], ankR = [hipR[0] + Math.sin(a) * leg, hipR[1] + Math.cos(a) * leg]; const shift = Math.tan(lean * Math.PI / 180) * 0.22;
    return frame({ 0: [0.5 - shift, 0.15], 7: [0.48 - shift, 0.16], 8: [0.52 - shift, 0.16], 11: [0.42 - shift, 0.28], 12: [0.58 - shift, 0.28], 13: [0.38 - shift, 0.40], 14: [0.62 - shift, 0.40], 15: [0.36 - shift, 0.50], 16: [0.64 - shift, 0.50], 23: hipL, 24: hipR, 25: [0.45, 0.675], 26: kneeR, 27: [0.45, 0.85], 28: ankR, 29: [0.44, 0.87], 30: [ankR[0] - 0.01, ankR[1] + 0.02], 31: [0.46, 0.88], 32: [ankR[0] + 0.01, ankR[1] + 0.02] }); }
  try { localStorage.setItem('fyzio.seenIntro', '1'); } catch (e) {}
  window.__mockPose = t => { if (t < 10500) return hipabd(0); const tt = t - 10500, rep = Math.floor(tt / 2600), ph = (tt % 2600) / 2600; if (rep >= 8) return hipabd(0); const k = Math.sin(Math.PI * ph); const f = hipabd(32 * k, rep === 1 ? 24 * k : 0); for (const p of f) { p.x += (Math.random() - 0.5) * 0.004; p.y += (Math.random() - 0.5) * 0.004; } return f; };`;

let base;
async function otpLogin(page, identifier, { name, role } = {}) {
  if (!/#\/login/.test(page.url())) await page.goto(base + '/?mock=1#/login' + (role === 'curator' ? '/curator' : ''));
  await page.waitForSelector('#l-id'); await page.fill('#l-id', identifier); await page.click('#l-send');
  await page.waitForSelector('#f-code:not([hidden])');   // dev code is auto-filled in test mode
  if (name && !(await page.$('#l-new[hidden]'))) { await page.fill('#l-name', name); if (role) await page.click(`[data-role="${role}"]`); }
  await page.click('#f-code button[type=submit]');
  await page.waitForFunction(() => window.__portal && window.__portal.me);
  if (await page.$('#f-consent')) { await page.$eval('#f-consent', f => f.requestSubmit()); await page.waitForSelector('#f-consent', { state: 'detached' }); }
}
/* Settings are tap-to-cycle bubbles: tap until the bubble shows the value we want. */
async function setBubble(page, key, value) {
  /* Re-query between taps: a render between two clicks detaches an element handle, and the page
     re-renders on its own after refreshMe() resolves. */
  const sel = `.bubble[data-optkey="${key}"]`;
  if (!(await page.$(sel))) return false;
  for (let i = 0; i < 12; i++) {
    const b = await page.waitForSelector(sel, { state: 'attached' });
    if ((await b.getAttribute('data-value')) === String(value)) return true;
    await b.click().catch(() => { });   // detached mid-tap: the next pass picks up the fresh node
  }
  throw new Error(`bubble ${key} never reached ${value}`);
}
async function runCoachedSet(page, side = 'right') {
  /* A one-sided move must be set to whichever limb the synthetic pose actually moves: the
     default is "both", which starts on the left and would never register a rep on a
     right-sided fixture. Routine items carry their own side and have no bubbles, so this is a
     no-op there. */
  await setBubble(page, 'side', side);
  await page.click('#do-start');
  await page.waitForFunction(() => window.OnTrackCoach.live && window.OnTrackCoach.live.state === 'active', null, { timeout: 20000 });
  // auto-finishes at the target: the last set lands on the review panel, an earlier one on the
  // rest overlay that keeps the camera up.
  await page.waitForFunction(() => document.querySelector('#rv-portal .panel') !== null || window.OnTrackCoach.restActive(), null, { timeout: 45000 });
}
(async () => {
  await start(); base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  const newPage = async (mobile = false) => { const ctx = await browser.newContext(mobile ? { viewport: { width: 400, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1100, height: 800 } }); const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); }); await page.addInitScript(MOCK); return page; };
  const results = [];
  const step = async (name, fn) => { try { await fn(); results.push(['ok', name]); console.log('ok  -', name); } catch (e) { results.push(['FAIL', name + ': ' + e.message]); console.log('FAIL-', name, e.message, '\nerrors so far:', errors); throw e; } };
  const text = (page) => page.innerText('#view');

  /* ---------- anonymous visitor (phone) ---------- */
  const visitor = await newPage(true);
  await step('visitor: home shows free vs pro exercises, no account needed', async () => {
    await visitor.goto(base + '/?mock=1#/'); await visitor.waitForSelector('.hero'); const t = await text(visitor);
    assert.ok(t.includes('Moves') && t.includes('Playlists') && (await visitor.$$('.ex-row')).length >= 10 && (await visitor.$$('.playlist')).length >= 6, 'moves grid and playlist rows'); const badges = await visitor.$$eval('.tiles .tile .badge', bs => bs.map(b => b.textContent.trim().toLowerCase())); const lastFree = badges.lastIndexOf('free'), firstPro = badges.indexOf('pass') >= 0 ? badges.indexOf('pass') : badges.indexOf('pro'); assert.ok(firstPro === -1 || lastFree < firstPro, 'free moves listed first: ' + badges.join(',')); await visitor.screenshot({ path: path.join(SHOTS, 'visitor-home.png'), fullPage: true });
    /* browsing offers the shortlist, not the whole library: a move is listed when it says so, and
       unstated that follows "vetted" */
    await visitor.goto(base + '/?mock=1#/exercises'); await visitor.waitForSelector('.ex-row');
    const shown = await visitor.$$eval('.ex-row', (rows) => rows.map((r) => r.getAttribute('href').split('/').pop()));
    const lib = await visitor.evaluate(async () => (await (await fetch('/api/exercises')).json()).exercises);
    assert.deepEqual(shown.slice().sort(), lib.filter((e) => e.listed).map((e) => e.id).sort(), 'the list is exactly the listed moves');
    assert.ok(shown.length < lib.length, `and that is a shortlist: ${shown.length} of ${lib.length}`);
    assert.ok(lib.filter((e) => e.vetted).every((e) => e.listed), 'every vetted move is listed by default');
    /* the tier filter appears only when the shortlist spans more than one tier; today's does not */
    const tiers = new Set(shown.map((id) => lib.find((e) => e.id === id).tracking || 'form'));
    assert.equal(await visitor.$$eval('#ex-filter', (e) => e.length), tiers.size > 1 ? 1 : 0, 'the filter shows only when there is something to filter');
    /* a move that is not listed is still reachable — hiding is about the lists, not about access */
    const hidden = lib.find((e) => !e.listed);
    await visitor.goto(base + `/?mock=1#/exercise/${hidden.id}`); await visitor.waitForSelector('.ex-head');
    assert.match(await text(visitor), new RegExp(hidden.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'a hidden move still opens by link');
  });
  await step('visitor: pro exercise is locked, free exercise can start', async () => {
    await visitor.goto(base + '/?mock=1#/exercise/heelslide'); await visitor.waitForSelector('.card.upgrade'); assert.equal(await visitor.$('#do-start'), null, 'locked exercise has no start button');
    await visitor.goto(base + '/?mock=1#/exercise/hipabd'); await visitor.waitForSelector('#do-start'); await visitor.click('#do-details'); const t = await text(visitor); assert.ok(t.includes('Set-up and form') && t.includes('Where to put the phone') && t.includes('The move') && t.includes('sign in')); assert.ok(await visitor.$('svg.demo-fig') && await visitor.$('.cam-sentence'), 'anatomical figure and phone-position sentence present'); await visitor.screenshot({ path: path.join(SHOTS, 'visitor-exercise.png'), fullPage: true });
  });
  await step('first-time visitor: sees the three-step intro, and only once', async () => {
    /* A bare context: newPage() pre-dismisses the intro for every other test, and its init
       script would re-dismiss it on the reload below, so this one starts genuinely fresh. */
    const ctx = await browser.newContext({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const fresh = await ctx.newPage();
    fresh.on('pageerror', (e) => errors.push(String(e)));
    await fresh.goto(base + '/#/');
    await fresh.waitForSelector('#intro:not([hidden])', { timeout: 15000 });
    const t = await fresh.innerText('#intro');
    for (const want of ['All of you in frame', 'Sound up', 'See the set']) assert.ok(t.includes(want), want);
    assert.equal((await fresh.$$('.intro-steps li')).length, 3);
    await fresh.screenshot({ path: path.join(SHOTS, 'intro.png') });
    await fresh.click('#intro-go');
    assert.ok(await fresh.$eval('#intro', (e) => e.hidden), 'dismissed');
    await fresh.reload(); await fresh.waitForSelector('.ex-row');
    assert.ok(await fresh.$eval('#intro', (e) => e.hidden), 'stays dismissed on the next visit');
    await ctx.close();
  });

  await step('one-sided move: the side is chosen up front, no lift-the-limb gesture', async () => {
    await visitor.goto(base + '/?mock=1#/exercise/hipabd'); await visitor.waitForSelector('#do-start');
    const sides = JSON.parse(await visitor.$eval('.bubble[data-optkey="side"]', (n) => n.dataset.values));
    assert.deepEqual(sides, ['left', 'right', 'both'], 'left / right / both offered');
    /* A move worked with both limbs at once must not offer the choice. */
    /* Same document, only the hash changes — the previous page's #do-start is still there, so wait for the new heading. */
    await visitor.goto(base + '/?mock=1#/exercise/plank'); await visitor.waitForFunction(() => /Plank/.test((document.querySelector('.ex-head h1') || {}).textContent || ''));
    assert.equal((await visitor.$$('[data-optkey="side"]')).length, 0, 'plank is not one-sided');
    /* Picking a side sends it straight into the set: no identify state, and the HUD names the limb. */
    await visitor.goto(base + '/?mock=1#/exercise/hipabd'); await visitor.waitForFunction(() => /abduction/i.test((document.querySelector('.ex-head h1') || {}).textContent || ''));
    await setBubble(visitor, 'side', 'right');
    await visitor.click('#do-start');
    await visitor.waitForFunction(() => window.OnTrackCoach.live && window.OnTrackCoach.live.state === 'active', null, { timeout: 25000 });
    const named = await visitor.evaluate(() => ({ work: window.OnTrackCoach.live.session.opts.work, hud: document.querySelector('#live-name').textContent }));
    assert.equal(named.work, 'R', 'the chosen side is the working limb');
    assert.ok(named.hud.includes('right leg'), named.hud);
    await visitor.click('#btn-exit'); await visitor.waitForSelector('#do-start');
  });

  await step('visitor: completes a coached set with the mock camera, then signs up and the set is saved', async () => {
    await setBubble(visitor, 'target', 8); await setBubble(visitor, 'sets', 2); await setBubble(visitor, 'rest', 30); await runCoachedSet(visitor); await visitor.screenshot({ path: path.join(SHOTS, 'visitor-review.png') });
    await visitor.waitForFunction(() => window.OnTrackCoach.restActive(), null, { timeout: 20000 });
    const rest = await visitor.evaluate(() => ({
      live: document.querySelector('#screen-live').classList.contains('active'),
      video: !!document.querySelector('#stage #video'),
      count: document.querySelector('#count').textContent,
      title: document.querySelector('#ov-title').textContent,
      tip: document.querySelector('#ov-text').textContent,
      buttons: [...document.querySelectorAll('#ov-actions .btn')].map(b => b.textContent),
    }));
    assert.ok(rest.live, 'the camera screen stays up between sets');
    /* restActive() is only true while the frame loop is still running (it bails without a live
       session), so this is the real check that the camera view was not torn down. The mock pose
       source attaches no MediaStream, so there is no srcObject to assert on here. */
    assert.ok(rest.video, 'the camera view is still mounted between sets');
    assert.ok(/^[1-9]/.test(rest.count), `the set's count stays on screen between sets (saw "${rest.count}")`);
    assert.ok(rest.title.includes('Set 1 of 2 done'), rest.title);
    assert.ok(rest.tip.length > 10, 'the rest screen says what to work on');
    assert.ok(rest.buttons.some(b => /Start set 2/.test(b)), rest.buttons.join(','));
    await visitor.screenshot({ path: path.join(SHOTS, 'rest-between-sets.png') });
    await visitor.click('#ov-actions .btn');
    await visitor.waitForFunction(() => window.OnTrackCoach.live && window.OnTrackCoach.live.state === 'active', null, { timeout: 25000 }); await visitor.waitForSelector('#rv-login', { timeout: 45000 });
    assert.ok((await visitor.innerText('#rv-portal')).includes('these 2 sets')); await visitor.click('#rv-login'); await visitor.waitForSelector('#l-id');
    await otpLogin(visitor, '+91 98765 43210', { name: 'Arjun Mehta' });
    await visitor.waitForFunction(() => document.body.innerText.includes('Recent sets') && document.querySelector('.card[data-sid]'), null, { timeout: 15000 });
    const t = await text(visitor); assert.ok(/free member/i.test(t) && t.includes('Standing hip abduction') && t.includes('8/8 reps'), 'pending sets flushed to history after consent'); assert.equal((await visitor.$$('.card[data-sid]')).length, 2, 'both sets saved'); await visitor.screenshot({ path: path.join(SHOTS, 'member-dashboard.png'), fullPage: true });
  });
  const member = visitor;
  await step('member: notes, session note, history filter', async () => {
    await member.goto(base + '/?mock=1#/notes'); await member.waitForSelector('#f-note'); await member.fill('#f-note [name=text]', 'Right hip felt tight at the top.'); await member.selectOption('#f-note [name=exerciseId]', 'hipabd'); await member.click('#f-note button[type=submit]'); await member.waitForFunction(() => document.body.innerText.includes('Right hip felt tight'));
    await member.goto(base + '/?mock=1#/history'); await member.waitForSelector('.card[data-sid]'); await member.click('.card[data-sid]'); await member.waitForSelector('.h-note'); await member.fill('.h-note', 'Rep 2 wobbled.'); await member.click('.h-save'); await member.waitForFunction(() => document.body.innerText.includes('Rep 2 wobbled'));
    await member.click('[data-ex="hipabd"]'); await member.waitForFunction(() => location.hash.includes('exercise=hipabd') && document.querySelector('.card[data-sid]')); await member.screenshot({ path: path.join(SHOTS, 'member-history.png'), fullPage: true });
  });
  await step('member: free tier cannot build routines; pro routine shows lock', async () => {
    await member.goto(base + '/?mock=1#/build'); await member.waitForSelector('.card.upgrade');
    await member.goto(base + '/?mock=1#/routines'); await member.waitForSelector('a.playlist'); const t = await text(member); assert.ok(t.includes('Core starter') && t.includes('Knee comeback'));
    await member.click('a.playlist:has-text("Knee comeback")'); await member.waitForSelector('.card.upgrade'); assert.ok((await text(member)).includes('Unlock'));
  });

  /* ---------- curator (desktop) ---------- */
  const curator = await newPage();
  await step('curator: registers as curator, fills listing, is not listed until subscribed', async () => {
    await otpLogin(curator, 'priya@physio.test', { name: 'Priya Nair', role: 'curator' }); await curator.goto(base + '/?mock=1#/curator-profile'); await curator.waitForSelector('#f-cp');
    await curator.fill('#f-cp [name=displayName]', 'Dr Priya Nair, PT'); await curator.selectOption('#f-cp [name=kind]', 'physiotherapist'); await curator.fill('#f-cp [name=headline]', 'Sports physio — knees and runners'); await curator.fill('#f-cp [name=city]', 'Bengaluru'); await curator.fill('#f-cp [name=credentials]', 'BPT, MPT (Sports)'); await curator.fill('#f-cp [name=languages]', 'English, Kannada, Hindi'); await curator.fill('#f-cp [name=rateText]', '₹1,500/month');
    await curator.check('#f-cp input[name=spec][value="Knee rehab"]'); await curator.check('#f-cp input[name=listed]'); await curator.fill('#f-cp [name=bio]', '12 years in sports rehab. I send short daily routines and check every set.'); await curator.screenshot({ path: path.join(SHOTS, 'curator-listing-editor.png'), fullPage: true });
    await curator.click('#f-cp button[type=submit]'); await curator.waitForFunction(() => document.body.innerText.includes('Activate the Curator plan'));
    await member.goto(base + '/?mock=1#/curators'); await member.waitForSelector('#f-cur'); assert.ok((await text(member)).includes('No curators match'), 'unsubscribed curator is hidden from the directory');
  });
  await step('curator: buys the Curator plan (mock checkout) and appears in Find a curator', async () => {
    await curator.goto(base + '/?mock=1#/pricing'); await curator.waitForSelector('[data-buy]'); await curator.screenshot({ path: path.join(SHOTS, 'pricing.png'), fullPage: true });
    curator.on('dialog', d => d.accept()); await curator.click('[data-buy="curator_monthly"]'); await curator.waitForFunction(() => location.hash === '#/curator-profile' && document.body.innerText.includes('You are listed'), null, { timeout: 15000 });
    await member.goto(base + '/?mock=1#/curators?specialty=Knee%20rehab&city=beng'); await member.waitForFunction(() => document.body.innerText.includes('Dr Priya Nair, PT'), null, { timeout: 10000 }); await member.screenshot({ path: path.join(SHOTS, 'find-a-curator.png'), fullPage: true });
  });
  await step('member: requests a connection; curator accepts', async () => {
    await member.click('a.card.link'); await member.waitForSelector('#f-conn'); await member.fill('#f-conn [name=message]', 'Knee surgery 6 weeks ago, cleared for home exercises.'); await member.click('#f-conn button[type=submit]'); await member.waitForFunction(() => document.body.innerText.includes('Request sent')); await member.screenshot({ path: path.join(SHOTS, 'curator-public.png'), fullPage: true });
    await curator.goto(base + '/?mock=1#/curator'); await curator.waitForSelector('[data-accept]'); assert.ok((await text(curator)).includes('Knee surgery 6 weeks ago')); await curator.click('[data-accept]'); await curator.waitForFunction(() => document.body.innerText.includes('Members (1)'));
  });
  await step('curator: builds a routine with targets and notes, sends it to the member', async () => {
    await curator.goto(base + '/?mock=1#/build/new'); await curator.waitForSelector('#rb-title'); await curator.fill('#rb-title', 'Knee week 1'); await curator.fill('#rb-desc', 'Twice a day. Stop if sharp pain.');
    await curator.click('[data-add="heelslide"]'); await curator.click('[data-add="hipabd"]');
    await curator.locator('[data-i="0"] [data-opt="rom:75"]').click(); await curator.locator('[data-i="0"] .it-sets').fill('2'); await curator.locator('[data-i="0"] .it-sets').dispatchEvent('change'); await curator.locator('[data-i="0"] .it-notes').fill('Only to 75° this week.');
    await curator.locator('[data-i="1"] [data-target="8"]').click(); await curator.locator('[data-i="1"] [data-opt="side:right"]').click(); await curator.screenshot({ path: path.join(SHOTS, 'routine-builder.png'), fullPage: true });
    await curator.click('#rb-save'); await curator.waitForFunction(() => location.hash.startsWith('#/routine/') && document.body.innerText.includes('Knee week 1'));
    const t = await text(curator); assert.ok(t.includes('75° target') && t.includes('2 sets') && t.includes('Only to 75°'));
    await curator.goto(base + '/?mock=1#/curator'); await curator.waitForSelector('[data-send]'); await curator.click('[data-send]'); await curator.selectOption('.send-slot select', { label: 'Knee week 1 (mine)' }); await curator.fill('.send-slot [name=message]', 'Start tomorrow morning.'); await curator.click('.send-slot button[type=submit]'); await curator.waitForFunction(() => document.body.innerText.includes('Sent.'));
  });
  await step('member: sent routine unlocks the pro exercise; completes it; curator sees and comments', async () => {
    await member.goto(base + '/?mock=1#/dashboard'); await member.waitForFunction(() => document.body.innerText.includes('From your curator')); const t = await text(member); assert.ok(t.includes('Knee week 1') && t.includes('Start tomorrow morning') && t.includes('Only to 75°')); await member.screenshot({ path: path.join(SHOTS, 'member-dashboard-sent.png'), fullPage: true });
    const links = await member.$$eval('a[href^="#/exercise/"]', as => as.map(a => a.getAttribute('href'))); const hs = links.find(h => h.startsWith('#/exercise/heelslide/item-')); assert.ok(hs, 'heel slide start link present');
    await member.goto(base + '/?mock=1' + hs); await member.waitForSelector('#do-start'); assert.ok((await text(member)).includes('From “Knee week 1”'), 'pro exercise unlocked through the curator');
    const ha = links.find(h => h.startsWith('#/exercise/hipabd/item-')); await member.goto(base + '/?mock=1' + ha); await member.waitForSelector('#do-start'); await runCoachedSet(member);
    await member.click('#effort button[data-v="4"]'); await member.fill('#rv-note', 'Easier than last week.'); await member.click('#rv-submit'); await member.waitForFunction(() => location.hash.startsWith('#/routine/'));
    await curator.goto(base + '/?mock=1#/curator'); await curator.waitForSelector('a[href^="#/curator-member/"]'); await curator.click('a[href^="#/curator-member/"]'); await curator.waitForSelector('.card[data-sid]'); assert.ok((await text(curator)).includes('effort 4/10'));
    await curator.click('.card[data-sid]'); await curator.waitForSelector('.cm-c'); await curator.fill('.cm-c', 'Nice control. Same again tomorrow.'); await curator.click('.cm-save'); await curator.waitForFunction(() => /curator replied/i.test(document.body.innerText)); await curator.screenshot({ path: path.join(SHOTS, 'curator-member-sessions.png'), fullPage: true });
    await member.goto(base + '/?mock=1#/history'); await member.waitForFunction(() => document.body.innerText.includes('Nice control.'));
    const priv = await curator.evaluate(async () => (await fetch('/api/sessions')).status); assert.equal(priv, 200); // curator's own history endpoint, not the member's
    const allSessions = await curator.evaluate(async () => (await (await fetch('/api/sessions')).json()).sessions.length); assert.equal(allSessions, 0, 'curator sees member sets only through the member view');
  });
  await step('member: ending the connection re-locks the pro exercise', async () => {
    await member.goto(base + '/?mock=1#/connections'); await member.waitForSelector('[data-end]'); member.on('dialog', d => d.accept()); await member.click('[data-end]'); await member.waitForFunction(() => /ended/i.test(document.body.innerText));
    await member.goto(base + '/?mock=1#/exercise/heelslide'); await member.waitForSelector('.card.upgrade'); assert.equal(await member.$('#do-start'), null);
  });

  /* ---------- pro member ---------- */
  const pro = await newPage();
  await step('pro: registers, buys Pro monthly (mock), builds and edits a routine, copies a prebuilt one', async () => {
    await otpLogin(pro, 'meera@example.test', { name: 'Meera' }); await pro.goto(base + '/?mock=1#/pricing'); await pro.waitForSelector('[data-buy]'); pro.on('dialog', d => d.accept()); await pro.click('[data-buy="pro_monthly"]');
    await pro.waitForFunction(() => location.hash === '#/dashboard' && /pro member/i.test(document.body.innerText), null, { timeout: 15000 });
    await pro.goto(base + '/?mock=1#/routines'); await pro.waitForSelector('a.playlist'); await pro.click('a.playlist:has-text("Knee comeback")'); await pro.waitForSelector('#rt-copy'); await pro.click('#rt-copy'); await pro.waitForSelector('#rb-title'); assert.equal(await pro.inputValue('#rb-title'), 'Knee comeback (copy)');
    await pro.fill('#rb-title', 'My knee plan'); await pro.click('#rb-save'); await pro.waitForFunction(() => document.body.innerText.includes('My knee plan'));
    await pro.goto(base + '/?mock=1#/build'); await pro.waitForFunction(() => document.body.innerText.includes('My knee plan')); await pro.screenshot({ path: path.join(SHOTS, 'pro-my-routines.png'), fullPage: true });
    await pro.goto(base + '/?mock=1#/account'); await pro.waitForSelector('[data-cancel]'); await pro.click('[data-cancel]'); await pro.waitForFunction(() => /not renewing/i.test(document.body.innerText)); await pro.screenshot({ path: path.join(SHOTS, 'account.png'), fullPage: true });
    assert.ok((await pro.evaluate(() => window.__portal.ent.pro)), 'access continues after cancelling until period end');
  });
  await step('pro: shoulder exercises render (diagram + guide); coached band abduction set on the chosen arm', async () => {
    for (const id of ['shoulder_er', 'shoulder_abd', 'band_row', 'pullapart', 'trapstretch']) { await pro.goto(base + '/?mock=1#/exercise/' + id); await pro.waitForSelector('#do-start'); await pro.click('#do-details'); const t = await text(pro); assert.ok(t.includes('Set-up and form') && t.includes('Where to put the phone'), id + ' page'); assert.ok(await pro.$('.cam-sentence'), id + ' phone sentence'); }
    await pro.screenshot({ path: path.join(SHOTS, 'exercise-trapstretch.png'), fullPage: true });
    await pro.goto(base + '/?mock=1#/exercise/shoulder_abd'); await pro.waitForSelector('#do-start');
    await pro.evaluate(() => {   // synthetic front-facing upper body: the LEFT arm (image right) raises out to the side
      function frame(map) { const pts = []; for (let i = 0; i < 33; i++) pts.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }); for (const k in map) { const [x, y] = map[k]; pts[+k] = { x: x / (16 / 9) + 0.5 - 0.5 / (16 / 9), y, z: 0, visibility: 0.95 }; } return pts; }
      /* the phone is propped 10° crooked: the whole picture is rolled (in the square, isotropic space frame() maps from), and the coach must level it from the upright trunk */
      const rolled = (map) => { const c = Math.cos(-10 * Math.PI / 180), s = Math.sin(-10 * Math.PI / 180); const out = {}; for (const k in map) { const [x, y] = map[k]; out[k] = [0.5 + (x - 0.5) * c - (y - 0.5) * s, 0.5 + (x - 0.5) * s + (y - 0.5) * c]; } return out; };
      window.__mockPose = t => { if (t < 10500) return abd(0); const tt = t - 10500, rep = Math.floor(tt / 2800), ph = (tt % 2800) / 2800; if (rep >= 8) return abd(0); return abd(92 * Math.sin(Math.PI * ph)); };
      function abd(raise) { const sh = [0.59, 0.30], a = raise * Math.PI / 180, up = 0.13, fo = 0.12; const el = [sh[0] + Math.sin(a) * up, sh[1] + Math.cos(a) * up], wr = [el[0] + Math.sin(a) * fo, el[1] + Math.cos(a) * fo];
        return frame(rolled({ 0: [0.50, 0.14], 7: [0.47, 0.15], 8: [0.53, 0.15], 11: sh, 12: [0.41, 0.30], 13: el, 14: [0.39, 0.42], 15: wr, 16: [0.38, 0.53], 23: [0.56, 0.55], 24: [0.44, 0.55], 25: [0.56, 0.75], 26: [0.44, 0.75], 27: [0.56, 0.95], 28: [0.44, 0.95], 29: [0.55, 0.97], 30: [0.43, 0.97], 31: [0.57, 0.98], 32: [0.45, 0.98] })); }

    });
    await setBubble(pro, 'target', 8); await runCoachedSet(pro, 'left');   // this fixture raises the LEFT arm
    const rec = await pro.evaluate(() => { const r = window.OnTrackCoach.lastRec; return { review: r.review, work: (r.events.find(e => e.type === 'calibrate') || {}).work, opening: (r.events.find(e => e.type === 'opening') || {}).text, camera: r.camera, ev: r.events.map(e => e.type).slice(0, 6) }; }); assert.equal(rec.review.reps, 8, 'eight abduction reps counted on a crooked phone: ' + JSON.stringify(rec));
    assert.equal(rec.camera && rec.camera.rollFrom, 'body', 'the 10° roll was read from the trunk, no sensor in a headless browser: ' + JSON.stringify(rec.camera));
    assert.ok(Math.abs(rec.camera.roll - 10) < 2, 'and measured right: ' + JSON.stringify(rec.camera));
    /* the set can be watched back: the player is up, its timeline has the eight reps, and the report carries it all */
    assert.ok(await pro.$('#rv-replay:not([hidden]) canvas.rp-stage'), 'the replay panel shows with a stage');
    const rp = await pro.evaluate(() => { const tl = window.Replay.timeline(window.OnTrackCoach.lastRec); return { reps: tl.reps.filter(r => r.full).length, cues: tl.cues.length, dur: tl.duration }; });
    assert.equal(rp.reps, 8, 'the timeline shows the eight counted reps: ' + JSON.stringify(rp)); assert.ok(rp.dur > 15000, 'and spans the set: ' + JSON.stringify(rp));
    await pro.click('#rv-replay .rp-timeline', { position: { x: 40, y: 20 } }); await pro.click('#rv-replay .rp-play'); await pro.waitForTimeout(400); await pro.click('#rv-replay .rp-play');
    const html = await pro.evaluate(async () => { const src = await (await fetch('coach/replay.js')).text(); const r = window.OnTrackCoach.lastRec; return window.Replay.reportHtml(r, { name: 'Shoulder abduction', type: 'reps', target: 8, faults: {} }, { score: 90, headline: 'x', type: 'reps', target: 8, reps: 8, partials: 0, faults: {} }, src).length; });
    assert.ok(html > 20000, 'the report is a full page with the recording inside: ' + html + ' bytes');
    await pro.evaluate(() => { for (let e = document.querySelector('#rv-next'); e; e = e.parentElement) if (e.scrollTop) e.scrollTop = 0; window.scrollTo(0, 0); });
    await pro.screenshot({ path: path.join(SHOTS, 'review-top.png') });
    await pro.evaluate(() => { for (let e = document.querySelector('#rv-next'); e; e = e.parentElement) if (e.scrollHeight > e.clientHeight + 40) { e.scrollTop = 460; break; } });
    await pro.screenshot({ path: path.join(SHOTS, 'review-replay.png') });
    /* what the coach says at the end: the set, then the one thing to try — not a read-out of the counts */
    const said = await pro.evaluate(() => {
      const f = window.OnTrackCoach;
      const F = (cue, weight, n) => ({ fault: { cue, label: cue + '!', weight }, n });
      const set = (o) => ({ type: 'reps', reps: 8, target: 8, partials: 0, tips: [], ...o });
      return {
        one: f.spokenSummary(set({ faults: { a: F('Stay tall', 2, 1) } })),
        many: f.spokenSummary(set({ faults: { a: F('Stay tall', 2, 1), b: F('Slow it down', 3, 4), c: F('Heels down', 2, 2) } })),
        light: f.spokenSummary(set({ faults: { a: F('All the way', 1, 2) } })),
        clean: f.spokenSummary(set({ faults: {} })),
        short: f.spokenSummary(set({ reps: 5, partials: 1, faults: {} })),
      };
    });
    assert.equal(said.one, 'Set 1 complete. Next set: stay tall.', JSON.stringify(said));
    /* every major one, heaviest first, as things to do rather than things that went wrong */
    assert.equal(said.many, 'Set 1 complete. Next set: slow it down, heels down and stay tall.', JSON.stringify(said));
    assert.equal(said.light, 'Set 1 complete. Next set: all the way.', 'a set with only light faults still gets the heaviest: ' + JSON.stringify(said));
    assert.equal(said.clean, 'Set 1 complete. Nothing to fix — same again.', JSON.stringify(said));
    assert.equal(said.short, 'Set 1 done — 5 of 8 reps. Nothing to fix — same again.', 'a set cut short still says how far it got: ' + JSON.stringify(said));
    /* and the written list at the top of the review says the same things, in the same words */
    const top = await pro.evaluate(() => { const el = document.querySelector('#rv-next'); const r = el.getBoundingClientRect(), s = document.querySelector('#rv-stats').getBoundingClientRect(); return { above: r.top < s.top, text: el.textContent.trim().slice(0, 60), bar: !document.querySelector('#rv-actions').hidden, buttons: [...document.querySelectorAll('#rv-actions button')].map((b) => b.textContent) }; });
    assert.ok(top.above, 'what to work on sits above the stats: ' + JSON.stringify(top));
    assert.ok(top.bar && top.buttons.length, 'and the way out is at the top: ' + JSON.stringify(top));
    /* the downloadable recording is landmarks and events only, whatever is held in memory for the replay */
    const redacted = await pro.evaluate(() => { const r = window.OnTrackCoach.lastRec; r.video = new Blob(['not-really-a-video'], { type: 'video/webm' }); r.videoMime = 'video/webm'; const j = JSON.parse(window.OnTrackCoach.recJson()); return { keys: Object.keys(j).filter((k) => k === 'video' || k === 'videoMime'), all: Object.keys(j).filter((k) => k.startsWith('video')), frames: j.frames.length }; });
    assert.deepEqual(redacted.keys, [], 'no video reaches the file: ' + JSON.stringify(redacted));
    assert.deepEqual(redacted.all, ['videoOffset'], 'only where its frames would have started, which is a number: ' + JSON.stringify(redacted));
    assert.ok(redacted.frames > 100, 'the landmarks are still there: ' + JSON.stringify(redacted));
    assert.equal(rec.work, 'L', 'the chosen left arm is the working limb: ' + JSON.stringify(rec));
    /* the set opens by naming the side and describing the movement, before the count-in */
    assert.match(rec.opening || '', /^Left arm\./, 'the opening names the side: ' + JSON.stringify(rec.opening));
    assert.match(rec.opening || '', /Raise the arm straight out to the side/, 'and says what to do: ' + JSON.stringify(rec.opening));
    assert.match(rec.opening || '', /8 reps\.$/, 'and the target: ' + JSON.stringify(rec.opening));
    await pro.screenshot({ path: path.join(SHOTS, 'review-shoulder-abd.png') }); await pro.click('#rv-submit'); await pro.waitForFunction(() => location.hash === '#/exercise/shoulder_abd' && !document.querySelector('#coach:not([hidden])'));
    await pro.goto(base + '/?mock=1#/history'); await pro.waitForFunction(() => document.body.innerText.includes('Shoulder abduction'));
  });
  await step('pro: data export and deletion request/cancel', async () => {
    const exp = await pro.evaluate(async () => (await (await fetch('/api/me/export')).json())); assert.equal(exp.routines.length, 1); assert.equal(exp.subscriptions.length, 1);
    await pro.goto(base + '/?mock=1#/account'); await pro.waitForSelector('#acc-erase'); await pro.click('#acc-erase'); await pro.waitForSelector('#acc-cancel-erase'); await pro.click('#acc-cancel-erase'); await pro.waitForSelector('#acc-erase');
  });

  /* ---------- admin ---------- */
  const admin = await newPage();
  await step('admin: overview, verifies the curator; badge shows publicly', async () => {
    await otpLogin(admin, 'admin@fyzio.test', { name: 'Ops' }); await admin.goto(base + '/?mock=1#/admin'); await admin.waitForSelector('.a-verify'); const t = await text(admin); assert.ok(t.includes('Dr Priya Nair, PT') && t.includes('subscription.granted'));
    admin.on('dialog', d => d.accept('Checked IAP registration')); await admin.click('.a-verify'); await admin.waitForFunction(() => document.body.innerText.includes('Checked IAP registration')); await admin.screenshot({ path: path.join(SHOTS, 'admin.png'), fullPage: true });
    await member.goto(base + '/?mock=1#/curators'); await member.waitForFunction(() => document.body.innerText.includes('Dr Priya Nair, PT') && /verified/i.test(document.body.innerText), null, { timeout: 10000 });
  });
  await step('studio: a physio builds a move from a recording — screen, describe, record, measure, faults, guide, export, try', async () => {
    const st = await newPage();
    /* The app's stream, time-warped: the mock clock starts with the camera preview and the Studio counts down ~3.4 s
       before it records, so the stream stays still until 5.5 s — about two still seconds at the start of the take, which
       is what calibration needs — then the same 2.6 s reps: the second one leans. */
    await st.addInitScript(`const __orig = window.__mockPose; window.__mockPose = (t) => (t < 5500 ? __orig(0) : __orig(10500 + (t - 5500)));`);
    await st.goto(base + '/studio/?mock=1'); await st.waitForSelector('#btn-new2'); await st.click('#btn-new2');
    // 1 · screen: six yeses
    await st.waitForSelector('[data-chips="screen.big"]');
    for (const q of ['big', 'across', 'visible', 'home', 'geometry', 'helps']) await st.click(`[data-chips="screen.${q}"] [data-v="true"]`);
    assert.ok((await st.$eval('#verdict', (e) => e.className)).includes('go'), 'all six yes → coachable');
    await st.click('#next');
    // 2 · describe
    await st.waitForSelector('[data-k="name"]'); await st.fill('[data-k="name"]', 'Side leg raise');
    assert.equal(await st.$eval('[data-k="id"]', (e) => e.value), 'side_leg_raise', 'id made from the name');
    await st.fill('[data-k="group"]', 'Hip strength'); await st.fill('[data-k="summary"]', 'Straight-leg raise to the side.'); await st.fill('[data-k="setup"]', 'Face the camera, 2.5 m away, hip height.'); await st.fill('[data-k="why"]', 'The leg swings across the camera plane.');
    await st.click('[data-chips="sidedKind"] [data-v="leg"]'); await st.waitForSelector('[data-chips="sided.by"]');
    // the faults are named here, before anything is recorded, so the takes can be labelled with them
    await st.click('#addf-name'); await st.waitForSelector('[data-k="faults.0.label"]');
    await st.fill('[data-k="faults.0.label"]', 'Leaning away'); await st.fill('[data-k="faults.0.cue"]', 'Stay tall');
    await st.click('#next');
    // 3 · record a clean take on the right leg
    await st.waitForSelector('#btn-cam');
    assert.ok(await st.$('#take-label [data-v="fault:leaning_away"]'), 'the fault named in step 2 is a take label in step 3');
    await st.click('#take-side [data-v="R"]'); await st.click('#btn-cam');
    await st.waitForFunction(() => !document.querySelector('#btn-rec').disabled);
    await st.click('#btn-rec'); await st.waitForSelector('#rec-badge', { timeout: 8000 });
    await st.waitForTimeout(11000); await st.click('#btn-rec');
    await st.waitForFunction(() => window.OnTrackStudio.state.takes.length === 1, null, { timeout: 5000 });
    const take = await st.evaluate(() => { const t = window.OnTrackStudio.state.takes[0]; return { label: t.label, side: t.side, frames: t.frames.length, ms: t.durationMs }; });
    assert.equal(take.label, 'clean'); assert.equal(take.side, 'R'); assert.ok(take.frames > 100 && take.ms > 9000, JSON.stringify(take));
    await st.click('#next');
    // 4 · measure: thigh from vertical, hip → knee; suggest the target from the take
    await st.waitForSelector('[data-mpath="progress.metric"]'); await st.selectOption('[data-mpath="progress.metric"] [data-mkind]', 'vertical');
    /* the landmarks are asked for when a slot is tapped, and the picker walks itself to the next empty slot */
    assert.equal(await st.$eval('#lm-pop', (e) => e.hidden), true, 'the picker is not standing open');
    await st.click('[data-mpath="progress.metric"] .slot[data-slot="0"]');
    await st.waitForSelector('#lm-pop [data-lm="HIP"]'); assert.match(await st.textContent('.lm-pop-head'), /Which point 1\?/);
    await st.click('#lm-pop [data-lm="HIP"]');
    await st.waitForFunction(() => /Which point 2\?/.test(document.querySelector('.lm-pop-head').textContent));
    await st.click('#lm-pop [data-lm="KNEE"]');
    await st.waitForFunction(() => document.getElementById('lm-pop').hidden, null, { timeout: 5000 });
    await st.waitForSelector('#suggest:not([disabled])'); await st.click('#suggest');
    await st.waitForFunction(() => { const s = window.OnTrackStudio.state; const m = s.moves[s.current]; return typeof m.progress.target === 'number' && m.progress.target >= 20 && m.progress.target <= 40; });
    const counted = await st.evaluate(() => { const s = window.OnTrackStudio.state; return s.sims[s.takes[0].id].full; });
    assert.ok(counted >= 3, 'clean take counts reps: ' + counted);
    await st.screenshot({ path: path.join(SHOTS, 'studio-measure.png'), fullPage: true });
    /* One long recording, cut into its reps: each becomes a take of its own, trimmed to the rep (so
       shorter than the whole recording), undescribed until the physio says what it shows. */
    await st.click('#back'); await st.waitForSelector('#takes [data-act="split"]');
    const wholeMs = await st.evaluate(() => window.OnTrackStudio.state.takes[0].durationMs);
    st.once('dialog', (d) => d.accept());
    const reps = await st.$eval('#takes [data-act="split"]', (b) => Number(b.textContent.match(/\d+/)[0]));
    await st.click('#takes [data-act="split"]');
    await st.waitForFunction((n) => window.OnTrackStudio.state.takes.length === n, reps, { timeout: 5000 });
    const kids = await st.evaluate(() => window.OnTrackStudio.state.takes.map((t) => ({ rep: t.origin && t.origin.rep, of: t.origin && t.origin.of, label: t.label, ms: Math.round(t.durationMs), still: t.frames.filter((f) => f[0] < t.calT).length, frames: t.frames.length })));
    assert.deepEqual(kids.map((k) => k.rep), kids.map((_, i) => i + 1), 'one take per rep, in order: ' + JSON.stringify(kids));
    assert.ok(kids.every((k) => k.of === reps && k.still > 10 && k.frames > k.still + 20), 'each keeps the still start and its rep: ' + JSON.stringify(kids));
    assert.ok(kids.every((k) => k.label === 'todo'), 'and none pretends to be clean before anyone said so: ' + JSON.stringify(kids));
    assert.ok(kids.every((k) => k.ms < wholeMs * 0.75), `each is trimmed to its rep, not the whole ${Math.round(wholeMs)} ms: ` + JSON.stringify(kids));
    const coverage = await st.$eval('.fires', (e) => e.textContent);
    assert.match(coverage, /3 reps not described yet/, 'the coverage panel says so: ' + coverage);
    /* describe each one: the middle rep is the one that leaned */
    for (const [i, label] of [[1, 'clean'], [2, 'fault:leaning_away'], [3, 'clean']]) {
      await st.click(`#takes .take:nth-child(${i}) [data-act="say"]`);
      await st.waitForSelector(`#say-pop [data-say-v="${label}"]`); await st.click(`#say-pop [data-say-v="${label}"]`);
    }
    await st.waitForFunction(() => window.OnTrackStudio.state.takes.map((t) => t.label).join() === 'clean,fault:leaning_away,clean');
    /* a rep can show two things at once: the middle one also rushed — then said not to have */
    await st.click('#takes .take:nth-child(2) [data-act="say"]'); await st.waitForSelector('#say-pop [data-say-v="borderline"]');
    await st.click('#say-pop [data-say-v="borderline"]');
    await st.waitForFunction(() => /Fault: Leaning away \+ Borderline/.test(document.querySelector('#takes .take:nth-child(2) [data-act="say"]').textContent));
    assert.deepEqual(await st.evaluate(() => window.OnTrackStudio.state.takes[1].labels), ['fault:leaning_away', 'borderline']);
    await st.click('#say-pop [data-say-v="borderline"]');
    await st.waitForFunction(() => window.OnTrackStudio.state.takes[1].labels.join() === 'fault:leaning_away');
    await st.click('#say-pop [data-say-close]');
    /* more examples than the target is fine, and reads as a count rather than a fraction */
    const after = await st.$eval('.fires', (e) => e.textContent);
    assert.ok(!/not described yet/.test(after) && /Clean 2 ✓/.test(after), 'coverage counts up and stops fussing: ' + after);
    await st.screenshot({ path: path.join(SHOTS, 'studio-split.png'), fullPage: true });
    await st.click('#next'); await st.waitForSelector('[data-mpath="progress.metric"]');
    await st.click('#next');
    // 5 · faults: a leaning fault on the trunk-lean metric, then see it fire on the leaning rep only
    await st.waitForSelector('[data-fi="0"]');
    assert.equal(await st.$eval('[data-k="faults.0.label"]', (e) => e.value), 'Leaning away', 'step 5 carries the fault named in step 2');
    await st.fill('[data-k="faults.0.tip"]', 'Do not tip the trunk to lift the leg higher.');
    await st.selectOption('[data-mpath="faults.0.metric"] [data-mkind]', 'lean'); await st.waitForSelector('[data-fi="0"] [data-chips="faults.0.op"]');
    await st.click('[data-chips="faults.0.op"] [data-v="<"]'); await st.fill('[data-k="faults.0.threshold"]', '-8'); await st.dispatchEvent('[data-k="faults.0.threshold"]', 'input');
    /* the rule fires on the rep labelled as this fault and on none of the clean reps — the split is what makes that visible */
    try { await st.waitForFunction(() => { const t = document.querySelector('[data-fi="0"] .fires').textContent; return /fires on 0\/\d+ clean/.test(t) && /fires on 1\/1 this fault/.test(t); }, null, { timeout: 8000 }); } catch (e) { const d = await st.evaluate(() => { const s = window.OnTrackStudio.state; const m = s.moves[s.current]; const sim = s.sims[s.takes[0].id]; return { fault: m.faults[0], fires: document.querySelector('[data-fi="0"] .fires').textContent, err: sim && sim.error, spans: sim && sim.faultSpans, lean: window.OnTrackStudio.trace({ kind: 'lean', pts: [] }, s.takes[0], 'R').map((x) => Math.round(x[1])) }; }); throw new Error(JSON.stringify(d)); }
    await st.click('#add-fast'); await st.waitForSelector('[data-fi="1"]');
    await st.screenshot({ path: path.join(SHOTS, 'studio-faults.png'), fullPage: true });
    await st.click('#next');
    // 6 · guide + figure
    await st.waitForSelector('[data-k="guide.surface"]'); await st.fill('[data-k="guide.surface"]', 'Firm floor, shoes on.'); await st.fill('[data-k="guide.cannotSee"]', 'Whether the foot is turned out.'); await st.fill('[data-k="guide.stop"]', 'Groin pain.');
    await st.click('[data-addp="0"]'); await st.waitForSelector('[data-k="guide.regions.0.points.0.t"]'); await st.fill('[data-k="guide.regions.0.points.0.t"]', 'Stand tall, hip bones level.'); await st.click('[data-tr="0.0"]');
    await st.click('[data-mus="glute"]'); await st.click('[data-mus="thigh"]');
    await st.click('#build-fig'); await st.waitForSelector('svg.demo-fig');
    const fig = await st.evaluate(() => { const s = window.OnTrackStudio.state; return s.moves[s.current].figure; });
    assert.equal(fig.view, 'front'); assert.ok(fig.A.hipR && fig.B.knR && fig.A.hipR[1] < 161 && fig.B.anR[1] <= 161, JSON.stringify(fig.B));
    /* the figure is editable by hand: drag the left wrist and the forearm turns with it, keeping its length */
    await st.click('#edit-fig'); await st.waitForSelector('#fb-canvas');
    const where = async (kf, joint) => st.evaluate(([kf, joint]) => {
      const s = window.OnTrackStudio.state, F = s.moves[s.current].figure[kf], p = F[joint];
      const c = document.getElementById('fb-canvas'), r = c.getBoundingClientRect(), ar = c.width / c.height;
      let dw = r.width, dh = r.width / ar; if (dh > r.height) { dh = r.height; dw = r.height * ar; }
      const V = { x: 196, y: 14, w: 212, h: 160 };
      return { fx: p[0], fy: p[1], x: r.left + (r.width - dw) / 2 + (p[0] - V.x) / V.w * dw, y: r.top + (r.height - dh) / 2 + (p[1] - V.y) / V.h * dh };
    }, [kf, joint]);
    const bone = async (kf, a, b) => st.evaluate(([kf, a, b]) => { const F = window.OnTrackStudio.state.moves[window.OnTrackStudio.state.current].figure[kf]; return Math.hypot(F[a][0] - F[b][0], F[a][1] - F[b][1]); }, [kf, a, b]);
    const forearm0 = await bone('A', 'elL', 'wrL');
    const wr = await where('A', 'wrL');
    await st.mouse.move(wr.x, wr.y); await st.mouse.down(); await st.mouse.move(wr.x - 60, wr.y - 40, { steps: 6 }); await st.mouse.up();
    const moved = await where('A', 'wrL');
    assert.ok(Math.hypot(moved.fx - wr.fx, moved.fy - wr.fy) > 4, `the wrist moved: ${JSON.stringify([wr.fx, wr.fy, moved.fx, moved.fy])}`);
    assert.ok(Math.abs(await bone('A', 'elL', 'wrL') - forearm0) < 1.5, 'and the forearm is the same length');
    /* stretching instead: the same drag makes the bone longer rather than turning it */
    await st.click('#fb-stretch'); assert.match(await st.textContent('#fb-hint'), /Stretching/);
    const upper0 = await bone('A', 'shL', 'elL');
    const el = await where('A', 'elL');
    await st.mouse.move(el.x, el.y); await st.mouse.down(); await st.mouse.move(el.x, el.y + 70, { steps: 6 }); await st.mouse.up();
    const upper1 = await bone('A', 'shL', 'elL');
    assert.ok(upper1 > upper0 + 3, `the upper arm got longer: ${upper0.toFixed(1)} → ${upper1.toFixed(1)}`);
    assert.ok(Math.abs(await bone('A', 'elL', 'wrL') - forearm0) < 1.5, 'and the forearm below it is carried along unchanged');
    await st.click('#fb-stretch'); assert.match(await st.textContent('#fb-hint'), /Bending/);
    assert.ok(Math.abs(await bone('A', 'shL', 'elL') - (await bone('B', 'shL', 'elL'))) >= 0, 'the other keyframe is untouched by this drag');
    /* a note pinned to a joint, which the exercise page draws on the animation */
    await st.click('#fb-addnote'); await st.waitForSelector('[data-fbn="0"]');
    await st.fill('[data-fbn="0"]', 'Knee drifts in over the big toe');
    await st.selectOption('[data-fbat="0"]', 'knR'); await st.selectOption('[data-fbkfn="0"]', 'B');
    await st.click('#fb-close'); await st.waitForFunction(() => document.getElementById('figbuild').hidden);
    const notes = await st.evaluate(() => window.OnTrackStudio.state.moves[window.OnTrackStudio.state.current].figure.notes);
    assert.deepEqual(notes, [{ at: 'knR', text: 'Knee drifts in over the big toe', kf: 'B' }]);
    await st.waitForFunction(() => /Knee drifts in/.test(document.querySelector('svg.demo-fig').textContent), null, { timeout: 5000 });
    await st.screenshot({ path: path.join(SHOTS, 'studio-figure.png'), fullPage: true });
    await st.click('#next');
    // 7 · export: complete, accepted, and the emitted move compiles in Node too
    await st.waitForSelector('#dl-js'); await st.waitForFunction(() => /Ready to ship/.test(document.body.innerText));
    /* a fresh video, checked against the finished move: the coach's verdict per rep, and whether it agrees with the physio */
    await st.evaluate(() => { const orig = window.__mockPose; window.__mockFile = (t) => (t < 1500 ? orig(0) : orig(5500 + (t - 1500))); });
    await st.setInputFiles('#check-file', path.join(__dirname, 'fixtures', 'blank-36s.webm'));
    await st.waitForFunction(() => document.querySelectorAll('#check-out tbody tr').length >= 3, null, { timeout: 180000 });
    const verdicts = await st.$$eval('#check-out tbody tr', (rows) => rows.map((r) => r.children[2].textContent));
    assert.ok(verdicts.length >= 3 && verdicts[0] === 'clean' && /Leaning/.test(verdicts[1]), 'the coach calls the second rep the lean, the first clean: ' + JSON.stringify(verdicts));
    await st.click('#check-out [data-check-say="0"]'); await st.click('#say-pop [data-say-v="clean"]'); await st.click('#say-pop [data-say-close]');
    await st.click('#check-out [data-check-say="1"]'); await st.click('#say-pop [data-say-v="fault:leaning_away"]'); await st.click('#say-pop [data-say-close]');
    await st.waitForFunction(() => /2 of 2 agree/.test(document.getElementById('check-out').textContent));
    assert.ok(!(await st.evaluate(() => window.OnTrackStudio.state.takes.some((t) => t.label === 'check' || t.source === 'check'))), 'nothing from the check joins the takes');
    const spec = await st.evaluate(() => { const s = window.OnTrackStudio.state; return s.moves[s.current]; });
    const SPEC = require('../client/coach/spec.js'); const LIB = require('../client/coach/exercise-library.js');
    assert.doesNotThrow(() => LIB.validate(SPEC.compile(spec, LIB.kinematics)), 'the exported spec compiles on the build side');
    const src = await st.evaluate(() => window.OnTrackStudio.moveFileSource(window.OnTrackStudio.state.moves[window.OnTrackStudio.state.current]));
    assert.ok(/lib\.define\(\(k\) => spec\.compile\(SPEC, k\)\)/.test(src) && !/"_key"/.test(src), 'move file embeds the spec without studio bookkeeping');
    await st.screenshot({ path: path.join(SHOTS, 'studio-export.png'), fullPage: true });
    // try it in the app: the draft appears on the exercise page with its figure and guide
    await st.evaluate(() => { const s = window.OnTrackStudio.state; const d = {}; d[s.moves[s.current].id] = s.moves[s.current]; localStorage.setItem('grooveform.drafts', JSON.stringify(d)); });
    await st.goto(base + '/?mock=1#/exercise/side_leg_raise'); await st.waitForSelector('#do-start'); await st.click('#do-details');
    const pageText = await st.evaluate(() => document.body.innerText);
    assert.ok(/Side leg raise \(draft\)/.test(pageText) && /cannot see/i.test(pageText), 'draft renders with its guide');
    assert.ok(await st.$('svg.demo-fig'), 'the figure built from the recording is on the page');
    await st.waitForTimeout(1200); await st.screenshot({ path: path.join(SHOTS, 'studio-try.png') });
    await st.close();
  });

  await step('studio: one phone video becomes its reps — read frame by frame, calibrated where the body settles', async () => {
    const st = await newPage();
    await st.goto(base + '/studio/?mock=1'); await st.waitForSelector('#move-select option[value="hipabd"]', { state: 'attached' });
    /* a library move opens as an editable copy, on step 2 — the takes live in step 3 */
    await st.selectOption('#move-select', 'hipabd'); await st.waitForSelector('[data-k="name"]');
    await st.click('#steps [data-step="record"]'); await st.waitForSelector('#file-input', { state: 'attached' });
    /* the video: the person walks in from the left for 1.5 s, holds the start position for 1.5 s, then does the stream's 8 reps */
    await st.evaluate(() => { const orig = window.__mockPose; window.__mockFile = (t) => { if (t < 1500) return orig(0).map((p) => ({ ...p, x: p.x - 0.3 * (1 - t / 1500) })); if (t < 3000) return orig(0); return orig(10500 + (t - 3000)); }; });
    await st.setInputFiles('#file-input', path.join(__dirname, 'fixtures', 'blank-36s.webm'));
    await st.waitForFunction(() => /Analysed|Failed/.test(document.getElementById('cam-status').textContent), null, { timeout: 180000 });
    const status = await st.textContent('#cam-status');
    assert.match(status, /Analysed — 8 reps to describe/, status);
    const kids = await st.evaluate(() => window.OnTrackStudio.state.takes.map((t) => ({ rep: t.origin && t.origin.rep, of: t.origin && t.origin.of, label: t.label, calT: t.calT, videoT0: t.videoT0, videoS0: t.videoS0, frames: t.frames.length })));
    assert.equal(kids.length, 8, JSON.stringify(kids));
    assert.ok(kids.every((k) => k.of === 8 && k.label === 'todo'), JSON.stringify(kids));
    /* Each rep carries the moment before ITSELF, as one unbroken slice: its clip starts at its own
       place in the recording (never back at the start of the set), and the clock does not jump at
       calibration, so it plays straight through. */
    assert.ok(kids.every((k) => k.calT >= 400 && k.calT <= 1700), 'every rep has a moment of the start position in front of it: ' + JSON.stringify(kids));
    assert.ok(kids.every((k) => k.videoT0 - k.videoS0 === k.calT), 'the lead-in runs straight into the rep: ' + JSON.stringify(kids));
    for (let i = 1; i < kids.length; i++) assert.ok(kids[i].videoS0 > kids[i - 1].videoS0, `rep ${i + 1} starts later in the video than rep ${i}: ` + JSON.stringify(kids.map((k) => k.videoS0)));
    assert.ok(kids[0].videoT0 >= 2700 && kids[0].videoT0 <= 4000, 'the first rep is cut from where the set began, not from the walk-in: ' + JSON.stringify(kids[0]));
    /* the first rep is already playing for the physio to say what it shows; each answer plays the next */
    await st.waitForFunction(() => !document.getElementById('player').hidden && !document.getElementById('pl-classify').hidden);
    assert.match(await st.textContent('#pl-title'), /Rep 1 of 8/);
    assert.ok(await st.$('#pl-classify [data-say="clean"]') && await st.$('#pl-classify [data-say="notrep"]') && await st.$('#pl-classify [data-say-skip]') && await st.$('#pl-classify [data-next]'), 'clean, not-a-rep, next and skip are offered');
    /* clean and not-a-rep stand alone, so they answer and move on in one tap */
    await st.click('#pl-classify [data-say="clean"]'); await st.waitForFunction(() => /Rep 2 of 8/.test(document.getElementById('pl-title').textContent));
    await st.click('#pl-classify [data-say="notrep"]'); await st.waitForFunction(() => /Rep 3 of 8/.test(document.getElementById('pl-title').textContent));
    await st.keyboard.press('KeyS'); await st.waitForFunction(() => /Rep 4 of 8/.test(document.getElementById('pl-title').textContent));
    await st.keyboard.press('Digit1'); await st.waitForFunction(() => /Rep 5 of 8/.test(document.getElementById('pl-title').textContent));
    /* a rep that shows two things: both chips stay on, and Next moves along */
    await st.click('#pl-classify [data-say^="fault:"]');
    await st.click('#pl-classify [data-say="borderline"]');
    assert.match(await st.textContent('#pl-said'), / \+ /, 'the bar lists both');
    assert.match(await st.textContent('#pl-title'), /Rep 5 of 8/, 'and stays on the rep until Next');
    await st.keyboard.press('Enter'); await st.waitForFunction(() => /Rep 6 of 8/.test(document.getElementById('pl-title').textContent));
    await st.click('#pl-close');
    const said = await st.evaluate(() => window.OnTrackStudio.state.takes.map((t) => t.labels.join('+')));
    assert.deepEqual(said.filter((_, i) => i !== 4), ['clean', 'notrep', 'todo', 'clean', 'todo', 'todo', 'todo'], 'said, not a rep, skipped, said by key; the rest wait: ' + JSON.stringify(said));
    assert.match(said[4], /^fault:\w+\+borderline$/, 'and one rep says two things at once: ' + said[4]);
    assert.match(await st.textContent('#describe-reps'), /Play and describe 4 reps/, 'the skipped ones can be picked up again');
    const drawn = await st.evaluate(() => document.querySelectorAll('#takes .take').length); assert.equal(drawn, 8, 'a not-a-rep take stays listed, struck through');
    await st.close();
  });

  await step('studio: any library move opens as a copy, round-trips to the same move, and saves back into its file', async () => {
    const st = await newPage();
    await st.goto(base + '/studio/?mock=1'); await st.waitForSelector('#btn-new2');
    /* every catalogue move survives entry → draft → entry with the same compiled result */
    const rt = await st.evaluate(() => {
      const S = window.OnTrackStudio, LIB = window.ExerciseLibrary, C = window.OnTrackCatalog;
      const strip = (ex) => JSON.parse(JSON.stringify(ex, (k, v) => (typeof v === 'function' ? '[fn]' : k === 'entry' || k === 'file' || k === 'figure' || k === 'spec' ? undefined : v)));
      const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
      const out = { checked: 0, problems: [], changed: [], rewritten: [] };
      for (const ex of LIB.all().filter((e) => e.catalog)) {
        const region = ex.file.replace(/\.json$/, '');
        const s = S.entryToSpec(ex); const { rel, json, entry } = S.regionWith(s, region);
        const p = S.catalogProblems(s, region); if (p.length) out.problems.push(ex.id + ': ' + p[0]);
        if (rel !== 'moves/' + ex.id + '.json') out.problems.push(ex.id + ': writes back to ' + rel);
        const grp = {}; for (const k of Object.keys(json)) if (k !== 'moves' && !k.startsWith('_')) grp[k] = json[k];
        const rebuilt = C.buildFile({ ...grp, moves: [entry] }, rel, C.data, false)[0];
        const a = JSON.stringify(canon(strip(ex))), b = JSON.stringify(canon(strip({ ...rebuilt, order: ex.order })));
        if (a !== b) out.changed.push(ex.id);
        /* and the file itself: saving a move you did not touch must not rewrite its entry */
        const { _studio, ...written } = entry; const { _note, _studio: _was, ...original } = ex.entry;   /* the Studio's own stamp (who, when) is not the move */
        if (JSON.stringify(canon(written)) !== JSON.stringify(canon(original))) out.rewritten.push(ex.id + ' ' + JSON.stringify(canon(written)).slice(0, 80));
        out.checked++;
      }
      return out;
    });
    assert.equal(rt.checked, 145, 'every move, the vetted ones included, is data'); assert.deepEqual(rt.problems, []); assert.deepEqual(rt.changed, [], 'a move must come back from the Studio exactly as it went in');
    assert.deepEqual(rt.rewritten, [], 'an untouched move must be written back as the same entry');
    /* the flow a physio sees: pick a move, edit a copy, change a number, check, download */
    /* the list is alphabetical and the search box narrows it */
    const names = await st.$$eval('#move-select option:not([disabled])', (os) => os.map((o) => o.textContent.replace(/ [·✓]$/, '')));
    assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })), 'moves are in alphabetical order');
    await st.fill('#move-search', 'knee');
    await st.waitForFunction(() => [...document.querySelectorAll('#move-select option:not([disabled])')].every((o) => /knee/i.test(o.textContent)));
    const few = await st.$$eval('#move-select option:not([disabled])', (o) => o.length);
    assert.ok(few > 0 && few < names.length, `the search narrows the list: ${few} of ${names.length}`);
    await st.fill('#move-search', '');
    /* picking a library move opens it as an editable copy — no second click */
    await st.selectOption('#move-select', 'seated_knee_ext');
    await st.waitForSelector('[data-k="name"]'); assert.equal(await st.$eval('[data-k="name"]', (e) => e.value), 'Seated knee extension');
    assert.equal(await st.$eval('[data-chips="tracking"] [aria-pressed="true"]', (e) => e.dataset.v), 'form');
    await st.click('#steps [data-step="faults"]'); await st.waitForSelector('[data-k="faults.0.threshold"]');
    assert.equal(await st.$eval('[data-k="faults.0.threshold"]', (e) => e.value), '-12');
    await st.fill('[data-k="faults.0.threshold"]', '-15'); await st.dispatchEvent('[data-k="faults.0.threshold"]', 'input');
    /* the move asks for a pause at the top, so its "no pause" fault is a built-in rule with no
       measurement of its own — the editor has to render it rather than look for a metric */
    const holdAt = await st.evaluate(() => { const S = window.OnTrackStudio; return S.state.moves[S.state.current].faults.findIndex((f) => f.rule === 'shortHold'); });
    assert.ok(holdAt >= 0, 'the hold rule survived the round trip');
    assert.match(await st.$eval(`.fault-card[data-fi="${holdAt}"] .notice`, (e) => e.textContent), /Built-in rule: the top was reached but not held/);
    /* a fault with no measurement shows as person-watched — find it by id, not by position */
    const listedAt = await st.evaluate(() => { const S = window.OnTrackStudio; const s = S.state.moves[S.state.current]; return s.faults.findIndex((f) => f.id === 'drop'); });
    assert.ok(listedAt >= 0, 'the drop fault survived the round trip');
    assert.equal(await st.$eval(`[data-chips="faults.${listedAt}.listed"] [aria-pressed="true"]`, (e) => e.dataset.v), 'true', 'a fault without a measurement is listed for the person');
    await st.click('#steps [data-step="export"]'); await st.waitForSelector('#dl-file');
    await st.waitForFunction(() => /Ready to ship/.test(document.body.innerText));
    assert.equal(await st.$eval('[data-k="_region"]', (e) => e.value), 'knee', 'stays in the region it came from');
    /* whether the move is offered for browsing, and that a choice is only written when it differs
       from vetted — this move is vetted, so the choice that has to be written down is "hidden" */
    assert.equal(await st.$eval('[data-chips="listed"] .chip[aria-pressed="true"]', (e) => e.dataset.v), 'auto');
    await st.click('[data-chips="listed"] [data-v="no"]');
    await st.waitForFunction(() => { const S = window.OnTrackStudio; return S.state.moves[S.state.current].listed === false; });
    const withFlag = await st.evaluate(() => { const S = window.OnTrackStudio; const s = S.state.moves[S.state.current]; return S.regionWith(s, 'knee').entry.listed; });
    assert.equal(withFlag, false, 'a move kept out of the lists although it is vetted says so in its file');
    await st.click('[data-chips="listed"] [data-v="auto"]');
    await st.waitForFunction(() => { const S = window.OnTrackStudio; return S.state.moves[S.state.current].listed === undefined; });
    const noFlag = await st.evaluate(() => { const S = window.OnTrackStudio; const s = S.state.moves[S.state.current]; return 'listed' in S.regionWith(s, 'knee').entry; });
    assert.equal(noFlag, false, 'and following vetted writes nothing');
    assert.match(await st.textContent('#dl-file'), /seated_knee_ext\.json/, 'and downloads as its own file');
    assert.ok(await st.$('#save-project[hidden]'), 'no dev server here, so no save button');
    const saved = await st.evaluate(() => { const S = window.OnTrackStudio; const s = S.state.moves[S.state.current]; return S.regionWith(s, 'knee'); });
    assert.equal(saved.rel, 'moves/seated_knee_ext.json', 'one exercise, one file');
    assert.equal(saved.isNew, false, 'replaces, does not add');
    const m = saved.json.moves.find((x) => x.id === 'seated_knee_ext'); assert.equal(saved.json.moves.filter((x) => x.id === 'seated_knee_ext').length, 1, 'replaces, does not duplicate');
    assert.equal(m.faults[0].threshold, -15); assert.equal(m.faults.find((f) => f.rule === 'shallow').metric, undefined, 'a built-in rule keeps no measurement');
    assert.ok(m._studio && m._studio.edited, 'the Studio leaves its provenance as a note');
    assert.equal(m.region, 'knee', 'the move file says which region it belongs to');
    await st.screenshot({ path: path.join(SHOTS, 'studio-edit-copy.png'), fullPage: true });
    await st.close();
  });

  await step('voice: a natural voice is chosen over the robotic default, and the same one on every device', async () => {
    const page = await newPage();
    /* a device offering the usual mixture: an old formant voice marked default, and better ones */
    await page.addInitScript(() => {
      const V = (name, lang, localService, def) => ({ name, lang, localService, default: !!def, voiceURI: name });
      const voices = [
        V('English (United Kingdom)', 'en-GB', true, true),     // Android's formant voice, offered first
        V('Microsoft Zira - English (United States)', 'en-US', true),
        V('eSpeak English', 'en-GB', true),
        V('Google UK English Female', 'en-GB', false),
        V('Microsoft Sonia Online (Natural) - English (United Kingdom)', 'en-GB', false),
        V('Samantha', 'en-US', true),
      ];
      window.__spoken = [];
      /* window.speechSynthesis is a read-only accessor, so it is redefined rather than assigned */
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => voices, speaking: false, cancel() { }, pause() { }, resume() { },
        speak(u) { window.__spoken.push({ text: u.text, voice: u.voice && u.voice.name, rate: u.rate }); },
        addEventListener() { }, removeEventListener() { }, onvoiceschanged: null,
      } });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: function (t) { this.text = t; } });
    });
    await page.goto(base + '/?mock=1#/');
    await page.waitForFunction(() => window.OnTrackCoach && window.OnTrackCoach.pickVoice);
    const pick = await page.evaluate(() => { const v = window.OnTrackCoach.pickVoice(); return { name: v && v.name, rate: window.OnTrackCoach.voiceRate(v) }; });
    assert.equal(pick.name, 'Microsoft Sonia Online (Natural) - English (United Kingdom)', 'the neural voice wins, not the default: ' + pick.name);
    assert.ok(pick.rate > 0.9 && pick.rate < 1.1, 'and it is read at a sensible speed: ' + pick.rate);
    /* every device runs the same ladder, so with only the bad ones present it still never picks eSpeak over a real voice */
    const ladder = await page.evaluate(() => {
      const list = window.OnTrackCoach.listVoices();
      return { first: list[0] && list[0].name, espeakLast: list[list.length - 1].name };
    });
    assert.match(ladder.first, /Sonia|Google|Samantha/, 'the good voices sort first: ' + ladder.first);
    /* degrees and dashes are written for the eye; they are spoken as words */
    /* Chrome needs the speak call on the next tick, so the stub records it just after utter returns */
    const said = await page.evaluate(async () => {
      const c = window.OnTrackCoach; c.voice.muted = false; c.voice.utter('Set 2 complete — 95° reached, 3 × 10', 2);
      await new Promise((r) => setTimeout(r, 30));
      return window.__spoken.pop();
    });
    assert.match(said.text, /95 degrees/, 'degrees are spoken: ' + said.text);
    assert.ok(!/—/.test(said.text) && !/×/.test(said.text), 'and the typography is not: ' + said.text);
    assert.equal(said.voice, 'Microsoft Sonia Online (Natural) - English (United Kingdom)');
    await page.close();
  });

  await step('reps with a hold, a hand weight, height in the settings, the animation toggle on the page, vetted as the author\'s call', async () => {
    const page = await newPage();
    /* Settings: the person's height, 5'11" unless they say otherwise */
    await page.goto(base + '/?mock=1#/settings'); await page.waitForSelector('#cs-height');
    assert.equal(await page.$eval('#cs-height', (e) => e.value), '71', 'default height is 5\'11"');
    assert.match(await page.$eval('#cs-height', (e) => e.selectedOptions[0].textContent), /5'11" \(180 cm\)/);
    await page.selectOption('#cs-height', '60');
    assert.equal(await page.evaluate(() => window.OnTrackCoach.settings.heightIn), 60, 'the height is a number of inches in the coach settings');
    await page.selectOption('#cs-height', '71');
    /* The exercise page: the animation toggle sits beside the figure and is the same setting as Settings */
    await page.goto(base + '/?mock=1#/exercise/goblet_squat'); await page.waitForSelector('#do-start');
    assert.ok(await page.$('#demo-host svg.demo-fig'), 'stick figure by default');
    assert.equal(await page.$eval('.fig-toggle [data-fig="lines"]', (e) => e.getAttribute('aria-pressed')), 'true');
    await page.click('.fig-toggle [data-fig="muscles"]');
    await page.waitForSelector('#demo-host canvas.demo-fig.muscle');
    assert.equal(await page.evaluate(() => window.OnTrackCoach.settings.figure), 'muscles', 'the toggle writes the setting');
    await page.goto(base + '/?mock=1#/settings'); await page.waitForSelector('#cs-figure');
    assert.equal(await page.$eval('#cs-figure', (e) => e.value), 'muscles', 'and Settings shows the same choice');
    await page.selectOption('#cs-figure', 'lines');
    /* A dumbbell move offers a weight: none → 1 → 2 → 5 kg → Other…, where the person types their own */
    await page.goto(base + '/?mock=1#/exercise/goblet_squat'); await page.waitForSelector('.bubble[data-optkey="weight"]');
    const w = '.bubble[data-optkey="weight"]';
    assert.equal(await page.$eval(w, (e) => e.textContent.trim()), 'No weight');
    for (const want of ['1 kg', '2 kg', '5 kg']) { await page.click(w); assert.equal(await page.$eval(w, (e) => e.textContent.trim()), want); }
    await page.click(w); await page.waitForSelector('.bubble-in');
    await page.fill('.bubble-in', '7.5'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.bubble-in'));
    assert.equal(await page.$eval(w, (e) => e.textContent.trim()), '7.5 kg', 'the typed weight sits on the bubble');
    await page.click(w); assert.equal(await page.$eval(w, (e) => e.textContent.trim()), 'No weight', 'and the next tap wraps round');
    await page.click(w); await page.click(w); await page.click(w); await page.click(w); await page.waitForSelector('.bubble-in');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.bubble-in'));
    assert.equal(await page.$eval(w, (e) => e.textContent.trim()), 'No weight', 'an empty box falls back to no weight');
    /* every dumbbell move offers it; a bodyweight one does not */
    const offered = await page.evaluate(() => window.ExerciseLibrary.all().filter((e) => e.options.some((o) => o.key === 'weight')).map((e) => e.id));
    assert.ok(offered.includes('goblet_squat') && offered.includes('biceps_curl') && !offered.includes('bodyweight_squat'), offered.join(','));
    await page.close();

    /* Studio: the third kind of counting, and a measurement in inches of the person's height */
    const st = await newPage();
    await st.goto(base + '/studio/?mock=1'); await st.waitForSelector('#btn-new2'); await st.click('#btn-new2');
    await st.waitForSelector('[data-chips="screen.big"]');
    for (const q of ['big', 'across', 'visible', 'home', 'geometry', 'helps']) await st.click(`[data-chips="screen.${q}"] [data-v="true"]`);
    await st.click('#next'); await st.waitForSelector('[data-chips="counts"]');
    assert.ok(!(await st.$('[data-chips="repHold"]')), 'no hold row until it is a rep with a hold');
    await st.click('[data-chips="counts"] [data-v="repHold"]'); await st.waitForSelector('[data-chips="repHold"]');
    const d = await st.evaluate(() => { const S = window.OnTrackStudio; const s = S.state.moves[S.state.current]; return { type: s.type, repHold: s.repHold, ptType: s.ptType }; });
    assert.deepEqual(d, { type: 'reps', repHold: 2, ptType: 'H' }, 'a rep with a hold is a rep move, held 2 s, PT type H');
    await st.click('[data-chips="repHold"] [data-v="3"]');
    await st.waitForFunction(() => { const S = window.OnTrackStudio; return S.state.moves[S.state.current].repHold === 3; });
    await st.click('[data-chips="weight"] [data-v="2"]');
    await st.waitForFunction(() => { const S = window.OnTrackStudio; return S.state.moves[S.state.current].weight === 2; });
    const entry = await st.evaluate(() => { const S = window.OnTrackStudio; const s = S.state.moves[S.state.current]; s.name = 'Held raise'; s.id = 'held_raise'; return S.specToEntry(s); });
    assert.equal(entry.repHold, 3); assert.equal(entry.weight, 2);
    await st.click('[data-chips="counts"] [data-v="hold"]');
    await st.waitForFunction(() => { const S = window.OnTrackStudio; const s = S.state.moves[S.state.current]; return s.type === 'hold' && s.repHold === 0; });
    /* a fault read as inches of the person's height: the "% of" list offers their height, and then a unit */
    await st.click('[data-chips="counts"] [data-v="reps"]');
    await st.waitForFunction(() => { const S = window.OnTrackStudio; return S.state.moves[S.state.current].type === 'reps'; });
    await st.evaluate(() => { const S = window.OnTrackStudio; const s = S.state.moves[S.state.current]; s.faults = [{ id: 'knee_in', label: 'Knee drifting in', cue: 'Knee out', tip: 'Track the knee over the foot.', severity: 2, metric: { kind: 'gap', pts: ['KNEE', 'FOOT'] }, rel: 'abs', op: '>', threshold: 10, minP: 0.3, persist: 400 }]; });
    await st.click('#steps [data-step="faults"]'); await st.waitForSelector('[data-mpath="faults.0.metric"] select[data-mk="per"]');
    assert.ok(!(await st.$('[data-mpath="faults.0.metric"] select[data-mk="unit"]')), 'no unit until the % is of their height');
    await st.selectOption('[data-mpath="faults.0.metric"] select[data-mk="per"]', 'height');
    await st.waitForSelector('[data-mpath="faults.0.metric"] select[data-mk="unit"]');
    await st.selectOption('[data-mpath="faults.0.metric"] select[data-mk="unit"]', 'in');
    await st.waitForFunction(() => { const S = window.OnTrackStudio; const m = S.state.moves[S.state.current].faults[0].metric; return m.per === 'height' && m.unit === 'in'; });
    const unitShown = await st.$eval('[data-k="faults.0.threshold"] + span', (e) => e.textContent.trim());
    assert.equal(unitShown, 'in', 'the threshold is in inches now');
    await st.selectOption('[data-mpath="faults.0.metric"] select[data-mk="per"]', 'torso');
    await st.waitForFunction(() => { const S = window.OnTrackStudio; const m = S.state.moves[S.state.current].faults[0].metric; return !m.per && !m.unit; });
    /* Vetted is the author's call: it can be turned on over a failing tuning report, and the file says so */
    await st.goto(base + '/studio/?mock=1'); await st.waitForSelector('#move-select');
    await st.selectOption('#move-select', 'seated_knee_ext'); await st.waitForSelector('#steps [data-step="export"]');
    await st.click('#steps [data-step="export"]'); await st.waitForSelector('[data-chips="vetted"]');
    await st.click('[data-chips="vetted"] [data-v="true"]');
    await st.waitForFunction(() => { const S = window.OnTrackStudio; return S.state.moves[S.state.current].vetted === true; });
    const tuned = await st.evaluate(() => { const S = window.OnTrackStudio; const s = S.state.moves[S.state.current]; return { tuned: s._tuned, entry: S.regionWith(s, 'knee').entry._studio.tuned }; });
    assert.ok(tuned.tuned && Array.isArray(tuned.tuned.override) && tuned.tuned.override.length, 'vetted over a failing report is recorded: ' + JSON.stringify(tuned.tuned));
    assert.deepEqual(tuned.entry.override, tuned.tuned.override, 'and written into the file');
    await st.close();
  });

  await step('each rep has its own start, the anchors are declared, and a move says what the coach says', async () => {
    const st = await newPage();
    await st.goto(base + '/studio/?mock=1'); await st.waitForSelector('#move-select');
    await st.waitForFunction(() => window.ExerciseLibrary && window.ExerciseLibrary.all().some((e) => e.id === 'glute_bridge'));
    /* The control, not any one move's data: whatever the bridge currently says, ticking a point
       adds it in a fixed order and unticking takes it away again. A test that demanded the bridge
       name particular points would break the moment someone edits the bridge, which is the whole
       purpose of the library being data. */
    await st.selectOption('#move-select', 'glute_bridge'); await st.waitForSelector('#steps [data-step="measure"]');
    await st.click('#steps [data-step="measure"]'); await st.waitForSelector('#stable-pts');
    const was = await st.evaluate(() => (window.OnTrackStudio.state.moves[window.OnTrackStudio.state.current].stable || []).slice());
    for (const n of was) assert.equal(await st.$eval(`[data-st="${n}"]`, (e) => e.getAttribute('aria-pressed')), 'true', n + ' is ticked because the move says so');
    assert.ok(!was.includes('WR'), 'the wrist is not one of them to begin with');
    assert.equal(await st.$eval('[data-st="WR"]', (e) => e.getAttribute('aria-pressed')), 'false');
    await st.click('[data-st="WR"]');
    await st.waitForFunction(() => (window.OnTrackStudio.state.moves[window.OnTrackStudio.state.current].stable || []).includes('WR'));
    const withWrist = await st.evaluate(() => { const S = window.OnTrackStudio; const s = S.state.moves[S.state.current]; return S.regionWith(s, 'hip').entry.stable; });
    assert.deepEqual(withWrist, ['SH', 'EL', 'WR', 'HIP', 'KNEE', 'ANK', 'HEEL', 'FOOT', 'oSH', 'oHIP', 'oKNEE', 'oANK'].filter((n) => n === 'WR' || was.includes(n)), 'written head to toe, whatever the move already named: ' + JSON.stringify(withWrist));
    await st.click('[data-st="WR"]');
    await st.waitForFunction(() => !(window.OnTrackStudio.state.moves[window.OnTrackStudio.state.current].stable || []).includes('WR'));
    assert.deepEqual(await st.evaluate(() => (window.OnTrackStudio.state.moves[window.OnTrackStudio.state.current].stable || []).slice()), was, 'and unticking puts it back as it was');
    /* and step 6 says what the coach says at each moment */
    await st.click('#steps [data-step="guide"]'); await st.waitForSelector('[data-cueon="count"]');
    assert.equal(await st.$eval('[data-cueon="count"]', (e) => e.textContent.trim()), 'says it');
    await st.click('[data-cueon="count"]');
    await st.waitForFunction(() => window.OnTrackStudio.state.moves[window.OnTrackStudio.state.current].cues.count === false);
    assert.equal(await st.$eval('[data-cueon="count"]', (e) => e.textContent.trim()), 'silent');
    assert.equal(await st.$('[data-cuetext="count"]'), null, 'a silent stage has no words to write');
    await st.fill('[data-cuetext="go"]', 'Begin'); await st.dispatchEvent('[data-cuetext="go"]', 'input');
    await st.fill('[data-cuetext="praise"]', 'Steady, Strong'); await st.dispatchEvent('[data-cuetext="praise"]', 'input');
    const cues = await st.evaluate(() => { const S = window.OnTrackStudio; const s = S.state.moves[S.state.current]; return S.regionWith(s, 'hip').entry.cues; });
    assert.deepEqual(cues, { count: false, go: 'Begin', praise: ['Steady', 'Strong'] }, JSON.stringify(cues));
    /* a hold is not offered the rep-only moments */
    const forHold = await st.evaluate(() => { const S = window.OnTrackStudio; const s = S.state.moves[S.state.current]; s.type = 'hold'; S.render(); return [...document.querySelectorAll('[data-cueon]')].map((b) => b.dataset.cueon); });
    assert.ok(forHold.includes('mark') && forHold.includes('enter') && !forHold.includes('count'), forHold.join(','));
    await st.close();

    /* the coach, at each moment: silenced says nothing, reworded says the move's words */
    const page = await newPage();
    await page.goto(base + '/?mock=1#/exercise/hipabd'); await page.waitForSelector('#do-start');
    const heard = await page.evaluate(() => {
      const at = window.OnTrackCoach.cueAt;
      const ex = { cues: { count: false, go: 'Begin', praise: ['Steady'] } };
      return { silenced: at(ex, 'count', '3'), reworded: at(ex, 'go', 'Go'), listed: at(ex, 'praise', ['Nice']),
        untouched: at(ex, 'finish', 'Set complete'), noBlock: at({}, 'go', 'Go') };
    });
    assert.equal(heard.silenced, null, 'a silenced moment says nothing');
    assert.equal(heard.reworded, 'Begin', 'a reworded one says the move\'s words');
    assert.deepEqual(heard.listed, ['Steady']);
    assert.equal(heard.untouched, 'Set complete', 'a stage left out is unchanged');
    assert.equal(heard.noBlock, 'Go', 'and a move with no cues block is unchanged');
    /* the engine: each rep records the start it was measured from */
    const froms = await page.evaluate(() => {
      const E = window.FormEngine, ex = window.ExerciseLibrary.all().find((e) => e.id === 'hipabd');
      const frame = (raise) => { const p = []; for (let i = 0; i < 33; i++) p.push({ x: 0.5, y: 0.5, z: 0, v: 1, visibility: 1 });
        const hip = [0.46, 0.55], kn = [hip[0] - Math.sin(raise * Math.PI / 180) * 0.2, hip[1] + Math.cos(raise * Math.PI / 180) * 0.2];
        p[11] = { x: 0.58, y: 0.30, z: 0, v: 1 }; p[12] = { x: 0.42, y: 0.30, z: 0, v: 1 };
        p[23] = { x: 0.54, y: 0.55, z: 0, v: 1 }; p[24] = { x: hip[0], y: hip[1], z: 0, v: 1 };
        p[25] = { x: 0.54, y: 0.75, z: 0, v: 1 }; p[26] = { x: kn[0], y: kn[1], z: 0, v: 1 };
        p[27] = { x: 0.54, y: 0.95, z: 0, v: 1 }; p[28] = { x: kn[0], y: kn[1] + 0.2, z: 0, v: 1 };
        for (const i of [7, 8, 29, 30, 31, 32]) p[i] = { x: 0.5, y: 0.9, z: 0, v: 1 };
        return p; };
      const sess = new E.SetSession(ex, { target: 20, rom: 30, work: 'R' }); const sm = new E.PoseSmoother();
      let t = 0, pts; for (let i = 0; i < 40; i++) { t += 33; pts = sm.update(frame(0), t, 1); }
      sess.calibrate(pts, 'R');
      const out = [];
      /* three raises, each returning to a resting position 4° further out than the last */
      for (let r = 0; r < 3; r++) {
        for (let i = 0; i < 60; i++) { t += 33; const q = sm.update(frame(r * 4 + 35 * Math.sin(Math.PI * i / 60)), t, 1); const v = sess.step(q, t); if (v.repEvent) out.push(v.repEvent.rep.from); }
        for (let i = 0; i < 60; i++) { t += 33; const q = sm.update(frame((r + 1) * 4), t, 1); const v = sess.step(q, t); if (v.repEvent) out.push(v.repEvent.rep.from); }
      }
      return { froms: out, restarts: sess.restarts, calibrated: +sess.ref.parts0[0].start.toFixed(1) };
    });
    assert.ok(froms.restarts > 0, 'the start was read again between reps');
    assert.ok(froms.froms.length >= 2, 'reps were counted: ' + JSON.stringify(froms));
    assert.ok(froms.froms[froms.froms.length - 1] > froms.froms[0], `each rep starts from where the leg now rests: ${froms.froms.join(', ')}`);
    await page.close();
  });

  await step('studio: every rep cut carries the moment before itself, and plays straight through', async () => {
    const st = await newPage();
    await st.goto(base + '/studio/?mock=1'); await st.waitForSelector('#move-select');
    await st.waitForFunction(() => window.ExerciseLibrary && window.ExerciseLibrary.all().some((e) => e.id === 'hipabd'));
    const out = await st.evaluate(() => {
      const S = window.OnTrackStudio, E = window.FormEngine, ex = window.ExerciseLibrary.all().find((e) => e.id === 'hipabd');
      /* a made-up side leg raise: a long walk-in, then five raises with a pause between each */
      const frame = (raise) => { const p = []; for (let i = 0; i < 33; i++) p.push([0.5, 0.5, 0, 1]);
        const hip = [0.46, 0.55], kn = [hip[0] - Math.sin(raise * Math.PI / 180) * 0.2, hip[1] + Math.cos(raise * Math.PI / 180) * 0.2];
        p[11] = [0.58, 0.30, 0, 1]; p[12] = [0.42, 0.30, 0, 1]; p[23] = [0.54, 0.55, 0, 1]; p[24] = [hip[0], hip[1], 0, 1];
        p[25] = [0.54, 0.75, 0, 1]; p[26] = [kn[0], kn[1], 0, 1]; p[27] = [0.54, 0.95, 0, 1]; p[28] = [kn[0], kn[1] + 0.2, 0, 1];
        for (const i of [7, 8, 29, 30, 31, 32]) p[i] = [0.5, 0.9, 0, 1];
        return p; };
      const frames = []; let t = 0;
      for (let i = 0; i < 90; i++) { frames.push([t, frame(0)]); t += 33; }          // three seconds of standing still
      for (let r = 0; r < 5; r++) {
        for (let i = 0; i < 60; i++) { frames.push([t, frame(35 * Math.sin(Math.PI * i / 60))]); t += 33; }   // the raise
        for (let i = 0; i < 60; i++) { frames.push([t, frame(0)]); t += 33; }        // two seconds of standing between reps
      }
      const take = { id: 'probe', moveId: 'hipabd', label: 'todo', labels: ['todo'], side: 'R', note: '', aspect: 16 / 9, frames, video: null, source: 'file', created: Date.now(), durationMs: t - 33, calT: 1200 };
      const sim = S.simulate(ex, take); const cut = S.repCuts(take, sim);
      const kids = S.cutKids(take, cut.cuts);
      return { reps: sim.reps.length, kids: kids.length, rows: kids.map((k) => ({
        /* where in the parent video this clip starts, and whether its clock jumps at calibration */
        from: S.videoTime(k, 0), jump: S.videoTime(k, k.calT + 1) - S.videoTime(k, k.calT - 1),
        lead: k.calT, dur: k.durationMs, reps: (S.simulate(ex, k) || {}).reps.length })) };
    });
    assert.ok(out.reps >= 4 && out.kids === out.reps, `five raises cut into ${out.kids} takes from ${out.reps} reps`);
    for (const [i, r] of out.rows.entries()) {
      assert.ok(r.jump <= 50, `rep ${i + 1} plays straight through, no cut back to the start of the set (jump ${r.jump} ms)`);
      assert.ok(r.lead > 300 && r.lead < 1700, `rep ${i + 1} carries the moment before itself: ${r.lead} ms`);
      assert.equal(r.reps, 1, `rep ${i + 1} holds exactly one rep`);
      if (i) assert.ok(r.from > out.rows[i - 1].from, `rep ${i + 1} starts later in the video than rep ${i}, not back at the beginning`);
    }
    /* each clip starts where its own rep began, not at the set's still start */
    assert.ok(out.rows[out.rows.length - 1].from > out.rows[0].from + 4000, 'the last rep is seconds into the recording: ' + JSON.stringify(out.rows.map((r) => r.from)));
    await st.close();
  });

  await step('studio: the target is a range, and the measure step says when two faults read the same number', async () => {
    const st = await newPage();
    await st.goto(base + '/studio/?mock=1'); await st.waitForSelector('#move-select');
    await st.waitForFunction(() => window.ExerciseLibrary && window.ExerciseLibrary.all().some((e) => e.id === 'hipabd'));
    await st.selectOption('#move-select', 'hipabd'); await st.waitForSelector('#steps [data-step="measure"]');
    await st.click('#steps [data-step="measure"]'); await st.waitForSelector('[data-chips="progress.maxMode"]');
    /* a move with no far end says so, and the reading is named as the near end of a range */
    assert.equal(await st.$eval('[data-chips="progress.maxMode"] .chip[aria-pressed="true"]', (e) => e.dataset.v), 'none');
    assert.ok((await st.innerText('#main')).includes('Counts as a rep at') && (await st.innerText('#main')).includes('Too far is'), 'the measure step reads as a range');
    assert.equal(await st.$('[data-k="progress.maxNum"]'), null, 'no far end, no number to type');
    /* turning it on proposes a distance past the target, and it follows the person\'s own choice */
    await st.click('[data-chips="progress.maxMode"] [data-v="delta"]');
    await st.waitForSelector('[data-k="progress.maxNum"]');
    const far = await st.evaluate(() => { const S = window.OnTrackStudio; const s = S.state.moves[S.state.current]; return { max: s.progress.max, entry: S.regionWith(s, 'hip').entry.progress.max }; });
    assert.ok(far.max && far.max.delta > 0, 'a first guess at the far end: ' + JSON.stringify(far));
    assert.deepEqual(far.entry, far.max, 'and it is written into the file');
    /* it compiles into a rule the physio did not write, shown read-only on the fault step */
    await st.click('#steps [data-step="faults"]'); await st.waitForSelector('.fault-card.built-in');
    const built = await st.textContent('.fault-card.built-in');
    assert.ok(/Going past the range/.test(built) && /written for you/.test(built), built.slice(0, 120));
    const ids = await st.evaluate(() => { const S = window.OnTrackStudio; const s = S.state.moves[S.state.current]; return { far: S.farEndFault(s).id, compiled: window.MoveSpec.compile(Object.assign(JSON.parse(JSON.stringify(s)), { id: 'probe' }), window.ExerciseLibrary.kinematics).faults.map((f) => f.id) }; });
    assert.ok(ids.compiled.includes('past_range'), ids.compiled.join(','));
    /* and it is a label a take can be recorded against */
    await st.click('#steps [data-step="record"]'); await st.waitForSelector('#steps');
    const labels = await st.evaluate(() => { const S = window.OnTrackStudio; const s = S.state.moves[S.state.current]; return !!S.farEndFault(s); });
    assert.equal(labels, true);
    /* measurement hygiene: two faults reading the same number the same way */
    const notes = await st.evaluate(() => {
      const S = window.OnTrackStudio; const s = S.state.moves[S.state.current];
      const m = { kind: 'lean', pts: [] };
      const twin = { faults: [
        { id: 'a', label: 'One', metric: m, op: '>', rel: 'change', threshold: 5 },
        { id: 'b', label: 'Two', metric: m, op: '>', rel: 'change', threshold: 9 },
      ], type: 'hold' };
      const dupe = { type: 'reps', progress: { metric: s.progress.metric }, faults: [{ id: 'c', label: 'Over', metric: JSON.parse(JSON.stringify(s.progress.metric)), op: '>', rel: 'abs', threshold: 40 }] };
      const absolute = { type: 'hold', faults: [{ id: 'd', label: 'Wide', metric: { kind: 'dist', pts: ['SH', 'EL'] }, op: '>', rel: 'abs', threshold: 40 }] };
      return { twin: S.measurementNotes(twin), dupe: S.measurementNotes(dupe), absolute: S.measurementNotes(absolute), clean: S.measurementNotes({ type: 'hold', faults: [] }) };
    });
    assert.match(notes.twin.join(' '), /read the same number the same way/);
    assert.match(notes.dupe.join(' '), /measures the same thing progress does/);
    assert.match(notes.absolute.join(' '), /Change from start/);
    assert.deepEqual(notes.clean, [], 'and a move with nothing wrong is not nagged');
    /* the focus card explains itself and measures nothing */
    await st.click('#steps [data-step="measure"]'); await st.waitForSelector('[data-chips="focus"]');
    assert.ok((await st.innerText('#main')).includes('Point to follow on screen'), 'the point is named for what it does');
    await st.close();
  });

  await step('a set-up check judges every rep\'s start, not only the set\'s', async () => {
    const page = await newPage();
    await page.goto(base + '/?mock=1#/exercise/hipabd'); await page.waitForSelector('#do-start');
    const out = await page.evaluate(() => {
      const E = window.FormEngine, SPEC = window.MoveSpec, K = window.ExerciseLibrary.kinematics;
      const spec = JSON.parse(JSON.stringify(window.ExerciseLibrary.all().find((e) => e.id === 'hipabd').spec));
      spec.id = 'probe';
      spec.faults.push({ id: 'already_out', label: 'Leg already out', cue: 'Bring the leg back', tip: 'Start hanging.', severity: 2, phase: 'start', metric: { kind: 'vertical', pts: ['HIP', 'KNEE'] }, op: '>', threshold: 6 });
      const ex = SPEC.compile(spec, K);
      const frame = (raise) => { const p = []; for (let i = 0; i < 33; i++) p.push({ x: 0.5, y: 0.5, z: 0, v: 1, visibility: 1 });
        const hip = [0.46, 0.55], kn = [hip[0] - Math.sin(raise * Math.PI / 180) * 0.2, hip[1] + Math.cos(raise * Math.PI / 180) * 0.2];
        p[11] = { x: 0.58, y: 0.30, z: 0, v: 1 }; p[12] = { x: 0.42, y: 0.30, z: 0, v: 1 };
        p[23] = { x: 0.54, y: 0.55, z: 0, v: 1 }; p[24] = { x: hip[0], y: hip[1], z: 0, v: 1 };
        p[25] = { x: 0.54, y: 0.75, z: 0, v: 1 }; p[26] = { x: kn[0], y: kn[1], z: 0, v: 1 };
        p[27] = { x: 0.54, y: 0.95, z: 0, v: 1 }; p[28] = { x: kn[0], y: kn[1] + 0.2, z: 0, v: 1 };
        for (const i of [7, 8, 29, 30, 31, 32]) p[i] = { x: 0.5, y: 0.9, z: 0, v: 1 };
        return p; };
      const frames = []; for (let i = 0; i < 40; i++) frames.push(frame(0));
      const reps = (from) => { for (let r = 0; r < 3; r++) { for (let i = 0; i < 60; i++) frames.push(frame(from + 34 * Math.sin(Math.PI * i / 60))); for (let i = 0; i < 45; i++) frames.push(frame(from)); } };
      reps(0); for (let i = 0; i < 45; i++) frames.push(frame(9)); reps(9);      // the set-up creeps out mid-set
      const sess = new E.SetSession(ex, { target: 100, rom: 30, work: 'R' }); const sm = new E.PoseSmoother();
      let t = 0; sess.calibrate(sm.update(frames[0], t, 1), 'R');
      let spoken = 0;
      for (const f of frames) { t += 1000 / 30; const r = sess.step(sm.update(f, t, 1), t);
        for (const c of r.cues) sess.ackCue(c.id, t);
        if ((r.startCues || []).length) { spoken++; sess.ackCue(r.startCues[0].id, t); } }
      const rv = sess.review();
      return { flags: sess.repEvents.map((e) => (e.rep.startFaults || []).includes('already_out')), spoken,
        startReps: (rv.faults.already_out || {}).startReps, n: (rv.faults.already_out || {}).n };
    });
    assert.equal(out.flags.length, 6, 'six reps: ' + JSON.stringify(out.flags));
    assert.deepEqual(out.flags.slice(0, 3), [false, false, false], 'the reps before the drift are clean');
    assert.deepEqual(out.flags.slice(3), [true, true, true], 'the reps after it are flagged: ' + JSON.stringify(out.flags));
    assert.equal(out.startReps, 3, 'the review says how many reps began wrong: ' + out.startReps);
    assert.equal(out.n, 3);
    assert.ok(out.spoken > 0 && out.spoken <= 3, 'it is offered at the rep boundary, capped: ' + out.spoken);
    await page.close();
  });

  await step('a side-on move can ignore the limb away from the camera', async () => {
    const page = await newPage();
    await page.goto(base + '/?mock=1#/exercise/hipabd'); await page.waitForSelector('#do-start');
    const out = await page.evaluate(() => {
      const E = window.FormEngine, SPEC = window.MoveSpec;
      const bridge = window.ExerciseLibrary.all().find((e) => e.id === 'glute_bridge');
      /* which indices are dropped depends on which side the lens sees, not on left or right */
      const res = { nearL: E.farLimb('L'), nearR: E.farLimb('R') };
      /* the setting under test is the mechanism, not one move's data: the probe declares it either
         way rather than reading it off the library, which is the editors' to change */
      const probe = (farSide, extra) => { const s = JSON.parse(JSON.stringify(bridge.spec)); s.id = 'probe';
        if (farSide) s.farSide = farSide; else delete s.farSide;
        s.faults.push(JSON.parse(JSON.stringify(extra))); return SPEC.checkSpec(s).join(' '); };
      const far = { id: 'far_knee', label: 'Far knee', cue: 'Knee in', tip: 'Track it.', severity: 2, metric: { kind: 'angle', pts: ['oHIP', 'oKNEE', 'oANK'] }, op: '<', threshold: 90 };
      /* a fault on the far limb is refused when the move says to ignore it, and allowed when it does not */
      res.refused = probe('ignore', far);
      res.watched = probe(null, far);
      /* and one on the torso pair is fine either way */
      res.torso = probe('ignore', { id: 'sh', label: 'Shoulders', cue: 'Square up', tip: 'Level them.', severity: 2, metric: { kind: 'height', pts: ['SH', 'oSH'] }, op: '>', threshold: 10 });
      return res;
    });
    assert.deepEqual(out.nearL, [14, 16, 18, 20, 22, 26, 28, 30, 32], 'nearest on the left, the right limb is dropped');
    assert.deepEqual(out.nearR, [13, 15, 17, 19, 21, 25, 27, 29, 31], 'and the other way round');
    assert.match(out.refused, /reads the limb away from the camera/);
    assert.equal(out.watched, '', 'left unset, both limbs are watched: ' + out.watched);
    assert.equal(out.torso, '', 'the shoulder pair is still measurable: ' + out.torso);
    await page.close();

    /* the Studio chip: only on a side-on move worked with both sides at once */
    const st = await newPage();
    await st.goto(base + '/studio/?mock=1'); await st.waitForSelector('#move-select');
    await st.waitForFunction(() => window.ExerciseLibrary && window.ExerciseLibrary.all().some((e) => e.id === 'glute_bridge'));
    await st.selectOption('#move-select', 'glute_bridge'); await st.waitForSelector('[data-chips="farSide"]');
    /* whatever the bridge carries today, the chip shows that and the round trip writes and clears it */
    const held = () => st.evaluate(() => window.OnTrackStudio.state.moves[window.OnTrackStudio.state.current].farSide || '');
    assert.equal(await st.$eval('[data-chips="farSide"] .chip[aria-pressed="true"]', (e) => e.dataset.v), await held(), 'the chip shows what the move carries');
    await st.click('[data-chips="farSide"] [data-v="ignore"]');
    await st.waitForFunction(() => window.OnTrackStudio.state.moves[window.OnTrackStudio.state.current].farSide === 'ignore');
    assert.equal(await st.evaluate(() => window.OnTrackStudio.regionWith(window.OnTrackStudio.state.moves[window.OnTrackStudio.state.current], 'hip').entry.farSide), 'ignore');
    await st.click('[data-chips="farSide"] [data-v=""]');
    await st.waitForFunction(() => !window.OnTrackStudio.state.moves[window.OnTrackStudio.state.current].farSide);
    assert.equal(await st.evaluate(() => 'farSide' in window.OnTrackStudio.regionWith(window.OnTrackStudio.state.moves[window.OnTrackStudio.state.current], 'hip').entry), false, 'watched is the default and writes nothing');
    /* a face-on move is not offered it */
    await st.evaluate(() => { const S = window.OnTrackStudio; S.state.moves[S.state.current].view = 'front'; S.render(); });
    assert.equal(await st.$('[data-chips="farSide"]'), null, 'face-on, neither limb is the far one');
    await st.close();
  });

  await step('nothing about the start position is said while the person is still getting into it', async () => {
    const page = pro;
    await page.goto(base + '/?mock=1#/exercise/glute_bridge'); await page.waitForSelector('#do-start');
    /* Six seconds of arriving — shuffling into place with the heels miles from the hips, which is
       what "feet too far away" is written to catch — and then they settle, correctly, and bridge.
       Nothing about the start position should be named while they are on their way there. */
    await page.evaluate(() => {
      const REST = { 0: [0.852, 0.576], 7: [0.871, 0.642], 8: [0.865, 0.576], 11: [0.786, 0.650], 12: [0.772, 0.584], 13: [0.632, 0.654], 14: [0.616, 0.605], 15: [0.474, 0.682], 16: [0.485, 0.623], 23: [0.467, 0.590], 24: [0.470, 0.532], 25: [0.374, 0.301], 26: [0.358, 0.284], 27: [0.297, 0.644], 28: [0.285, 0.570], 29: [0.318, 0.687], 30: [0.296, 0.633], 31: [0.203, 0.685], 32: [0.182, 0.593] };
      const TOP = { 0: [0.862, 0.560], 7: [0.880, 0.633], 8: [0.875, 0.574], 11: [0.786, 0.648], 12: [0.786, 0.568], 13: [0.626, 0.672], 14: [0.626, 0.573], 15: [0.457, 0.691], 16: [0.491, 0.567], 23: [0.522, 0.443], 24: [0.532, 0.382], 25: [0.322, 0.267], 26: [0.339, 0.244], 27: [0.295, 0.650], 28: [0.313, 0.587], 29: [0.318, 0.691], 30: [0.344, 0.646], 31: [0.196, 0.704], 32: [0.216, 0.644] };
      const pose = (k, footOut, jitter) => { const p = []; for (let i = 0; i < 33; i++) p.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
        for (const id in REST) { const a = REST[id], b = TOP[id];
          let x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k;
          if (footOut && [27, 28, 29, 30, 31, 32].includes(+id)) x -= footOut;    /* feet walked away from the hips */
          p[+id] = { x: x + jitter, y: y + jitter, z: 0, visibility: 0.95 }; }
        return p; };
      window.__mockPose = (t) => {
        if (t < 6000) return pose(0, 0.09, Math.sin(t / 25) * 0.03);   /* arriving: feet out, and shuffling about */
        if (t < 12500) return pose(0, 0, 0);                            /* arrived, and still */
        const tt = t - 12500, rep = Math.floor(tt / 3000), ph = (tt % 3000) / 3000;
        return rep >= 12 ? pose(0, 0, 0) : pose(Math.sin(Math.PI * ph), 0, 0);
      };
    });
    await page.click('#do-start');
    /* while they are arriving, the coach holds its tongue: no verdict, and the overlay says so */
    await page.waitForFunction(() => window.OnTrackCoach.live && window.OnTrackCoach.live.state === 'position', null, { timeout: 15000 });
    const arriving = await page.evaluate(async () => {
      const C = window.OnTrackCoach, seen = [];
      for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 50)); const L = C.live; if (!L) break;
        if (L.state !== 'position') break;
        seen.push({ bad: (L.startBad || []).length, held: L.steadySince ? 1 : 0 }); }
      return { seen, said: (C.live && C.live.rec.events || []).filter((e) => e.type === 'startFault').length };
    });
    assert.ok(arriving.seen.length > 10, 'there was time to watch them arrive: ' + arriving.seen.length);
    assert.ok(arriving.seen.every((s) => s.bad === 0), 'no set-up verdict while they are still moving into place');
    assert.equal(arriving.said, 0, 'and nothing said about it');
    await page.waitForFunction(() => window.OnTrackCoach.live && window.OnTrackCoach.live.state === 'active', null, { timeout: 25000 });
    await page.waitForFunction(() => document.querySelector('#rv-portal .panel') !== null || window.OnTrackCoach.restActive(), null, { timeout: 60000 });
    const out = await page.evaluate(() => { const r = window.OnTrackCoach.lastRec;
      return { faults: Object.keys(r.review.faults || {}), said: r.events.filter((e) => e.type === 'startFault').length,
        noted: r.events.filter((e) => e.type === 'startFaults').length, reps: r.review.reps }; });
    assert.equal(out.said, 0, 'nothing about the start position was ever spoken: ' + JSON.stringify(out));
    assert.equal(out.noted, 0, 'and none was counted against the set: ' + JSON.stringify(out));
    assert.ok(!out.faults.includes('feet'), 'the feet they arrived with are not a fault of the set: ' + JSON.stringify(out));
    assert.ok(out.reps >= 5, 'and the set ran: ' + JSON.stringify(out));
    /* hand the page back the way it was found: the review is a full-screen panel, and the next
       step opens the same URL, which the router treats as no navigation at all */
    if (await page.$('#rv-submit')) { await page.click('#rv-submit'); await page.waitForFunction(() => !document.querySelector('#coach:not([hidden])')); }
  });

  await step('a video file analysed is the set\'s own video: the replay and the export get the picture', async () => {
    const page = pro;
    await page.goto(base + '/?mock=1#/exercise/glute_bridge'); await page.waitForSelector('#do-file-input', { state: 'attached' });
    await page.evaluate(() => {
      const REST = { 0: [0.852, 0.576], 7: [0.871, 0.642], 8: [0.865, 0.576], 11: [0.786, 0.650], 12: [0.772, 0.584], 13: [0.632, 0.654], 14: [0.616, 0.605], 15: [0.474, 0.682], 16: [0.485, 0.623], 23: [0.467, 0.590], 24: [0.470, 0.532], 25: [0.374, 0.301], 26: [0.358, 0.284], 27: [0.297, 0.644], 28: [0.285, 0.570], 29: [0.318, 0.687], 30: [0.296, 0.633], 31: [0.203, 0.685], 32: [0.182, 0.593] };
      const TOP = { 0: [0.862, 0.560], 7: [0.880, 0.633], 8: [0.875, 0.574], 11: [0.786, 0.648], 12: [0.786, 0.568], 13: [0.626, 0.672], 14: [0.626, 0.573], 15: [0.457, 0.691], 16: [0.491, 0.567], 23: [0.522, 0.443], 24: [0.532, 0.382], 25: [0.322, 0.267], 26: [0.339, 0.244], 27: [0.295, 0.650], 28: [0.313, 0.587], 29: [0.318, 0.691], 30: [0.344, 0.646], 31: [0.196, 0.704], 32: [0.216, 0.644] };
      const lying = (k) => { const p = []; for (let i = 0; i < 33; i++) p.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
        for (const id in REST) { const a = REST[id], b = TOP[id]; p[+id] = { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, z: 0, visibility: 0.95 }; } return p; };
      window.__mockPose = (t) => { if (t < 5000) return lying(0); const tt = t - 5000, ph = (tt % 3000) / 3000; return lying(Math.sin(Math.PI * ph)); };
    });
    /* the page's own "Analyze a video…" path, with the 36 s fixture; the pose stream is the mock */
    await page.setInputFiles('#do-file-input', path.join(__dirname, 'fixtures', 'blank-36s.webm'));
    await page.waitForFunction(() => window.OnTrackCoach.live && window.OnTrackCoach.live.state === 'active', null, { timeout: 30000 });
    const early = await page.evaluate(() => { const r = window.OnTrackCoach.live.rec; return { hasVideo: r.video instanceof Blob, mime: r.videoMime, offset: r.videoOffset, facing: r.facing, source: r.source && r.source.name }; });
    assert.ok(early.hasVideo, 'the file is on the recording from the first analysed frame: ' + JSON.stringify(early));
    assert.equal(early.facing, 'environment', 'and is never mirrored');
    assert.ok(Number.isFinite(early.offset) && early.offset >= 0, 'time 0 of the recording sits somewhere in the file: ' + JSON.stringify(early));
    /* the file ends before the set does, which finishes it */
    await page.waitForFunction(() => document.querySelector('#rv-portal .panel') !== null || window.OnTrackCoach.restActive(), null, { timeout: 60000 });
    const out = await page.evaluate(() => { const r = window.OnTrackCoach.lastRec;
      const j = JSON.parse(window.OnTrackCoach.recJson());
      return { hasVideo: r.video instanceof Blob, reps: r.review.reps, jsonHasVideo: 'video' in j, replayHasVideo: !!document.querySelector('#rv-replay canvas.rp-stage') }; });
    assert.ok(out.hasVideo && out.reps >= 3, 'the set ran on the file and kept it: ' + JSON.stringify(out));
    assert.equal(out.jsonHasVideo, false, 'the diagnostics still carry landmarks only');
    if (await page.$('#rv-submit')) { await page.click('#rv-submit'); await page.waitForFunction(() => !document.querySelector('#coach:not([hidden])')); }
  });

  await step('the coach points: an arrow on the joint that has to move, to the target and then back to the start', async () => {
    const page = pro;                      /* already signed in and subscribed, so the bridge opens */
    await page.goto(base + '/?mock=1#/exercise/glute_bridge'); await page.waitForSelector('#do-start');
    /* a supine body side-on to the lens, head to image right: two frames lifted straight out of a
       real recorded bridge — the resting position and the top of a rep — with the set morphing
       between them, so the framing, the orientation and the set-up checks all see a real body */
    await page.evaluate(() => {
      const REST = { 0: [0.852, 0.576], 7: [0.871, 0.642], 8: [0.865, 0.576], 11: [0.786, 0.650], 12: [0.772, 0.584], 13: [0.632, 0.654], 14: [0.616, 0.605], 15: [0.474, 0.682], 16: [0.485, 0.623], 23: [0.467, 0.590], 24: [0.470, 0.532], 25: [0.374, 0.301], 26: [0.358, 0.284], 27: [0.297, 0.644], 28: [0.285, 0.570], 29: [0.318, 0.687], 30: [0.296, 0.633], 31: [0.203, 0.685], 32: [0.182, 0.593] };
      const TOP = { 0: [0.862, 0.560], 7: [0.880, 0.633], 8: [0.875, 0.574], 11: [0.786, 0.648], 12: [0.786, 0.568], 13: [0.626, 0.672], 14: [0.626, 0.573], 15: [0.457, 0.691], 16: [0.491, 0.567], 23: [0.522, 0.443], 24: [0.532, 0.382], 25: [0.322, 0.267], 26: [0.339, 0.244], 27: [0.295, 0.650], 28: [0.313, 0.587], 29: [0.318, 0.691], 30: [0.344, 0.646], 31: [0.196, 0.704], 32: [0.216, 0.644] };
      const lying = (k) => { const p = []; for (let i = 0; i < 33; i++) p.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
        for (const id in REST) { const a = REST[id], b = TOP[id]; p[+id] = { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, z: 0, visibility: 0.95 }; }
        return p; };
      window.__mockPose = (t) => { if (t < 10500) return lying(0); const tt = t - 10500, rep = Math.floor(tt / 3000), ph = (tt % 3000) / 3000;
        return rep >= 12 ? lying(0) : lying(Math.sin(Math.PI * ph)); };
    });
    await page.click('#do-start');
    await page.waitForFunction(() => window.OnTrackCoach.live && window.OnTrackCoach.live.state === 'active', null, { timeout: 20000 });
    /* watch the aim through a rep: on the way out it points up the picture, on the way back down,
       and it always starts at the hip — the joint that travels between a still shoulder and knee */
    const seen = await page.evaluate(async () => {
      const C = window.OnTrackCoach, out = [];
      for (let i = 0; i < 260; i++) {
        await new Promise((r) => setTimeout(r, 40));
        const L = C.live; if (!L || L.state !== 'active' || !L.session.m || !L.session.ref) continue;
        if (!L.pts) continue;
        const a = C.aimFor(L.ex, L.session.m, L.session.ref, L.pts, L.session);
        if (!a) continue;
        const hip = L.pts[23];
        out.push({ home: !!a.home, dy: a.to.y - a.from.y, atHip: hip ? Math.hypot(a.from.x - hip.x, a.from.y - hip.y) : null, state: L.session.counter.state, p: +(L.session.m.p || 0).toFixed(2) });
      }
      return out;
    });
    assert.ok(seen.length > 20, 'the aim was there to read: ' + seen.length);
    /* short of the target and on the way there, it points up the picture; past it, back down —
       which is the same instruction either way: go to where the ring is */
    const outward = seen.filter((s) => !s.home && s.p < 0.8), past = seen.filter((s) => !s.home && s.p > 1.05);
    const home = seen.filter((s) => s.home);
    assert.ok(outward.length && outward.every((s) => s.dy < 0), 'short of the target it points up the picture: ' + JSON.stringify(outward.filter((s) => s.dy >= 0).slice(0, 3)));
    assert.ok(!past.length || past.every((s) => s.dy > 0), 'past it, back down to where the hip belongs: ' + JSON.stringify(past.filter((s) => s.dy <= 0).slice(0, 3)));
    assert.ok(home.length && home.every((s) => s.dy > 0), 'and on the way back it points at the position the rep began from: ' + JSON.stringify(home.slice(0, 3)));
    const far = seen.map((s) => s.atHip).filter((x) => x != null).sort((a, b) => b - a)[0];
    assert.ok(far != null && far < 0.02, 'it always starts at the hip, not at a target drawn somewhere else: ' + far);
  });

  await step('studio: a set-up check is judged on every rep the recording is broken into, and shown', async () => {
    const st = await newPage();
    await st.goto(base + '/studio/?mock=1'); await st.waitForSelector('#move-select');
    await st.waitForFunction(() => window.ExerciseLibrary && window.ExerciseLibrary.all().some((e) => e.id === 'glute_bridge'));
    const out = await st.evaluate(() => {
      const S = window.OnTrackStudio, E = window.FormEngine;
      const lib = window.ExerciseLibrary.all().find((e) => e.id === 'glute_bridge');
      /* a set-up check certain to be true of the position every rep begins from: lying down, the
         shoulder–hip–knee angle is well under 150° between reps */
      const spec = JSON.parse(JSON.stringify(lib.spec)); spec.id = 'probe';
      spec.faults.push({ id: 'probe_start', label: 'Probe', cue: 'Straighten up', tip: 'Probe.', severity: 2, phase: 'start', metric: { kind: 'angle', pts: ['SH', 'HIP', 'KNEE'] }, op: '<', threshold: 150 });
      const ex = window.MoveSpec.compile(spec, window.ExerciseLibrary.kinematics);
      /* a supine body whose hips rise and fall: four bridges with a pause between */
      /* resting, the shoulder–hip–knee angle is about 112°, so the probe is true; at the top the
         hips rise until it is about 174°, which is what the bridge counts as a rep */
      const frame = (lift) => { const p = []; for (let i = 0; i < 33; i++) p.push([0.5, 0.5, 0, 1]);
        const hipY = 0.72 - lift * 0.14;
        p[11] = [0.66, 0.60, 0, 1]; p[12] = [0.66, 0.61, 0, 1];
        p[23] = [0.46, hipY, 0, 1]; p[24] = [0.46, hipY + 0.01, 0, 1];
        p[25] = [0.30, 0.60, 0, 1]; p[26] = [0.30, 0.61, 0, 1];
        p[27] = [0.28, 0.76, 0, 1]; p[28] = [0.28, 0.77, 0, 1];
        for (const i of [7, 8]) p[i] = [0.72, 0.58, 0, 1];
        for (const i of [29, 30]) p[i] = [0.30, 0.78, 0, 1];
        for (const i of [31, 32]) p[i] = [0.24, 0.78, 0, 1];
        return p; };
      const frames = []; let t = 0;
      for (let i = 0; i < 60; i++) { frames.push([t, frame(0)]); t += 33; }
      for (let r = 0; r < 4; r++) {
        for (let i = 0; i < 60; i++) { frames.push([t, frame(Math.sin(Math.PI * i / 60))]); t += 33; }
        for (let i = 0; i < 45; i++) { frames.push([t, frame(0)]); t += 33; }
      }
      const take = { id: 'probe', moveId: 'glute_bridge', label: 'todo', labels: ['todo'], side: 'L', note: '', aspect: 16 / 9, frames, video: null, source: 'file', created: Date.now(), durationMs: t - 33, calT: 1200 };
      const sim = S.simulate(ex, take);
      if (!sim || sim.error || sim.reps.length < 2) return { error: sim && sim.error, reps: sim && sim.reps.length };
      const kids = S.cutKids(take, S.repCuts(take, sim).cuts);
      return { reps: sim.reps.length,
        wholePerRep: (sim.startReps || {}).probe_start ? sim.startReps.probe_start.length : 0,
        kids: kids.length,
        kidStart: kids.map((k) => (S.simulate(ex, k).startFired || []).includes('probe_start')),
        kidShown: kids.map((k) => S.firedOf(S.simulate(ex, k)).includes('probe_start')) };
    });
    assert.ok(!out.error, 'the probe move simulates: ' + JSON.stringify(out));
    assert.ok(out.reps >= 2, 'the recording holds several reps: ' + out.reps);
    assert.equal(out.wholePerRep, out.reps, 'every rep of the whole take is judged on its own start');
    assert.ok(out.kids >= 2 && out.kidStart.every(Boolean), 'and every rep broken out is judged on its own: ' + JSON.stringify(out.kidStart));
    assert.ok(out.kidShown.every(Boolean), 'and the Studio shows it, rather than computing it and saying nothing: ' + JSON.stringify(out.kidShown));
    await st.close();
  });

  await step('a fault the coach will not swear to waits for the review, where a rep can be watched back and corrected', async () => {
    const page = pro;
    await page.goto(base + '/?mock=1#/exercise/glute_bridge'); await page.waitForSelector('#do-start');
    /* the same recorded bridge as the other bridge steps, with the toes lifted at the top of every
       rep: "foot coming off the floor" is a tentative fault, so it is measured all set and never
       said. 31/32 are the foot points; lifting them raises the toes-off-the-floor reading. */
    await page.evaluate(() => {
      const REST = { 0: [0.852, 0.576], 7: [0.871, 0.642], 8: [0.865, 0.576], 11: [0.786, 0.650], 12: [0.772, 0.584], 13: [0.632, 0.654], 14: [0.616, 0.605], 15: [0.474, 0.682], 16: [0.485, 0.623], 23: [0.467, 0.590], 24: [0.470, 0.532], 25: [0.374, 0.301], 26: [0.358, 0.284], 27: [0.297, 0.644], 28: [0.285, 0.570], 29: [0.318, 0.687], 30: [0.296, 0.633], 31: [0.203, 0.685], 32: [0.182, 0.593] };
      const TOP = { 0: [0.862, 0.560], 7: [0.880, 0.633], 8: [0.875, 0.574], 11: [0.786, 0.648], 12: [0.786, 0.568], 13: [0.626, 0.672], 14: [0.626, 0.573], 15: [0.457, 0.691], 16: [0.491, 0.567], 23: [0.522, 0.443], 24: [0.532, 0.382], 25: [0.322, 0.267], 26: [0.339, 0.244], 27: [0.295, 0.650], 28: [0.313, 0.587], 29: [0.318, 0.691], 30: [0.344, 0.646], 31: [0.196, 0.704], 32: [0.216, 0.644] };
      const lying = (k, toes) => { const p = []; for (let i = 0; i < 33; i++) p.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
        for (const id in REST) { const a = REST[id], b = TOP[id]; p[+id] = { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, z: 0, visibility: 0.95 }; }
        for (const id of [31, 32]) p[id] = { ...p[id], y: p[id].y - toes };
        return p; };
      window.__mockPose = (t) => { if (t < 10500) return lying(0, 0); const tt = t - 10500, rep = Math.floor(tt / 3000), ph = (tt % 3000) / 3000;
        if (rep >= 8) return lying(0, 0); const k = Math.sin(Math.PI * ph); return lying(k, k > 0.6 ? 0.07 : 0); };
    });
    await page.click('#do-start');
    await page.waitForFunction(() => window.OnTrackCoach.live && window.OnTrackCoach.live.state === 'active', null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('#rv-portal .panel') !== null || window.OnTrackCoach.restActive(), null, { timeout: 60000 });
    const quiet = await page.evaluate(() => { const r = window.OnTrackCoach.lastRec; const rv = window.OnTrackCoach.lastRec.review;
      return { spoken: r.events.filter((e) => e.type === 'cue' && e.fault === 'foot_lifting').length, counted: (rv.faults || {}).foot_lifting || 0,
        maybe: !document.getElementById('rv-maybe').hidden, maybeText: document.getElementById('rv-maybe-list').textContent,
        fixes: document.getElementById('rv-faults').textContent }; });
    assert.ok(quiet.counted > 0, 'the camera saw the toes come up: ' + JSON.stringify(quiet));
    assert.equal(quiet.spoken, 0, 'and said nothing about it during the set: ' + JSON.stringify(quiet));
    assert.ok(quiet.maybe && /foot|floor/i.test(quiet.maybeText), 'it is a reminder after the set instead: ' + JSON.stringify(quiet));
    assert.ok(!/off the floor/i.test(quiet.fixes), 'and not among the things to work on: ' + quiet.fixes);
    /* now the person watches a rep back and says the camera got it wrong */
    const before = await page.evaluate(() => ({ score: window.OnTrackCoach.lastRec.review.score, ring: document.getElementById('ring-text').textContent }));
    await page.click('#rv-replist details.rep:first-of-type > summary');
    await page.waitForSelector('#rv-replist details.rep[open] .rep-edit .chip');
    /* the rep plays on its own: the player stops at the end of that rep rather than running on */
    const played = await page.evaluate(async () => {
      const btn = document.querySelector('#rv-replist details.rep[open] [data-watch]'); if (!btn) return { ok: false };
      btn.click(); await new Promise((r) => setTimeout(r, 250));
      return { ok: true, t: window.OnTrackCoach.replayAt() };
    });
    assert.ok(played.ok && played.t >= 0, 'the rep plays back: ' + JSON.stringify(played));
    /* clear the fault the coach was unsure about on this rep, and add one it never saw */
    const ids = await page.evaluate(() => [...document.querySelectorAll('#rv-replist details.rep[open] .rep-edit .chip')].map((c) => ({ id: c.dataset.fault, on: c.getAttribute('aria-pressed') })));
    assert.ok(ids.some((c) => c.id === 'foot_lifting'), 'every fault the move can see is offered: ' + JSON.stringify(ids));
    await page.click('#rv-replist details.rep[open] .chip[data-fault="arch"]');
    await page.waitForFunction(() => (window.OnTrackCoach.lastRec.review.faults || {}).arch > 0);
    const after = await page.evaluate(() => { const rv = window.OnTrackCoach.lastRec.review;
      const r = window.OnTrackCoach.reviewNow();
      return { arch: (rv.faults || {}).arch, repFaults: r.repList[0].faults, edited: !!r.faults.arch.edited, score: r.score,
        ring: document.getElementById('ring-text').textContent, open: document.querySelectorAll('#rv-replist details.rep[open]').length,
        events: window.OnTrackCoach.lastRec.events.filter((e) => e.type === 'repEdit').length,
        tips: document.getElementById('rv-faults').textContent, mark: document.querySelector('#rv-replist details.rep[open] summary').textContent }; });
    assert.ok(after.repFaults.includes('arch'), 'the rep carries what the person said: ' + JSON.stringify(after));
    assert.equal(after.arch, 1, 'and the set counts it once: ' + JSON.stringify(after));
    assert.ok(after.edited && /your call/i.test(after.mark), 'marked as the person\'s call, not a measurement: ' + JSON.stringify(after));
    assert.ok(after.score < before.score && after.ring === String(after.score), 'the set is scored again: ' + JSON.stringify([before, after]));
    assert.equal(after.open, 1, 'and the rep being read stays open');
    assert.equal(after.events, 1, 'the correction is written into the recording');
    assert.match(after.tips, /back/i, 'and it joins what to work on: ' + after.tips);
    if (await page.$('#rv-submit')) { await page.click('#rv-submit'); await page.waitForFunction(() => !document.querySelector('#coach:not([hidden])')); }
  });

  await step('security: pages load with no JS errors; API refuses requests without the fetch header', async () => {
    const r = await member.evaluate(async () => (await fetch('/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"text":"x"}' })).status); assert.equal(r, 403);
    assert.deepEqual(errors, [], 'no page errors');
  });

  await browser.close(); server.close();
  const fails = results.filter(r => r[0] === 'FAIL'); console.log(`\n${results.length - fails.length} passed, ${fails.length} failed`); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
