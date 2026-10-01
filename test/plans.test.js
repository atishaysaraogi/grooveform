'use strict';
/* Plans: the library's bundles are whole against the library, a plan's words say what it
   asks for, an item is cleaned, and a plan survives the trip through a link. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../public/js/core.js');
const Moves = require('../public/js/moves.js');
const Plans = require('../public/js/plans.js');

const DIR = path.join(__dirname, '..', 'public', 'bundles');

test('every bundle in the folder names exercises, faults and settings the library has, and the index lists the folder', () => {
  const files = fs.readdirSync(DIR).filter((f) => /\.json$/.test(f) && f !== 'index.json').sort();
  assert.ok(files.length >= 6, 'shoulder, knee and back, two each: ' + files.join(', '));
  assert.deepEqual(Plans.problems, []);
  assert.equal(Plans.list.length, files.length);
  for (const p of Plans.list) assert.deepEqual(Plans.check(p, Moves), [], p.id + ' is whole');
  const idx = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
  assert.deepEqual(idx.files, files, 'index.json is the folder');
  const ids = Plans.list.map((p) => p.id);
  for (const id of ['frozen-shoulder-early', 'frozen-shoulder-thawing', 'knee-early', 'knee-strength', 'back-care', 'back-strength']) assert.ok(ids.includes(id), id);
  assert.ok(Plans.list.every((p) => p.name && p.for && p.blurb && p.items.length >= 4), 'each says who it is for and has a few exercises');
});

test('the checker catches an exercise, a fault or a setting that is not there, and a hold given reps', () => {
  const bad = { name: 'x', items: [{ move: 'nosuch' }, { move: 'slr', ignore: ['nosuch'], settings: { nosuch: 1 } }, { move: 'wallsit', reps: 10, rom: 50 }, { move: 'bridge', rom: 500, sets: 0 }] };
  const at = Plans.check(bad, Moves).map((p) => p.at);
  for (const a of ['items[0].move', 'items[1].ignore', 'items[1].settings', 'items[2].reps', 'items[2].rom', 'items[3].rom', 'items[3].sets']) assert.ok(at.includes(a), a + ': ' + at.join(' '));
});

test('an item cleaned, and its adjustments as the coach takes them', () => {
  const it = Plans.cleanItem({ move: 'slr', sets: 3.4, reps: 8, hold: 2, rom: 100, ignore: ['toesDown', 'bad id'], settings: { liftMin: 25, x: 'no' }, note: '  a note  ', junk: 1 });
  assert.deepEqual(it, { move: 'slr', sets: 3, reps: 8, hold: 2, ignore: ['toesDown'], settings: { liftMin: 25 }, note: 'a note' }, 'a full range is left out, a bad id dropped, the note trimmed');
  assert.equal(Plans.cleanItem({ sets: 3 }), null, 'no exercise, no item');
  const a = Plans.adjustOf({ move: 'slr', rom: 70, ignore: ['toesDown'], reps: 8 });
  assert.equal(a.rom, 70); assert.deepEqual(a.ignore, ['toesDown']); assert.equal(a.reps, 8);
  const c = Core.adjust(Moves.slr, Object.assign({}, Core.COMMON, Moves.slr.defaults), a);
  assert.equal(c.repCount, 8); assert.deepEqual(c.ignore, ['toesDown']); assert.equal(c.rom, 70);
  assert.equal(Plans.adjustOf({ move: 'slr', reps: 8 }, { counts: false }).reps, undefined, 'the counts can be left to the page');
});

test('the words say what an item asks for', () => {
  assert.equal(Plans.words({ move: 'slr', sets: 3, reps: 10, hold: 2, rom: 70, ignore: ['toesDown'] }, Moves.slr), '3 × 10 · hold 2 s · range 70% · leaving alone: Toes pointing away');
  assert.equal(Plans.words({ move: 'wallsit', sets: 2, hold: 45 }, Moves.wallsit), '2 × 45 s');
  assert.match(Plans.words({ move: 'bridge' }, Moves.bridge), /^3 × 10$/, 'the file\'s own numbers when the item says nothing');
});

test('a plan goes into a link and comes back the same, as a shared plan', () => {
  const p = Plans.list.find((x) => x.id === 'knee-early');
  const code = Plans.encode(p);
  assert.match(code, /^[A-Za-z0-9_-]+$/, 'base64url, safe in an address');
  const back = Plans.decode(code);
  assert.ok(back && back.shared && back.id === '~' + code);
  assert.equal(back.name, p.name); assert.deepEqual(back.items, p.items); assert.deepEqual(back.notes, p.notes);
  assert.equal(Plans.decode('not a plan'), null);
  assert.equal(Plans.decode(Plans.encode({ name: 'empty', items: [] })), null, 'nothing to do is not a plan');
});
