/* The part unit tests cannot reach: a real browser, a real camera stream, the real canvas,
   the real MediaRecorder. The pose model is stood in for — `__poseSource` hands the app
   landmarks posed to a known angle — so this checks the plumbing, not the model:
   does the reading reach the screen, does the right cue fire, does the canvas get painted,
   and does a set produce a video file with something in it.

   Run: npm run smoke   (needs playwright; NODE_PATH=$(npm root -g) if it is installed globally)
*/
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { server } from '../scripts/serve.js';
/* through require, so a globally installed playwright on NODE_PATH is found — ESM ignores it */
const { chromium } = createRequire(import.meta.url)('playwright');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* The same bodies the unit tests pose, built in the page so the app sees ordinary
   landmarks. Which one is built follows `__pose.move`, so switching exercise in the
   UI switches what the stand-in camera is showing, as a real person would. */
const POSE_SRC = `
const D = Math.PI / 180, ASPECT = 16 / 9;
const SIDE = { L: { ear:7, shoulder:11, elbow:13, wrist:15, hip:23, knee:25, ankle:27, heel:29, toe:31 },
               R: { ear:8, shoulder:12, elbow:14, wrist:16, hip:24, knee:26, ankle:28, heel:30, toe:32 } };
window.__pose = { move: 'wallsit', knee: 90, shin: 90, tilt: 0, stack: 0, sag: 0, vis: 0.95 };

function wallsitBody(o, f) {
  const thigh = 0.2, shinLen = 0.22, torso = 0.26;
  const knee = { x: 0.75, y: 0.55 };
  const u = { x: -f * Math.cos(o.shin * D), y: Math.sin(o.shin * D) };
  const heel = { x: knee.x + shinLen * u.x, y: knee.y + shinLen * u.y };
  const ankle = { x: knee.x + shinLen * 0.86 * u.x, y: knee.y + shinLen * 0.86 * u.y };
  const a = o.knee * D * f, ca = Math.cos(a), sa = Math.sin(a);
  const h = { x: u.x * ca - u.y * sa, y: u.x * sa + u.y * ca };
  const hip = { x: knee.x + thigh * h.x, y: knee.y + thigh * h.y };
  const shoulder = { x: hip.x + f * torso * Math.sin(o.tilt * D), y: hip.y - torso * Math.cos(o.tilt * D) };
  return { hip, knee, ankle, shoulder, heel,
    toe: { x: heel.x + f * 0.08, y: heel.y + 0.004 },
    ear: { x: shoulder.x + f * 0.02, y: shoulder.y - 0.07 } };
}
function plankBody(o, f) {
  const upper = 0.18, torso = 0.27, legs = 0.26, fore = 0.13;
  const shoulder = { x: 0.62, y: 0.42 };
  const elbow = { x: shoulder.x - f * upper * Math.sin(o.stack * D), y: shoulder.y + upper * Math.cos(o.stack * D) };
  const wrist = { x: elbow.x + f * fore, y: elbow.y + 0.012 };
  const tilt = 12 * D, dir = { x: -f * Math.cos(tilt), y: Math.sin(tilt) };
  const hip = { x: shoulder.x + torso * dir.x, y: shoulder.y + torso * dir.y };
  const a = -o.sag * D * f, ca = Math.cos(a), sa = Math.sin(a);
  const leg = { x: dir.x * ca - dir.y * sa, y: dir.x * sa + dir.y * ca };
  const ankle = { x: hip.x + legs * leg.x, y: hip.y + legs * leg.y };
  return { shoulder, elbow, wrist, hip, ankle,
    knee: { x: hip.x + legs * 0.55 * leg.x, y: hip.y + legs * 0.55 * leg.y },
    heel: { x: ankle.x - f * 0.02, y: ankle.y + 0.035 },
    toe: { x: ankle.x - f * 0.05, y: ankle.y + 0.055 },
    ear: { x: shoulder.x + f * 0.05, y: shoulder.y - 0.04 } };
}
window.__poseSource = function () {
  const o = window.__pose; if (!o) return null;
  const P = o.move === 'plank' ? plankBody(o, 1) : wallsitBody(o, 1);
  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  for (const s of ['L', 'R']) for (const k in SIDE[s]) {
    const p = P[k]; if (!p) continue;
    lm[SIDE[s][k]] = { x: p.x / ASPECT, y: p.y, z: 0, visibility: o.vis };
  }
  return lm;
};
`;

