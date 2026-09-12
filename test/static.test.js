'use strict';
// The static build (dist/) must work served as plain files from a sub-path, exactly like GitHub Pages: no API server behind it.
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const DIST = path.join(__dirname, '..', 'dist'); if (!fs.existsSync(path.join(DIST, 'api', 'me'))) { console.error('run: node scripts/build-static.js first'); process.exit(1); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0]); if (!u.startsWith('/repo/')) { res.writeHead(404); return res.end(); } let f = path.join(DIST, u.slice(6) || 'index.html'); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); if (!fs.existsSync(f)) { res.writeHead(404); return res.end('nope'); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
srv.listen(0, async () => {
  const base = `http://127.0.0.1:${srv.address().port}/repo/`; const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); const errors = [];
  const page = await browser.newPage({ viewport: { width: 400, height: 860 } }); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base); await page.waitForSelector('.tile', { timeout: 15000 });
  assert.equal((await page.$$('.tile')).length, 10, 'ten moves from the static catalogue'); assert.equal((await page.$$('.playlist')).length, 6, 'six playlists');
  await page.click('.playlist'); await page.waitForSelector('.rt-item'); assert.ok((await page.$$('.rt-item')).length >= 2, 'playlist detail loaded from api/routines/<id>');
  assert.ok((await page.$$('.rt-config .chip')).length > 0, 'every move on the playlist is configurable in place');
  assert.equal((await page.$$('.rt-start')).length, 1, 'one start button for the whole routine');
  assert.equal((await page.$$('.rt-item .item-row a.btn.primary')).length, 0, 'no per-exercise start buttons');
  // a single move still opens on its own, with its own options
  await page.goto(base); await page.waitForSelector('.tile'); await page.click('.tile'); await page.waitForSelector('#do-start');
  assert.ok((await page.$$('.card.config .chip')).length > 0, 'move page keeps its own options');
  assert.deepEqual(errors, []);

  // Text must stay legible in both themes: the palette's grape/violet become the *background* in
  // dark mode, so anything that named them directly used to vanish. Guard the worst offenders.
  const contrast = `(() => {
    const lum = (c) => { const [r,g,b] = c.match(/\\d+/g).map(Number).map(v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*r+0.7152*g+0.0722*b; };
    const ratio = (a,b) => { const x=lum(a), y=lum(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); };
    const bg = getComputedStyle(document.body).backgroundColor;
    const at = (sel) => { const el = document.querySelector(sel); return el ? ratio(getComputedStyle(el).color, bg) : null; };
    return { l1: at('.hero h1 .l1'), l2: at('.hero h1 .l2'), l3: at('.hero h1 .l3'), nav: at('.topnav a') };
  })()`;
  for (const scheme of ['dark', 'light']) {
    const pg = await browser.newPage({ viewport: { width: 400, height: 860 }, colorScheme: scheme });
    await pg.goto(base); await pg.waitForSelector('.hero h1 .l1');
    const r = await pg.evaluate(contrast);
    for (const [k, v] of Object.entries(r)) { assert.ok(v !== null, `${k} present in ${scheme}`); assert.ok(v >= 3, `${k} contrast ${Number(v).toFixed(2)} too low on ${scheme} background`); }
    await pg.close();
  }
  // The camera overlay used to cover the HUD, so a person the model could not find had no way
  // out: no buttons on the overlay and an unclickable exit. The ✕ must win the hit test.
  const esc = await browser.newPage({ viewport: { width: 400, height: 860 } });
  await esc.goto(base); await esc.waitForSelector('.tile');
  const hit = await esc.evaluate(() => {
    document.getElementById('coach').hidden = false;
    document.getElementById('screen-live').classList.add('active');
    const ov = document.getElementById('overlay-msg'); ov.hidden = false;
    const x = document.getElementById('btn-exit'); const r = x.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { onTop: top === x || x.contains(top), overlayVisible: !ov.hidden };
  });
  assert.ok(hit.overlayVisible, 'overlay is up');
  assert.ok(hit.onTop, 'the exit button stays clickable while the camera overlay is showing');
  await esc.close();

  await browser.close(); srv.close(); console.log('static build: ok'); process.exit(0);
});
