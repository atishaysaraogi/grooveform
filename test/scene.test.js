'use strict';
/* Before anything is measured: a joint that leaps is held, and the light and the
   background are looked at and, when they call for it, said once. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');

/* a standing body: thirty-three points in a box, all trusted */
function body(dx = 0) {
  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.45 + dx + (i % 2) * 0.1, y: 0.1 + (i / 33) * 0.8, z: 0, visibility: 0.95 });
  return lm;
}
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

test('a landmark that leaps in one frame is held where it was, for two frames, then believed', () => {
  const g = new Core.JumpGate(Core.COMMON);
  let t = 0; g.apply(body(), t);
  /* the right ankle (28) snaps a quarter of the body away: held */
  const snap = body(); snap[28] = { x: snap[28].x + 0.25, y: snap[28].y, z: 0, visibility: 0.9 };
  t += 33; let out = g.apply(snap, t);
  assert.equal(dist(out[28], body()[28]), 0, 'held at the last place');
  assert.equal(out[28].visibility, 0.9, 'with the certainty the model gave it');
  assert.deepEqual(g.held, [28], 'and said so');
  t += 33; out = g.apply(snap, t); assert.equal(dist(out[28], body()[28]), 0, 'a second frame too');
  t += 33; out = g.apply(snap, t); assert.ok(dist(out[28], snap[28]) === 0, 'the third frame is believed: it is where the foot is');
  assert.equal(g.held.length, 0);
  /* a slow movement is never held: the whole body drifts a little each frame */
  const h = new Core.JumpGate(Core.COMMON); let s = 0;
  for (let i = 0; i < 10; i++) { const o = h.apply(body(i * 0.01), s); s += 33; assert.equal(h.held.length, 0, 'frame ' + i); assert.equal(o[28].x, body(i * 0.01)[28].x); }
  /* a gap in the frames starts afresh: nothing is held across it */
  const k = new Core.JumpGate(Core.COMMON); k.apply(body(), 0); k.apply(body(0.3), 1000); assert.equal(k.held.length, 0);
  /* off with jump 0 */
  const z = new Core.JumpGate(Object.assign({}, Core.COMMON, { jump: 0 })); z.apply(body(), 0); assert.equal(dist(z.apply(snap, 33)[28], snap[28]), 0);
});

/* a thumbnail: w × h RGBA, the body's box one shade and the rest another */
function picture(w, h, bg, body, box) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, inb = box && x >= box[0] && x < box[2] && y >= box[1] && y < box[3]; const c = inb ? body : bg; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }
  return d;
}
const lmIn = (x0, y0, x1, y1) => { const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: x0 + ((i % 4) / 3) * (x1 - x0), y: y0 + (Math.floor(i / 4) / 8) * (y1 - y0), visibility: 0.9 }); return lm; };

test('the light and the background: dark, against the light, blending in, or nothing to say', () => {
  const W = 64, H = 36, box = [20, 6, 40, 30], lm = lmIn(20 / W, 6 / H, 40 / W, 30 / H);
  const fine = Core.scene(picture(W, H, [200, 200, 200], [60, 40, 120], box), W, H, lm, 0.5);
  assert.ok(fine.luma > 0.5 && fine.body < fine.bg && fine.colour > 0.1, JSON.stringify(fine));
  assert.equal(Core.sceneCue(fine), null, 'a lit body against a plain wall calls for nothing');
  const darkTop = Core.scene(picture(W, H, [215, 215, 215], [30, 30, 30], box), W, H, lm, 0.5);
  assert.equal(Core.sceneCue(darkTop), null, 'a dark top on a light wall is contrast, not backlighting: ' + JSON.stringify(darkTop));
  const dark = Core.scene(picture(W, H, [20, 20, 20], [30, 30, 30], box), W, H, lm, 0.5);
  assert.equal(Core.sceneCue(dark), 'dark');
  const backlit = Core.scene(picture(W, H, [250, 250, 250], [50, 50, 50], box), W, H, lm, 0.5);   // a window behind: blown white round a dark body
  assert.equal(Core.sceneCue(backlit), 'backlit', JSON.stringify(backlit));
  const blend = Core.scene(picture(W, H, [120, 110, 100], [125, 112, 104], box), W, H, lm, 0.5);
  assert.equal(Core.sceneCue(blend), 'blend', JSON.stringify(blend));
  /* a body in a different colour at the same brightness is not blending in */
  const colour = Core.scene(picture(W, H, [120, 120, 120], [180, 90, 90], box), W, H, lm, 0.5);
  assert.equal(Core.sceneCue(colour), null, JSON.stringify(colour));
  /* no body seen: the light is still read, the contrast is not */
  const nobody = Core.scene(picture(W, H, [120, 120, 120], [120, 120, 120], null), W, H, null, 0.5);
  assert.equal(nobody.body, null); assert.equal(Core.sceneCue(nobody), null);
  assert.equal(Core.scene(null, W, H, lm, 0.5), null);
});

test('the coach says the one thing about the light once, during the set-up wait, and the set goes on', () => {
  const HOLD = { id: 'fake', name: 'Fake hold', faults: ['lost', 'bad'], cues: { bad: { text: 'Fix it' } }, bands: [], read: (x) => x, judge: (v) => v, defaults: {} };
  const GOOD = { ok: true, inPosition: true, faults: {}, good: {} };
  const c = new Core.Coach(HOLD);
  const said = [];
  for (let t = 0; t < 6000; t += 33) { if (t % 700 < 33) c.scene({ luma: 0.5, dark: 0, bright: 0, body: 0.46, bg: 0.48, colour: 0.02 }); const o = c.step(GOOD, t); if (o.cue) said.push(o.cue); }
  const blend = said.filter((x) => x.id === 'blend');
  assert.equal(blend.length, 1, 'once: ' + JSON.stringify(said));
  assert.match(blend[0].text, /blend into the background/);
  assert.ok(blend[0].t >= 500 && blend[0].t < 2000, 'in the wait, after it has held: ' + blend[0].t);
  assert.equal(c.ready, true, 'the coaching began all the same');
  /* nothing to say: nothing said */
  const d = new Core.Coach(HOLD); const quiet = [];
  for (let t = 0; t < 4000; t += 33) { d.scene({ luma: 0.5, dark: 0, bright: 0, body: 0.42, bg: 0.6, colour: 0.2 }); const o = d.step(GOOD, t); if (o.cue) quiet.push(o.cue.id); }
  assert.ok(!quiet.some((id) => ['dark', 'backlit', 'blend'].includes(id)), JSON.stringify(quiet));
  assert.ok(Core.SYSTEM.includes('blend') && Core.SHARED_CUES.dark && Core.SHARED_CUES.backlit);
});
