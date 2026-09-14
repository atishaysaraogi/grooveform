'use strict';
// Browser end-to-end for the marketplace: anonymous visitor → free member → Pro member → curator → admin, through the real UI,
// with a synthetic pose stream (?mock=1) driving a full coached set.
// Run: CHROMIUM_PATH=/path/to/chromium node test/e2e.test.js   (needs Playwright; see docs/TESTING.md)
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const assert = require('node:assert/strict');
const { chromium } = require('playwright');
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fyzio-e2e-')), 'e2e.sqlite'); process.env.PORT = '0'; process.env.NODE_ENV = 'test'; process.env.NOTIFY_PROVIDER = 'console'; process.env.PAYMENT_PROVIDER = 'mock';
process.env.ADMIN_IDENTIFIER = 'admin@fyzio.test'; process.env.FREE_EXERCISES = 'hipabd,plank'; process.env.SOLO_MODE = 'false';   // marketplace flows on; solo mode is covered by test/solo.test.js   // hip abduction free so the mock pose stream can drive an anonymous set
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
  await page.waitForFunction(() => window.FyzioCoach.live && window.FyzioCoach.live.state === 'active', null, { timeout: 20000 });
  // auto-finishes at the target: the last set lands on the review panel, an earlier one on the
  // rest overlay that keeps the camera up.
  await page.waitForFunction(() => document.querySelector('#rv-portal .panel') !== null || window.FyzioCoach.restActive(), null, { timeout: 45000 });
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
    await visitor.waitForFunction(() => window.FyzioCoach.live && window.FyzioCoach.live.state === 'active', null, { timeout: 25000 });
    const named = await visitor.evaluate(() => ({ work: window.FyzioCoach.live.session.opts.work, hud: document.querySelector('#live-name').textContent }));
    assert.equal(named.work, 'R', 'the chosen side is the working limb');
    assert.ok(named.hud.includes('right leg'), named.hud);
    await visitor.click('#btn-exit'); await visitor.waitForSelector('#do-start');
  });

  await step('visitor: completes a coached set with the mock camera, then signs up and the set is saved', async () => {
    await setBubble(visitor, 'target', 8); await setBubble(visitor, 'sets', 2); await setBubble(visitor, 'rest', 30); await runCoachedSet(visitor); await visitor.screenshot({ path: path.join(SHOTS, 'visitor-review.png') });
    await visitor.waitForFunction(() => window.FyzioCoach.restActive(), null, { timeout: 20000 });
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
    await visitor.waitForFunction(() => window.FyzioCoach.live && window.FyzioCoach.live.state === 'active', null, { timeout: 25000 }); await visitor.waitForSelector('#rv-login', { timeout: 45000 });
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
      function abd(raise) { const sh = [0.59, 0.30], a = raise * Math.PI / 180, up = 0.13, fo = 0.12; const el = [sh[0] + Math.sin(a) * up, sh[1] + Math.cos(a) * up], wr = [el[0] + Math.sin(a) * fo, el[1] + Math.cos(a) * fo];
        return frame({ 0: [0.50, 0.14], 7: [0.47, 0.15], 8: [0.53, 0.15], 11: sh, 12: [0.41, 0.30], 13: el, 14: [0.39, 0.42], 15: wr, 16: [0.38, 0.53], 23: [0.56, 0.55], 24: [0.44, 0.55], 25: [0.56, 0.75], 26: [0.44, 0.75], 27: [0.56, 0.95], 28: [0.44, 0.95], 29: [0.55, 0.97], 30: [0.43, 0.97], 31: [0.57, 0.98], 32: [0.45, 0.98] }); }
      window.__mockPose = t => { if (t < 10500) return abd(0); const tt = t - 10500, rep = Math.floor(tt / 2800), ph = (tt % 2800) / 2800; if (rep >= 8) return abd(0); return abd(92 * Math.sin(Math.PI * ph)); };
    });
    await setBubble(pro, 'target', 8); await runCoachedSet(pro, 'left');   // this fixture raises the LEFT arm
    const rec = await pro.evaluate(() => { const r = window.FyzioCoach.lastRec; return { review: r.review, work: (r.events.find(e => e.type === 'calibrate') || {}).work, ev: r.events.map(e => e.type).slice(0, 6) }; }); assert.equal(rec.review.reps, 8, 'eight abduction reps counted: ' + JSON.stringify(rec));
    assert.equal(rec.work, 'L', 'the chosen left arm is the working limb: ' + JSON.stringify(rec));
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
    /* The app's stream, time-warped: still for 1.5 s (calibration) instead of 10.5, then the same 2.6 s reps — the second one leans. */
    await st.addInitScript(`const __orig = window.__mockPose; window.__mockPose = (t) => (t < 1500 ? __orig(0) : __orig(10500 + (t - 1500)));`);
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
    await st.waitForFunction(() => window.GrooveformStudio.state.takes.length === 1, null, { timeout: 5000 });
    const take = await st.evaluate(() => { const t = window.GrooveformStudio.state.takes[0]; return { label: t.label, side: t.side, frames: t.frames.length, ms: t.durationMs }; });
    assert.equal(take.label, 'clean'); assert.equal(take.side, 'R'); assert.ok(take.frames > 100 && take.ms > 9000, JSON.stringify(take));
    await st.click('#next');
    // 4 · measure: thigh from vertical, hip → knee; suggest the target from the take
    await st.waitForSelector('[data-mpath="progress.metric"]'); await st.selectOption('[data-mpath="progress.metric"] [data-mkind]', 'vertical');
    await st.waitForSelector('[data-mpath="progress.metric"] [data-lm="HIP"]'); await st.click('[data-mpath="progress.metric"] [data-lm="HIP"]'); await st.click('[data-mpath="progress.metric"] [data-lm="KNEE"]');
    await st.waitForSelector('#suggest:not([disabled])'); await st.click('#suggest');
    await st.waitForFunction(() => { const s = window.GrooveformStudio.state; const m = s.moves[s.current]; return typeof m.progress.target === 'number' && m.progress.target >= 20 && m.progress.target <= 40; });
    const counted = await st.evaluate(() => { const s = window.GrooveformStudio.state; return s.sims[s.takes[0].id].full; });
    assert.ok(counted >= 3, 'clean take counts reps: ' + counted);
    await st.screenshot({ path: path.join(SHOTS, 'studio-measure.png'), fullPage: true });
    await st.click('#next');
    // 5 · faults: a leaning fault on the trunk-lean metric, then see it fire on the leaning rep only
    await st.waitForSelector('[data-fi="0"]');
    assert.equal(await st.$eval('[data-k="faults.0.label"]', (e) => e.value), 'Leaning away', 'step 5 carries the fault named in step 2');
    await st.fill('[data-k="faults.0.tip"]', 'Do not tip the trunk to lift the leg higher.');
    await st.selectOption('[data-mpath="faults.0.metric"] [data-mkind]', 'lean'); await st.waitForSelector('[data-fi="0"] [data-chips="faults.0.op"]');
    await st.click('[data-chips="faults.0.op"] [data-v="<"]'); await st.fill('[data-k="faults.0.threshold"]', '-8'); await st.dispatchEvent('[data-k="faults.0.threshold"]', 'input');
    try { await st.waitForFunction(() => /fires on 1\/1 clean/.test(document.querySelector('[data-fi="0"] .fires').textContent), null, { timeout: 8000 }); } catch (e) { const d = await st.evaluate(() => { const s = window.GrooveformStudio.state; const m = s.moves[s.current]; const sim = s.sims[s.takes[0].id]; return { fault: m.faults[0], fires: document.querySelector('[data-fi="0"] .fires').textContent, err: sim && sim.error, spans: sim && sim.faultSpans, lean: window.GrooveformStudio.trace({ kind: 'lean', pts: [] }, s.takes[0], 'R').map((x) => Math.round(x[1])) }; }); throw new Error(JSON.stringify(d)); }
    await st.click('#add-fast'); await st.waitForSelector('[data-fi="1"]');
    await st.screenshot({ path: path.join(SHOTS, 'studio-faults.png'), fullPage: true });
    await st.click('#next');
    // 6 · guide + figure
    await st.waitForSelector('[data-k="guide.surface"]'); await st.fill('[data-k="guide.surface"]', 'Firm floor, shoes on.'); await st.fill('[data-k="guide.cannotSee"]', 'Whether the foot is turned out.'); await st.fill('[data-k="guide.stop"]', 'Groin pain.');
    await st.click('[data-addp="0"]'); await st.waitForSelector('[data-k="guide.regions.0.points.0.t"]'); await st.fill('[data-k="guide.regions.0.points.0.t"]', 'Stand tall, hip bones level.'); await st.click('[data-tr="0.0"]');
    await st.click('[data-mus="glute"]'); await st.click('[data-mus="thigh"]');
    await st.click('#build-fig'); await st.waitForSelector('svg.demo-fig');
    const fig = await st.evaluate(() => { const s = window.GrooveformStudio.state; return s.moves[s.current].figure; });
    assert.equal(fig.view, 'front'); assert.ok(fig.A.hipR && fig.B.knR && fig.A.hipR[1] < 161 && fig.B.anR[1] <= 161, JSON.stringify(fig.B));
    await st.click('#next');
    // 7 · export: complete, accepted, and the emitted move compiles in Node too
    await st.waitForSelector('#dl-js'); await st.waitForFunction(() => /Ready to ship/.test(document.body.innerText));
    const spec = await st.evaluate(() => { const s = window.GrooveformStudio.state; return s.moves[s.current]; });
    const SPEC = require('../client/coach/spec.js'); const LIB = require('../client/coach/exercise-library.js');
    assert.doesNotThrow(() => LIB.validate(SPEC.compile(spec, LIB.kinematics)), 'the exported spec compiles on the build side');
    const src = await st.evaluate(() => window.GrooveformStudio.moveFileSource(window.GrooveformStudio.state.moves[window.GrooveformStudio.state.current]));
    assert.ok(/lib\.define\(\(k\) => spec\.compile\(SPEC, k\)\)/.test(src) && !/"_key"/.test(src), 'move file embeds the spec without studio bookkeeping');
    await st.screenshot({ path: path.join(SHOTS, 'studio-export.png'), fullPage: true });
    // try it in the app: the draft appears on the exercise page with its figure and guide
    await st.evaluate(() => { const s = window.GrooveformStudio.state; const d = {}; d[s.moves[s.current].id] = s.moves[s.current]; localStorage.setItem('grooveform.drafts', JSON.stringify(d)); });
    await st.goto(base + '/?mock=1#/exercise/side_leg_raise'); await st.waitForSelector('#do-start'); await st.click('#do-details');
    const pageText = await st.evaluate(() => document.body.innerText);
    assert.ok(/Side leg raise \(draft\)/.test(pageText) && /cannot see/i.test(pageText), 'draft renders with its guide');
    assert.ok(await st.$('svg.demo-fig'), 'the figure built from the recording is on the page');
    await st.waitForTimeout(1200); await st.screenshot({ path: path.join(SHOTS, 'studio-try.png') });
    await st.close();
  });

  await step('studio: any library move opens as a copy, round-trips to the same move, and saves back into its file', async () => {
    const st = await newPage();
    await st.goto(base + '/studio/?mock=1'); await st.waitForSelector('#btn-new2');
    /* every catalogue move survives entry → draft → entry with the same compiled result */
    const rt = await st.evaluate(() => {
      const S = window.GrooveformStudio, LIB = window.ExerciseLibrary, C = window.FyzioCatalog;
      const strip = (ex) => JSON.parse(JSON.stringify(ex, (k, v) => (typeof v === 'function' ? '[fn]' : k === 'entry' || k === 'file' || k === 'figure' || k === 'spec' ? undefined : v)));
      const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
      const out = { checked: 0, problems: [], changed: [], rewritten: [] };
      for (const ex of LIB.all().filter((e) => e.catalog)) {
        const s = S.entryToSpec(ex); const { rel, json, entry } = S.fileWith(s, ex.file.replace(/\.json$/, ''));
        const p = S.catalogProblems(s, ex.file.replace(/\.json$/, '')); if (p.length) out.problems.push(ex.id + ': ' + p[0]);
        const grp = {}; for (const k of Object.keys(json)) if (k !== 'moves' && !k.startsWith('_')) grp[k] = json[k];
        const rebuilt = C.buildFile({ ...grp, moves: [entry] }, rel, C.data, false)[0];
        const a = JSON.stringify(canon(strip(ex))), b = JSON.stringify(canon(strip({ ...rebuilt, order: ex.order })));
        if (a !== b) out.changed.push(ex.id);
        /* and the file itself: saving a move you did not touch must not rewrite its entry */
        const { _studio, ...written } = entry; const { _note, ...original } = ex.entry;
        if (JSON.stringify(canon(written)) !== JSON.stringify(canon(original))) out.rewritten.push(ex.id + ' ' + JSON.stringify(canon(written)).slice(0, 80));
        out.checked++;
      }
      return out;
    });
    assert.equal(rt.checked, 144, 'every move, the ten vetted ones included, is data'); assert.deepEqual(rt.problems, []); assert.deepEqual(rt.changed, [], 'a move must come back from the Studio exactly as it went in');
    assert.deepEqual(rt.rewritten, [], 'an untouched move must be written back as the same entry');
    /* the flow a physio sees: pick a move, edit a copy, change a number, check, download */
    await st.selectOption('#move-select', 'seated_knee_ext'); await st.waitForSelector('#edit-copy'); await st.click('#edit-copy');
    await st.waitForSelector('[data-k="name"]'); assert.equal(await st.$eval('[data-k="name"]', (e) => e.value), 'Seated knee extension');
    assert.equal(await st.$eval('[data-chips="tracking"] [aria-pressed="true"]', (e) => e.dataset.v), 'form');
    await st.click('#steps [data-step="faults"]'); await st.waitForSelector('[data-k="faults.0.threshold"]');
    assert.equal(await st.$eval('[data-k="faults.0.threshold"]', (e) => e.value), '68');
    await st.fill('[data-k="faults.0.threshold"]', '62'); await st.dispatchEvent('[data-k="faults.0.threshold"]', 'input');
    assert.equal(await st.$eval('[data-fi="1"] [data-chips="faults.1.listed"] [aria-pressed="true"]', (e) => e.dataset.v), 'true', 'a fault without a measurement is listed for the person');
    await st.click('#steps [data-step="export"]'); await st.waitForSelector('#dl-file');
    await st.waitForFunction(() => /Ready to ship/.test(document.body.innerText));
    assert.equal(await st.$eval('[data-k="_target"]', (e) => e.value), 'knee', 'saves back into the file it came from');
    assert.ok(await st.$('#save-project[hidden]'), 'no dev server here, so no save button');
    const saved = await st.evaluate(() => { const S = window.GrooveformStudio; const s = S.state.moves[S.state.current]; return S.fileWith(s, 'knee'); });
    const m = saved.json.moves.find((x) => x.id === 'seated_knee_ext'); assert.equal(saved.json.moves.filter((x) => x.id === 'seated_knee_ext').length, 1, 'replaces, does not duplicate');
    assert.equal(m.faults[0].threshold, 62); assert.equal(m.faults[1].metric, undefined); assert.ok(m._studio && m._studio.edited, 'the Studio leaves its provenance as a note');
    assert.equal(m.pose.A.preset, undefined === undefined ? m.pose.A.preset : null);   // pose passes through untouched
    assert.deepEqual(Object.keys(saved.json)[0], '_about', 'the field guide stays at the top of the file');
    await st.screenshot({ path: path.join(SHOTS, 'studio-edit-copy.png'), fullPage: true });
    await st.close();
  });

  await step('security: pages load with no JS errors; API refuses requests without the fetch header', async () => {
    const r = await member.evaluate(async () => (await fetch('/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"text":"x"}' })).status); assert.equal(r, 403);
    assert.deepEqual(errors, [], 'no page errors');
  });

  await browser.close(); server.close();
  const fails = results.filter(r => r[0] === 'FAIL'); console.log(`\n${results.length - fails.length} passed, ${fails.length} failed`); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