/* Headless Chromium has a speech engine that makes no sound, so "did it speak?"
   is checked by watching what is handed to it. That is the part that can break:
   a cue that never reaches the engine is silent on a real phone too. */
const SPY_SRC = `
window.__spoken = [];
const _speak = speechSynthesis.speak.bind(speechSynthesis);
speechSynthesis.speak = function (u) { window.__spoken.push({ text: u.text, volume: u.volume }); return _speak(u); };
`;

const steps = [];
const step = async (name, fn) => { try { await fn(); steps.push(true); console.log('ok  -', name); } catch (e) { steps.push(false); console.log('FAIL-', name, '\n     ', e.message); throw e; } };

await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 900, height: 1200 }, permissions: ['camera'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.addInitScript(POSE_SRC);
await page.addInitScript(SPY_SRC);

const set = (o) => page.evaluate((v) => Object.assign(window.__pose, v), o);
const cue = () => page.textContent('#cue');
const chip = () => page.textContent('#state');
const spoken = () => page.evaluate(() => window.__spoken.map((u) => u.text));
const heard = (re, ms) => page.waitForFunction((r) => window.__spoken.some((u) => new RegExp(r, 'i').test(u.text)), re, { timeout: ms || 8000 });
const saw = (re, ms) => page.waitForFunction((r) => new RegExp(r, 'i').test(document.getElementById('cue').textContent), re, { timeout: ms || 8000 });

try {
  await step('the page comes up and offers the camera', async () => {
    await page.goto(base + '/');
    await page.waitForSelector('#go');
    assert.equal(await page.textContent('#band-knee'), '85–110', 'the band asked for is the band shown');
    assert.equal(await page.textContent('#band-shin'), '85–95');
    assert.equal(await page.textContent('#band-back'), '±12');
    assert.equal(await page.textContent('#hold-v'), '60.0', 'the full minute is still to do');
  });

  await step('starting the camera starts the set and says where to put the phone', async () => {
    await page.click('#go');
    /* the engine is woken on the tap itself, silently, because Safari will not
       start speaking later — long after the camera and the model are awaited */
    await page.waitForFunction(() => window.__spoken.length > 0, null, { timeout: 5000 });
    const first = (await page.evaluate(() => window.__spoken[0]));
    assert.equal(first.volume, 0, 'the waking utterance is silent: ' + JSON.stringify(first));
    await page.waitForFunction(() => document.getElementById('veil').hidden, null, { timeout: 20000 });
    /* no second tap: the set is already running and recording */
    assert.equal(await page.textContent('#startstop'), 'Finish the set');
    assert.match(await cue(), /camera on the floor/i, 'and the instruction is on screen');
    assert.match(await cue(), /step into the frame/i);
    await heard('camera on the floor');   // and said out loud, not only written
    await page.waitForFunction(() => document.getElementById('v-knee').textContent !== '—', null, { timeout: 10000 });
    const knee = await page.textContent('#v-knee');
    assert.ok(Math.abs(Number(knee) - 90) <= 1, 'a body posed at 90° reads 90° on screen, not ' + knee);
    assert.ok(Math.abs(Number(await page.textContent('#v-shin')) - 90) <= 1, 'and a plumb shin reads 90°');
  });

  await step('the picture and the finish button are on screen together', async () => {
    const box = await page.evaluate(() => {
      const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
      return { stage: r('stage'), button: r('startstop'), h: window.innerHeight };
    });
    assert.ok(box.stage.bottom > 0 && box.stage.bottom < box.h, 'the whole picture is in view');
    assert.ok(box.button.top > box.stage.bottom, 'the button is below the picture');
    assert.ok(box.button.bottom < box.h, 'and both fit without scrolling: button ends at '
      + Math.round(box.button.bottom) + ' of ' + box.h);
  });

  await step('the canvas is painted, and repainted, with the picture the recording gets', async () => {
    const shot = () => page.evaluate(() => {
      const c = document.getElementById('view'), x = c.getContext('2d');
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let sum = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 97) { sum += d[i] + d[i + 1] + d[i + 2]; n++; }
      return { w: c.width, h: c.height, mean: sum / n };
    });
    const a = await shot();
    assert.ok(a.w >= 320 && a.h >= 240, 'it is the camera\'s own size: ' + a.w + 'x' + a.h);
    assert.ok(a.mean > 4, 'something is drawn on it, not a black rectangle: ' + a.mean.toFixed(1));
    await wait(400);
    const b = await shot();
    assert.ok(Math.abs(b.mean - a.mean) > 0.01 || b.mean > 4, 'and it keeps being drawn');
  });

  await step('the legs being too straight is called', async () => {
    await set({ knee: 122 });
    await saw('lower down');
    await heard('lower down');
    assert.match(await chip(), /knee off/i);
  });

  await step('too deep is called the other way', async () => {
    await set({ knee: 70 });
    await saw('come up');
    await heard('come up');
  });

  await step('heels ahead of the knees are told to bring the feet back', async () => {
    await set({ knee: 95, tilt: 2, shin: 108 });
    await saw('feet back');
    await heard('feet back');
    assert.match(await chip(), /shin off/i);
    assert.match(await page.getAttribute('#read-shin', 'class'), /bad/);
  });

  await step('heels behind the knees are told the other way', async () => {
    await set({ shin: 72 });
    await saw('feet forward');
    await heard('feet forward');
  });

  await step('a back off the wall is called', async () => {
    await set({ shin: 90, tilt: 30 });
    await saw('back flat');
    await heard('back flat');
  });

  await step('a good wall sit is told to hold, and the clock runs', async () => {
    await set({ knee: 95, tilt: 2, shin: 90 });
    await saw('hold');
    await heard('that is it');
    /* the readout counts down from sixty, so time banked is what it has come off */
    await page.waitForFunction(() => Number(document.getElementById('hold-v').textContent) < 58.5, null, { timeout: 8000 });
    assert.match(await chip(), /\d+ s left/i);
    assert.match(await page.getAttribute('#read-knee', 'class'), /good/, 'and the reading reads as good');
  });

  await step('the clock stops when the position goes', async () => {
    const left = Number(await page.textContent('#hold-v'));
    await set({ knee: 140 });
    await wait(1200);
    const now = Number(await page.textContent('#hold-v'));
    assert.ok(left - now < 0.4, `the countdown stopped: ${left} → ${now}`);
    assert.match(await page.textContent('#best-v'), /held \d.*best \d/);
  });

  await step('finishing the set writes a video with the cues on it, and a log', async () => {
    await page.click('#startstop');
    await page.waitForSelector('#result:not([hidden])', { timeout: 10000 });
    const out = await page.evaluate(() => ({
      move: document.getElementById('r-move').textContent,
      best: document.getElementById('r-best').textContent,
      cues: Number(document.getElementById('r-cues').textContent),
      rows: [...document.querySelectorAll('#log li')].map((li) => li.textContent),
      canDownload: !document.getElementById('dl-video').disabled,
      note: document.getElementById('rec-note').textContent,
    }));
    assert.equal(out.move, 'Wall sit', 'the set says which exercise it was');
    assert.ok(Number(out.best) >= 1, 'the longest hold was counted: ' + out.best);
    assert.ok(out.cues >= 3, 'the corrections were counted: ' + out.cues);
    assert.ok(out.rows.length >= 4 && /\d+\.\ds —/.test(out.rows[0]), 'the log has times and words: ' + JSON.stringify(out.rows.slice(0, 3)));
    assert.ok(out.canDownload, 'and there is a video to download — ' + out.note);
    assert.match(out.note, /MB/, 'with something in it: ' + out.note);
  });

  await step('the downloaded file is a real video', async () => {
    const dl = page.waitForEvent('download');
    await page.click('#dl-video');
    const d = await dl;
    const name = d.suggestedFilename();
    assert.match(name, /^wallsit-.*\.(mp4|webm)$/, name);
    const path = await d.path();
    const { size } = await (await import('node:fs/promises')).stat(path);
    assert.ok(size > 20000, 'it has frames in it: ' + size + ' bytes');
    console.log('      ' + name + ', ' + (size / 1e6).toFixed(2) + ' MB');
  });

  await step('switching to the plank changes what is measured and what is shown', async () => {
    await set({ move: 'plank', stack: 0, sag: 0 });
    await page.selectOption('#move', 'plank');
    await page.waitForSelector('#read-stack');
    assert.equal(await page.textContent('#band-stack'), '-5 to 15', 'the shoulder band');
    assert.equal(await page.textContent('#band-line'), '±5', 'the hip band');
    assert.equal(await page.$('#read-knee'), null, 'and the wall sit\'s readings are gone');
    await page.click('#startstop');
    await page.waitForFunction(() => document.getElementById('v-line').textContent !== '—', null, { timeout: 10000 });
    assert.ok(Math.abs(Number(await page.textContent('#v-line'))) <= 1, 'a straight plank reads zero at the hip');
    assert.ok(Math.abs(Number(await page.textContent('#v-stack'))) <= 1, 'and a plumb arm reads zero');
  });

  await step('hips above the line are told to come down', async () => {
    await set({ sag: 12 });
    await saw('lower your hips');
    await heard('lower your hips');
    assert.match(await chip(), /hip off/i);
  });

  await step('hips below the line are told to lift', async () => {
    await set({ sag: -12 });
    await saw('lift your hips');
    await heard('lift your hips');
  });

  await step('shoulders behind the elbows are called before the hips, however far the hips are out', async () => {
    /* six degrees behind the elbows against twenty past the hip band: the base still
       goes first. Six is inside the plank's stronger-wording line, so this is the
       plain cue rather than the emphatic one. */
    await set({ stack: -11, sag: 25 });
    await saw('shoulders over your elbows');
    await heard('shoulders over your elbows');
  });

  await step('a good plank holds, and its own countdown calls the time and ends', async () => {
    /* six seconds rather than sixty, because the target and the calls are settings —
       which is the other thing this proves */
    await page.click('#settings-btn');
    await page.fill('#cfg-target', '6');
    await page.dispatchEvent('#cfg-target', 'change');
    await page.fill('#cfg-calls', '4, 2');
    await page.dispatchEvent('#cfg-calls', 'change');
    await page.click('#startstop');            // finish the running set
    await page.click('#startstop');            // and start a fresh one on the new target
    await set({ stack: 5, sag: 1 });
    await saw('4 seconds left', 12000);
    await saw('2 seconds left', 12000);
    await saw('6 seconds . done', 12000);
    assert.match(await chip(), /done/i);
    assert.equal(await page.textContent('#hold-v'), '0.0', 'nothing left to do');
    await page.click('#startstop');
    await page.waitForSelector('#result:not([hidden])', { timeout: 10000 });
    assert.equal(await page.textContent('#r-move'), 'Elbow plank');
    assert.ok(Number(await page.textContent('#r-hold')) >= 6, 'the full target was held');
    const rows = await page.$$eval('#log li', (ls) => ls.map((l) => l.textContent));
    assert.ok(rows.some((t) => /4 seconds left/.test(t)) && rows.some((t) => /done/.test(t)),
      'and the calls are in the log: ' + JSON.stringify(rows));
  });

  await step('the settings change what is judged', async () => {
    await page.fill('#cfg-hipLine', '2');
    await page.dispatchEvent('#cfg-hipLine', 'change');
    assert.equal(await page.textContent('#band-line'), '±2');
    await page.click('#startstop');
    await set({ stack: 0, sag: 4 });
    await page.waitForFunction(() => /hip off/i.test(document.getElementById('state').textContent), null, { timeout: 8000 });
  });

  await step('every cue that was written was also said out loud', async () => {
    const said = await spoken();
    const written = await page.$$eval('#log li', (ls) => ls.map((l) => l.textContent.replace(/^[\d.]+s\s*—\s*/, '')));
    const missing = written.filter((t) => !said.some((u) => u === t));
    assert.deepEqual(missing, [], 'these reached the log but never the voice: ' + JSON.stringify(missing));
    assert.ok(said.length > 10, 'and there was plenty of it: ' + said.length);
  });

  await step('a plank wants a wide frame, and says so when it does not have one', async () => {
    assert.equal(await page.isVisible('#orient'), false, 'nothing to say about a landscape frame');
    /* stand the frame up under it: the next painted frame should notice */
    await page.evaluate(() => { const c = document.getElementById('view'); c.width = 720; c.height = 1280; });
    await page.waitForSelector('#orient:not([hidden])', { timeout: 6000 });
    assert.match(await page.textContent('#orient'), /turn the phone on its side/i);
    await heard('turn the phone on its side');
    await page.evaluate(() => { const c = document.getElementById('view'); c.width = 1280; c.height = 720; });
    await page.waitForFunction(() => document.getElementById('orient').hidden, null, { timeout: 6000 });
  });

  await step('the exercise and its bands are remembered across a reload', async () => {
    await page.reload();
    await page.waitForSelector('#go');
    assert.equal(await page.inputValue('#move'), 'plank', 'it comes back on the plank');
    assert.equal(await page.textContent('#band-line'), '±2', 'with the band that was set');
  });

  await step('no JS errors along the way', () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  server.close();
}

const bad = steps.filter((s) => !s).length;
console.log(`\n${steps.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
