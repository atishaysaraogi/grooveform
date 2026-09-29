'use strict';
/* The picture's edge: a needed point at it, or sliding in certainty beside it, is not
   trusted, and the coach says which part it is. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const Moves = require('../public/js/moves.js');
const Trace = require('../public/js/trace.js');

const M = Moves.bridge;
const D = Math.PI / 180, ASPECT = 16 / 9;
/* the bridge rig from trace.test.js, with the whole body slid along the frame and any
   one point's certainty set */
function body({ shin = 95, dip = 50, hipAng = 130, foot = 0, facing = 1, vis = 0.95, dx = 0, certain = {} } = {}) {
  const heelAt = [0.64, 0.68], footLen = 0.07, shinLen = 0.15, thighLen = 0.17, torso = 0.2;
  const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  const heel = { x: heelAt[0], y: heelAt[1] };
  const toeDir = { x: facing * Math.cos(foot * D), y: Math.sin(foot * D) };
  const toe = { x: heel.x + footLen * toeDir.x, y: heel.y + footLen * toeDir.y };
  const sd = rot(toeDir, -facing * shin * D);
  const knee = { x: heel.x + shinLen * sd.x, y: heel.y + shinLen * sd.y };
  const ankle = { x: heel.x + shinLen * 0.12 * sd.x, y: heel.y + shinLen * 0.12 * sd.y };
  const td = { x: -facing * Math.cos(dip * D), y: Math.sin(dip * D) };
  const hip = { x: knee.x + thighLen * td.x, y: knee.y + thighLen * td.y };
  const bd = rot({ x: -td.x, y: -td.y }, -facing * hipAng * D);
  const shoulder = { x: hip.x + torso * bd.x, y: hip.y + torso * bd.y };
  const P = { heel, toe, knee, ankle, hip, shoulder, ear: { x: shoulder.x - facing * 0.05, y: shoulder.y - 0.01 } };
  const lm = []; for (let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 });
  for (const side of ['L', 'R']) for (const [name, i] of Object.entries(Core.SIDE[side])) { const p = P[name]; if (p) lm[i] = { x: p.x / ASPECT + dx, y: p.y, z: 0, visibility: certain[name] == null ? vis : certain[name] }; }
  return lm;
}
const toeX = (dx) => body({ dx })[Core.SIDE.R.toe].x;
const cfg = Object.assign({}, Core.COMMON, M.defaults);

test('a needed point past the picture\'s edge is not trusted, however sure the model is of it, and the part is named', () => {
  M.reset();
  const inside = M.read(body(), ASPECT, cfg);
  assert.ok(inside.ok, 'the body in the middle of the picture reads');
  /* slid until the toes are just past the right-hand edge, certainty untouched */
  const dx = 1.01 - toeX(0);
  const out = M.read(body({ dx }), ASPECT, cfg);
  assert.equal(out.ok, false, 'not trusted with the toes out of the picture');
  assert.match(out.why, /foot is at the edge of the picture/, out.why);
  assert.ok(out.edge && out.edge.how === 'edge' && ['toe', 'heel', 'ankle'].includes(out.edge.joint), JSON.stringify(out.edge));
  /* inside the margin but not by much: trusted, and flagged as close */
  const nearDx = 1 - (cfg.edge * 1.5) - toeX(0);
  const near = M.read(body({ dx: nearDx }), ASPECT, cfg);
  assert.ok(near.ok, 'a toe a margin and a half in is trusted');
  assert.ok(near.near.some((n) => n.joint === 'toe'), 'and said to be close: ' + JSON.stringify(near.near));
  assert.equal(inside.near.length, 0, 'nothing is close in the middle');
  /* the margin is a setting */
  assert.ok(M.read(body({ dx }), ASPECT, Object.assign({}, cfg, { edge: -0.1 })).ok, 'with no margin the point past the edge is taken as the model gives it');
  assert.equal(Core.partWords('L', 'ankle'), 'left foot'); assert.equal(Core.partWords('R', 'wrist'), 'right hand');
  assert.equal(Core.fillPart('Your {joint} is out', 'R', 'heel'), 'Your right foot is out');
});

test('near the edge, certainty sliding away from its recent best is not trusted either; far from the edge it is', () => {
  const run = (dx, drops) => {
    M.reset();
    let last = null;
    for (let i = 0; i < 12; i++) last = M.read(body({ dx, certain: i >= 10 ? drops : {} }), ASPECT, cfg);
    return last;
  };
  const nearDx = 1 - (cfg.edge * 2.5) - toeX(0);   // inside three margins, outside two
  const slid = run(nearDx, { toe: 0.6 });   // still over the certainty bar
  assert.equal(slid.ok, false, 'a fall from 0.95 to 0.6 beside the edge is not trusted');
  assert.equal(slid.edge && slid.edge.how, 'drop', JSON.stringify(slid.edge));
  assert.match(slid.why, /at the edge of the picture/);
  assert.ok(run(nearDx, { toe: 0.8 }).ok, 'a smaller fall is');
  assert.ok(run(0, { toe: 0.6 }).ok, 'and the same fall in the middle of the picture is');
  assert.ok(run(nearDx, { toe: 0.6 }) && !M.read(body({ dx: nearDx, certain: { toe: 0.3 } }), ASPECT, cfg).ok, 'under the bar it is hidden, as ever');
});

test('the coach says which part is at the edge, on the slow clock, and warns of a part close to it during the set-up wait', () => {
  const frames = (script) => { const out = []; let t = 0; for (const [pose, ms] of script) for (const end = t + ms; t < end; t += 33) out.push({ t, lm: body(pose) }); return out; };
  const dx = 1.01 - toeX(0);
  const r = Trace.run(M, {}, frames([[{ dx }, 20000]]), ASPECT);
  const edge = r.cues.filter((c) => c.id === 'edge');
  assert.ok(edge.length >= 1, 'said: ' + JSON.stringify(r.cues.map((c) => c.id)));
  assert.match(edge[0].text, /(left|right) foot is at the edge of the picture/, edge[0].text);
  assert.ok(edge[0].t >= 500 && edge[0].t < 700, 'after the persist time: ' + edge[0].t);
  assert.equal(edge.length, 2, 'and again fifteen seconds on, not sooner: ' + edge.map((c) => c.t).join(', '));
  assert.ok(!r.cues.some((c) => c.id === 'lost'), 'not as nobody being there');
  assert.ok(r.rows.every((row) => !row.out.ready), 'and no coaching began');
  /* close to the edge, inside it: one warning during the wait, and the coaching begins */
  const nearDx = 1 - (cfg.edge * 1.5) - toeX(0);
  const w = Trace.run(M, {}, frames([[{ dx: nearDx }, 6000]]), ASPECT);
  const framing = w.cues.filter((c) => c.id === 'framing');
  assert.equal(framing.length, 1, 'once: ' + JSON.stringify(w.cues));
  assert.match(framing[0].text, /(left|right) foot is close to the edge of the picture/, framing[0].text);
  assert.ok(framing[0].t < 2000, 'before the wait is over: ' + framing[0].t);
  assert.ok(w.rows[w.rows.length - 1].out.ready, 'the coaching began all the same');
  /* neither is one of the person's faults */
  assert.ok(!Trace.faultIds(M).includes('edge') && !Trace.faultIds(M).includes('framing'));
  assert.ok(!M.faults.includes('edge'), 'not in the fault order');
  const acct = Trace.reps(r, M); assert.equal(acct.length, 0, 'no attempt in a frame that is not trusted');
});
