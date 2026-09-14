'use strict';
// The Studio's "Save into the project": a dev-only route that checks a moves file the way the app loads it,
// writes it, and re-reads the library — against a scratch copy of client/data/, never the real one.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fyzio-data-'));
const DATA = path.join(tmp, 'data'); fs.cpSync(path.join(__dirname, '..', 'client', 'data'), DATA, { recursive: true });
Object.assign(process.env, { DB_PATH: path.join(tmp, 'test.sqlite'), PORT: '0', NODE_ENV: 'development', NOTIFY_PROVIDER: 'console', PAYMENT_PROVIDER: 'mock', SOLO_MODE: 'true', FREE_EXERCISES: 'all', GROOVEFORM_DATA_DIR: DATA });
const { start, server } = require('../server/index.js');
const catalog = require('../client/coach/catalog.js');
let base;
const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => null) }; };
const knee = () => JSON.parse(fs.readFileSync(path.join(DATA, 'moves', 'knee.json'), 'utf8'));

before(async () => { await start(); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('the dev route is there in development and names the files', async () => {
  const r = await call('GET', '/api/dev/catalog');
  assert.equal(r.status, 200); assert.ok(r.data.files.includes('moves/knee.json')); assert.equal(r.data.dir, DATA);
});

test('a file that checks clean is written in the shared style and the library re-reads it', async () => {
  const before = (await call('GET', '/api/exercises')).data.exercises.length;
  const j = knee(); const copy = JSON.parse(JSON.stringify(j.moves.find((m) => m.id === 'seated_knee_ext')));
  copy.id = 'seated_knee_ext_slow'; copy.name = 'Seated knee extension (slow)'; copy.faults[0].threshold = 62; copy._note = 'saved from the test';
  j.moves.push(copy);
  const r = await call('PUT', '/api/dev/catalog/knee', j);
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.moves, j.moves.length); assert.equal(r.data.library, before + 1);
  assert.equal(fs.readFileSync(path.join(DATA, 'moves', 'knee.json'), 'utf8'), catalog.format(j) + '\n', 'written in the one style the tools share');
  const list = (await call('GET', '/api/exercises')).data.exercises;
  assert.equal(list.length, before + 1);
  const added = list.find((e) => e.id === 'seated_knee_ext_slow'); assert.ok(added && added.tracking === 'form' && added.faults.some((f) => f.id === 'leanback' && f.tracked), 'the saved move is live in the API with its checks');
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'client', 'data', 'moves', 'knee.json.bak')), 'nothing touched the real data folder');
  assert.ok(!JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'client', 'data', 'moves', 'knee.json'), 'utf8'))).includes('seated_knee_ext_slow'));
});

test('a file with a mistake is refused with the problems and nothing is written', async () => {
  const before = fs.readFileSync(path.join(DATA, 'moves', 'knee.json'), 'utf8');
  const j = knee(); j.moves[0].sumary = 'typo'; j.moves[1].faults.push({ template: 'lean' });
  const r = await call('PUT', '/api/dev/catalog/knee', j);
  assert.equal(r.status, 400); assert.equal(r.data.problems.length, 2, JSON.stringify(r.data));
  assert.match(r.data.problems[0], /did you mean "summary"/); assert.match(r.data.problems[1], /template "lean" has no threshold/);
  assert.equal(fs.readFileSync(path.join(DATA, 'moves', 'knee.json'), 'utf8'), before);
  const bad = await call('PUT', '/api/dev/catalog/Knee File', j); assert.equal(bad.status, 400);
});

test('a new region file is created and listed in the manifest', async () => {
  const j = knee(); const file = { _about: j._about, region: 'neck_extra', group: 'Neck — extra', order: 2500, camera: j.camera, sources: [], moves: [{ ...j.moves[0], id: 'quad_set_copy', name: 'Quad set copy' }] };
  const r = await call('PUT', '/api/dev/catalog/neck_extra', file);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
  assert.ok(manifest.moves.includes('moves/neck_extra.json'));
  assert.ok((await call('GET', '/api/exercises')).data.exercises.some((e) => e.id === 'quad_set_copy' && e.group === 'Neck — extra'));
});
