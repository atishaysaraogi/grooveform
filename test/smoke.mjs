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
const Mp4 = createRequire(import.meta.url)('../public/js/mp4.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* The same bodies the unit tests pose, built in the page so the app sees ordinary
   landmarks. Which one is built follows `__pose.move`, so switching exercise in the
   UI switches what the stand-in camera is showing, as a real person would. */
const POSE_SRC = `
const D = Math.PI / 180;
/* the frame the camera is actually giving, which is not the same for every move:
   the knee raise asks for a tall one. A stand-in that assumed a shape would pose
   bodies the app then reads at the wrong scale. */
function aspect() {
  const cam = document.getElementById('cam');
  return cam && cam.videoWidth ? cam.videoWidth / cam.videoHeight : 16 / 9;
}
const SIDE = { L: { ear:7, shoulder:11, elbow:13, wrist:15, hip:23, knee:25, ankle:27, heel:29, toe:31 },
               R: { ear:8, shoulder:12, elbow:14, wrist:16, hip:24, knee:26, ankle:28, heel:30, toe:32 } };
window.__pose = { move: 'wallsit', knee: 90, shin: 90, tilt: 0, stack: 0, sag: 0,
                  thigh: 0, kneeUp: 180, foot: 90, bShin: 95, dip: 50, hipAng: 130, bFoot: 0, vis: 0.95 };

function wallsitBody(o, f) {
  const thigh = 0.2, shinLen = 0.22, torso = 0.26;
  const knee = { x: 0.34, y: 0.48 };      // placed for the tall frame this move asks for
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
function kneeraiseBody(o, f) {
  const thighLen = 0.17, shinLen = 0.16, heelDrop = 0.03, footLen = 0.08, torso = 0.22, hipAt = [0.22, 0.42];
  const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  const leg = (lift, bend, ang) => {
    const hip = { x: hipAt[0], y: hipAt[1] };
    const dir = { x: f * Math.sin(lift * D), y: Math.cos(lift * D) };
    const knee = { x: hip.x + thighLen * dir.x, y: hip.y + thighLen * dir.y };
    const sd = rot(dir, (180 - bend) * D * f);
    const ankle = { x: knee.x + shinLen * sd.x, y: knee.y + shinLen * sd.y };
    const heel = { x: ankle.x + heelDrop * sd.x, y: ankle.y + heelDrop * sd.y };
    const fd = rot({ x: -sd.x, y: -sd.y }, ang * D * f);
    return { hip, knee, ankle, heel,
      toe: { x: heel.x + footLen * fd.x, y: heel.y + footLen * fd.y } };
  };
  const shoulder = { x: hipAt[0], y: hipAt[1] - torso };
  const top = { shoulder, ear: { x: shoulder.x + f * 0.012, y: shoulder.y - 0.06 } };
  /* two legs, not one copied: the raised one and the one holding him up. That is
     what makes the app's choice of which leg to measure a real choice here. */
  return { R: Object.assign({}, top, leg(o.thigh, o.kneeUp, o.foot)),
    L: Object.assign({}, top, leg(0, 180, 90)) };
}
/* on the back, side on: the same rig as bridge.test.js */
function bridgeBody(o, f) {
  const footLen = 0.07, shinLen = 0.15, thighLen = 0.17, torso = 0.2;
  const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  const heel = { x: 0.64, y: 0.68 };
  const toeDir = { x: f * Math.cos(o.bFoot * D), y: Math.sin(o.bFoot * D) };
  const toe = { x: heel.x + footLen * toeDir.x, y: heel.y + footLen * toeDir.y };
  const sd = rot(toeDir, -f * o.bShin * D);
  const knee = { x: heel.x + shinLen * sd.x, y: heel.y + shinLen * sd.y };
  const ankle = { x: heel.x + shinLen * 0.12 * sd.x, y: heel.y + shinLen * 0.12 * sd.y };
  const td = { x: -f * Math.cos(o.dip * D), y: Math.sin(o.dip * D) };
  const hip = { x: knee.x + thighLen * td.x, y: knee.y + thighLen * td.y };
  const bd = rot({ x: -td.x, y: -td.y }, -f * o.hipAng * D);
  const shoulder = { x: hip.x + torso * bd.x, y: hip.y + torso * bd.y };
  return { heel, toe, knee, ankle, hip, shoulder, ear: { x: shoulder.x - f * 0.05, y: shoulder.y - 0.01 } };
}
window.__poseSource = function () {
  const o = window.__pose; if (!o) return null;
  const A = aspect();
  const B = o.move === 'plank' ? plankBody(o, 1)
    : o.move === 'kneeraise' ? kneeraiseBody(o, 1)
    : o.move === 'bridge' ? bridgeBody(o, 1) : wallsitBody(o, 1);
  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  for (const s of ['L', 'R']) {
    /* side on, most bodies here have their two sides on top of each other; the one
       that does not hands back a limb for each */
    const P = B[s] || B;
    for (const k in SIDE[s]) {
      const p = P[k]; if (!p) continue;
      lm[SIDE[s][k]] = { x: p.x / A, y: p.y, z: 0, visibility: o.vis };
    }
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
    assert.match(await cue(), /stand the phone up on the floor/i, 'and the instruction is on screen');
    assert.match(await cue(), /step into the frame/i);
    await heard('stand the phone up');   // and said out loud, not only written
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

  await step('every fault present is written on the page, not only the one being said', async () => {
    /* the knee too open and the back off the wall at once: the voice takes one, the
       words show both, in the move's order */
    await set({ knee: 130, shin: 90, tilt: 20 });
    /* the readings are smoothed, so the second fault lands a few frames after the first */
    await page.waitForFunction(() => /Too high\s+\u00b7\s+Leaning forward/.test(document.getElementById('faults').textContent), null, { timeout: 8000 });
    const words = await page.textContent('#faults');
    assert.match(words, /^Too high\s+\u00b7\s+Leaning forward$/, 'both faults, in order, and nothing else: ' + words);
    await set({ knee: 95, shin: 90, tilt: 0 });
    await page.waitForFunction(() => document.getElementById('faults').textContent === '', null, { timeout: 8000 });
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
    /* this browser build has no AAC encoder, so the film is silent and the note says
       so rather than pretending; a phone's has one, and the note says that instead */
    assert.match(out.note, /with the sound the microphone heard|silent — this browser cannot encode sound/, out.note);
  });

  await step('the page encodes the film itself, thirty frames a second from the clock and from nowhere else', async () => {
    /* Two real sets on a phone came back wrong from the browser's recorder: one
       with 2415 frames in twelve seconds, most two milliseconds apart, then no
       picture for the last nine; one with 155 distinct frames stamped as if they
       fit in nine tenths of a second, and a sound track that stopped after one. So
       the page takes the frames itself, on its own clock. Here the frames handed to
       the encoder over two seconds of a running set are counted, and have to be the
       clock's rate and no more. */
    await page.click('#startstop');                  // a set of its own, so a film is being made
    await wait(800);
    assert.equal(await page.evaluate(() => window.__app.rec && window.__app.rec.kind), 'codec', 'this browser can encode, so the page does');
    const n = await page.evaluate(() => new Promise((res) => {
      const proto = VideoEncoder.prototype, orig = proto.encode; let count = 0;
      proto.encode = function () { count++; return orig.apply(this, arguments); };
      setTimeout(() => { proto.encode = orig; res(count); }, 2000);
    }));
    /* the lower bound has room for a slow machine: a frame is only taken when the
       canvas has been drawn since the last, and a busy encoder is left to catch up */
    assert.ok(n >= 30 && n <= 75, 'handed over ' + n + ' frames in two seconds; thirty a second is the film');
    await page.click('#startstop');
    await page.waitForSelector('#result:not([hidden])', { timeout: 10000 });
  });

  await step('the recording is as long as the set was, even when the model is slow', async () => {
    /* The failure this guards against: a canvas asked for thirty frames a second
       that is only repainted seven times a second, and an encoder that writes the
       seven at the spacing of thirty. The set then plays back four times too fast.
       So the frames are asked for on a real clock, and this checks the film is the
       length of the thing it filmed with the model made as slow as a phone's. */
    await page.evaluate(() => {
      const src = window.__poseSource;
      window.__quick = src;                          // kept so the slowness can be undone
      window.__poseSource = function (t) {
        const until = performance.now() + 120;      // about seven frames a second
        while (performance.now() < until) { }
        return src(t);
      };
    });
    await page.click('#startstop');                  // a fresh set, timed from here
    const t0 = Date.now();
    await wait(6000);
    await page.click('#startstop');
    const wall = (Date.now() - t0) / 1000;
    await page.waitForSelector('#result:not([hidden])', { timeout: 15000 });
    const film = await page.evaluate(() => new Promise((res) => {
      const blob = window.__app.blob;
      if (!blob) return res({ err: 'nothing was recorded' });
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => res({ duration: v.duration });
      v.onerror = () => res({ err: 'the file would not load' });
      v.src = URL.createObjectURL(blob);
    }));
    assert.ok(!film.err, String(film.err));
    assert.ok(film.duration > 0 && Number.isFinite(film.duration), 'it has a duration: ' + film.duration);
    const off = Math.abs(film.duration - wall) / wall;
    assert.ok(off < 0.2, `the film is ${film.duration.toFixed(2)}s for a set of ${wall.toFixed(2)}s`);
    console.log('      ' + film.duration.toFixed(2) + 's recorded of a ' + wall.toFixed(2) + 's set');
    /* put the speed back, or every step after this one runs at a seventh of the pace */
    await page.evaluate(() => { window.__poseSource = window.__quick; });

    /* and the file itself, frame by frame: every frame lasts about as long as it
       was on screen, none is two milliseconds, the index is in front of the data,
       and the header says how long it is */
    const b64 = await page.evaluate(() => new Promise((res) => {
      const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(window.__app.blob);
    }));
    const f = Mp4.inspect(new Uint8Array(Buffer.from(b64, 'base64')));
    assert.ok(f.moovBeforeMdat, 'the index comes before the data: ' + f.top.join(' '));
    assert.ok(/^(avc1|vp09)$/.test(f.codec), 'a codec players know: ' + f.codec);
    assert.ok(f.samples >= wall * 5, f.samples + ' frames for ' + wall.toFixed(1) + ' s with the model this slow');
    const shortest = Math.min(...f.durations), longest = Math.max(...f.durations);
    assert.ok(shortest >= 0.015, 'no frame is stamped shorter than a sixtieth of a second: ' + shortest.toFixed(4));
    assert.ok(longest <= 1.5, 'and none longer than a stall: ' + longest.toFixed(3));
    assert.ok(Math.abs(f.duration - film.duration) < 0.05, 'the header length is the played length: ' + f.duration.toFixed(2));
    assert.ok(f.keyframes.length >= 1 && f.keyframes[0] === 1, 'the first frame is a key frame');
    assert.ok(f.sizes.every((n) => n > 0));
    console.log('      ' + f.samples + ' frames, ' + f.codec + ', shortest ' + (shortest * 1000).toFixed(0) + ' ms, longest ' + (longest * 1000).toFixed(0) + ' ms');
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
    /* SMOKE_KEEP=<dir> keeps the file, for looking at with other tools */
    if (process.env.SMOKE_KEEP) await (await import('node:fs/promises')).copyFile(path, (await import('node:path')).join(process.env.SMOKE_KEEP, name));
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
    await page.click('#page-btn');              // the plank runs full screen; the settings are on the page
    await page.waitForFunction(() => !document.body.classList.contains('full'), null, { timeout: 3000 });
    assert.equal(await page.isVisible('#full-btn'), true, 'and the way back to the picture is offered');
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
    await page.click('#finish-full');            // a fresh set is full screen again
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

  await step('the canvas is the frame the camera gave, and the box on screen is that shape too', async () => {
    await page.click('#page-btn');              // as a page: full screen, the box is the screen
    await page.waitForFunction(() => !document.body.classList.contains('full'), null, { timeout: 3000 });
    const shot = await page.evaluate(() => {
      const c = document.getElementById('view'), v = document.getElementById('cam');
      const b = document.getElementById('stage').getBoundingClientRect();
      return { cw: c.width, ch: c.height, vw: v.videoWidth, vh: v.videoHeight, bw: b.width, bh: b.height };
    });
    assert.equal(shot.cw, shot.vw, 'the canvas is the frame, not a shape chosen for it');
    assert.equal(shot.ch, shot.vh);
    assert.ok(shot.cw > shot.ch, 'and the plank got a wide one: ' + shot.cw + 'x' + shot.ch);
    /* the stage is given the same shape and a width to match the height it is
       allowed, so the picture is the box rather than a letterbox inside it */
    assert.ok(Math.abs(shot.bw / shot.bh - shot.cw / shot.ch) < 0.02,
      `the box on screen is the picture's shape: ${Math.round(shot.bw)}x${Math.round(shot.bh)} for ${shot.cw}x${shot.ch}`);
    /* and on the way to the eye it is fitted into whatever box the page gives it,
       never stretched to fill one of a different shape */
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('view')).objectFit),
      'contain', 'the canvas is fitted into its box on screen, not stretched to it');
  });

  await step('a frame the wrong way round is bordered, not squashed', async () => {
    /* stand the canvas up under a landscape frame: the picture must keep its own
       proportions and sit in the middle, which is the squash this was reported as */
    await page.evaluate(() => { const c = document.getElementById('view'); c.width = 720; c.height = 1280; });
    await wait(400);
    const bands = await page.evaluate(() => {
      const c = document.getElementById('view'), x = c.getContext('2d');
      const lit = (y) => { const d = x.getImageData(2, y, c.width - 4, 1).data;
        let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]; return sum / (d.length / 4); };
      return { top: lit(Math.round(c.height * 0.08)), middle: lit(Math.round(c.height * 0.5)),
        bottom: lit(Math.round(c.height * 0.92)), w: c.width, h: c.height };
    });
    assert.ok(bands.middle > bands.top + 20 && bands.middle > bands.bottom + 20,
      'the picture sits in a band across the middle with borders above and below, rather than filling a shape that is not its own: '
      + JSON.stringify(bands));
    await page.evaluate(() => { const c = document.getElementById('view'); c.width = 1280; c.height = 720; });
    await wait(400);
  });

  await step('turning the picture is what puts a sideways frame right, and is said when it is needed', async () => {
    /* the plank's frame is already the way it wants it, so there is nothing to say */
    assert.equal(await page.isVisible('#orient'), false);
    /* a quarter turn makes it the wrong way round, which is exactly the state some
       phones hand over on their own, and the app has to notice and say so */
    await page.selectOption('#cfg-rotate', 'right');
    await page.waitForSelector('#orient:not([hidden])', { timeout: 6000 });
    assert.match(await page.textContent('#orient'), /turn the phone on its side/i);
    await heard('turn the phone on its side');
    /* The readings are taken from the turned frame, so a turn moves the ones that are
       taken against vertical. The arm's lean off vertical is one; the hip's bend off
       the shoulder-to-ankle line is not, being an angle at a joint, and would look
       the same whichever way up the frame arrived. That difference is the reason the
       frame is turned before anything is read rather than after. */
    await wait(600);
    const turned = { arm: Number(await page.textContent('#v-stack')), hip: Number(await page.textContent('#v-line')) };
    await page.selectOption('#cfg-rotate', 'off');
    await page.waitForFunction(() => document.getElementById('orient').hidden, null, { timeout: 6000 });
    await wait(600);
    const straight = { arm: Number(await page.textContent('#v-stack')), hip: Number(await page.textContent('#v-line')) };
    assert.ok(Math.abs(turned.arm - straight.arm) > 45,
      `the arm reads ${straight.arm}° upright and ${turned.arm}° on its side`);
    assert.ok(Math.abs(turned.hip - straight.hip) < 2,
      `while the hip's bend is the same either way: ${straight.hip}° and ${turned.hip}°`);
  });

  await step('the camera is asked for its own landscape resolution, the same for every exercise', async () => {
    /* Width and height in a camera request describe the sensor's frame before the
       phone turns it. A phone stood on its end turns a 1280×720 capture into a tall
       picture by itself; asked for 720×1280 it crops a strip out of the sensor and
       turns that instead, which lands as a wide band with the legs gone. So the
       request must be the sensor's own shape whatever the exercise wants. */
    for (const id of ['wallsit', 'kneeraise', 'plank', 'bridge']) {
      await set({ move: id });
      await page.selectOption('#move', id);
      await wait(400);
      const req = await page.evaluate(() => window.__app.cameraRequest);
      assert.equal(req.video.width.ideal, 1280, id + ' asks for the sensor\'s width');
      assert.equal(req.video.height.ideal, 720, id + ' and its height');
      assert.equal(req.video.aspectRatio, undefined, id + ' and dictates no aspect ratio');
      /* and the microphone, with the browser's clean-up off so the spoken cues from
         the phone's own speaker stay on the film */
      assert.equal(req.audio.echoCancellation, false, id + ' asks for the microphone as it is');
    }
    await set({ move: 'kneeraise' });
    await page.selectOption('#move', 'kneeraise');
    await page.waitForFunction(() => document.getElementById('veil-title').textContent === 'Knee raise', null, { timeout: 5000 });
    /* the stand-in camera here cannot turn itself, so a standing exercise gets a wide
       frame, and the app says so in words rather than bending the picture */
    await page.waitForSelector('#orient:not([hidden])', { timeout: 6000 });
    assert.match(await page.textContent('#orient'), /stand the phone up.*wide 1280\u00d7720/i);
    /* and the wrong way round, the page stays a page, notice and all */
    await wait(300);
    assert.equal(await page.evaluate(() => document.body.classList.contains('full')), false, 'not full screen until the phone is turned');
  });

  await step('the knee raise counts reps rather than holding one position', async () => {
    await set({ move: 'kneeraise', thigh: 0, kneeUp: 180, foot: 85 });
    await page.waitForSelector('#read-reps');
    assert.equal(await page.textContent('#band-knee'), '80\u2013100', 'a right angle at the knee, ten either way');
    assert.equal(await page.textContent('#band-foot'), '60\u2013100', 'and the foot, taken at the heel');
    /* the clock belongs to the exercise: ten seconds a rep here, not the minute the
       plank was just using */
    assert.equal(await page.inputValue('#cfg-target'), '10');
    assert.equal(await page.inputValue('#cfg-calls'), '5');
    assert.equal(await page.textContent('#hold-k'), 'left of 10 s');
    /* and it can be changed, a second at a time, which a step of five could not do */
    assert.equal(await page.getAttribute('#cfg-target', 'step'), '1');
    await page.focus('#cfg-target');
    await page.keyboard.press('ArrowUp');
    await page.dispatchEvent('#cfg-target', 'change');
    assert.equal(await page.inputValue('#cfg-target'), '11', 'the arrows move it by one');
    await page.waitForFunction(() => document.getElementById('hold-k').textContent === 'left of 11 s', null, { timeout: 5000 });
    /* two seconds a rep and three of them, so a set finishes inside a test */
    await page.fill('#cfg-target', '2'); await page.dispatchEvent('#cfg-target', 'change');
    await page.fill('#cfg-calls', '1'); await page.dispatchEvent('#cfg-calls', 'change');
    await page.fill('#cfg-repCount', '3'); await page.dispatchEvent('#cfg-repCount', 'change');
    await page.click('#startstop');
    /* the card is rebuilt when the exercise changes, so wait for the count rather
       than reading whatever happens to be in the DOM at this instant */
    await page.waitForFunction(() => document.getElementById('rep-v').textContent === '0', null, { timeout: 5000 });
    await saw('raise one knee');
    await heard('raise one knee');
  });

  await step('a rep is counted on the way back down, not at the top', async () => {
    await set({ thigh: 88, kneeUp: 90, foot: 85 });
    /* no "that is it" asserted here: these reps are two seconds so the coach can
       finish a set inside a test, and a two second hold has no room to say hold and
       then count it down. The unit tests cover that at the real ten. */
    await page.waitForFunction(() => /lower slowly/i.test(document.getElementById('cue').textContent), null, { timeout: 12000 });
    await heard('lower slowly');
    assert.equal(await page.textContent('#rep-v'), '0', 'the top of the rep is not the end of it');
    await set({ thigh: 0, kneeUp: 180, foot: 90 });
    await page.waitForFunction(() => document.getElementById('rep-v').textContent === '1', null, { timeout: 8000 });
  });

  await step('a knee held out of line is corrected, and the knee before the foot', async () => {
    await set({ thigh: 88, kneeUp: 130, foot: 140 });
    await saw('bend your knee');
    await heard('bend your knee');
    await set({ thigh: 88, kneeUp: 90, foot: 140 });
    await saw('pull your toes up');
    await heard('pull your toes up');
  });

  await step('the set ends when the reps are done', async () => {
    for (let i = 0; i < 3; i++) {
      await set({ thigh: 0, kneeUp: 180, foot: 90 });
      await wait(900);
      await set({ thigh: 88, kneeUp: 90, foot: 85 });
      await wait(3400);
      await set({ thigh: 0, kneeUp: 180, foot: 90 });
      await wait(900);
      if (await page.textContent('#rep-v') === '3') break;
    }
    await page.waitForFunction(() => /done/i.test(document.getElementById('state').textContent), null, { timeout: 10000 });
    assert.equal(await page.textContent('#rep-v'), '3');
    await page.click('#startstop');
    await page.waitForSelector('#result:not([hidden])', { timeout: 10000 });
    assert.equal(await page.textContent('#r-move'), 'Knee raise');
    assert.equal(await page.isVisible('#r-reps'), true, 'the set is reported in reps');
    assert.equal(await page.textContent('#r-reps-v'), '3/3');
  });

  await step('the glute bridge: a wide frame, four readings, the feet coached before the lift', async () => {
    await set({ move: 'bridge', bShin: 95, dip: 50, hipAng: 130, bFoot: 0 });
    await page.selectOption('#move', 'bridge');
    await page.waitForFunction(() => document.getElementById('veil-title').textContent === 'Glute bridge', null, { timeout: 5000 });
    await page.waitForSelector('#read-over');
    assert.equal(await page.textContent('#band-shin'), '85\u2013110', 'the shin at the heel');
    assert.equal(await page.textContent('#band-hip'), '\u2265 160', 'the line at the top');
    assert.equal(await page.textContent('#band-over'), '\u2264 3', 'the hips no higher than the knees');
    assert.equal(await page.textContent('#band-foot'), '\u00b110', 'the feet flat');
    assert.equal(await page.inputValue('#cfg-target'), '2', 'a two second squeeze at the top');
    assert.equal(await page.textContent('#target-label'), 'Hold at the top for');
    /* a wide frame is what it wants, and the stand-in gives one, so no notice */
    await wait(400);
    assert.equal(await page.isHidden('#orient'), true, 'lying down suits a phone on its side');
    await page.fill('#cfg-repCount', '2'); await page.dispatchEvent('#cfg-repCount', 'change');
    await page.click('#startstop');
    await page.waitForFunction(() => document.getElementById('rep-v').textContent === '0', null, { timeout: 5000 });
    await page.waitForFunction(() => document.getElementById('v-hip').textContent !== '\u2014', null, { timeout: 10000 });
    /* the phone is the way this one wants it and a set is running, so the picture
       takes the whole screen: the stage is the viewport, and the finish button is
       on it */
    await page.waitForFunction(() => document.body.classList.contains('full'), null, { timeout: 5000 });
    const box = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.x, r.y, r.width, r.height, innerWidth, innerHeight]; });
    assert.deepEqual(box.slice(0, 4), [0, 0, box[4], box[5]], 'the stage is the whole screen: ' + box.join(','));
    assert.equal(await page.isVisible('#finish-full'), true, 'with the finish button on it');
    assert.ok(Math.abs(Number(await page.textContent('#v-hip')) - 130) <= 1, 'lying there reads the hip angle');
    assert.ok(Math.abs(Number(await page.textContent('#v-over')) + 50) <= 1, 'and the hip fifty below the knee');
    /* feet too far out: said before the lift is asked for */
    await set({ bShin: 70 });                     // fifteen past the band, so the stronger words
    await saw('feet in');
    await heard('feet in');
    await set({ bShin: 95 });
    await saw('lift your hips');
  });

  await step('a bridge lifted past the knees is told so, and a rep counts on the way down', async () => {
    await set({ bShin: 95, dip: -10, hipAng: 150, bFoot: 0 });
    await saw('no higher than your knees');
    await heard('no higher than your knees');
    await set({ bShin: 95, dip: 5, hipAng: 170, bFoot: 0 });
    await page.waitForFunction(() => /lower slowly/i.test(document.getElementById('cue').textContent), null, { timeout: 12000 });
    assert.equal(await page.textContent('#rep-v'), '0', 'the top is not the rep');
    /* SMOKE_SHOT=<dir> keeps a picture of the top of the rep, for looking at */
    if (process.env.SMOKE_SHOT) await page.screenshot({ path: (await import('node:path')).join(process.env.SMOKE_SHOT, 'bridge-top.png') });
    await set({ dip: 25, hipAng: 145 });
    await wait(1300);
    await set({ dip: 50, hipAng: 130 });
    await page.waitForFunction(() => document.getElementById('rep-v').textContent === '1', null, { timeout: 8000 });
    await page.click('#finish-full');                // the button on the picture ends the set
    await page.waitForSelector('#result:not([hidden])', { timeout: 10000 });
    assert.equal(await page.evaluate(() => document.body.classList.contains('full')), false, 'and the page is a page again');
    assert.equal(await page.textContent('#r-move'), 'Glute bridge');
    assert.equal(await page.textContent('#r-reps-v'), '1/2');
    /* back to the knee raise, which the reload step below expects to find */
    await set({ move: 'kneeraise' });
    await page.selectOption('#move', 'kneeraise');
    await page.waitForFunction(() => document.getElementById('veil-title').textContent === 'Knee raise', null, { timeout: 5000 });
  });

  await step('the exercise and its bands are remembered across a reload', async () => {
    await page.reload();
    await page.waitForSelector('#go');
    assert.equal(await page.inputValue('#move'), 'kneeraise', 'it comes back on the last exercise used');
    assert.equal(await page.inputValue('#cfg-repCount'), '3', 'with the rep count that was set');
    /* and the plank's own band, changed two exercises ago, is still its own */
    await page.selectOption('#move', 'plank');
    await page.waitForSelector('#read-line');
    assert.equal(await page.textContent('#band-line'), '±2', 'each exercise keeps its own settings');
  });

  await step('the pose model has a thread of its own, and it answers', async () => {
    /* the model itself is never loaded here — the stand-in stands in for it — but the
       worker that would run it has to be a module the browser can start, and it has
       to answer, or a phone falls back to reading frames on the page's own thread
       and the recording judders again */
    const reply = await page.evaluate(() => new Promise((res) => {
      let w;
      try { w = new Worker('js/pose-worker.js', { type: 'module' }); } catch (e) { return res('could not start: ' + e.message); }
      const t = setTimeout(() => res('no answer'), 8000);
      w.onmessage = (e) => { clearTimeout(t); w.terminate(); res(e.data && e.data.type); };
      w.onerror = (e) => { clearTimeout(t); res('error: ' + (e.message || 'unknown')); };
      w.postMessage({ type: 'ping' });
    }));
    assert.equal(reply, 'pong', reply);
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
