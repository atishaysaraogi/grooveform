'use strict';
/* The exercise library: one JSON file per exercise, read into the move the
   coach runs. Every file in the folder is whole, the index lists the folder,
   and the language a file is written in (spec.js) does what it says. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../public/js/core.js');
const Spec = require('../public/js/spec.js');
const Moves = require('../public/js/moves.js');

const DIR = path.join(__dirname, '..', 'public', 'exercises');
const files = fs.readdirSync(DIR).filter((f) => /\.json$/.test(f) && f !== 'index.json').sort();

test('every file in the folder is an exercise the app can run, named after its id', () => {
  assert.ok(files.length >= 5, 'the five that were written by hand, at least: ' + files.join(', '));
  assert.deepEqual(Moves.problems, [], 'nothing failed to load');
  for (const f of files) {
    const json = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const problems = Spec.check(json).filter((p) => p.level === 'error');
    assert.deepEqual(problems, [], f + ' has no errors');
    assert.equal(f, json.id + '.json', 'the file is named after the id');
    const m = Moves[json.id];
    assert.ok(m && m.read && m.judge && m.faults.includes('lost') && m.cues.lost, f + ' compiled into a move');
    assert.equal(m.spec, json === m.spec ? json : m.spec, 'and keeps its file');
  }
});

test('the index lists the folder, in the order the app shows the exercises', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
  assert.deepEqual(idx.files, files, 'index.json is the folder (npm test writes it; so does the Pages workflow)');
  const orders = Moves.list.map((m) => m.order);
  assert.deepEqual(orders.slice().sort((a, b) => a - b), orders, 'the list follows each file\'s order');
  assert.deepEqual(Moves.list.slice(0, 5).map((m) => m.id), ['wallsit', 'plank', 'kneeraise', 'bridge', 'donkeykick']);
});

test('the compiled move has everything the picture, the settings and the Review page read from it', () => {
  for (const m of Moves.list) {
    for (const b of m.bands) {
      assert.ok(b.key && b.of && b.hud && Array.isArray(b.scale) && b.scale.length === 2, m.id + ': band ' + b.key);
      assert.ok(Array.isArray(b.set) && b.set.length, m.id + ': band ' + b.key + ' has settings to tune');
      for (const s of b.set) assert.equal(typeof m.defaults[s.key], 'number', m.id + ': ' + s.key + ' has a default');
    }
    for (const s of m.extra) assert.equal(typeof m.defaults[s.key], 'number', m.id + ': ' + s.key + ' has a default');
    for (const [bone, key] of Object.entries(m.limb)) assert.ok(m.bands.some((b) => b.key === key), m.id + ': ' + bone + ' is coloured by ' + key);
    for (const id of m.faults) if (id !== 'lost' && !m.prompts.includes(id)) assert.ok(m.cues[id] && m.cues[id].label && m.cues[id].text, m.id + ': ' + id + ' has words');
    if (m.reps) { assert.ok(m.prompts.length === 1 && m.cues.lower && m.cues.early, m.id + ': a rep move has its prompt, lower and early words'); }
    assert.ok(m.howto.length && m.cannot && m.about && m.start && m.position, m.id + ': the words around it');
    assert.ok(m.pose || m.figure, m.id + ': a figure to animate');
  }
});

/* ---- the language: a synthetic body, so each kind of measurement can be checked on its own ---- */
const ASPECT = 16 / 9;
function landmarks(P) {
  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  for (const side of ['L', 'R']) for (const [name, i] of Object.entries(Core.SIDE[side])) { const p = P[side] ? P[side][name] : P[name]; if (p) lm[i] = { x: p.x / ASPECT, y: p.y, z: 0, visibility: p.v == null ? 0.95 : p.v }; }
  return lm;
}
const base = (over) => Object.assign({
  v: 1, id: 'fake', name: 'Fake', type: 'hold', phone: { orientation: 'wide' }, words: { start: 'Go', position: 'x', howto: ['x'], cannot: 'x' },
  facing: { from: 'hip', to: 'knee' }, landmarks: { joints: ['shoulder', 'hip', 'knee', 'ankle'], needed: ['hip', 'knee', 'ankle'], bones: [['hip', 'knee']] },
  measurements: [], faults: [], defaults: {}, muscles: { thigh: 1 },
}, over);
const SEATED = { shoulder: { x: 1.0, y: 0.3 }, hip: { x: 1.0, y: 0.5 }, knee: { x: 1.2, y: 0.5 }, ankle: { x: 1.2, y: 0.7 }, heel: { x: 1.2, y: 0.72 }, toe: { x: 1.3, y: 0.72 }, elbow: { x: 1.0, y: 0.4 }, wrist: { x: 1.1, y: 0.45 }, ear: { x: 1.0, y: 0.25 } };

