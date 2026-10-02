'use strict';
/* A plan's adjustments: faults ignored, the range of motion scaled from the return line,
   the count and the hold changed — what a coach or a physio changes for one person. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');
const Moves = require('../public/js/moves.js');

test('an ignored fault is never on, and a band whose faults are all ignored no longer holds the position', () => {
  const M = Moves.proneraise;
  const base = Object.assign({}, Core.COMMON, M.defaults);
  const r = { ok: true, lift: -4, knee: 140, hip: 0 };   // a good lift with the knee bent
  let v = M.judge(r, base);
  assert.ok(v.faults.kneeBend != null, 'the knee is called'); assert.equal(v.inPosition, false, 'and holds the position');
  v = M.judge(r, Core.adjust(M, base, { ignore: ['kneeBend'] }));
  assert.equal(v.faults.kneeBend, undefined, 'ignored: not called');
  assert.equal(v.inPosition, true, 'and the knee no longer holds the position');
  assert.ok(v.good.knee === false, 'the band itself still reads, for the picture');
  const c = Core.adjust(M, base, { ignore: ['kneeBend', 'nosuch', 'lost', 'raise'] });
  assert.deepEqual(c.ignore, ['kneeBend'], 'only faults the move has, never the prompt or lost');
});

test('the range of motion scales the top band and the under-way line from the return line', () => {
  const M = Moves.slr, p = M.spec.progress;
  const base = Object.assign({}, Core.COMMON, M.defaults);
  const band = M.bands.find((b) => b.key === p.measure);
  const d = base[p.downAt];
  const c = Core.adjust(M, base, { rom: 50 });
  assert.equal(c[p.raiseAt], Math.round((d + (base[p.raiseAt] - d) * 0.5) * 10) / 10, 'under way halfway to where it was');
  for (const key of [band.lo, band.hi, band.min, band.max].filter(Boolean)) assert.equal(c[key], Math.round((d + (base[key] - d) * 0.5) * 10) / 10, key + ' halfway out');
  assert.equal(c[p.downAt], d, 'the return line stays');
  assert.equal(c.rom, 50);
  const full = Core.adjust(M, base, { rom: 100 });
  for (const key of [p.raiseAt, band.lo, band.hi, band.min, band.max].filter(Boolean)) assert.equal(full[key], base[key], 'a full range changes nothing');
  const more = Core.adjust(M, base, { rom: 120 });
  assert.ok(Math.abs(more[p.raiseAt] - d) > Math.abs(base[p.raiseAt] - d), 'past the full range asks for more');
  /* a hold is not scaled */
  const H = Moves.wallsit, hb = Object.assign({}, Core.COMMON, H.defaults), hc = Core.adjust(H, hb, { rom: 50 });
  for (const k of Object.keys(H.defaults)) assert.equal(hc[k], hb[k], 'wall sit ' + k);
});

test('the count, the sets, the hold and any setting by name', () => {
  const M = Moves.bridge, base = Object.assign({}, Core.COMMON, M.defaults);
  const c = Core.adjust(M, base, { reps: 8, sets: 2, hold: 3, settings: { shinMin: 80, nosuch: 'x' } });
  assert.equal(c.repCount, 8); assert.equal(c.setCount, 2); assert.equal(c.holdTargetSec, 3); assert.equal(c.shinMin, 80);
  assert.equal(c.nosuch, undefined, 'only numbers');
  const n = Core.adjust(M, base, null);
  assert.deepEqual(n.ignore, []); assert.equal(n.rom, 100);
});
