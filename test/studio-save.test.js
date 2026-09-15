'use strict';
// The Studio's "Save into the project": a dev-only route that checks one exercise the way the app loads
// it — inside its region, against every other id — then writes that one file and re-reads the library.
// Against a scratch copy of client/data/, never the real one.
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
const readMove = (id) => JSON.parse(fs.readFileSync(path.join(DATA, 'moves', id + '.json'), 'utf8'));
const readRegion = (name) => JSON.parse(fs.readFileSync(path.join(DATA, 'regions', name + '.json'), 'utf8'));

before(async () => { await start(); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('the dev route is there in development and names the regions', async () => {
  const r = await call('GET', '/api/dev/catalog');
  assert.equal(r.status, 200); assert.ok(r.data.regions.includes('regions/knee.json')); assert.equal(r.data.dir, DATA);
});

test('one exercise that checks clean is written as its own file and the library re-reads it', async () => {
  const before = (await call('GET', '/api/exercises')).data.exercises.length;
  const copy = readMove('seated_knee_ext');
  copy.id = 'seated_knee_ext_slow'; copy.name = 'Seated knee extension (slow)'; copy.faults[0].threshold = 62; copy._note = 'saved from the test';
  const r = await call('PUT', '/api/dev/catalog/seated_knee_ext_slow', { region: 'knee', move: copy });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.added, true); assert.equal(r.data.library, before + 1);
  assert.equal(fs.readFileSync(path.join(DATA, 'moves', 'seated_knee_ext_slow.json'), 'utf8'), catalog.format(copy) + '\n', 'written in the one style the tools share');
  assert.ok(readRegion('knee').moves.includes('seated_knee_ext_slow'), 'and listed by its region');
  const list = (await call('GET', '/api/exercises')).data.exercises;
  assert.equal(list.length, before + 1);
  const added = list.find((e) => e.id === 'seated_knee_ext_slow'); assert.ok(added && added.tracking === 'form' && added.faults.some((f) => f.id === 'leanback' && f.tracked), 'the saved move is live in the API with its camera-checked faults');
  /* editing it again rewrites that one file and adds nothing to the region */
  const again = readMove('seated_knee_ext_slow'); again.name = 'Seated knee extension (slower)';
  const r2 = await call('PUT', '/api/dev/catalog/seated_knee_ext_slow', { region: 'knee', move: again });
  assert.equal(r2.status, 200); assert.equal(r2.data.added, false);
  assert.equal(readRegion('knee').moves.filter((id) => id === 'seated_knee_ext_slow').length, 1);
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'client', 'data', 'moves', 'seated_knee_ext_slow.json')), 'nothing touched the real data folder');
});

test('an exercise with a mistake is refused with the problems and nothing is written', async () => {
  const before = fs.readFileSync(path.join(DATA, 'moves', 'quad_set.json'), 'utf8');
  const bad = readMove('quad_set'); bad.sumary = 'typo';
  const r = await call('PUT', '/api/dev/catalog/quad_set', { region: 'knee', move: bad });
  assert.equal(r.status, 400); assert.match(r.data.problems.join(' '), /did you mean "summary"/, JSON.stringify(r.data));
  const bad2 = readMove('quad_set'); bad2.faults.push({ template: 'lean' });
  const r2 = await call('PUT', '/api/dev/catalog/quad_set', { region: 'knee', move: bad2 });
  assert.equal(r2.status, 400); assert.match(r2.data.problems.join(' '), /template "lean" has no threshold/);
  assert.equal(fs.readFileSync(path.join(DATA, 'moves', 'quad_set.json'), 'utf8'), before);
  assert.equal((await call('PUT', '/api/dev/catalog/Quad Set', { region: 'knee', move: bad })).status, 400, 'a bad id is refused');
  assert.equal((await call('PUT', '/api/dev/catalog/quad_set', { region: 'knee', move: { ...readMove('quad_set'), id: 'other_id' } })).status, 400, 'a move whose id disagrees with the address is refused');
  assert.equal((await call('PUT', '/api/dev/catalog/quad_set', { region: 'nose', move: readMove('quad_set') })).status, 400, 'an unknown region is refused');
});

test('an id another region already uses is refused', async () => {
  const clash = { ...readMove('quad_set'), id: 'wallsit' };
  const r = await call('PUT', '/api/dev/catalog/wallsit', { region: 'hip', move: clash });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.problems.join(' '), /used twice/);
});
