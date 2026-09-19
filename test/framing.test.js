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

test('every move opens by saying where to put the phone and how to stand to it', () => {
  for (const m of Moves.list) {
    assert.match(m.start, /floor/i, m.id + ' says where the phone goes');
    assert.match(m.start, /side on/i, m.id + ' says which way to face — all of these are read from the side');
    assert.ok(m.start.length < 120, m.id + ' keeps it short enough to be spoken: ' + m.start.length);
  }
});

test('a move that counts reps says how many, how long each is, and what to call them', () => {
  const m = Moves.kneeraise;
  assert.equal(m.reps, true);
  assert.equal(m.defaults.repCount, 10, 'ten reps');
  assert.equal(m.defaults.holdTargetSec, 10, 'ten seconds each');
  for (const id of ['raise', 'lower', 'early']) assert.ok(m.cues[id], 'it can say ' + id);
  assert.deepEqual(m.prompts, ['raise'], 'and being asked to start a rep is not a correction');
  /* the hold moves are not rep moves and must not have acquired any of this */
  for (const h of [Moves.wallsit, Moves.plank]) assert.ok(!h.reps, h.id + ' is one long hold');
});

/* ---------- the shape of the canvas, and what goes in it ---------- */

test('a move that wants a wide picture gets one whichever way the phone is lying', () => {
  assert.deepEqual(Core.canvasSize('wide', 1280, 720), { w: 1280, h: 720 }, 'already on its side');
  assert.deepEqual(Core.canvasSize('wide', 720, 1280), { w: 1280, h: 720 }, 'and stood up, it is still made wide');
  assert.deepEqual(Core.canvasSize('tall', 1280, 720), { w: 720, h: 1280 });
  assert.deepEqual(Core.canvasSize(null, 720, 1280), { w: 720, h: 1280 }, 'asking for nothing takes what comes');
  assert.equal(Core.canvasSize('wide', 0, 0), null, 'and a frame of no size decides nothing');
});

test('the picture is fitted into the canvas whole, and never stretched to it', () => {
  const same = Core.fitRect(1280, 720, 1280, 720);
  assert.deepEqual(same, { x: 0, y: 0, w: 1280, h: 720 }, 'a matching frame fills it exactly');

  /* the case that was squashing the plank: a portrait frame in a landscape canvas */
  const tall = Core.fitRect(720, 1280, 1280, 720);
  assert.equal(tall.h, 720, 'it is as tall as the canvas');
  assert.ok(Math.abs(tall.w / tall.h - 720 / 1280) < 1e-9, 'and keeps its own proportions');
  assert.ok(tall.x > 0 && Math.abs(tall.x - (1280 - tall.w) / 2) < 1e-9, 'centred, with bars either side');

  const wide = Core.fitRect(1280, 720, 720, 1280);
  assert.equal(wide.w, 720);
  assert.ok(Math.abs(wide.w / wide.h - 1280 / 720) < 1e-9, 'the other way round, likewise');
  assert.ok(wide.y > 0, 'bars above and below');
});

test('whatever the frame and whatever the canvas, the proportions come through untouched', () => {
  for (const [vw, vh] of [[1280, 720], [720, 1280], [640, 480], [1080, 1080], [1920, 816]]) {
    for (const [W, H] of [[1280, 720], [720, 1280], [800, 800]]) {
      const f = Core.fitRect(vw, vh, W, H);
      assert.ok(Math.abs(f.w / f.h - vw / vh) < 1e-9, `${vw}x${vh} into ${W}x${H} came out ${f.w}x${f.h}`);
      assert.ok(f.w <= W + 1e-9 && f.h <= H + 1e-9, 'and all of it is inside the canvas');
      assert.ok(Math.abs(f.w - W) < 1e-9 || Math.abs(f.h - H) < 1e-9, 'touching at least one pair of edges');
    }
  }
});

test('the edge of a band is inside it, on every move', () => {
  /* a body posed to exactly the edge reads a ten-thousandth of a degree under it,
     and a bare comparison would mark the very number the setting says is allowed */
  assert.equal(Core.inBand(85 - 1e-13, 85, 95), true, 'the low edge');
  assert.equal(Core.inBand(95 + 1e-13, 85, 95), true, 'the high edge');
  assert.equal(Core.inBand(84.9, 85, 95), false, 'and a tenth outside is still outside');
  assert.equal(Core.inBand(95.1, 85, 95), false);
  assert.equal(Core.within(12 + 1e-13, 12), true);
  assert.equal(Core.within(-12 - 1e-13, 12), true);
  assert.equal(Core.within(12.1, 12), false);
});
