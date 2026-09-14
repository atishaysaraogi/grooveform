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

const files = fs.existsSync(LIB_DIR) ? fs.readdirSync(LIB_DIR).filter((f) => f.endsWith('.js')).sort() : [];   // hand-written code moves: none today, every move is data
const handWritten = engine.EXERCISES.filter((e) => !e.catalog);
const catalogue = engine.EXERCISES.filter((e) => e.catalog);

test('every file in the library folder registers exactly one hand-written move', () => {
  assert.equal(handWritten.length, files.length);
  assert.deepEqual(handWritten.map((e) => e.id).sort(), files.map((f) => f.replace(/\.js$/, '')).sort(),
    'a hand-written move id must match its filename');
});

/* The library is data: client/data/manifest.json names every file, the browser fetches them and the
   server reads them. The folders and the manifest must agree, and nothing may be listed twice. */
const DATA_DIR = path.join(ROOT, 'client', 'data');
const catalog = require(path.join(ROOT, 'client', 'coach', 'catalog.js'));
const data = catalog.readDataSync(DATA_DIR);
const moveFiles = fs.readdirSync(path.join(DATA_DIR, 'moves')).filter((f) => f.endsWith('.json')).sort();

test('the manifest lists every code move and every moves file, and index.html lists none of them', () => {
  assert.deepEqual(data.manifest.code.map((p) => p.replace(/^coach\/library\//, '')).sort(), files, 'manifest.json "code" and client/coach/library/ disagree');
  assert.deepEqual(data.manifest.moves.map((p) => p.replace(/^moves\//, '')).sort(), moveFiles, 'manifest.json "moves" and client/data/moves/ disagree');
  for (const html of ['index.html', 'studio/index.html']) {
    const src = fs.readFileSync(path.join(ROOT, 'client', html), 'utf8');
    assert.ok(!/coach\/(library|catalog)\//.test(src), html + ' must not list moves — the manifest does');
    const iCat = src.indexOf('coach/catalog.js'), iSpec = src.indexOf('coach/spec.js'), iApp = src.indexOf(html === 'index.html' ? 'app.js' : 'studio.js');
    assert.ok(iSpec < iCat && iCat < iApp, html + ': coach/spec.js, then coach/catalog.js, then the app');
  }
});

test('every data file opens with its _about guide, and the guide covers every field a move may use', () => {
  for (const rel of ['manifest.json', 'settings.json', 'shared.json', ...data.manifest.moves]) {
    const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, rel), 'utf8'));
    assert.equal(Object.keys(j)[0], '_about', rel + ' must start with _about');
  }
  const guides = data.files.map((f) => f.json._about);
  for (const g of guides) {
    assert.deepEqual(g.fields, guides[0].fields, 'the field guide must read the same in every moves file (node scripts/catalog.js sync-docs)');
    assert.ok(g.what && g.add && g.remove && g.check, 'the guide says what the file is and how to add, remove and check a move');
  }
  const documented = Object.keys(guides[0].fields).sort(), allowed = catalog.KEYS.entry.slice().sort();
  assert.deepEqual(documented, allowed, 'every allowed move field is explained in _about.fields, and nothing else is');
  for (const [k, v] of Object.entries(guides[0].fields)) assert.ok(v.length > 20, 'field guide for ' + k + ' is too short to help');
  const settingsDoc = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf8'))._about.fields;
  for (const k of catalog.KEYS.settings) assert.ok(Object.keys(settingsDoc).some((d) => d === k || d.startsWith(k + '.')), 'settings.json _about.fields must explain ' + k);
  const sharedDoc = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'shared.json'), 'utf8'))._about;
  for (const k of catalog.KEYS.shared) assert.ok(sharedDoc[k], 'shared.json _about must explain ' + k);
});

test('every shipped file checks clean, and a mistake is reported with the file, the move and a suggestion', () => {
  const others = (skip) => data.files.filter((f) => f.name !== skip).flatMap((f) => f.json.moves.map((m) => m.id));
  for (const f of data.files) assert.deepEqual(catalog.checkFile(f.json, f.name, data, others(f.name)), [], f.name);
  const knee = data.files.find((f) => f.name.endsWith('knee.json'));
  /* moves by id, so the checks do not depend on where in the file each one sits */
  const mutate = (fn) => { const j = JSON.parse(JSON.stringify(knee.json)); const by = (id) => j.moves.find((m) => m.id === id); fn(j, by); return catalog.checkFile(j, knee.name, data, others(knee.name)); };
  const one = (fn) => { const p = mutate(fn); assert.equal(p.length, 1, JSON.stringify(p)); return p[0]; };
  assert.match(one((j, by) => { by('quad_set').sumary = by('quad_set').summary; }), /knee.json › quad_set: unknown field "sumary" — did you mean "summary"/);
  assert.match(one((j, by) => { by('slr').progress.metric = 'kne'; }), /knee.json › slr › progress: unknown measurement "kne"/);
  assert.match(one((j, by) => { by('seated_knee_ext').faults[0].threshold = 'sixty'; }), /seated_knee_ext/);
  assert.match(one((j, by) => { by('seated_knee_ext').faults.push({ template: 'lean' }); }), /template "lean" has no threshold/);
  assert.match(one((j, by) => { by('seated_knee_ext').pose.A.thigh_angle = 10; }), /pose.A: unknown field "thigh_angle"/);
  assert.match(one((j, by) => { by('seated_knee_ext').id = 'quad_set'; }), /id "quad_set" is used twice/);
  assert.match(one((j, by) => { by('seated_knee_ext').id = 'slr'; }), /slr.*used twice/);
  assert.match(one((j, by) => { by('heelslide').faults[0].metric.per = ['KNEE']; }), /heelslide.*per must be/);
  assert.match(one((j, by) => { by('heelslide').faults[1].when[0].op = '='; }), /heelslide.*when needs op/);
  assert.match(one((j, by) => { by('quad_set').tracking = 'form'; }), /quad_set/);
  assert.match(one((j, by) => { delete by('quad_set').summary; }), /quad_set.*summary/);
  assert.match(one((j, by) => { by('quad_set')._note = 'a note is fine'; by('quad_set').faults[0]._todo = 'so is this'; by('quad_set').summary = ''; }), /summary/);
  assert.deepEqual(mutate((j, by) => { by('quad_set')._note = 'notes are ignored'; j._todo = 'anywhere'; }), []);
  assert.throws(() => catalog.readDataSync(path.join(__dirname, 'no-such-dir')), /ENOENT/);
});

test('the JSON style the tools write round-trips and keeps short things on one line', () => {
  for (const f of data.files) {
    const text = catalog.format(f.json);
    assert.deepEqual(JSON.parse(text), f.json, f.name + ' does not round-trip');
    assert.equal(text + '\n', fs.readFileSync(path.join(DATA_DIR, f.name), 'utf8'), f.name + ' is not in the shared style — run: node scripts/catalog.js format');
    assert.match(text, /"camera": \{ "height"/, 'a camera line stays on one line');
  }
});

/* A joint the entry names as a contact — a foot on the floor, a hand on the bar — must land on the
   same spot in both keyframes, or the figure slides along its own support as it animates. */
test('every declared contact holds still between the keyframes', () => {
  const ALIAS = { ft: 'an', ftF: 'anF' };
  const slid = [];
  for (const [id, fig] of (globalThis.__pendingFigures || [])) {
    if (!fig.B || !Array.isArray(fig.anchors)) continue;
    for (const k of fig.anchors.slice(1)) {
      const j = ALIAS[k] || k; if (!fig.A[j] || !fig.B[j]) continue;
      const d = Math.hypot(fig.A[j][0] - fig.B[j][0], fig.A[j][1] - fig.B[j][1]);
      if (d > 5) slid.push(`${id}.${k} slides ${Math.round(d)}`);
    }
  }
  assert.deepEqual(slid, [], 'a contact cannot reach its mark — the limb is too short for the pose');
});

/* The catalogue is where a physio edits. Every entry must carry the full record, say honestly
   what the camera can do with it, and draw a figure. */
test('every catalogue move is complete, honest about tracking, and has a figure', () => {
  assert.ok(catalogue.length >= 130, `expected the whole library as data, found ${catalogue.length}`);
  const vetted = catalogue.filter((e) => e.vetted);
  assert.ok(vetted.length >= 10, 'the ten vetted moves are data too');
  for (const e of vetted) assert.equal(e.tracking, 'form', e.id + ': a vetted move is coached on form');
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

/* The spoken brief is what a person hears as the set comes up. It is only useful if it says
   the position and the movement, in a couple of sentences, and leaves out the camera talk
   they have already dealt with — so every camera-coached move must carry one. */
test('every coached move has a spoken brief: short, no camera talk, complete sentences', () => {
  const coached = engine.EXERCISES.filter((e) => e.tracking !== 'none');
  const missing = coached.filter((e) => !e.brief || !e.brief.trim()).map((e) => e.id);
  assert.deepEqual(missing, [], 'these moves would start a set in silence');
  for (const e of coached) {
    const b = e.brief, n = b.split(/\s+/).length;
    assert.ok(n >= 8 && n <= 45, `${e.id}: brief is ${n} words — aim for one or two sentences`);
    assert.ok(/[.!]$/.test(b.trim()), `${e.id}: brief should end as a sentence — "${b.slice(-30)}"`);
    assert.ok(!/\b(camera|phone|lens|in frame|in shot|m away)\b/i.test(b), `${e.id}: brief mentions the camera set-up, which is already done by then`);
    assert.ok(!/\bnearest\b(?!\s+(?:the\s+)?\w)/i.test(b), `${e.id}: brief has a dangling "nearest"`);
  }
});

/* A move that says nothing about a rule is capped by settings.json; a move may narrow it itself. */
test('the fast rule is capped at one cue a set, and the cap reaches the compiled fault', () => {
  const st = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf8'));
  assert.equal(st.fault.maxCues.fast, 1);
  /* An untracked move may list "too fast" as a watch-out with no rule behind it; only a rule
     compiles to a rep-level fault, and only that one carries a cap. */
  const rushed = engine.EXERCISES.filter((e) => e.faults.some((f) => f.id === 'fast' && f.onRep));
  assert.ok(rushed.length > 10, 'most rep moves carry the fast rule, got ' + rushed.length);
  for (const e of rushed) assert.equal(e.faults.find((f) => f.id === 'fast').maxCues, 1, e.id);
});
