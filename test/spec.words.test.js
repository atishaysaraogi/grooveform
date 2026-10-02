'use strict';
/* The words the studio writes for a measurement, a rule and a fault, and the `axis`
   option on a distance. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const Spec = require('../public/js/spec.js');
const Moves = require('../public/js/moves.js');
const W = Spec.words;

test('a measurement is described from its geometry, in a physio\'s words', () => {
  const f = Moves.bridge.spec, m = (k) => f.measurements.find((x) => x.key === k);
  const foot = W.describe(m('foot'), f);
  assert.equal(foot.what, 'the foot line off the floor (heel over toe), as the change since the start');
  assert.equal(foot.meaning, '0 is as at the start; + the heel up, − the toes up.', 'a change still says which way is which');
  assert.deepEqual(foot.notes, []);
  assert.equal(foot.unit, '°');
  assert.equal(W.describe(m('hip'), f).what, 'the hip angle (knee–hip–shoulder), read on past 180', 'a joint angle that keeps rising past straight');
  assert.deepEqual(W.describe(m('hip'), f).notes, []);
  assert.equal(W.describe(m('over'), f).what, 'the hip off the straight line from the knee to the shoulder');
  assert.equal(W.describe(m('shin'), f).what, 'the ankle angle at the heel (toe–heel–knee)');
  /* the other side's points are said with their side; a reversed sign is said */
  const slr = Moves.slr.spec;
  assert.equal(W.describe(slr.measurements.find((x) => x.key === 'other'), slr).what, 'the height of the other heel over the hip, as % of the other shin, as the change since the start');
  const lift = W.describe(slr.measurements.find((x) => x.key === 'lift'), slr);
  assert.equal(lift.what, 'the hip angle (knee–hip–shoulder), as the change from rest');
  assert.deepEqual(lift.notes, ['sign reversed']);
  /* a length, a change, a ratio */
  const clam = Moves.clamshell.spec;
  assert.equal(W.describe(clam.measurements.find((x) => x.key === 'feet'), clam).what, 'the gap between the heels, as % of the trunk, as the change since the start');
  assert.match(W.describe(clam.measurements.find((x) => x.key === 'open'), clam).what, /the knee over the hip .*, as the change since the start$/);
  const ww = Moves.wallwalk.spec;
  assert.equal(W.describe(ww.measurements.find((x) => x.key === 'shrug'), ww).unit, '%');
});

test('every measurement in the library gets words, and none is a bare key', () => {
  for (const mv of Moves.list) {
    const f = mv.spec;
    for (const m of f.measurements) {
      const d = W.describe(m, f);
      assert.ok(d.what.length > 8 && /^(the|how|a |minus)/.test(d.what), `${f.id}.${m.key}: ${d.what}`);
      assert.ok(d.unit === '°' || d.unit === '%' || m.kind === 'sum', `${f.id}.${m.key} unit ${d.unit}`);
      if (m.band) assert.match(W.ruleWords(f, m, null, f.defaults), /must be (between|at least|at most|within)/, `${f.id}.${m.key}`);
    }
    for (const x of f.faults) assert.match(W.faultWords(f, x, f.defaults), /→ ‘.+’, said as ‘.+’/, `${f.id}.${x.id}`);
    if (f.type === 'reps') assert.match(W.progressWords(f, f.defaults), /^The rep is under way once .* and counts once it is back/);
  }
});

test('the rule, the fault and the setting read as sentences with the window in them', () => {
  const f = Moves.bridge.spec, m = (k) => f.measurements.find((x) => x.key === k);
  assert.equal(W.ruleWords(f, m('foot'), null, f.defaults), 'At all times, the foot line off the floor (heel over toe), as the change since the start, must be within 12° of the start.');
  assert.equal(W.ruleWords(f, m('hip'), null, f.defaults), 'At the top of the rep, the hip angle (knee–hip–shoulder), read on past 180, must be at least 160°.');
  assert.equal(W.startWords(f, m('shin')), 'At the start position, the ankle angle at the heel (toe–heel–knee) must be between 45° and 150°.');
  assert.equal(W.faultWords(f, f.faults.find((x) => x.id === 'heelsUp'), f.defaults), 'Over 12° at all times (risen more than 12° from the start) → ‘Heels lifting’, said as ‘Keep your heels down’; well past: ‘Heels down — they are coming off the floor’.');
  assert.equal(W.settingWords(f, 'footFlat'), 'The foot line off the floor (heel over toe), as the change since the start, at all times: within ± (°)');
  assert.equal(W.settingWords(f, 'overMax'), 'The hip off the straight line from the knee to the shoulder, at the top of the rep: at most (°)');
  assert.match(W.faultWords(f, f.faults.find((x) => x.id === 'feetFar'), f.defaults), /^Over 122° between reps/, 'the feet are judged at rest');
  assert.match(W.settingWords(f, 'raiseAt'), /^A rep is under way once the hip angle .* rises past \(°\)$/);
  assert.equal(W.settingWords(f, 'footBias'), null, 'a number that is not an edge keeps the file\'s own words');
  assert.equal(W.whenWords(Moves.plank.spec, 'top'), 'in the hold');
  assert.equal(W.whenWords(Object.assign({}, f, { words: Object.assign({}, f.words, { atTop: 'at the bottom of the squat' }) }), 'top'), 'at the bottom of the squat');
  /* the edge words follow the sign */
  assert.equal(W.edgeWords(f, m('foot'), 'below', -10), 'Under -10° (dropped more than 10° from the start)');
  const cat = Moves.catcamel.spec;
  assert.match(W.faultWords(cat, cat.faults.find((x) => x.measure === 'round' && x.side === 'above'), cat.defaults), /dropped less than 15° from the start/);
});

