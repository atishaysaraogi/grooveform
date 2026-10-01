'use strict';
/* Room for the movement: where the figure says each joint will go, scaled to the person,
   must stay inside the picture — said before the set, while there is time to move. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');

/* a figure facing right: the toe rises 60 units over a 40-unit torso between A and B */
const A = { h: [300, 40], sh: [300, 60], hip: [300, 100], kn: [300, 130], an: [300, 160], ft: [312, 162], el: [300, 80], wr: [300, 100] };
const B = Object.assign({}, A, { kn: [330, 110], an: [350, 90], ft: [360, 100] });
const ASPECT = 16 / 9;
/* a person, side on, facing right, the torso 0.3 of the picture's height: the toe near the top edge */
const person = (toeY, facing) => ({ ok: true, side: 'R', facing, points: { ear: { x: 0.8, y: 0.1 }, shoulder: { x: 0.8, y: 0.2 }, hip: { x: 0.8, y: 0.5 }, knee: { x: 0.8, y: 0.72 }, ankle: { x: 0.8, y: 0.95 }, toe: { x: 0.9, y: toeY }, heel: { x: 0.78, y: 0.96 }, elbow: { x: 0.8, y: 0.35 }, wrist: { x: 0.8, y: 0.5 } }, other: {} });

test('a joint the movement would take out of the picture is named; one with room is not', () => {
  /* the toe at the bottom of the picture goes up by 62 figure units × (0.3 / 40) = 0.47: from 0.97 to about 0.5, inside */
  assert.equal(Core.roomOf(A, B, person(0.97, 1), ASPECT, 0.03), null, 'room upward');
  /* the same lift with the person's toe already high: it would leave through the top */
  const out = Core.roomOf(A, B, person(0.4, 1), ASPECT, 0.03);
  assert.ok(out && out.joint === 'toe' && out.side === 'R' && out.y < 0.03, JSON.stringify(out));
  /* facing the other way, the forward travel goes left: the toe at x 0.9 (of 1.78) moves 60 units × 0.0075 = 0.45 left — fine; facing right it would go to 1.35, fine too */
  assert.equal(Core.roomOf(A, B, person(0.97, -1), ASPECT, 0.03), null);
  /* a person near the right edge, facing right: the forward travel leaves through the side */
  const edgeP = person(0.97, 1); edgeP.points.toe = { x: 1.6, y: 0.97 }; edgeP.points.ankle = { x: 1.55, y: 0.95 };
  const side = Core.roomOf(A, B, edgeP, ASPECT, 0.03);
  assert.ok(side && side.joint === 'toe' && side.x > ASPECT - 0.06, JSON.stringify(side));
  /* nothing to say without a reading, a figure, or a torso to scale by */
  assert.equal(Core.roomOf(A, B, { ok: false }, ASPECT, 0.03), null);
  assert.equal(Core.roomOf(null, B, person(0.4, 1), ASPECT, 0.03), null);
  assert.equal(Core.roomOf(A, A, person(0.4, 1), ASPECT, 0.03), null, 'a hold moves nothing');
});

test('the coach says it once during the set-up wait, naming the part, and goes on to be ready', () => {
  const HOLD = { id: 'fake', name: 'Fake hold', faults: ['lost', 'bad'], cues: { bad: { text: 'Fix it' }, room: Core.SHARED_CUES.room }, bands: [], read: (x) => x, judge: (v) => v, defaults: {} };
  const GOOD = { ok: true, inPosition: true, faults: {}, good: {} };
  const c = new Core.Coach(HOLD); const said = [];
  for (let t = 0; t < 8000; t += 33) { if (t % 700 < 33) c.room({ joint: 'toe', side: 'L', over: 0.1 }); const o = c.step(GOOD, t); if (o.cue) said.push(o.cue); }
  const room = said.filter((x) => x.id === 'room');
  assert.equal(room.length, 1, JSON.stringify(said));
  assert.match(room[0].text, /left foot will go out of the picture/);
  assert.ok(room[0].t >= 500 && room[0].t < 3000, 'during the wait: ' + room[0].t);
  assert.equal(c.ready, true, 'the wait is three seconds now'); assert.ok(Core.COMMON.readyMs === 3000);
  assert.ok(Core.SYSTEM.includes('room') && Core.SHARED_CUES.still.text.length);
});