test('each kind of measurement reads what its geometry says, and `of` names the reading', () => {
  const f = base({ measurements: [
    { key: 'knee', kind: 'angle', a: 'hip', b: 'knee', c: 'ankle' },
    { key: 'back', of: 'tilt', kind: 'tilt', base: 'hip', top: 'shoulder' },
    { key: 'shin', kind: 'floor', at: 'knee', to: ['heel', 'ankle'] },
    { key: 'line', kind: 'bend', a: 'shoulder', b: 'hip', c: 'ankle' },
    { key: 'rise', kind: 'rise', a: 'knee', b: 'hip' },
    { key: 'thigh', kind: 'down', from: 'hip', to: 'knee' },
    { key: 'reach', kind: 'distance', a: 'hip', b: 'knee', per: ['hip', 'shoulder'] },
    { key: 'both', kind: 'sum', terms: [{ measure: 'rise' }, { kind: 'rise', a: 'hip', b: 'shoulder', times: -1 }], offset: 10 },
    { key: 'armlike', kind: 'tilt', base: 'hip', top: 'shoulder', offset: 90 },
  ] });
  const m = Spec.compile(f, Core), cfg = Object.assign({}, Core.COMMON, m.defaults);
  const r = m.read(landmarks(SEATED), ASPECT, cfg);
  assert.ok(r.ok, 'read');
  assert.ok(Math.abs(r.knee - 90) < 1e-6, 'a right angle at the knee: ' + r.knee);
  assert.ok(Math.abs(r.tilt) < 1e-6 && r.back === undefined, 'the tilt is read under its own name: ' + r.tilt);
  assert.ok(Math.abs(r.shin - 90) < 1e-6 && r.of.shin.to === 'heel', 'the shin to the heel: ' + r.shin + ' ' + r.of.shin.to);
  assert.ok(Math.abs(r.rise) < 1e-6, 'hip level with the knee');
  assert.ok(Math.abs(r.thigh - 90) < 1e-6, 'the thigh level: ' + r.thigh);
  assert.ok(Math.abs(r.reach - 1) < 1e-6, 'the thigh is as long as the torso here');
  assert.ok(Math.abs(r.both - (0 - 90 + 10)) < 1e-6, 'a sum with a negative term and an offset: ' + r.both);
  assert.ok(Math.abs(r.armlike - 90) < 1e-6, 'an offset on a tilt');
  assert.deepEqual(r.angles, ['knee', 'tilt', 'shin', 'line', 'rise', 'thigh', 'reach', 'both', 'armlike'], 'every reading is smoothed under its own name');
  /* the heel not trusted: the ankle stands in */
  const lm = landmarks(Object.assign({}, SEATED, { heel: { x: 1.2, y: 0.72, v: 0.1 } }));
  assert.equal(m.read(lm, ASPECT, cfg).of.shin.to, 'ankle');
});

