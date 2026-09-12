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
  await page.click('.playlist'); await page.waitForSelector('.item-row'); assert.ok((await page.$$('.item-row')).length >= 2, 'playlist detail loaded from api/routines/<id>');
  await page.click('a.btn.primary.small'); await page.waitForSelector('#do-start'); assert.ok((await page.innerText('#view')).includes('From “'), 'move page with playlist context');
  assert.deepEqual(errors, []); await browser.close(); srv.close(); console.log('static build: ok'); process.exit(0);
});
