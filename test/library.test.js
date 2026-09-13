'use strict';
// The exercise library is the one place a move is defined. These tests hold the contract:
// every move carries the whole record the app renders, and every move file is actually loaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIB_DIR = path.join(ROOT, 'client', 'coach', 'library');
const library = require(path.join(ROOT, 'client', 'coach', 'exercise-library.js'));
const engine = require(path.join(ROOT, 'client', 'coach', 'engine.js'));   // loads every move

const files = fs.readdirSync(LIB_DIR).filter((f) => f.endsWith('.js')).sort();
const CAT_DIR = path.join(ROOT, 'client', 'coach', 'catalog');
const catFiles = fs.existsSync(CAT_DIR) ? fs.readdirSync(CAT_DIR).filter((f) => f.endsWith('.js')).sort() : [];
const handWritten = engine.EXERCISES.filter((e) => !e.catalog);
const catalogue = engine.EXERCISES.filter((e) => e.catalog);

test('every file in the library folder registers exactly one hand-written move', () => {
  assert.ok(files.length >= 1, 'the library folder is empty');
  assert.equal(handWritten.length, files.length);
  assert.deepEqual(handWritten.map((e) => e.id).sort(), files.map((f) => f.replace(/\.js$/, '')).sort(),
    'a hand-written move id must match its filename');
});

// The browser has no readdir: it loads each move from a <script> tag. A move file with no tag
// works on the server and silently vanishes in the browser, so check the two agree.
test('index.html loads every move file in the library and catalogue folders', () => {
  const html = fs.readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');
  const tagged = [...html.matchAll(/coach\/library\/([a-z0-9_]+)\.js/g)].map((m) => m[1]);
  assert.deepEqual(tagged.slice().sort(), files.map((f) => f.replace(/\.js$/, '')).sort(),
    'add a <script> tag in client/index.html for each move (and remove tags for deleted ones)');
  assert.equal(new Set(tagged).size, tagged.length, 'a move is listed twice in index.html');
  const catTagged = [...html.matchAll(/coach\/catalog\/([a-z0-9_]+)\.js/g)].map((m) => m[1]);
  assert.deepEqual(catTagged.slice().sort(), catFiles.map((f) => f.replace(/\.js$/, '')).sort(),
    'client/index.html and client/coach/catalog/ disagree — add or remove the <script> tag');
  const iCat = html.indexOf('src="coach/catalog.js"'), iSpec = html.indexOf('src="coach/spec.js"'), iFirst = html.indexOf('src="coach/catalog/');
  assert.ok(iSpec < iCat && iCat < iFirst, 'coach/spec.js, then coach/catalog.js, then the catalogue files');
});

/* The catalogue is where a physio edits. Every entry must carry the full record, say honestly
   what the camera can do with it, and draw a figure. */
test('every catalogue move is complete, honest about tracking, and has a figure', () => {
  assert.ok(catalogue.length >= 60, `expected a comprehensive catalogue, found ${catalogue.length}`);
  const figures = new Set((globalThis.__pendingFigures || []).map((f) => f[0]));
  for (const ex of catalogue) {
    const w = (m) => `${ex.id}: ${m}`;
    assert.ok(['form', 'reps', 'none'].includes(ex.tracking), w('tracking tier'));
    assert.equal(typeof ex.vetted, 'boolean', w('vetted'));
    assert.ok(ex.camera && ex.camera.height && ex.camera.distance, w('camera placement'));
    assert.ok(ex.level, w('level'));
    assert.ok(Array.isArray(ex.equipment), w('equipment'));
    assert.ok(ex.muscles && Array.isArray(ex.muscles.primary) && ex.muscles.primary.length, w('primary muscles'));
    assert.ok(Array.isArray(ex.sources) && ex.sources.length, w('sources'));
    assert.ok(ex.guide && ex.guide.cannotSee, w('guide.cannotSee'));
    assert.ok(ex.faults.length >= 2, w('at least two listed faults'));
    for (const f of ex.faults) { assert.ok(f.cue && f.tip && f.cue !== f.tip, w(`fault ${f.id} cue/tip`)); assert.ok(f.cue.trim().split(/\s+/).length <= 8, w(`fault ${f.id} cue is long`)); }
    if (ex.tracking === 'none') { assert.equal(ex.calibrate, undefined, w('an untracked move must not pretend to calibrate')); assert.ok(ex.faults.every((f) => f.check === undefined), w('untracked faults have no check')); }
    else { assert.equal(typeof ex.calibrate, 'function', w('tracked move calibrates')); assert.equal(typeof ex.measure, 'function', w('tracked move measures')); }
    if (ex.tracking === 'form') assert.ok(ex.faults.some((f) => f.tracked !== false && !f.onRep), w('a form-tracked move must watch at least one live fault'));
    assert.ok(figures.has(ex.id), w('no figure — give the entry a pose'));
  }
  const tiers = { form: 0, reps: 0, none: 0 }; catalogue.forEach((e) => tiers[e.tracking]++);
  assert.ok(tiers.form > 0 && tiers.reps > 0 && tiers.none > 0, 'all three tiers should be represented: ' + JSON.stringify(tiers));
});

test('the registry loads the exercise-library.js the moves register into', () => {
  assert.equal(engine.EXERCISES, library.list, 'engine must expose the library array itself');
  assert.ok(library.kinematics, 'engine must publish the kinematics toolkit');
});

test('moves are ordered, and the order is unique', () => {
  const orders = engine.EXERCISES.map((e) => e.order);
  assert.deepEqual(orders, orders.slice().sort((a, b) => a - b), 'EXERCISES must be sorted by order');
  assert.equal(new Set(orders).size, orders.length, 'two moves share an order');
});

test('every move carries its full record', () => {
  for (const ex of engine.EXERCISES) {
    // validate() is what define() enforces; re-running it here reports which move broke.
    assert.doesNotThrow(() => library.validate(ex), `${ex.id} is incomplete`);
    const tracked = ex.guide.regions.some((r) => r.points.some((p) => p.tracked));
    if (ex.tracking === 'none') assert.ok(!tracked, `${ex.id}: nothing is tracked, so no guide point should claim the camera checks it`);
    else assert.ok(tracked, `${ex.id}: the guide should mark at least one point the camera checks`);
    assert.ok(ex.faults.every((f) => f.cue !== f.tip), `${ex.id}: a fault's spoken cue and written tip should differ`);
  }
});

test('a move missing any detail is rejected rather than half-registered', () => {
  const good = engine.EXERCISES[0];
  const clone = (over) => Object.assign({}, good, over);
  assert.throws(() => library.validate(clone({ guide: undefined })), /guide is required/);
  assert.throws(() => library.validate(clone({ faults: [] })), /faults/);
  assert.throws(() => library.validate(clone({ summary: '' })), /summary/);
  assert.throws(() => library.validate(clone({ order: undefined })), /order/);
  assert.throws(() => library.validate(clone({ defaultTarget: 9999 })), /defaultTarget must be one of targets/);
  assert.throws(() => library.validate(clone({
    faults: [{ id: 'x', label: 'X', tip: 'do less', weight: 1, check: () => false }],
  })), /needs a spoken cue/);
  assert.throws(() => library.validate(clone({
    guide: { surface: 'floor', stop: 'pain', regions: [{ name: 'Legs', points: [{ t: 'straight' }] }] },
  })), /tracked/);
});

test('define rejects a duplicate id', () => {
  assert.throws(() => library.define(() => engine.EXERCISES[0]), /already registered/);
});