test('bands, faults in the file\'s order, requires and unless, optional readings, a hold\'s position', () => {
  const f = base({
    defaults: { kneeMin: 80, kneeMax: 100, tiltMax: 5, shinMin: 85, shinMax: 95 },
    measurements: [
      { key: 'knee', kind: 'angle', a: 'hip', b: 'knee', c: 'ankle', band: { lo: 'kneeMin', hi: 'kneeMax' }, scale: [0, 180], settings: [{ key: 'kneeMin', label: 'a', min: 0, max: 180 }, { key: 'kneeMax', label: 'b', min: 0, max: 180 }] },
      { key: 'back', kind: 'tilt', base: 'hip', top: 'shoulder', band: { sym: 'tiltMax' }, scale: [-40, 40], settings: [{ key: 'tiltMax', label: 'c', min: 0, max: 40 }] },
      { key: 'shin', kind: 'floor', at: 'knee', to: 'heel', optional: true, band: { lo: 'shinMin', hi: 'shinMax' }, scale: [0, 180], settings: [{ key: 'shinMin', label: 'd', min: 0, max: 180 }, { key: 'shinMax', label: 'e', min: 0, max: 180 }] },
    ],
    faults: [
      { id: 'lean', measure: 'back', side: 'above', label: 'Leaning', text: 'Sit up' },
      { id: 'open', measure: 'knee', side: 'above', requires: ['back'], label: 'Knee open', text: 'Bend' },
      { id: 'shut', measure: 'knee', side: 'below', unless: ['lean'], label: 'Knee shut', text: 'Open' },
    ],
  });
  assert.deepEqual(Spec.check(f).filter((p) => p.level === 'error'), []);
  const m = Spec.compile(f, Core), cfg = Object.assign({}, Core.COMMON, m.defaults);
  assert.deepEqual(m.faults, ['lost', 'lean', 'open', 'shut'], 'the coach\'s order is the file\'s, after lost');
  const v = m.judge(m.read(landmarks(SEATED), ASPECT, cfg), cfg);
  assert.ok(v.ok && v.good.knee && v.good.back && v.good.shin && v.inPosition, 'seated square is in position: ' + JSON.stringify(v));
  /* the knee opened to 120 with the back leaning 20: the lean is said, the open knee waits on the back */
  const P = Object.assign({}, SEATED, { ankle: { x: 1.2 + 0.2 * Math.sin(Math.PI / 6), y: 0.5 + 0.2 * Math.cos(Math.PI / 6) }, shoulder: { x: 1.0 + 0.2 * Math.sin(20 * Math.PI / 180), y: 0.5 - 0.2 * Math.cos(20 * Math.PI / 180) } });
  const v2 = m.judge(m.read(landmarks(P), ASPECT, cfg), cfg);
  assert.ok(v2.faults.lean > 14 && v2.faults.lean < 16, 'the lean is fifteen past its band: ' + v2.faults.lean);
  assert.equal(v2.faults.open, undefined, 'the knee is not judged until the back is good');
  assert.equal(v2.good.knee, false, 'though its band says it is out');
  /* the heel gone: the shin reads nothing, which is not a fault and not a failed frame */
  const lm = landmarks(Object.assign({}, SEATED, { heel: { x: 1.2, y: 0.72, v: 0.1 } }));
  const r3 = m.read(lm, ASPECT, cfg);
  assert.equal(r3.ok, true, 'the frame stands');
  assert.equal(m.judge(r3, cfg).good.shin, true, 'and an optional reading not there is not held against anyone');
});

test('reps: progress up or down, the start rule, the prompt\'s place in the order, and set-up faults', () => {
  const f = base({
    type: 'reps',
    defaults: { kneeMin: 80, kneeMax: 100, raiseAt: 120, downAt: 160, tiltMax: 5, repCount: 3, holdTargetSec: 1 },
    measurements: [
      { key: 'knee', kind: 'angle', a: 'hip', b: 'knee', c: 'ankle', band: { lo: 'kneeMin', hi: 'kneeMax' }, scale: [0, 180], settings: [{ key: 'kneeMin', label: 'a', min: 0, max: 180 }, { key: 'kneeMax', label: 'b', min: 0, max: 180 }] },
      { key: 'back', kind: 'tilt', base: 'hip', top: 'shoulder', band: { sym: 'tiltMax' }, scale: [-40, 40], settings: [{ key: 'tiltMax', label: 'c', min: 0, max: 40 }] },
    ],
    progress: { measure: 'knee', raiseAt: 'raiseAt', downAt: 'downAt', direction: 'down' },
    prompt: { id: 'raise', text: 'Squat' },
    ready: { atStart: true, ranges: { back: [-10, 10] } },
    faults: [
      { id: 'lean', measure: 'back', side: 'above', setup: true, label: 'Leaning', text: 'Sit up' },
      { id: 'shut', measure: 'knee', side: 'below', label: 'Too deep', text: 'Up a bit' },
    ],
  });
  assert.deepEqual(Spec.check(f).filter((p) => p.level === 'error'), []);
  const m = Spec.compile(f, Core), cfg = Object.assign({}, Core.COMMON, m.defaults);
  assert.deepEqual(m.faults, ['lost', 'lean', 'raise', 'shut'], 'set-up faults, the prompt, then the movement');
  assert.deepEqual(m.setup, ['lean']); assert.deepEqual(m.prompts, ['raise']);
  const standing = Object.assign({}, SEATED, { knee: { x: 1.0, y: 0.7 }, ankle: { x: 1.0, y: 0.9 } });
  const vs = m.judge(m.read(landmarks(standing), ASPECT, cfg), cfg);
  assert.equal(vs.atStart, true, 'straight legs are the start, going down'); assert.equal(vs.raised, false);
  assert.ok(m.ready(m.read(landmarks(standing), ASPECT, cfg), vs), 'and the start rule holds');
  const vd = m.judge(m.read(landmarks(SEATED), ASPECT, cfg), cfg);
  assert.equal(vd.raised, true, 'a right angle is past 120 on the way down'); assert.equal(vd.atStart, false);
  assert.equal(vd.inPosition, true);
  assert.ok(m.cues.raise.text === 'Squat' && m.cues.lower && m.cues.early, 'the words a rep move needs');
});

