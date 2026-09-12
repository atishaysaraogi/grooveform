'use strict';
// Builds a fully static copy of the app (solo mode) into dist/ for GitHub Pages or any static host:
// the client files plus the JSON the client fetches (api/me, api/exercises, api/routines/prebuilt, api/routines/<id>) written as files.
// Run: node scripts/build-static.js   → dist/
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-build-')), 'build.sqlite'); process.env.PORT = '0'; process.env.NODE_ENV = 'test'; process.env.SOLO_MODE = 'true'; process.env.FREE_EXERCISES = 'all';
const { start, server } = require('../server/index.js');
const ROOT = path.join(__dirname, '..'); const OUT = path.join(ROOT, 'dist');
(async () => {
  await start(); const base = `http://127.0.0.1:${server.address().port}`;
  fs.rmSync(OUT, { recursive: true, force: true }); fs.cpSync(path.join(ROOT, 'client'), OUT, { recursive: true });
  const get = async (p) => (await fetch(base + p)).json();
  const write = (rel, obj) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj)); };
  write('api/me', await get('/api/me')); write('api/exercises', await get('/api/exercises'));
  const pre = await get('/api/routines/prebuilt'); write('api/routines/prebuilt', pre);
  for (const r of pre.routines) write('api/routines/' + r.id, await get('/api/routines/' + r.id));
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');   // GitHub Pages: serve files as-is
  fs.writeFileSync(path.join(OUT, '404.html'), fs.readFileSync(path.join(OUT, 'index.html')));   // deep links reload to the app
  const nEx = (await get('/api/exercises')).exercises.length; server.close(); console.log(`static build written to ${OUT} (${pre.routines.length} playlists, ${nEx} moves)`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
