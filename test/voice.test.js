'use strict';
/* The natural voice: a clip for every phrase the coach can say, looked up whole
   or in parts, with nothing a move says left out. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Core = require('../public/js/core.js');
const Moves = require('../public/js/moves.js');
const Speech = require('../public/js/speech.js');

const DIR = path.join(__dirname, '..', 'public', 'voice');
const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const has = (t) => !!index.clips[Speech.key(t)] || (Speech.parts(t).length > 1 && Speech.parts(t).every((p) => index.clips[p]));

test('the pack has a clip for every phrase the coach can say, and the files are there', () => {
  const list = Speech.packTexts(Moves, Core);
  assert.equal(index.count, list.length, 'the index was built from this list');
  for (const t of list) assert.ok(index.clips[t], 'in the pack: ' + t);
  let bytes = 0;
  for (const [t, f] of Object.entries(index.clips)) {
    const p = path.join(DIR, f);
    assert.ok(fs.existsSync(p), 'the file for: ' + t);
    const head = fs.readFileSync(p).subarray(0, 3);
    assert.ok(head.toString('latin1') === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0), 'an mp3: ' + f);
    bytes += fs.statSync(p).size;
  }
  assert.ok(bytes < 12e6, 'small enough to ship: ' + (bytes / 1e6).toFixed(1) + ' MB');
});

test('every text a set can produce is covered, whole or in parts', () => {
  for (const m of Moves.list) {
    const cfg = Object.assign({}, Core.COMMON, m.defaults);
    for (const t of Speech.texts(m, cfg, Core.SHARED_CUES)) assert.ok(has(t), `${m.id}: ${t}`);
  }
  for (const t of ['7 \u2014 slower on the way down', '10 reps \u2014 done \u2014 slower on the way down', 'Set 2 of 3. When you are ready.',
    'Set 2 of 3 \u2014 the other leg. When you are ready.', 'Set 1 of 3. Into position when you are ready.', 'All done. 3 sets, 30 reps.',
    'All done. 1 set, 45 seconds in position.', '60 seconds \u2014 done', '30 seconds left', 'I can\u2019t see you \u2014 step into the camera, side on']) {
    assert.ok(has(t), 'covered: ' + t);
  }
  assert.deepEqual(Speech.parts('All done. 3 sets, 30 reps.'), ['All done', '3 sets', '30 reps']);
  assert.deepEqual(Speech.parts('Set 2 of 3 \u2014 the other leg. When you are ready.'), ['Set 2 of 3', 'the other leg', 'When you are ready']);
  assert.equal(Speech.key('  Lower slowly.  '), 'Lower slowly');
});
