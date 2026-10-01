/* The people from the product plan, each walked through the care page with the
   screen recorded: Dr. Meera the physio, Sunita her post-operative patient, Arjun on his
   own with his back, Rohan the coach and Priya his client, and one phone as every role.
   Each flow is a video in docs/videos (webm from the browser, mp4 beside it where ffmpeg
   is found), with a caption on the picture saying what is being done.

   Run: node test/care-journeys.mjs   (playwright on NODE_PATH; FFMPEG=/path/to/ffmpeg for the mp4s)
   The flows are driven, not asserted to the last detail: a flow that breaks is reported
   with a screenshot and the next one runs. The smoke (care-smoke.mjs) is the assertion. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { POSE_SRC, SPY_SRC } from './stand-in.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { make } = require('../scripts/care-server.js');

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'docs', 'videos');
fs.mkdirSync(OUT, { recursive: true });
const FFMPEG = process.env.FFMPEG || ['/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2', '/usr/bin/ffmpeg'].find((f) => fs.existsSync(f)) || null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ontrack-journeys-'));
const log = [];
const S = make({ CARE_DATA: dir, CARE_DEMO_CODE: '123456', CARE_ADMIN_PHONES: '+919000000010', CARE_BASE_URL: '' }, (s) => log.push(s));
await new Promise((r) => S.server.listen(0, r));
const base = `http://127.0.0.1:${S.server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, slowMo: 90, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

const PHONE = { width: 390, height: 780 }, LAPTOP = { width: 1100, height: 760 };
const results = [];
/* one flow = one recorded page; the context closes at the end so the video is written */
async function flow(name, who, size, body) {
  const vdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ontrack-video-'));
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: vdir, size }, permissions: ['camera'], deviceScaleFactor: 1 });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(POSE_SRC); await page.addInitScript(SPY_SRC);
  /* the caption: a strip on the picture, which is the video's, not the app's */
  await page.addInitScript((w) => { addEventListener('DOMContentLoaded', () => { const c = document.createElement('div'); c.id = '__cap'; c.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:rgba(43,21,70,.92);color:#fff;font:700 15px/1.3 system-ui,sans-serif;padding:10px 14px;pointer-events:none;white-space:pre-wrap'; c.textContent = w; document.body.appendChild(c); }); }, who);
  const cap = async (text, ms) => { await page.evaluate(([w, t]) => { const c = document.getElementById('__cap'); if (c) c.textContent = w + '\n' + t; }, [who, text]); await wait(ms == null ? 1400 : ms); };
  const t0 = Date.now();
  let err = null;
  try { await body(page, cap); await cap('End of this flow.', 1200); }
  catch (e) { err = e; try { await page.screenshot({ path: path.join(OUT, name + '-failed.png') }); } catch { } }
  await ctx.close();
  const webm = fs.readdirSync(vdir).find((f) => f.endsWith('.webm'));
  let out = null;
  if (webm) {
    out = path.join(OUT, name + '.webm'); fs.renameSync(path.join(vdir, webm), out);
    if (FFMPEG) { try { execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', out, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, name + '.mp4')]); fs.unlinkSync(out); out = path.join(OUT, name + '.mp4'); } catch (e) { log.push('ffmpeg: ' + e.message); } }
  }
  fs.rmSync(vdir, { recursive: true, force: true });
  results.push({ name, ok: !err, err: err && err.message, errors, secs: Math.round((Date.now() - t0) / 1000), file: out && path.basename(out) });
  console.log(`${err ? 'FAIL' : 'ok  '} ${name} (${Math.round((Date.now() - t0) / 1000)} s)${err ? '\n      ' + err.message : ''}${errors.length ? '\n      page errors: ' + errors.join(' | ') : ''}`);
}

/* the moves every flow makes */
const go = async (page, hash) => { await page.evaluate((h) => { if (location.hash === h) dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h; }, hash); };
const careShown = (page, re, ms) => page.waitForFunction((r) => !document.getElementById('screen-care').hidden && new RegExp(r, 'i').test(document.getElementById('screen-care').textContent), re, { timeout: ms || 10000 });
const open = async (page, hash) => { await page.goto(base + '/care.html' + (hash || '')); await page.waitForSelector('#picker .item', { state: 'attached' }); await page.waitForFunction(() => !!window.__care, null, { timeout: 10000 }); };
const signIn = async (page, cap, number, name, born, extra) => {
  await go(page, '#/care/signin'); await page.waitForSelector('#care-phone', { state: 'visible' });
  await cap(`Signs in with the phone number. No password: a code comes by SMS.`);
  await page.fill('#care-phone', number); await page.click('#care-send');
  await page.waitForFunction(() => /Code: 123456/.test(document.getElementById('care-signin-note').textContent), null, { timeout: 10000 });
  await cap('The code (shown here because this is a demo server).');
  await page.click('#care-code-form button[type=submit]');
  await page.waitForFunction(() => /^#\/care/.test(location.hash) && !/signin/.test(location.hash), null, { timeout: 10000 });
  if (name) {
    await page.waitForSelector('#cp-name', { state: 'visible' });
    await cap('First time: a name, the year of birth, what they are working on.');
    await page.fill('#cp-name', name); await page.fill('#cp-born', String(born));
    if (extra) await extra();
    await page.click('#care-profile button[type=submit]');
    await page.waitForFunction(() => /Saved/.test(document.getElementById('cp-note').textContent), null, { timeout: 10000 });
  }
};
const set = (page, o) => page.evaluate((v) => Object.assign(window.__pose, v), o);
const shortSession = (page) => page.evaluate(() => { const i = document.getElementById('cfg-target'); i.value = '2'; i.dispatchEvent(new Event('change')); const c = document.getElementById('cfg-calls'); c.value = '1'; c.dispatchEvent(new Event('change')); });
/* a knee raise session, two reps, driven by the stand-in */
async function kneeRaiseSession(page, cap, reps) {
  await set(page, { move: 'kneeraise', thigh: 0, kneeUp: 180, foot: 85 });
  await shortSession(page);
  await cap('Start the camera. The phone is propped on the floor; the coach waits until it sees the start position.');
  await page.click('#go');
  await page.waitForFunction(() => window.__app.session.inSet, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__app.state && window.__app.state.ready === true, null, { timeout: 20000 });
  await cap('Each rep: the knee up, held, down; counted on the way down. One rep here with the knee too open, so the coach says so.', 400);
  for (let i = 0; i < 4; i++) {
    await set(page, { thigh: 0, kneeUp: 180, foot: 90 }); await wait(900);
    await set(page, { thigh: 88, kneeUp: i === 1 ? 130 : 90, foot: 85 }); await wait(3400);
    await set(page, { thigh: 0, kneeUp: 180, foot: 90 }); await wait(900);
    if (await page.textContent('#rep-v') === String(reps)) break;
  }
  await page.waitForSelector('#screen-done:not([hidden])', { timeout: 20000 });
  await page.waitForSelector('#care-done', { timeout: 10000 });
  await page.waitForFunction(() => window.__care.current.saved, null, { timeout: 10000 });
}

const who = { meera: '+919000000010', sunita: '9000000020', arjun: '9000000030', priya: '9000000040', rohan: '9000000050' };
const ids = {};
const idOf = (name) => Object.values(S.store.data.users).find((u) => u.name === name).id;

/* ---- 1. Dr. Meera: the physio signs in and invites her patient ---- */
await flow('01-meera-signs-in-and-invites-sunita', 'Dr. Meera, physio, 44 · on her phone between patients', PHONE, async (page, cap) => {
  await open(page);
  await cap('care.html is the app with a sign-in panel at the top. The exercises below work as they always did.');
  await signIn(page, cap, who.meera, 'Dr. Meera', 1982, async () => { await page.fill('#cp-cond', ''); });
  await cap('Her number is the clinic\'s admin number, so the physio screens are on.');
  await go(page, '#/care'); await careShown(page, /Add a patient/);
  await cap('Her home: the queue, the due list, her patients. Nobody yet. She adds Sunita by number.');
  await page.fill('#ca-phone', who.sunita); await page.fill('#ca-name', 'Sunita');
  await page.click('#care-add button[type=submit]');
  await page.waitForFunction(() => /Invitation sent/.test(document.getElementById('ca-out').textContent), null, { timeout: 10000 });
  await cap('The invitation goes by SMS; she can also send it on WhatsApp herself. Sunita shows as invited until she accepts.', 2500);
  await go(page, '#/care'); await careShown(page, /invited/);
  await cap('Invited, not yet accepted.', 1500);
});

/* ---- 2. Sunita: the invitation on her phone ---- */
await flow('02-sunita-opens-the-invitation', 'Sunita, 58, three weeks after a knee replacement · her own phone', PHONE, async (page, cap) => {
  const link = Object.values(S.store.data.links)[0];
  await open(page, '#/care/link/' + link.id);
  await cap('She taps the link in the SMS. The page asks her to sign in with the same number.');
  await signIn(page, cap, who.sunita, 'Sunita', 1968, async () => { await page.fill('#cp-cond', 'knee replacement, left, 3 weeks ago'); await page.check('#cp-research'); });
  await cap('She ticks the box that lets the app learn from her reviewed reps — without her name. Her choice.');
  await go(page, '#/care'); await careShown(page, /An invitation/);
  await page.click('#screen-care a.btn.primary'); await careShown(page, /Dr. Meera wants to add you/);
  await cap('The invitation says exactly what Dr. Meera will see. Nothing from before today.', 3000);
  await page.click('#care-accept'); await careShown(page, /They will set one/);
  await cap('Accepted. Until the plan comes, the programmes and exercises are hers to use.', 2000);
});

/* ---- 3. Dr. Meera: a plan built from the exercises, modified, assigned; the visit interval ---- */
await flow('03-meera-builds-and-assigns-the-plan', 'Dr. Meera, physio · on her phone', PHONE, async (page, cap) => {
  await open(page); await signIn(page, cap, who.meera);
  await go(page, '#/ex/kneeraise'); await page.waitForFunction(() => window.__app.move.id === 'kneeraise', null, { timeout: 10000 });
  await cap('A plan starts from the exercise pages. The knee raise: under Adjust, she adds it to a new plan.');
  await page.evaluate(() => document.getElementById('adjust-panel').scrollIntoView());
  await page.selectOption('#adj-plan', 'new'); await page.click('#adj-add');
  await page.waitForFunction(() => /Added to a new plan/.test(document.getElementById('adj-saved').textContent), null, { timeout: 10000 });
  await page.click('#adj-saved a');
  await page.waitForSelector('#screen-plan:not([hidden])');
  await cap('The plan\'s page: she names it, adds the wall sit, and adjusts each step. (Short counts here so the demo session is short.)');
  await page.fill('#plan-actions input[type=text]', 'Knee — week 3'); await page.press('#plan-actions input[type=text]', 'Tab');
  await page.selectOption('#plan-actions select', 'wallsit'); await page.click('#plan-actions .add-ex button');
  await page.waitForFunction(() => document.querySelectorAll('#plan-items .plan-item').length === 2, null, { timeout: 10000 });
  await page.click('#plan-items .plan-item:nth-child(1) .rowtools button:nth-child(3)');
  await page.waitForSelector('#plan-items .plan-item:nth-child(1) .adj');
  const inputs = await page.$$('#plan-items .plan-item:nth-child(1) .adj .grid label input');
  await inputs[0].fill('1'); await inputs[0].dispatchEvent('change'); await inputs[1].fill('2'); await inputs[1].dispatchEvent('change'); await inputs[2].fill('2'); await inputs[2].dispatchEvent('change');
  await page.fill('#plan-items .plan-item:nth-child(1) .adj input[maxlength="200"]', 'Slow on the way down.'); await page.press('#plan-items .plan-item:nth-child(1) .adj input[maxlength="200"]', 'Tab');
  await cap('Sets, reps, the hold, the range of motion, faults to leave alone, a note for Sunita.', 2500);
  await page.click('#plan-items .plan-item:nth-child(2) .rowtools button:nth-child(3)');
  await page.waitForSelector('#plan-items .plan-item:nth-child(2) .adj');
  const in2 = await page.$$('#plan-items .plan-item:nth-child(2) .adj .grid label input');
  await in2[0].fill('1'); await in2[0].dispatchEvent('change'); await in2[1].fill('5'); await in2[1].dispatchEvent('change');
  ids.sunita = idOf('Sunita');
  await go(page, '#/care/patient/' + ids.sunita); await careShown(page, /Assign a programme/);
  await cap('Sunita\'s page. The plan from her own plans, with a line for Sunita, assigned.');
  await page.selectOption('#cpp-bundle', { label: 'My plan: Knee — week 3' });
  await page.fill('#cpp-anote', 'Twice a day. Ice after if it swells.');
  await page.click('#cpp-assign button[type=submit]');
  await page.waitForFunction(() => /version 1/.test(document.getElementById('screen-care').textContent), null, { timeout: 10000 });
  await cap('Version 1 is on Sunita\'s phone; she was told by message. Every change later is a new version.', 2000);
  await page.evaluate(() => document.getElementById('cpp-visit').scrollIntoView());
  await cap('She wants to see Sunita every two weeks; the app will remind Sunita to book, and list her as due.');
  await page.selectOption('#cpp-weeks', '2'); await page.fill('#cpp-clinic', '080 2345 6789'); await page.click('#cpp-visit button[type=submit]');
  await page.waitForFunction(() => /Next: \d{4}/.test(document.getElementById('cpp-vnote').textContent), null, { timeout: 10000 });
  await page.fill('#cpp-remline', 'Ice after, Sunita.'); await page.click('#cpp-rem button[type=submit]');
  await cap('A line of her own in every reminder Sunita gets.', 1800);
});

/* ---- 4. Sunita: a session at home, how it felt, a rep sent for review ---- */
await flow('04-sunita-does-a-session-and-sends-a-rep', 'Sunita, 58 · at home, the phone propped against the sofa', PHONE, async (page, cap) => {
  await open(page); await signIn(page, cap, who.sunita);
  await go(page, '#/care'); await careShown(page, /Knee — week 3/);
  await cap('Her home: today\'s steps from Dr. Meera, with her note. Start on the first.', 2500);
  await page.click('#screen-care a.btn.primary');
  await page.waitForFunction(() => /^#\/plan\/asg-/.test(location.hash) && document.getElementById('ex-title').textContent === 'Knee raise', null, { timeout: 10000 });
  await cap('The exercise page with the plan\'s numbers on it, the banner saying which step. "Too hard today" would ease it a notch.', 2500);
  await kneeRaiseSession(page, cap, 2);
  await cap('The session\'s end: what to watch for next time, and how it felt. Saved to her history and seen by Dr. Meera.', 2500);
  await page.click('#feel .seg[data-key=effort] .btn[data-v=right]'); await page.click('#feel .seg[data-key=pain] .btn[data-v=some]');
  await page.fill('#feel-note', 'a pull at the top of the knee'); await page.click('#feel-save');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('feel-saved').textContent), null, { timeout: 10000 });
  await page.evaluate(() => document.getElementById('care-done').scrollIntoView());
  await cap('Review with my physio: each rep with what the app said. She ticks both and writes what she felt.', 2500);
  await page.click('#cd-all'); await page.fill('#cd-line', 'it pulls at the top of the second one');
  await page.click('#cd-send');
  await page.waitForFunction(() => /Sent to Dr. Meera/.test(document.getElementById('cd-note').textContent), null, { timeout: 40000 });
  await cap('The clip of those reps and the skeleton go to Dr. Meera. Nothing else does.', 2500);
  await page.click('#cd-up');
  await page.waitForFunction(() => /Thanks/.test(document.getElementById('cd-tnote').textContent), null, { timeout: 10000 });
  await cap('And a thumbs up on the coaching.', 1200);
});

/* ---- 5. Dr. Meera: the queue, the clip with the skeleton, the verdict ---- */
await flow('05-meera-judges-the-review', 'Dr. Meera, physio · at the clinic laptop', LAPTOP, async (page, cap) => {
  await open(page); await signIn(page, cap, who.meera);
  await go(page, '#/care'); await careShown(page, /Waiting for you/);
  await cap('Her home flags one review waiting, and Sunita\'s week.', 2000);
  await go(page, '#/care/queue'); await careShown(page, /Sunita · Knee raise/);
  await cap('The queue, oldest first; overdue after two working days.', 1800);
  await page.click('#screen-care a.btn.primary');
  await page.waitForFunction(() => { const v = document.getElementById('cr-video'); return v && v.readyState >= 1; }, null, { timeout: 20000 });
  await cap('The clip plays with the skeleton the phone saw drawn over it, the angles beside it, a strip of the reps and where the app called a fault.', 1500);
  await page.$eval('#cr-video', (v) => v.play());
  await wait(5000);
  await page.$eval('#cr-video', (v) => { v.pause(); v.currentTime = 1.5; });
  await cap('Scrubbed to the second rep. Half speed is a tap away.', 2000);
  await page.evaluate(() => document.querySelector('.care-judge').scrollIntoView());
  await cap('Her verdict per rep: fine, a fault the app knows, or something else. Rep 2: the app called the knee; she agrees.', 2500);
  const second = (await page.$$('#j-reps .care-judge'))[1];
  await second.$eval('.btn[data-v=fault]', (b) => b.click());
  await second.$eval('.j-fault input', (i) => { i.checked = true; });
  await page.fill('#j-msg', 'Good start. Bend the knee to a right angle at the top, and slow on the way down.');
  await page.$eval('#j-form details', (d) => { d.open = true; });
  await page.fill('#j-reps-n', '3'); await page.fill('#j-why', 'Three reps, slowly, this week.');
  await cap('A message to Sunita, and the step changed: three reps, with the reason. That becomes version 2 of her plan.', 2500);
  await page.click('#j-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/care/queue', null, { timeout: 10000 });
  await careShown(page, /Nothing waiting/);
  await cap('Queue empty. Sunita is told.', 1500);
});

/* ---- 6. Sunita: the reply, the plan, the visit ---- */
await flow('06-sunita-sees-the-reply-and-books-a-visit', 'Sunita, 58 · the next morning', PHONE, async (page, cap) => {
  /* the visit falls due in a few days for the demo */
  const link = Object.values(S.store.data.links)[0]; link.visit.next = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10); await S.store.save();
  await open(page); await signIn(page, cap, who.sunita);
  await go(page, '#/care'); await careShown(page, /From your physio/);
  await cap('Her home: Dr. Meera\'s reply, the plan now says three reps, and the visit due in four days.', 3000);
  await page.click('#screen-care .care-reply a');
  await page.waitForFunction(() => /Dr. Meera says/.test(document.getElementById('screen-care').textContent), null, { timeout: 10000 });
  await cap('The review itself: her clip, the verdict per rep, the message, the change to the step.', 3000);
  await go(page, '#/care'); await careShown(page, /Next visit/);
  await page.evaluate(() => [...document.querySelectorAll('.care-panel h2')].find((h) => /Next visit/.test(h.textContent)).scrollIntoView());
  await cap('The visit: Booked, Remind me in 3 days, or Call the clinic.', 1800);
  await page.click('[data-visit=booked]'); await careShown(page, /booked/);
  await go(page, '#/care/reminders'); await careShown(page, /Remind me/);
  await cap('Reminders at her time, on her days, by whatever reaches her.', 1500);
  await page.check('#rm-on'); await page.fill('#rm-time', '07:30'); await page.click('#care-rem button[type=submit]');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('rm-note').textContent), null, { timeout: 10000 });
  await go(page, '#/care/data'); await careShown(page, /The log/);
  await cap('My data: what is kept, who opened her clip and when, export everything, delete the account.', 3000);
});

/* ---- 7. Arjun: on his own, no physio ---- */
await flow('07-arjun-on-his-own', 'Arjun, 41, a bad back, no physio · his phone, evenings', PHONE, async (page, cap) => {
  await open(page);
  await cap('Nobody sent Arjun a link. He signs in anyway: the programmes are free, and his sessions will be kept.');
  await signIn(page, cap, who.arjun, 'Arjun', 1985, async () => { await page.fill('#cp-cond', 'low back, stiff mornings'); });
  await go(page, '#/care'); await careShown(page, /No plan from a physio yet/);
  await cap('No physio, no plan: the home says so and points at the programmes.', 1800);
  await go(page, '#/'); await page.waitForSelector('#plan-list .plan');
  await cap('The programmes on the app\'s home. Low back — gentle daily routine.', 1500);
  await go(page, '#/plan/back-care'); await page.waitForSelector('#screen-plan:not([hidden])');
  await cap('Its steps, notes and sources. He can copy it to his own plans and change it. (Here, a plank for the demo.)', 2500);
  await go(page, '#/ex/plank'); await page.waitForFunction(() => window.__app.move.id === 'plank', null, { timeout: 10000 });
  await set(page, { move: 'plank', stack: 0, sag: 0 });
  await page.evaluate(() => { const i = document.getElementById('cfg-target'); i.value = '4'; i.dispatchEvent(new Event('change')); const c = document.getElementById('cfg-calls'); c.value = '2'; c.dispatchEvent(new Event('change')); const s = document.getElementById('cfg-setCount'); if (s) { s.value = '1'; s.dispatchEvent(new Event('change')); } });
  await cap('A plank, four seconds for the demo. The coach times the hold only while the position is right.');
  await page.click('#go');
  await page.waitForFunction(() => window.__app.session.inSet, null, { timeout: 20000 });
  await page.waitForSelector('#screen-done:not([hidden])', { timeout: 40000 });
  await page.waitForSelector('#care-done', { timeout: 10000 });
  await page.evaluate(() => document.getElementById('care-done').scrollIntoView());
  await cap('No physio to send a rep to, but the session is saved, and the thumbs still count.', 2500);
  await go(page, '#/care/history'); await careShown(page, /Plank/);
  await cap('His history, and the week bar.', 1500);
  await go(page, '#/care/reminders'); await careShown(page, /Remind me/);
  await page.check('#rm-on'); await page.fill('#rm-time', '21:00'); await page.click('#care-rem button[type=submit]');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('rm-note').textContent), null, { timeout: 10000 });
  await cap('Reminders work without a physio too.', 1200);
  await go(page, '#/'); await page.waitForSelector('#plan-list .plan');
  await page.click('#care-report-btn'); await page.waitForSelector('#care-sheet:not([hidden])');
  await cap('Something is wrong, from any screen: a line, and the app attaches the phone, the version and the last minute of cues.', 2000);
  await page.fill('#cs-text', 'It said I was out of the picture with the phone two metres away.'); await page.click('#cs-form button[type=submit]');
  await page.waitForFunction(() => /Thanks/.test(document.getElementById('cs-note').textContent), null, { timeout: 10000 });
  await cap('Thanks, we read every one.', 1200);
});

