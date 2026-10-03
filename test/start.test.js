'use strict';
/* The start position: what the coach waits for before it says or counts anything — the rep's
   measure back at its start, measurements in a range, held for `readyMs` — and the file that says
   there is none, so the coaching begins on the first frame the body is seen. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const Spec = require('../public/js/spec.js');
const Moves = require('../public/js/moves.js');
const Rig = require('./fixtures/rig.js');

/* the bridge, with its start position as given */
const bridge = (ready, defaults) => {
  const f = JSON.parse(JSON.stringify(Moves.bridge.spec));
  if (ready === null) delete f.ready; else if (ready) f.ready = ready;
  Object.assign(f.defaults, defaults || {});
  assert.deepEqual(Spec.check(f).filter((p) => p.level === 'error'), [], 'the file checks clean');
  return Spec.compile(f, Core);
};
/* a pose held for ms through a fresh coach: when it became ready, and what was said */
function hold(M, pose, ms, over) {
  if (M.reset) M.reset();
  const c = new Core.Coach(M, over || {});
  let readyAt = null; const said = [];
  for (const { t, lm } of Rig.take([[pose, ms]])) {
    const out = c.step(M.read(lm, Rig.ASPECT, c.cfg), t);
    if (out.ready && readyAt == null) readyAt = t;
    if (out.cue) said.push(out.cue.id);
  }
  return { readyAt, said };
}

test('a rep move waits for its measure back at the start, held for readyMs', () => {
  const M = bridge();
  assert.equal(M.ready != null, true, 'the bridge says what its start is');
  const atRest = hold(M, Rig.REST, 5000);
  assert.ok(atRest.readyAt >= 3000 && atRest.readyAt < 3100, 'lying at rest: ready after the three seconds — ' + atRest.readyAt);
  assert.equal(hold(M, Rig.TOP, 6000).readyAt, null, 'hips up from the first frame: never the start, never coached');
  assert.ok(hold(bridge(undefined, { readyMs: 1000 }), Rig.REST, 3000).readyAt < 1100, 'a shorter hold, from the file');
});

test('a measurement in a range is part of the start, and the words for it are said', () => {
  /* the shin must be past 100 at the start; the rig's rest has it at 95 */
  const M = bridge({ atStart: true, ranges: { shin: [100, 150] }, nudge: 'Feet a little further from you' }, { nudgeSec: 2 });
  const r = hold(M, Rig.REST, 4000);
  assert.equal(r.readyAt, null, 'the shin out of its start range: not the start');
  assert.ok(r.said.includes('notready'), 'and after two seconds the nudge is said: ' + r.said.join(','));
  assert.ok(hold(M, Object.assign({}, Rig.REST, { shin: 110 }), 4000).readyAt != null, 'the shin inside: the start');
});

test('no start position: no rule and no time, and the coaching begins on the first frame seen', () => {
  const M = bridge({ atStart: false }, { readyMs: 0 });
  assert.equal(hold(M, Rig.TOP, 500).readyAt, 0, 'hips already up: coached from the first frame');
  assert.equal(hold(M, Rig.REST, 500).readyAt, 0);
  /* no rule but a time: being seen, held */
  const seen = hold(bridge({ atStart: false }, { readyMs: 2000 }), Rig.TOP, 3000);
  assert.ok(seen.readyAt >= 2000 && seen.readyAt < 2100, 'being seen for two seconds is the start: ' + seen.readyAt);
  /* the words only: the rep's start is still the default */
  assert.equal(hold(bridge({ nudge: 'Lie down' }), Rig.TOP, 4000).readyAt, null, 'a nudge alone leaves the start as it was');
});

test('the hold at the top as a rule or as a note', () => {
  /* the bridge with a long hold the rig's quick rep cannot meet */
  const run = (holdShort) => {
    const M = bridge(undefined, Object.assign({ holdTargetSec: 5 }, holdShort ? { holdShort } : {}));
    if (M.reset) M.reset();
    const c = new Core.Coach(M, {});
    const said = []; let last = null;
    for (const { t, lm } of Rig.take([[Rig.REST, 4000], [Rig.TOP, 2500], [Rig.REST, 3000]])) {
      last = c.step(M.read(lm, Rig.ASPECT, c.cfg), t);
      if (last.cue) said.push(last.cue.text);
    }
    return { reps: last.reps, said };
  };
  const rule = run(), note = run('note');
  assert.equal(rule.reps, 0, 'a rule: down before the hold is done, not counted');
  assert.ok(rule.said.some((w) => w === Moves.bridge.spec.words.early), 'and the early words said: ' + rule.said.join(' | '));
  assert.equal(note.reps, 1, 'a note: the rep counts');
  assert.ok(note.said.some((w) => w.startsWith('1 — ') && w.includes(Moves.bridge.spec.words.early)), 'the short hold said on the count: ' + note.said.join(' | '));
  const f = JSON.parse(JSON.stringify(Moves.bridge.spec)); f.defaults.holdShort = 'maybe';
  assert.ok(Spec.check(f).some((p) => p.level === 'error' && p.at === 'defaults.holdShort'), 'anything else is an error in the file');
});
