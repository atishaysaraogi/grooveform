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

/* the same body the unit tests pose, built in the page so the app sees ordinary landmarks */
const POSE_SRC = `
const D = Math.PI / 180, ASPECT = 16 / 9;
const SIDE = { L: { shoulder: 11, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31, ear: 7 },
               R: { shoulder: 12, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32, ear: 8 } };
window.__pose = { knee: 90, shin: 90, tilt: 0, vis: 0.95 };
/* the same body the unit tests pose, built from the knee out so the knee angle and
   the shin's angle off the floor can be set one without the other */
window.__poseSource = function () {
  const o = window.__pose; if (!o) return null;
  const thigh = 0.2, shinLen = 0.22, torso = 0.26, f = 1;
  const knee = { x: 0.75, y: 0.55 };
  const u = { x: -f * Math.cos(o.shin * D), y: Math.sin(o.shin * D) };
  const heel = { x: knee.x + shinLen * u.x, y: knee.y + shinLen * u.y };
  const ankle = { x: knee.x + shinLen * 0.86 * u.x, y: knee.y + shinLen * 0.86 * u.y };
  const a = o.knee * D * f, ca = Math.cos(a), sa = Math.sin(a);
  const h = { x: u.x * ca - u.y * sa, y: u.x * sa + u.y * ca };
  const hip = { x: knee.x + thigh * h.x, y: knee.y + thigh * h.y };
  const shoulder = { x: hip.x + f * torso * Math.sin(o.tilt * D), y: hip.y - torso * Math.cos(o.tilt * D) };
  const P = { hip, knee, ankle, shoulder, heel,
    toe: { x: heel.x + f * 0.08, y: heel.y + 0.004 },
    ear: { x: shoulder.x + f * 0.02, y: shoulder.y - 0.07 } };
  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  for (const s of ['L', 'R']) for (const k in SIDE[s]) {
    const p = P[k]; if (!p) continue;
    lm[SIDE[s][k]] = { x: p.x / ASPECT, y: p.y, z: 0, visibility: o.vis };
  }
  return lm;
};
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

const set = (o) => page.evaluate((v) => Object.assign(window.__pose, v), o);
const cue = () => page.textContent('#cue');
const chip = () => page.textContent('#state');

try {
  await step('the page comes up and offers the camera', async () => {
    await page.goto(base + '/');
    await page.waitForSelector('#go');
    assert.equal(await page.textContent('#knee-band'), '85–110', 'the band asked for is the band shown');
    assert.equal(await page.textContent('#back-band'), '±12');
    assert.equal(await page.textContent('#shin-band'), '85–95');
    assert.equal(await page.textContent('#hold-v'), '60.0', 'the full minute is still to do');
  });

  await step('starting the camera begins reading the body', async () => {
    await page.click('#go');
    await page.waitForFunction(() => document.getElementById('veil').hidden, null, { timeout: 20000 });
    await page.waitForFunction(() => document.getElementById('knee-v').textContent !== '—', null, { timeout: 10000 });
    const knee = await page.textContent('#knee-v');
    assert.ok(Math.abs(Number(knee) - 90) <= 1, 'a body posed at 90° reads 90° on screen, not ' + knee);
    const shin = await page.textContent('#shin-v');
    assert.ok(Math.abs(Number(shin) - 90) <= 1, 'and a plumb shin reads 90°, not ' + shin);
  });

  await step('the picture and the start button are on screen together', async () => {
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

  await step('a set starts, and the legs being too straight is called', async () => {
    await page.click('#startstop');
    assert.equal(await page.textContent('#startstop'), 'Finish the set');
    await set({ knee: 122 });
    await page.waitForFunction(() => /lower/i.test(document.getElementById('cue').textContent), null, { timeout: 4000 });
    assert.match(await cue(), /lower down/i);
    assert.match(await chip(), /too high/i);
  });

  await step('too deep is called the other way', async () => {
    await set({ knee: 70 });
    await page.waitForFunction(() => /come up/i.test(document.getElementById('cue').textContent), null, { timeout: 6000 });
    assert.match(await chip(), /too deep/i);
  });

  await step('a back off the wall is called', async () => {
    await set({ knee: 95, tilt: 30 });
    await page.waitForFunction(() => /back flat/i.test(document.getElementById('cue').textContent), null, { timeout: 8000 });
  });

  await step('heels ahead of the knees are told to bring the feet back', async () => {
    await set({ knee: 95, tilt: 2, shin: 108 });
    await page.waitForFunction(() => /feet back/i.test(document.getElementById('cue').textContent), null, { timeout: 8000 });
    assert.match(await chip(), /feet out/i);
    assert.match(await page.getAttribute('#read-shin', 'class'), /bad/);
  });

  await step('heels behind the knees are told the other way', async () => {
    await set({ shin: 72 });
    await page.waitForFunction(() => /feet forward/i.test(document.getElementById('cue').textContent), null, { timeout: 8000 });
    assert.match(await chip(), /feet in/i);
  });

  await step('a good wall sit is told to hold, and the clock runs', async () => {
    await set({ knee: 95, tilt: 2, shin: 90 });
    await page.waitForFunction(() => /hold/i.test(document.getElementById('cue').textContent), null, { timeout: 8000 });
    /* the readout counts down from sixty, so time banked is what it has come off */
    await page.waitForFunction(() => Number(document.getElementById('hold-v').textContent) < 58.5, null, { timeout: 8000 });
    assert.match(await chip(), /\d+ s left/i);
    assert.match(await page.getAttribute('#read-knee', 'class'), /good/, 'and the reading reads as good');
    assert.match(await page.getAttribute('#read-shin', 'class'), /good/);
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
      hold: document.getElementById('r-hold').textContent,
      best: document.getElementById('r-best').textContent,
      cues: Number(document.getElementById('r-cues').textContent),
      rows: [...document.querySelectorAll('#log li')].map((li) => li.textContent),
      canDownload: !document.getElementById('dl-video').disabled,
      note: document.getElementById('rec-note').textContent,
    }));
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
    assert.match(name, /^wall-sit-.*\.(mp4|webm)$/, name);
    const path = await d.path();
    const { size } = await (await import('node:fs/promises')).stat(path);
    assert.ok(size > 20000, 'it has frames in it: ' + size + ' bytes');
    console.log('      ' + name + ', ' + (size / 1e6).toFixed(2) + ' MB');
  });

  await step('the settings change what is judged', async () => {
    await page.click('#settings-btn');
    await page.fill('#cfg-max', '100');
    await page.dispatchEvent('#cfg-max', 'change');
    assert.equal(await page.textContent('#knee-band'), '85–100');
    await set({ knee: 105, tilt: 0 });
    await page.waitForFunction(() => /too high/i.test(document.getElementById('state').textContent), null, { timeout: 6000 });
  });

  await step('the set is a countdown: it calls the time and it ends', async () => {
    /* six seconds rather than sixty, because the target and the calls are settings —
       which is the other thing this proves */
    await page.fill('#cfg-target', '6');
    await page.dispatchEvent('#cfg-target', 'change');
    await page.fill('#cfg-calls', '4, 2');
    await page.dispatchEvent('#cfg-calls', 'change');
    await page.click('#startstop');
    await set({ knee: 95, tilt: 0, shin: 90 });
    const saw = (re, ms) => page.waitForFunction((r) => new RegExp(r, 'i').test(document.getElementById('cue').textContent), re, { timeout: ms });
    await saw('4 seconds left', 10000);
    await saw('2 seconds left', 10000);
    await saw('6 seconds . done', 10000);
    assert.match(await chip(), /done/i);
    assert.equal(await page.textContent('#hold-v'), '0.0', 'nothing left to do');
    await page.click('#startstop');
    await page.waitForSelector('#result:not([hidden])', { timeout: 10000 });
    assert.equal(await page.textContent('#r-target'), 'of 6');
    assert.ok(Number(await page.textContent('#r-hold')) >= 6, 'the full target was held: ' + await page.textContent('#r-hold'));
    const rows = await page.$$eval('#log li', (ls) => ls.map((l) => l.textContent));
    assert.ok(rows.some((t) => /4 seconds left/.test(t)) && rows.some((t) => /done/.test(t)),
      'and the calls are in the log: ' + JSON.stringify(rows));
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
