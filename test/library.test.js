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

test('every file in the library folder registers exactly one move', () => {
  assert.ok(files.length >= 1, 'the library folder is empty');
  assert.equal(engine.EXERCISES.length, files.length);
  assert.deepEqual(library.ids().slice().sort(), files.map((f) => f.replace(/\.js$/, '')).sort(),
    'a move id must match its filename');
});

// The browser has no readdir: it loads each move from a <script> tag. A move file with no tag
// works on the server and silently vanishes in the browser, so check the two agree.
test('index.html loads every move in the library folder', () => {
  const html = fs.readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');
  const tagged = [...html.matchAll(/coach\/library\/([a-z0-9_]+)\.js/g)].map((m) => m[1]);
  assert.deepEqual(tagged.slice().sort(), files.map((f) => f.replace(/\.js$/, '')).sort(),
    'add a <script> tag in client/index.html for each move (and remove tags for deleted ones)');
  assert.equal(new Set(tagged).size, tagged.length, 'a move is listed twice in index.html');
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
    assert.ok(ex.guide.regions.some((r) => r.points.some((p) => p.tracked)),
      `${ex.id}: the guide should mark at least one point the camera checks`);
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