/* ---- 8. Rohan: a coach, with the same screens; Priya his client ---- */
await flow('08-rohan-becomes-a-coach-and-adds-priya', 'Rohan, 27, online fitness coach · his phone', PHONE, async (page, cap) => {
  await open(page);
  await signIn(page, cap, who.rohan, 'Rohan', 1999);
  await page.evaluate(() => document.getElementById('care-physio').scrollIntoView());
  await cap('A coach asks for the physio\'s screens with a registration number and clinic; the admin checks and turns them on.');
  await page.fill('#cp-reg', 'IFT-2024-1183'); await page.fill('#cp-clinic', 'Rohan Fitness, online'); await page.click('#care-physio button[type=submit]');
  await page.waitForFunction(() => /Asked/.test(document.getElementById('cp-pnote').textContent), null, { timeout: 10000 });
  /* the admin turns the role on (Dr. Meera's number is the admin here) */
  ids.rohan = idOf('Rohan');
  const meeraToken = await S.care.call('verify', null, { phone: who.meera, code: (await S.care.call('requestCode', null, { phone: who.meera })).demoCode });
  await S.care.call('setRole', meeraToken.token, { userId: ids.rohan, role: 'physio' });
  await cap('(The admin has turned it on.)', 800);
  await go(page, '#/care'); await careShown(page, /Add a patient/);
  await cap('The same screens as a physio\'s: clients, the queue, Add a client.', 1500);
  await page.fill('#ca-phone', who.priya); await page.fill('#ca-name', 'Priya'); await page.click('#care-add button[type=submit]');
  await page.waitForFunction(() => /Invitation sent/.test(document.getElementById('ca-out').textContent), null, { timeout: 10000 });
  await cap('Priya is invited; the message is one tap from WhatsApp.', 2000);
});