test('a front view names the side with each landmark', () => {
  const f = base({
    phone: { orientation: 'tall', view: 'front' }, facing: null,
    landmarks: { joints: ['L.knee', 'R.knee', 'L.ankle', 'R.ankle'], needed: ['L.knee', 'R.knee', 'L.ankle', 'R.ankle'], bones: [['L.knee', 'L.ankle']] },
    measurements: [{ key: 'knees', kind: 'distance', a: 'L.knee', b: 'R.knee', per: ['L.ankle', 'R.ankle'] }],
  });
  assert.deepEqual(Spec.check(f).filter((p) => p.level === 'error'), []);
  const m = Spec.compile(f, Core), cfg = Object.assign({}, Core.COMMON, m.defaults);
  const P = { L: { knee: { x: 0.9, y: 0.5 }, ankle: { x: 0.8, y: 0.7 } }, R: { knee: { x: 1.1, y: 0.5 }, ankle: { x: 1.2, y: 0.7 } } };
  const r = m.read(landmarks(P), ASPECT, cfg);
  assert.ok(r.ok && Math.abs(r.knees - 0.5) < 1e-6, 'the knees half as far apart as the ankles: ' + r.knees);
});

test('the checker catches what would break the coach, and the starter passes it', () => {
  const bad = base({ measurements: [{ key: 'knee', kind: 'angle', a: 'hip', b: 'kne', c: 'ankle', band: { lo: 'kneeMin', hi: 'kneeMax' }, scale: [0, 180] }], faults: [{ id: 'x', measure: 'nope', side: 'sideways', label: 'a label that is far too long for the picture', text: '' }] });
  const at = Spec.check(bad).filter((p) => p.level === 'error').map((p) => p.at);
  for (const want of ['measurements[0].b', 'measurements[0].band', 'faults[0].measure', 'faults[0].side', 'faults[0].text', 'faults[0].label']) assert.ok(at.includes(want), 'caught: ' + want + ' in ' + at.join(', '));
  const starter = Spec.blank();
  assert.deepEqual(Spec.check(starter).filter((p) => p.level === 'error'), [], 'the starter is whole');
  const m = Spec.compile(starter, Core);
  assert.ok(m.reps && m.read && m.judge, 'and runs');
  /* the library refuses a file with an error, and says why */
  assert.throws(() => Moves.add(bad), /faults\[0\]/);
  assert.equal(Moves.fake, undefined, 'and does not keep it');
});

test('a draft laid over the library stands in for the move of its id, and goes away whole', () => {
  const before = Moves.list.length, orig = Moves.bridge;
  const d = JSON.parse(JSON.stringify(orig.spec)); d.name = 'Bridge, tuned'; d.defaults.overMax = 9;
  const m = Moves.draft(d);
  assert.ok(m.draft && Moves.bridge === m && Moves.bridge.defaults.overMax === 9, 'the draft is the bridge now');
  assert.equal(Moves.list.length, before, 'no new entry');
  Moves.draft(null);
  assert.equal(Moves.bridge, orig, 'the library\'s own is back');
  const n = JSON.parse(JSON.stringify(orig.spec)); n.id = 'bridge2'; n.name = 'Another';
  Moves.draft(n);
  assert.equal(Moves.list.length, before + 1, 'a draft with a new id is listed');
  Moves.draft(null);
  assert.equal(Moves.list.length, before); assert.equal(Moves.bridge2, undefined);
});