test('a new fault starts with words from the geometry', () => {
  const f = Moves.bridge.spec;
  assert.deepEqual(W.faultTemplate(f, f.measurements.find((x) => x.key === 'foot'), 'above'), { label: 'Heels lifting', text: 'Keep the heels down' });
  assert.deepEqual(W.faultTemplate(f, f.measurements.find((x) => x.key === 'hip'), 'below'), { label: 'Hips short of the line', text: 'Lift the hips higher' });
  const t = W.faultTemplate(Moves.hinge.spec, Moves.hinge.spec.measurements.find((x) => x.key === 'hinge'), 'above');
  assert.ok(t.label.length <= 26 && t.text, JSON.stringify(t));
  /* a foot read against its start is still heels lifting; any other change is said by the part that moved */
  assert.deepEqual(W.faultTemplate(Moves.lunge.spec, Moves.lunge.spec.measurements.find((x) => x.key === 'heel'), 'above'), { label: 'Heels lifting', text: 'Keep the heels down' });
  assert.deepEqual(W.faultTemplate(Moves.kneeext.spec, Moves.kneeext.spec.measurements.find((x) => x.key === 'thigh'), 'above'), { label: 'Thigh up from start', text: 'Back to where you started' });
});

test('a distance along one axis: the height of a point over another as a share of a limb', () => {
  const P = { hip: { x: 0.5, y: 0.5, v: 1 }, knee: { x: 0.6, y: 0.6, v: 1 }, heel: { x: 0.7, y: 0.7, v: 1 }, 'other.heel': null };
  const both = { R: P, L: { heel: { x: 0.9, y: 0.7, v: 1 } } };
  const ctx = { P, both, cfg: { vis: 0.5 }, facing: 1, Core, values: {}, side: 'R' };
  const thigh = Math.hypot(0.1, 0.1);
  const up = Spec.measure({ kind: 'distance', a: 'knee', b: 'hip', axis: 'y', per: ['hip', 'knee'], times: 100 }, ctx).x;
  assert.ok(Math.abs(up - 100 * 0.1 / thigh) < 1e-9, 'the hip is a tenth of the frame above the knee: ' + up);
  const ahead = Spec.measure({ kind: 'distance', a: 'hip', b: 'knee', axis: 'x', per: ['hip', 'knee'], times: 100 }, ctx).x;
  assert.ok(Math.abs(ahead - 100 * 0.1 / thigh) < 1e-9, '+ the way the body faces');
  assert.ok(Math.abs(Spec.measure({ kind: 'distance', a: 'hip', b: 'knee', axis: 'x', per: ['hip', 'knee'] }, Object.assign({}, ctx, { facing: -1 })).x + 0.1 / thigh) < 1e-9, 'and − the other way');
  const gap = Spec.measure({ kind: 'distance', a: 'heel', b: 'other.heel', axis: 'x', per: ['hip', 'knee'] }, ctx).x;
  assert.ok(gap > 0, 'the other heel is ahead');
  /* the checker asks for per, and only on a distance */
  const file = JSON.parse(JSON.stringify(Moves.bridge.spec));
  file.measurements.push({ key: 'lift', kind: 'distance', a: 'ankle', b: 'hip', axis: 'y' });
  assert.ok(Spec.check(file).some((p) => p.level === 'error' && /axis needs per/.test(p.message)));
  file.measurements[file.measurements.length - 1].per = ['hip', 'knee'];
  assert.ok(!Spec.check(file).some((p) => /axis/.test(p.message)));
  file.measurements[file.measurements.length - 1].kind = 'rise';
  assert.ok(Spec.check(file).some((p) => p.level === 'error' && /on a distance/.test(p.message)));
  const d = W.describe({ kind: 'distance', a: 'other.heel', b: 'heel', axis: 'y', per: ['knee', 'ankle'], times: 100 }, Moves.slr.spec);
  assert.equal(d.what, 'the height of the heel over the other heel, as % of the shin');
  assert.equal(d.unit, '%');
});

test('a tilt signed by the line it is facing from is warned about', () => {
  const file = JSON.parse(JSON.stringify(Moves.calfraise.spec));
  file.facing = { from: 'hip', to: 'shoulder' };
  assert.ok(Spec.check(file).some((p) => p.level === 'warn' && /can never read negative/.test(p.message)), 'facing hip to shoulder, the trunk lean tilts the same line');
  file.facing = { from: 'heel', to: 'toe' };
  assert.ok(!Spec.check(file).some((p) => /can never read negative/.test(p.message)));
});
