'use strict';
// Solo mode (the default): no sign-in, plans or curators anywhere; everything free; an anonymous set runs and ends with "Done".
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const assert = require('node:assert/strict');
const { chromium } = require('playwright');
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fyzio-solo-')), 'solo.sqlite'); process.env.PORT = '0'; process.env.NODE_ENV = 'test';
const { start, server } = require('../server/index.js');
const SHOTS = path.join(__dirname, '..', 'docs', 'screenshots');
(async () => {
  await start(); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage(); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/#/'); await page.waitForSelector('.tile');
  const body = await page.innerText('body');
  for (const banned of [/Sign in/, /Find a (curator|coach)/, /Pricing/, /\bPro\b/, /\bPass\b/, /\bFree\b/, /₹/]) assert.ok(!banned.test(body), 'solo home must not mention: ' + banned);
  assert.equal(await page.$('#btn-login:not([hidden])'), null, 'no sign-in button');
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(body), 'no emoji on the home page');
  const titles = await page.$$eval('.tiles', cols => cols.map(c => [...c.querySelectorAll('.tile .name')].map(n => n.textContent.trim())));
  assert.equal(titles[0].length, 10, 'ten moves'); assert.ok((await page.$$('.playlist')).length >= 6, 'six playlists, one per row');
  await page.screenshot({ path: path.join(SHOTS, 'solo-home.png'), fullPage: true });
  // routines are distinct sets of exercises
  const pre = await page.evaluate(async () => (await (await fetch('/api/routines/prebuilt')).json()).routines.map(r => r.items.map(i => i.exerciseId).sort().join('+')));
  assert.equal(new Set(pre).size, pre.length, 'every prebuilt routine has a different exercise set: ' + pre.join(' | '));
  // exercise page: one config tile with reps + sets + rest, top-down camera diagram only, no side view
  await page.goto(base + '/#/exercise/heelslide'); await page.waitForSelector('#do-start');
  const cfg = await page.innerText('.card.config'); assert.ok(/Reps per set|Hold time/.test(cfg) && cfg.includes('Sets') && cfg.includes('Rest between sets'), 'reps, sets and rest in one tile');
  assert.ok(await page.$('svg.cam-diagram.top') && !(await page.$('svg.cam-diagram:not(.top)')), 'only the from-above diagram'); assert.ok(await page.$('canvas.demo-fig[data-anat]'), 'anatomical move figure');
  assert.ok(/Phone on the floor/.test(await page.innerText('#view')), 'camera sentence'); assert.ok((await page.$$('.guide .tag.cam')).length > 3 && (await page.$$('.guide .tag.you')).length > 1, 'guide uses camera/you tags, no bullets');
  assert.equal(await page.$('.card.upgrade'), null, 'nothing locked');
  await page.screenshot({ path: path.join(SHOTS, 'solo-exercise.png'), fullPage: true });
  // settings page exists with voice toggle
  await page.goto(base + '/#/settings'); await page.waitForSelector('#cs-voice'); assert.ok(await page.$('#cs-voicename'));
  assert.deepEqual(errors, []);
  await browser.close(); server.close(); console.log('solo mode: ok'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