await flow('09-priya-accepts-and-sends-a-rep', 'Priya, 22, Rohan\'s client · her phone, after work', PHONE, async (page, cap) => {
  const link = Object.values(S.store.data.links).find((l) => l.physio === ids.rohan);
  await open(page, '#/care/link/' + link.id);
  await signIn(page, cap, who.priya, 'Priya', 2004);
  await go(page, '#/care'); await careShown(page, /An invitation/);
  await page.click('#screen-care a.btn.primary'); await careShown(page, /Rohan.*wants to add you/);
  await page.click('#care-accept'); await careShown(page, /They will set one/);
  await cap('Accepted. Rohan assigns a plan (a knee raise and a wall sit here).', 1500);
  /* Rohan assigns, in the background */
  const rt = await S.care.call('verify', null, { phone: who.rohan, code: (await S.care.call('requestCode', null, { phone: who.rohan })).demoCode });
  ids.priya = idOf('Priya');
  await S.care.call('assignPlan', rt.token, { patientId: ids.priya, plan: { name: 'Priya — week 1', items: [{ move: 'kneeraise', sets: 1, reps: 2, hold: 2, note: 'Film the last rep for me.' }, { move: 'wallsit', sets: 1, hold: 20 }] }, note: 'Three times a week.' });
  await go(page, '#/care'); await careShown(page, /Priya — week 1/);
  await cap('Her home: Rohan\'s plan, his note. Start.', 2000);
  await page.click('#screen-care a.btn.primary');
  await page.waitForFunction(() => /^#\/plan\/asg-/.test(location.hash) && document.getElementById('ex-title').textContent === 'Knee raise', null, { timeout: 10000 });
  await kneeRaiseSession(page, cap, 2);
  await page.evaluate(() => document.getElementById('care-done').scrollIntoView());
  await cap('Only the second rep goes to Rohan.', 1500);
  await page.click('#cd-flagged');
  await page.fill('#cd-line', 'the second one felt off'); await page.click('#cd-send');
  await page.waitForFunction(() => /Sent to Rohan/.test(document.getElementById('cd-note').textContent), null, { timeout: 40000 });
  await cap('Sent.', 1200);
});

await flow('10-rohan-names-something-new', 'Rohan, coach · his phone', PHONE, async (page, cap) => {
  await open(page); await signIn(page, cap, who.rohan);
  await go(page, '#/care/queue'); await careShown(page, /Priya · Knee raise/);
  await page.click('#screen-care a.btn.primary');
  await page.waitForFunction(() => { const v = document.getElementById('cr-video'); return v && v.readyState >= 1; }, null, { timeout: 20000 });
  await page.$eval('#cr-video', (v) => v.play()); await wait(3000); await page.$eval('#cr-video', (v) => v.pause());
  await page.evaluate(() => document.querySelector('.care-judge').scrollIntoView());
  await cap('The app knows only its own faults. Rohan sees something else: he names it. It is kept against the exercise, for a rule later.', 2500);
  const j = (await page.$$('#j-reps .care-judge'))[0];
  await j.$eval('.btn[data-v=new]', (b) => b.click());
  await j.$eval('.j-name', (i) => { i.value = 'Hip hiking'; }); await j.$eval('.j-desc', (i) => { i.value = 'the pelvis lifts with the knee'; }); await j.$eval('.j-part', (i) => { i.value = 'hip'; });
  await page.fill('#j-msg', 'Keep the hips level — think of a glass of water on them.');
  await page.click('#j-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/care/queue', null, { timeout: 10000 });
  await careShown(page, /Nothing waiting/);
  await cap('Next time he reviews a knee raise, "Hip hiking" is offered.', 1500);
  await go(page, '#/care/patient/' + ids.priya); await careShown(page, /Notes/);
  await page.waitForSelector('#cpp-noteform', { state: 'attached' });
  await page.evaluate(() => document.getElementById('cpp-noteform').scrollIntoView());
  await page.fill('#cpp-ntext', 'Great first week. Keep the phone a little further back.'); await page.check('#cpp-nshare'); await page.click('#cpp-noteform button[type=submit]');
  await careShown(page, /Great first week/);
  await cap('A note shared with Priya; it shows on her home.', 1500);
});

/* ---- 11. One phone, every role: the sandbox a static host serves ---- */
await flow('11-sandbox-one-phone-every-role', 'Anyone, on GitHub Pages · the sandbox, nothing leaves the phone', PHONE, async (page, cap) => {
  const { server } = require('../scripts/serve.js');
  await new Promise((r) => server.listen(0, r));
  const sbase = `http://127.0.0.1:${server.address().port}`;
  try {
    await page.goto(sbase + '/care.html'); await page.waitForSelector('#picker .item');
    await cap('On a static host the same page runs its logic inside the browser. Any number, the code is always 123456.');
    await signIn(page, cap, '9000000001', 'Dr. Sandbox', 1980);
    await page.evaluate(() => document.getElementById('care-physio').scrollIntoView());
    await cap('In the sandbox a person can make themselves the physio.', 1200);
    await page.click('#cp-be-physio'); await careShown(page, /Add a patient/);
    await page.fill('#ca-phone', '9000000002'); await page.fill('#ca-name', 'Pat'); await page.click('#care-add button[type=submit]');
    await page.waitForFunction(() => /Invitation sent/.test(document.getElementById('ca-out').textContent), null, { timeout: 10000 });
    await cap('No message goes out: sign out, sign in as the patient\'s number on the same phone, and the invitation is there.', 2500);
    await go(page, '#/care/profile'); await careShown(page, /Sign out/); await page.click('#cp-signout');
    await page.waitForFunction(() => !window.__care.me, null, { timeout: 10000 });
    await signIn(page, cap, '9000000002', 'Pat', 1970);
    await go(page, '#/care'); await careShown(page, /An invitation/);
    await page.click('#screen-care a.btn.primary'); await careShown(page, /wants to add you/);
    await page.click('#care-accept'); await careShown(page, /They will set one/);
    await cap('Accepted, on one phone. Every flow can be tried this way before a server exists.', 2500);
  } finally { server.close(); }
});

await browser.close();
S.close();
fs.rmSync(dir, { recursive: true, force: true });
const bad = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, 'README.md'), `# The flows, recorded\n\nMade by \`node test/care-journeys.mjs\`: each person from the product plan walked through care.html against the care server (a demo code, messages to the outbox), the screen recorded with a caption saying what is being done.\n\n| file | who and what | seconds |\n|---|---|---|\n${results.map((r) => `| ${r.file || '(no video)'} | ${r.name.replace(/^\d+-/, '').replace(/-/g, ' ')}${r.ok ? '' : ' — FAILED: ' + r.err} | ${r.secs} |`).join('\n')}\n`);
console.log(`\n${results.length - bad.length} flows recorded, ${bad.length} failed — ${OUT}`);
process.exit(bad.length ? 1 : 0);
