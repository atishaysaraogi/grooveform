/* The care page, end to end, against the care server: a physio's browser and a
   patient's, the invitation, the plan, a session driven by the pose stand-in, a rep sent
   for review with its clip, the physio's verdict, the reply, the visit, a report.

   Run: npm run smoke:care   (playwright on NODE_PATH, as for npm run smoke) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { POSE_SRC, SPY_SRC } from './stand-in.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { make } = require('../scripts/care-server.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = [];
const step = async (name, fn) => { try { await fn(); steps.push(true); console.log('ok  -', name); } catch (e) { steps.push(false); console.log('FAIL-', name, '\n     ', e.message); throw e; } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ontrack-care-'));
const log = [];
const S = make({ CARE_DATA: dir, CARE_DEMO_CODE: '123456', CARE_ADMIN_PHONES: '+919000000010', CARE_BASE_URL: '' }, (s) => log.push(s));
await new Promise((r) => S.server.listen(0, r));
const base = `http://127.0.0.1:${S.server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function phone(name) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, permissions: ['camera'] });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ' console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(POSE_SRC); await page.addInitScript(SPY_SRC);
  return page;
}
const physio = await phone('physio'), patient = await phone('patient');
/* a route, as a tap on a link would: a hash that is already the page's is re-entered */
const go = async (page, hash) => { await page.evaluate((h) => { if (location.hash === h) dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h; }, hash); };
const careShown = async (page, re, ms) => {
  try { await page.waitForFunction((r) => !document.getElementById('screen-care').hidden && new RegExp(r, 'i').test(document.getElementById('screen-care').textContent), re, { timeout: ms || 8000 }); }
  catch (e) { const txt = await page.evaluate(() => ({ hash: location.hash, hidden: document.getElementById('screen-care').hidden, text: document.getElementById('screen-care').textContent.replace(/\s+/g, ' ').slice(0, 300) })); throw new Error(`waited for ${re} on the care screen; got ${JSON.stringify(txt)}`); }
};
const signIn = async (page, number) => {
  await go(page, '#/care/signin');
  await page.waitForSelector('#care-phone', { state: 'visible' });
  await page.fill('#care-phone', number); await page.click('#care-send');
  await page.waitForFunction(() => /Code: 123456/.test(document.getElementById('care-signin-note').textContent), null, { timeout: 8000 });
  await page.fill('#care-code', '123456'); await page.click('#care-code-form button[type=submit]');
  await page.waitForFunction(() => /^#\/care\/(profile|$)/.test(location.hash) || location.hash === '#/care', null, { timeout: 8000 });
};
const set = (page, o) => page.evaluate((v) => Object.assign(window.__pose, v), o);

try {
  await step('the care page comes up as the app, with a sign-in panel; a wrong code is refused; the code signs the patient in', async () => {
    await patient.goto(base + '/care.html');
    await patient.waitForSelector('#picker .item');
    assert.equal(await patient.textContent('title'), 'OnTrack Care');
    assert.match(await patient.textContent('#care-home'), /Sign in with your phone number/);
    assert.equal(await patient.evaluate(() => window.__care.api.mode), 'http', 'the server serves its own care-config.js');
    await go(patient, '#/care/signin');
    await patient.waitForSelector('#care-phone', { state: 'visible' });
    await patient.fill('#care-phone', '9000000020'); await patient.click('#care-send');
    await patient.waitForFunction(() => /Code: 123456/.test(document.getElementById('care-signin-note').textContent), null, { timeout: 8000 });
    await patient.fill('#care-code', '000000'); await patient.click('#care-code-form button[type=submit]');
    await patient.waitForFunction(() => /wrong code/.test(document.getElementById('care-code-note').textContent), null, { timeout: 8000 });
    await patient.fill('#care-code', '123456'); await patient.click('#care-code-form button[type=submit]');
    await patient.waitForFunction(() => location.hash === '#/care/profile', null, { timeout: 8000 });
    await patient.fill('#cp-name', 'Sunita'); await patient.fill('#cp-born', '1968'); await patient.fill('#cp-cond', 'knee replacement, left');
    await patient.check('#cp-research');
    await patient.click('#care-profile button[type=submit]');
    await patient.waitForFunction(() => /Saved/.test(document.getElementById('cp-note').textContent), null, { timeout: 8000 });
    await go(patient, '#/care');
    await careShown(patient, /No plan from a physio yet/);
    assert.ok(S.store.data.users && Object.values(S.store.data.users).some((u) => u.name === 'Sunita' && u.born === 1968 && u.consents.research), 'on the server');
  });

  await step('the physio signs in and invites the patient by number; the patient accepts the link', async () => {
    await physio.goto(base + '/care.html');
    await physio.waitForSelector('#picker .item');
    await signIn(physio, '9000000010');
    await physio.fill('#cp-name', 'Dr. Meera'); await physio.fill('#cp-born', '1980'); await physio.click('#care-profile button[type=submit]');
    await physio.waitForFunction(() => /Saved/.test(document.getElementById('cp-note').textContent), null, { timeout: 8000 });
    await go(physio, '#/care');
    await careShown(physio, /Add a patient/);
    await physio.fill('#ca-phone', '9000000020'); await physio.fill('#ca-name', 'Sunita'); await physio.click('#care-add button[type=submit]');
    await physio.waitForFunction(() => /Invitation sent/.test(document.getElementById('ca-out').textContent), null, { timeout: 8000 });
    const url = await physio.$eval('#ca-out a.btn', (a) => a.getAttribute('href'));
    assert.match(url, /care\.html#\/care\/link\/[a-f0-9]+$/, url);
    assert.ok(log.some((l) => /\[outbox sms\] \+919000000020: Dr. Meera wants to add you/.test(l)), 'the invitation went to the outbox: ' + log.join(' | '));
    /* the patient opens the link */
    await patient.goto(base + '/' + url.replace(/^.*care\.html/, 'care.html'));
    await careShown(patient, /Dr. Meera wants to add you/);
    assert.match(await patient.textContent('#screen-care'), /your sessions: counts, holds/);
    await patient.click('#care-accept');
    await careShown(patient, /They will set one/);
    await go(physio, '#/care');
    await careShown(physio, /Sunita/);
    assert.match(await physio.textContent('#screen-care'), /no plan yet/);
  });

  await step('the physio assigns a plan of their own; the patient sees today\'s steps, and the plan says who set it', async () => {
    const pid = Object.values(S.store.data.users).find((u) => u.name === 'Sunita').id;
    await physio.evaluate(() => { Plans.create({ name: 'Smoke plan', items: [{ move: 'kneeraise', sets: 1, reps: 2, hold: 2 }, { move: 'wallsit', sets: 1, hold: 5 }] }); });
    await go(physio, '#/care/patient/' + pid);
    await careShown(physio, /Assign a programme/);
    await physio.selectOption('#cpp-bundle', { label: 'My plan: Smoke plan' });
    await physio.fill('#cpp-anote', 'Twice a day, Sunita.');
    await physio.click('#cpp-assign button[type=submit]');
    await physio.waitForFunction(() => /version 1/.test(document.getElementById('screen-care').textContent), null, { timeout: 8000 });
    assert.match(await physio.textContent('#screen-care'), /Smoke plan.*version 1.*Twice a day/s);
    await go(patient, '#/care');
    await careShown(patient, /Smoke plan/);
    const steps = await patient.$$eval('#screen-care .care-list li .name', (l) => l.map((x) => x.textContent.trim()));
    assert.deepEqual(steps.slice(0, 2), ['Knee raise', 'Wall sit']);
    assert.match(await patient.textContent('#screen-care'), /Twice a day, Sunita/);
    await patient.click('#screen-care a.btn.primary');
    await patient.waitForFunction(() => /^#\/plan\/asg-[a-f0-9]+\/1$/.test(location.hash) && document.getElementById('ex-title').textContent === 'Knee raise', null, { timeout: 8000 });
    assert.match(await patient.textContent('#plan-banner'), /Smoke plan.*Step 1 of 2/s);
    assert.equal(await patient.inputValue('#cfg-repCount'), '2', 'the plan\'s count on the page');
    assert.ok(await patient.$('#care-ease'), 'too hard today is offered on a step of an assigned plan');
    await go(patient, '#/plan/asg-' + pid);
    await patient.waitForFunction(() => /Set by Dr. Meera/.test(document.getElementById('plan-kind').textContent), null, { timeout: 8000 });
  });

  await step('a session on the patient\'s phone is saved to the server, with its reps and how it felt', async () => {
    const pid = Object.values(S.store.data.users).find((u) => u.name === 'Sunita').id;
    await go(patient, '#/plan/asg-' + pid + '/1');
    await patient.waitForFunction(() => document.getElementById('ex-title').textContent === 'Knee raise' && window.__app.move.id === 'kneeraise', null, { timeout: 8000 });
    await set(patient, { move: 'kneeraise', thigh: 0, kneeUp: 180, foot: 85 });
    await patient.evaluate(() => { const i = document.getElementById('cfg-target'); i.value = '2'; i.dispatchEvent(new Event('change')); const c = document.getElementById('cfg-calls'); c.value = '1'; c.dispatchEvent(new Event('change')); });
    await patient.click('#go');
    await patient.waitForFunction(() => window.__app.session.inSet, null, { timeout: 20000 });
    await patient.waitForFunction(() => window.__app.state && window.__app.state.ready === true, null, { timeout: 20000 });
    for (let i = 0; i < 4; i++) {
      await set(patient, { thigh: 0, kneeUp: 180, foot: 90 }); await wait(900);
      await set(patient, { thigh: 88, kneeUp: 90, foot: 85 }); await wait(3400);
      await set(patient, { thigh: 0, kneeUp: 180, foot: 90 }); await wait(900);
      if (await patient.textContent('#rep-v') === '2') break;
    }
    await patient.waitForSelector('#screen-done:not([hidden])', { timeout: 15000 });
    assert.equal(await patient.textContent('#r-reps-v'), '2/2');
    await patient.waitForSelector('#care-done', { timeout: 8000 });
    const reps = await patient.$$eval('#care-done .care-reps li', (l) => l.map((x) => x.textContent.trim()));
    assert.equal(reps.length, 2, 'two reps on the review list: ' + JSON.stringify(reps));
    assert.match(reps[0], /^Rep 1/);
    await patient.waitForFunction(() => window.__care.current.saved, null, { timeout: 8000 });
    const sess = Object.values(S.store.data.sessions);
    assert.equal(sess.length, 1); assert.equal(sess[0].move, 'kneeraise'); assert.equal(sess[0].step, 0); assert.equal(sess[0].planV, 1);
    assert.equal(sess[0].sets[0].reps, 2); assert.equal(sess[0].reps.length, 2); assert.equal(sess[0].reps[1].counted, true);
    /* how it felt rides on the same row */
    await patient.click('#feel .seg[data-key=pain] .btn[data-v=some]');
    await patient.fill('#feel-note', 'a twinge at the top'); await patient.click('#feel-save');
    await patient.waitForFunction(() => /Saved/.test(document.getElementById('feel-saved').textContent), null, { timeout: 8000 });
    await wait(600);
    assert.equal(Object.values(S.store.data.sessions)[0].feel.pain, 'some');
    assert.equal(Object.values(S.store.data.sessions)[0].feel.note, 'a twinge at the top');
  });

  await step('the reps are sent for review: the clip is cut from the film and the pose record goes with it', async () => {
    await patient.click('#cd-all');
    await patient.fill('#cd-line', 'it pulls at the top');
    await patient.click('#cd-send');
    await patient.waitForFunction(() => /Sent to Dr. Meera/.test(document.getElementById('cd-note').textContent) || /care-err/.test(document.getElementById('cd-note').className), null, { timeout: 30000 });
    assert.match(await patient.textContent('#cd-note'), /Sent to Dr. Meera/);
    const rv = Object.values(S.store.data.reviews);
    assert.equal(rv.length, 1); assert.deepEqual(rv[0].reps, [1, 2]); assert.equal(rv[0].line, 'it pulls at the top'); assert.equal(rv[0].research, true);
    assert.ok(rv[0].clipPath && fs.existsSync(path.join(dir, 'files', rv[0].clipPath)), 'the clip is on disk: ' + rv[0].clipPath);
    const clip = fs.readFileSync(path.join(dir, 'files', rv[0].clipPath));
    assert.ok(clip.length > 2000 && clip.length < 30e6, 'a clip of a few reps: ' + clip.length);
    assert.ok(rv[0].recordPath && fs.existsSync(path.join(dir, 'files', rv[0].recordPath)), 'the record too');
    const recBytes = fs.readFileSync(path.join(dir, 'files', rv[0].recordPath));
    const rec = JSON.parse(/\.gz$/.test(rv[0].recordPath) ? require('node:zlib').gunzipSync(recBytes).toString() : recBytes.toString());
    assert.equal(rec.move, 'kneeraise'); assert.ok(rec.frames.length > 20, 'frames in the record: ' + rec.frames.length); assert.equal(rec.frames[0].lm.length, 132);
    assert.equal(rec.reps.length, 2); assert.ok(rec.bands.some((b) => b.key === 'thigh'));
    assert.ok(log.some((l) => /\[outbox (whatsapp|sms)\] \+919000000010: Sunita sent you 2 reps of Knee raise/.test(l)), 'the physio is told: ' + log.slice(-3).join(' | '));
    /* a thumbs down on the coaching lands as a report */
    await patient.fill('#cd-thumb-line', 'it said bend your knee when it was bent');
    await patient.click('#cd-down');
    await patient.waitForFunction(() => /Thanks/.test(document.getElementById('cd-tnote').textContent), null, { timeout: 8000 });
    assert.ok(Object.values(S.store.data.reports).some((r) => r.kind === 'thumbs' && /bend your knee/.test(r.text)));
  });

  await step('the physio sees the queue, opens the review (the clip plays with the skeleton over it), and judges it: fine, a known fault, and the step eased', async () => {
    await go(physio, '#/care/queue');
    await careShown(physio, /Sunita · Knee raise/);
    assert.match(await physio.textContent('#screen-care'), /2 reps.*it pulls at the top/s);
    await physio.click('#screen-care a.btn.primary');
    await physio.waitForFunction(() => /^#\/care\/review\//.test(location.hash) && document.getElementById('cr-video'), null, { timeout: 8000 });
    try { await physio.waitForFunction(() => { const v = document.getElementById('cr-video'); return v && v.readyState >= 1 && v.duration > 0; }, null, { timeout: 15000 }); }
    catch (e) { throw new Error('the clip did not load: ' + JSON.stringify(await physio.$eval('#cr-video', (v) => ({ src: v.src.slice(0, 80), error: v.error && v.error.message, code: v.error && v.error.code, ready: v.readyState, note: document.getElementById('cr-note').textContent })))); }
    const dur = await physio.$eval('#cr-video', (v) => v.duration);
    assert.ok(dur > 1 && dur < 30, 'the clip is the reps, not the session: ' + dur + ' s');
    await physio.waitForFunction(() => document.querySelectorAll('#cr-strip s').length === 2, null, { timeout: 8000 });
    await physio.$eval('#cr-video', (v) => { v.currentTime = Math.min(1.2, v.duration / 2); });
    await physio.waitForFunction(() => /thigh|Thigh/i.test(document.getElementById('cr-reads').textContent), null, { timeout: 8000 });
    const painted = await physio.$eval('#cr-canvas', (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
    assert.ok(painted > 50, 'the skeleton is drawn over the clip: ' + painted + ' px');
    assert.match(await physio.textContent('#screen-care'), /Rep 1: counted/);
    assert.ok(Object.values(S.store.data.reviews)[0].state === 'opened');
    /* rep 2: a fault the app knows; the whole message; the step changed */
    const second = (await physio.$$('#j-reps .care-judge'))[1];
    await second.$eval('.btn[data-v=fault]', (b) => b.click());
    await second.$eval('.j-fault input', (i) => { i.checked = true; });
    await physio.fill('#j-msg', 'Good. Keep the knee at a right angle.');
    await physio.$eval('#j-form details', (d) => { d.open = true; });
    await physio.fill('#j-reps-n', '3'); await physio.fill('#j-why', 'Three reps, slowly.');
    await physio.click('#j-form button[type=submit]');
    await physio.waitForFunction(() => location.hash === '#/care/queue', null, { timeout: 8000 });
    await careShown(physio, /Nothing waiting/);
    const rv = Object.values(S.store.data.reviews)[0];
    assert.equal(rv.state, 'answered'); assert.equal(rv.labels.length, 2); assert.equal(rv.labels[0].verdict, 'fine'); assert.equal(rv.labels[1].verdict, 'fault');
    assert.equal(rv.change.planV, 2); assert.match(rv.change.what, /1 × 3/);
  });

  await step('the patient sees the reply, and the plan has the change', async () => {
    await go(patient, '#/care');
    await careShown(patient, /From your physio/);
    assert.match(await patient.textContent('#screen-care'), /Dr. Meera on your Knee raise.*To work on:.*Keep the knee at a right angle/s);
    const steps = await patient.$$eval('#screen-care .care-list li .sub', (l) => l.map((x) => x.textContent.trim()));
    assert.match(steps[0], /1 × 3/, 'three reps now: ' + steps[0]);
    await patient.click('#screen-care .care-reply a');
    await patient.waitForFunction(() => /^#\/care\/review\//.test(location.hash) && /Dr. Meera says/.test(document.getElementById('screen-care').textContent), null, { timeout: 8000 });
    assert.match(await patient.textContent('#screen-care'), /The step was changed: 1 × 3.*Three reps, slowly/s);
    await go(patient, '#/care/reviews');
    await careShown(patient, /To work on/);
  });

  await step('the visit interval: set by the physio, seen by the patient, booked with a tap; a clinic measurement on the visit', async () => {
    const pid = Object.values(S.store.data.users).find((u) => u.name === 'Sunita').id;
    await go(physio, '#/care/patient/' + pid);
    await careShown(physio, /Visits/);
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    await physio.selectOption('#cpp-weeks', '2'); await physio.fill('#cpp-last', tenDaysAgo); await physio.fill('#cpp-clinic', '080 1234 5678');
    await physio.click('#cpp-visit button[type=submit]');
    await physio.waitForFunction(() => /Next: \d{4}/.test(document.getElementById('cpp-vnote').textContent), null, { timeout: 8000 });
    await go(patient, '#/care');
    await careShown(patient, /Next visit/);
    assert.match(await patient.textContent('#screen-care'), /would like to see you in 4 days/);
    assert.ok(await patient.$('a[href="tel:080 1234 5678"]'), 'call the clinic');
    await patient.click('[data-visit=booked]');
    await careShown(patient, /booked/);
    assert.ok(log.some((l) => /Sunita booked their visit/.test(l)));
    await go(physio, '#/care/patient/' + pid);
    await careShown(physio, /booked/);
    await physio.fill('#cpp-mwhat', 'knee flexion'); await physio.fill('#cpp-mval', '95');
    await physio.click('#cpp-visited');
    await physio.waitForFunction(() => /Next: \d{4}/.test(document.getElementById('cpp-vnote').textContent) && !/booked/.test(document.getElementById('cpp-vnote').textContent), null, { timeout: 8000 });
    assert.equal(Object.values(S.store.data.measurements || {}).length, 1);
    /* a note, shared, reaches the patient's home */
    await physio.fill('#cpp-ntext', 'Lovely progress this week.'); await physio.check('#cpp-nshare'); await physio.click('#cpp-noteform button[type=submit]');
    await careShown(physio, /Lovely progress/);
    await go(patient, '#/care');
    await careShown(patient, /Notes for you.*Lovely progress/s);
  });

  await step('the physio modifies the plan: a copy of their own, a step adjusted on its page, assigned as the next version', async () => {
    const pid = Object.values(S.store.data.users).find((u) => u.name === 'Sunita').id;
    await go(physio, '#/care/patient/' + pid);
    await careShown(physio, /Modify this plan/);
    await physio.click('#cpp-modify');
    await physio.waitForFunction(() => /^#\/plan\/my-/.test(location.hash) && document.getElementById('care-assign-go'), null, { timeout: 8000 });
    assert.match(await physio.textContent('#care-assign-go'), /Assign to Sunita/);
    /* the second step's hold, through the app's own adjust form */
    await physio.click('#plan-items .plan-item:nth-child(2) .rowtools button:nth-child(3)');
    await physio.waitForSelector('#plan-items .plan-item:nth-child(2) .adj');
    const holdInput = (await physio.$$('#plan-items .plan-item:nth-child(2) .adj .grid label input'))[1];
    await holdInput.fill('8'); await holdInput.dispatchEvent('change');
    await physio.waitForFunction(() => /1 × 8 s/.test(document.querySelector('#plan-items .plan-item:nth-child(2) .what').textContent), null, { timeout: 5000 });
    await physio.click('#care-assign-go');
    await physio.waitForFunction(() => /^#\/care\/patient\//.test(location.hash) && /version 3/.test(document.getElementById('screen-care').textContent), null, { timeout: 8000 });
    const plan = Object.values(S.store.data.plans).sort((a, b) => b.v - a.v)[0];
    assert.equal(plan.v, 3); assert.equal(plan.plan.items[1].hold, 8); assert.equal(plan.plan.items[0].reps, 3, 'the review\'s change is kept in the copy');
    await go(patient, '#/care');
    await careShown(patient, /1 × 8 s/);
  });

  await step('reminders, a report from any screen, and the admin\'s view of it', async () => {
    await go(patient, '#/care/reminders');
    await careShown(patient, /Remind me/);
    await patient.check('#rm-on'); await patient.fill('#rm-time', '07:30'); await patient.selectOption('#rm-chan', 'whatsapp');
    await patient.click('#care-rem button[type=submit]');
    await patient.waitForFunction(() => /Saved/.test(document.getElementById('rm-note').textContent), null, { timeout: 8000 });
    const u = Object.values(S.store.data.users).find((x) => x.name === 'Sunita');
    assert.equal(u.reminders.time, '07:30'); assert.equal(u.reminders.on, true); assert.equal(u.consents.reminders, true);
    /* the sheet, from the app's home */
    await go(patient, '#/');
    await patient.click('#care-report-btn');
    await patient.waitForSelector('#care-sheet:not([hidden])');
    await patient.fill('#cs-text', 'It could not see me lying down.');
    await patient.click('#cs-form button[type=submit]');
    await patient.waitForFunction(() => /Thanks/.test(document.getElementById('cs-note').textContent), null, { timeout: 8000 });
    const rp = Object.values(S.store.data.reports).find((r) => r.kind === 'problem');
    assert.ok(rp && /could not see me/.test(rp.text) && rp.device && rp.appV, JSON.stringify(rp));
    assert.ok(rp.log.some((l) => /cue/.test(l)), 'the last minute of cues rides along: ' + JSON.stringify(rp.log.slice(0, 2)));
    /* the admin (the physio's number is the admin here) replies, the patient sees it */
    await go(physio, '#/care/admin/reports');
    await careShown(physio, /could not see me/);
    await physio.evaluate(() => { window.prompt = () => 'Put a lamp behind the phone.'; });
    await physio.click('[data-reply]');
    await careShown(physio, /Put a lamp/);
    await go(patient, '#/care');
    await careShown(patient, /About what you reported.*Put a lamp/s);
    await go(physio, '#/care/admin/alarms');
    await careShown(physio, /Knee raise.*2 reps judged/s);
    await go(physio, '#/care/admin/stats');
    await careShown(physio, /sessions/);
  });

  await step('my data: the log shows the clip was opened by name; the export has the session; the link can be ended', async () => {
    await go(patient, '#/care/data');
    await careShown(patient, /The log/);
    assert.match(await patient.textContent('#screen-care'), /Dr. Meera · clip opened/);
    const ex = await patient.evaluate(() => window.__care.api.call('exportData'));
    assert.equal(ex.sessions.length, 1); assert.equal(ex.reviews.length, 1); assert.equal(ex.files.length, 2);
    /* signed in on one device, and the token survives a reload */
    assert.match(await patient.textContent('#screen-care'), /Signed in on/);
    await patient.reload(); await patient.waitForSelector('#picker .item', { state: 'attached' });
    await patient.waitForFunction(() => window.__care && window.__care.me && window.__care.me.user.name === 'Sunita', null, { timeout: 8000 });
    await careShown(patient, /The log/);
  });

  await step('the plain page is untouched: index.html has no care layer, and the exercise list is the same', async () => {
    await patient.goto(base + '/');
    await patient.waitForSelector('#picker .item');
    assert.equal(await patient.evaluate(() => !!window.__care), false);
    assert.equal(await patient.evaluate(() => !!document.getElementById('care-home')), false);
    assert.equal(await patient.$$eval('#picker .item', (l) => l.length), 28);
  });

  await step('the same page on a static host is a sandbox: one phone as the physio and the patient in turn, nothing leaving it', async () => {
    const { server } = require('../scripts/serve.js');
    await new Promise((r) => server.listen(0, r));
    const sbase = `http://127.0.0.1:${server.address().port}`;
    const sandbox = await phone('sandbox');
    try {
      await sandbox.goto(sbase + '/care.html'); await sandbox.waitForSelector('#picker .item');
      assert.equal(await sandbox.evaluate(() => window.__care.api.mode), 'local');
      assert.match(await sandbox.textContent('#care-home'), /Sign in/);
      await signIn(sandbox, '9000000001');
      await sandbox.fill('#cp-name', 'Dr. Local'); await sandbox.fill('#cp-born', '1980'); await sandbox.click('#care-profile button[type=submit]');
      await sandbox.waitForFunction(() => /Saved/.test(document.getElementById('cp-note').textContent), null, { timeout: 8000 });
      await sandbox.click('#cp-be-physio');
      await careShown(sandbox, /Add a patient/);
      await sandbox.fill('#ca-phone', '9000000002'); await sandbox.fill('#ca-name', 'Pat'); await sandbox.click('#care-add button[type=submit]');
      await sandbox.waitForFunction(() => /Invitation sent/.test(document.getElementById('ca-out').textContent), null, { timeout: 8000 });
      assert.match(await sandbox.textContent('#ca-out'), /open the link yourself/);
      /* the physio signs out; the patient signs in on the same phone and finds the invitation */
      await go(sandbox, '#/care/profile'); await careShown(sandbox, /Sign out/); await sandbox.click('#cp-signout');
      await sandbox.waitForFunction(() => location.hash === '#/' && !window.__care.me, null, { timeout: 8000 });
      await signIn(sandbox, '9000000002');
      await sandbox.fill('#cp-name', 'Pat'); await sandbox.fill('#cp-born', '1970'); await sandbox.click('#care-profile button[type=submit]');
      await sandbox.waitForFunction(() => /Saved/.test(document.getElementById('cp-note').textContent), null, { timeout: 8000 });
      await go(sandbox, '#/care'); await careShown(sandbox, /An invitation/);
      await sandbox.click('#screen-care a.btn.primary'); await careShown(sandbox, /Dr. Local wants to add you/);
      await sandbox.click('#care-accept'); await careShown(sandbox, /They will set one/);
      /* and back as the physio: a programme assigned; as the patient: today's steps */
      await go(sandbox, '#/care/profile'); await careShown(sandbox, /Sign out/); await sandbox.click('#cp-signout');
      await sandbox.waitForFunction(() => !window.__care.me, null, { timeout: 8000 });
      await signIn(sandbox, '9000000001'); await go(sandbox, '#/care'); await careShown(sandbox, /Pat/);
      await sandbox.click('#screen-care a.btn.primary'); await careShown(sandbox, /Assign a programme/);
      await sandbox.selectOption('#cpp-bundle', 'knee-early'); await sandbox.click('#cpp-assign button[type=submit]');
      await sandbox.waitForFunction(() => /version 1/.test(document.getElementById('screen-care').textContent), null, { timeout: 8000 });
      await go(sandbox, '#/care/profile'); await careShown(sandbox, /Sign out/); await sandbox.click('#cp-signout');
      await sandbox.waitForFunction(() => !window.__care.me, null, { timeout: 8000 });
      await signIn(sandbox, '9000000002'); await go(sandbox, '#/care'); await careShown(sandbox, /Knee — early rehab/);
      assert.equal(await sandbox.$$eval('#screen-care .care-list li', (l) => l.length), 5);
      const msgs = await sandbox.evaluate(() => window.__care.api.store.data.outbox.map((m) => m.kind));
      assert.ok(msgs.includes('invite') && msgs.includes('plan'), 'the messages that would have gone are in the sandbox\'s outbox: ' + msgs.join(','));
    } finally { await sandbox.context().close(); server.close(); }
  });

  await step('no JS errors along the way (the one 400 is the wrong code, refused as it should be)', () => {
    const bad400 = errors.filter((e) => /status of 400/.test(e));
    assert.equal(bad400.length, 1, JSON.stringify(errors));
    assert.deepEqual(errors.filter((e) => !/status of 400/.test(e)), []);
  });
} finally {
  await browser.close();
  S.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
const bad = steps.filter((s) => !s).length;
console.log(`\n${steps.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
