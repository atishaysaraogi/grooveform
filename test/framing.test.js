'use strict';
/* Which way round the phone has to lie, and whether it does. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const Moves = require('../public/js/moves.js');

test('a move that wants a wide frame says so when it has a tall one', () => {
  assert.equal(Core.framing('wide', 1280, 720), null, 'a landscape frame is what it asked for');
  assert.equal(Core.framing('wide', 1920, 1080), null);
  assert.match(Core.framing('wide', 720, 1280), /turn the phone on its side/i);
  assert.match(Core.framing('wide', 480, 640), /wide frame/i);
});

test('and the other way round, for a move that wants a tall one', () => {
  assert.equal(Core.framing('tall', 720, 1280), null);
  assert.match(Core.framing('tall', 1280, 720), /stand the phone up/i);
});

test('a move with nothing to say about the frame takes whatever it is given', () => {
  for (const [w, h] of [[1280, 720], [720, 1280], [640, 640]]) {
    assert.equal(Core.framing(null, w, h), null);
    assert.equal(Core.framing(undefined, w, h), null);
  }
});

test('a frame of no size is not complained about, because there is nothing to judge yet', () => {
  assert.equal(Core.framing('wide', 0, 0), null);
  assert.equal(Core.framing('wide', 1280, 0), null);
});

test('the plank asks for a wide frame and says so in the words it opens with', () => {
  assert.equal(Moves.plank.camera, 'wide', 'a plank is long and low');
  assert.match(Moves.plank.start, /on its side/i, 'and the instruction says which way to lay the phone');
  assert.match(Moves.plank.hint, /on its side/i);
  /* the wall sit is a standing body and is happy either way, so it asks for nothing */
  assert.equal(Moves.wallsit.camera, undefined);
  assert.match(Moves.wallsit.start, /camera on the floor/i);
});

test('every move opens by saying where to put the phone and to get into frame', () => {
  for (const m of Moves.list) {
    assert.match(m.start, /floor/i, m.id + ' says where the phone goes');
    assert.match(m.start, /frame|plank|wall/i, m.id + ' says what to do then');
    assert.ok(m.start.length < 120, m.id + ' keeps it short enough to be spoken: ' + m.start.length);
  }
});
