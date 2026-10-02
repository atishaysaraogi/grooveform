'use strict';
/* An exercise file through a link and back. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Share = require('../public/js/share.js');
const Moves = require('../public/js/moves.js');

test('a file goes into a link compressed and comes back whole', async () => {
  const file = Moves.bridge.spec;
  const code = await Share.encode(file);
  assert.equal(code[0], 'z');
  assert.ok(code.length < JSON.stringify(file).length / 1.5, 'shorter than the file itself: ' + code.length);
  assert.match(code, /^[A-Za-z0-9_-]+$/, 'safe in an address');
  assert.deepEqual(await Share.decode(code), file);
});

test('what is not a file is refused', async () => {
  await assert.rejects(Share.decode('xabc'), /not an exercise link/);
  await assert.rejects(Share.decode('j' + Buffer.from('{"a":1}').toString('base64url')), /not an exercise file/);
});
