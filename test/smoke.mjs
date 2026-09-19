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
window.__pose = { knee: 90, tilt: 0, vis: 0.95 };
window.__poseSource = function () {
  const o = window.__pose; if (!o) return null;
  const thigh = 0.2, shin = 0.22, torso = 0.26, f = 1;
  const hip = { x: 0.55, y: 0.5 };
  const knee = { x: hip.x + f * thigh, y: hip.y };
  const phi = (180 - o.knee) * D;
  const ankle = { x: knee.x + f * shin * Math.cos(phi), y: knee.y + shin * Math.sin(phi) };
  const shoulder = { x: hip.x + f * torso * Math.sin(o.tilt * D), y: hip.y - torso * Math.cos(o.tilt * D) };
  const P = { hip, knee, ankle, shoulder,
    heel: { x: ankle.x - f * 0.03, y: ankle.y + 0.012 },
    toe: { x: ankle.x + f * 0.06, y: ankle.y + 0.015 },
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
  });

  await step('starting the camera begins reading the body', async () => {
    await page.click('#go');
    await page.waitForFunction(() => document.getElementById('veil').hidden, null, { timeout: 20000 });
    await page.waitForFunction(() => document.getElementById('knee-v').textContent !== '—', null, { timeout: 10000 });
    const knee = await page.textContent('#knee-v');
    assert.ok(Math.abs(Number(knee) - 90) <= 1, 'a body posed at 90° reads 90° on screen, not ' + knee);
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

  await step('a good wall sit is told to hold, and the clock runs', async () => {
    await set({ knee: 95, tilt: 2 });
    await page.waitForFunction(() => /hold/i.test(document.getElementById('cue').textContent), null, { timeout: 8000 });
    await page.waitForFunction(() => Number(document.getElementById('hold-v').textContent) > 1.5, null, { timeout: 8000 });
    assert.match(await chip(), /holding/i);
    const knee = await page.getAttribute('#read-knee', 'class');
    assert.match(knee, /good/, 'and the reading reads as good');
  });

  await step('the clock stops when the position goes', async () => {
    const held = Number(await page.textContent('#hold-v'));
    await set({ knee: 140 });
    await wait(1200);
    const now = Number(await page.textContent('#hold-v'));
    assert.ok(now - held < 0.4, `the hold clock stopped: ${held} → ${now}`);
    assert.match(await page.textContent('#best-v'), /best \d/);
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
