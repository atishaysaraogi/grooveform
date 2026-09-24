'use strict';
/* Which way round the phone has to lie, and whether it does. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const Moves = require('../public/js/moves.js');

test('a move that wants a wide frame says so when it has a tall one, and says what it has', () => {
  assert.equal(Core.framing('wide', 1280, 720), null, 'a landscape frame is what it asked for');
  assert.equal(Core.framing('wide', 1920, 1080), null);
  assert.match(Core.framing('wide', 720, 1280), /turn the phone on its side/i);
  assert.match(Core.framing('wide', 480, 640), /wide picture/i);
  /* the size the camera is actually giving is in the words, so that a report of
     "still wrong" carries the one fact that decides what is wrong */
  assert.match(Core.framing('wide', 480, 640), /tall 480×640/);
  assert.match(Core.framing('tall', 1280, 720), /wide 1280×720/);
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

test('each move asks for the frame its body needs, and says so in the words it opens with', () => {
  /* a plank is long and low; the other two are standing bodies and want the height */
  assert.equal(Moves.plank.camera, 'wide');
  assert.match(Moves.plank.start, /on its side/i, 'and the instruction says which way to lay the phone');
  assert.match(Moves.plank.hint, /on its side/i);
  for (const m of [Moves.wallsit, Moves.kneeraise]) {
    assert.equal(m.camera, 'tall', m.id + ' is a standing body');
    assert.match(m.start, /stand the phone up/i, m.id + ' says to stand the phone up');
    assert.match(m.hint, /standing up|stood up/i, m.id + ' hint: ' + m.hint);
  }
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

test('nothing is forced into a shape the camera did not give', () => {
  /* The canvas is the frame, the same way up. A move that wanted the other shape
     says so in words; it does not get the picture bent into one, and it does not
     get it parked in a letterbox either. */
  assert.equal(Core.canvasSize, undefined, 'there is no such thing as a wanted canvas shape any more');
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

/* ---------- turning a frame that arrived the wrong way up ---------- */

test('a quarter turn moves the corners where a quarter turn should', () => {
  const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  /* clockwise: the top-left corner goes to the top-right */
  assert.deepEqual(Core.rotateLandmarks(corners, 1).map((p) => [p.x, p.y]),
    [[1, 0], [1, 1], [0, 1], [0, 0]]);
  /* and anticlockwise the other way round */
  assert.deepEqual(Core.rotateLandmarks(corners, 3).map((p) => [p.x, p.y]),
    [[0, 1], [0, 0], [1, 0], [1, 1]]);
  /* four turns is where it started, and no turn is the array it was handed */
  assert.deepEqual(Core.rotateLandmarks(corners, 4).map((p) => [p.x, p.y]), corners.map((p) => [p.x, p.y]));
  assert.equal(Core.rotateLandmarks(corners, 0), corners);
  /* whatever else a landmark carries comes through it */
  assert.equal(Core.rotateLandmarks([{ x: 0.2, y: 0.3, z: 1, visibility: 0.7 }], 1)[0].visibility, 0.7);
});

test('a body that arrived on its side reads the same as one that arrived upright', () => {
  /* This is the whole point of turning it. Every angle taken at a joint survives a
     rotation on its own, but the ones taken against vertical or the floor do not —
     a shin is only plumb with respect to gravity — so a frame stored the wrong way
     up has to be put right before anything is read, not after. */
  const M = Moves.wallsit;
  const cfg = Object.assign({}, Core.COMMON, M.defaults);
  const TALL = 9 / 16;

  /* the same body, once in a tall frame the right way up, once in the wide frame a
     phone hands over when it declines to turn the picture itself */
  const upright = [], onSide = [];
  for (let i = 0; i < 33; i++) { upright.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 }); onSide.push(null); }
  const P = { shoulder: [0.18, 0.22], hip: [0.18, 0.48], knee: [0.34, 0.5], ankle: [0.35, 0.69], heel: [0.33, 0.71], toe: [0.44, 0.72] };
  for (const side of ['L', 'R']) for (const [name, i] of Object.entries(Core.SIDE[side])) {
    const p = P[name]; if (!p) continue;
    upright[i] = { x: p[0] / TALL, y: p[1], z: 0, visibility: 0.95 };
  }
  /* turning it anticlockwise is what a clockwise turn has to undo */
  const wide = Core.rotateLandmarks(upright, 3);

  const a = M.read(upright, TALL, cfg);
  const b = M.read(Core.rotateLandmarks(wide, 1), TALL, cfg);
  assert.ok(a.ok && b.ok);
  for (const k of ['knee', 'shin', 'tilt']) {
    assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${k}: upright ${a[k].toFixed(3)}, turned back ${b[k].toFixed(3)}`);
  }
  /* and left as it came, the gravity-bound readings are wrong by a quarter turn */
  const raw = M.read(wide, 1 / TALL, cfg);
  assert.ok(Math.abs(raw.shin - a.shin) > 45, 'unturned, the shin reads nothing like it: ' + raw.shin.toFixed(1));
  assert.ok(Math.abs(raw.knee - a.knee) < 1e-9, 'while the angle at the knee is a rotation apart from nobody');
});

test('every script the page loads carries the current version, so a phone that cached the last one loads this one', () => {
  const fs = require('node:fs'), path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const tags = [...html.matchAll(/<script src="js\/([a-z0-9-]+\.js)(\?v=([^"]*))?"/g)];
  assert.ok(tags.length >= 4, 'the scripts are there: ' + tags.length);
  for (const t of tags) assert.equal(t[3], Core.VER, t[1] + ' is stamped ' + t[3]);
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.match(app, /pose-worker\.js\?v=' \+ Core\.VER/, 'and so is the worker');
  /* and the page itself, so a page kept from before the scripts changed is fetched again */
  const v = /<html[^>]*data-v="([^"]*)"/.exec(html);
  assert.ok(v && v[1] === Core.VER, 'the page carries the version: ' + (v && v[1]));
});
