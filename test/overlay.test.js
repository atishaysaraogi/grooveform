'use strict';
/* The words on the picture: a cue wrapped to the frame so none of it is ever
   past the edge. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../public/js/core.js');

const measure = (s) => s.length * 10;   // ten units a character

test('a cue is laid into lines no wider than the frame, on the spaces', () => {
  const text = 'Lay the phone on its side on the floor. I will wait while you get set up';
  const lines = Core.wrapWords(text, 200, measure);
  assert.ok(lines.length >= 4, 'several lines: ' + lines.length);
  for (const l of lines) assert.ok(measure(l) <= 200, 'within the width: ' + l);
  assert.equal(lines.join(' '), text, 'nothing lost, nothing added');
  assert.deepEqual(Core.wrapWords('Lift your hips', 400, measure), ['Lift your hips'], 'a short cue is one line');
});

test('a word wider than the frame is broken where it must be, so nothing is ever wider than the frame', () => {
  const lines = Core.wrapWords('ok supercalifragilistic end', 100, measure);
  for (const l of lines) assert.ok(measure(l) <= 100, 'within: ' + l);
  assert.equal(lines.join(''), 'oksupercalifragilisticend', 'every character kept: ' + lines.join('|'));
  assert.deepEqual(Core.wrapWords('', 100, measure), []);
  assert.deepEqual(Core.wrapWords('   ', 100, measure), []);
});

const Overlay = require('../public/js/overlay.js');
const Sound = require('../public/js/sound.js');
const Moves = require('../public/js/moves.js');

test('the tones: every cue has one, the time calls share theirs, and a sequence renders as sound', () => {
  assert.equal(Sound.toneFor('call30'), Sound.TONES.call);
  assert.equal(Sound.toneFor('call5'), Sound.TONES.call);
  assert.equal(Sound.toneFor('hold'), Sound.TONES.hold);
  assert.equal(Sound.toneFor('hipHigh'), Sound.TONES.lost, 'a cue without a tone of its own gets the plain one');
  const d = Sound.samples(Sound.TONES.hold, 22050);
  const expect = (0.09 + Sound.GAP + 0.13 + Sound.GAP) * 22050;
  assert.ok(Math.abs(d.length - expect) < 4, 'as long as its notes: ' + d.length);
  let sum = 0; for (const x of d) sum += x * x;
  assert.ok(Math.sqrt(sum / d.length) > 0.4, 'and not silence');
  assert.equal(Sound.OUT_GAIN, 0.18, 'the tones sit under the voice');
});

test('the words on the picture and the rule for red are the same for the coach and the Review page', () => {
  const M = Moves.bridge;
  assert.equal(Overlay.bandText({ lo: 'shinMin', hi: 'shinMax' }, { shinMin: 85, shinMax: 110 }), '85\u2013110');
  assert.equal(Overlay.bandText({ sym: 'footFlat' }, { footFlat: 10 }), '\u00b110');
  assert.equal(Overlay.faultWords({ active: ['heelsUp', 'hipHigh'] }, M.cues), M.cues.heelsUp.label + '  \u00b7  ' + M.cues.hipHigh.label);
  assert.equal(Overlay.faultWords({ active: [] }, M.cues), '');
  assert.equal(Overlay.isCorrection({ id: 'hipHigh', text: 'x' }, M), true);
  assert.equal(Overlay.isCorrection({ id: 'raise', text: 'Lift your hips' }, M), false, 'a prompt is not a correction');
  assert.equal(Overlay.isCorrection({ id: 'count3', text: '3' }, M), false);
  assert.equal(Overlay.isCorrection({ id: 'count3', text: '3 \u2014 slower on the way down' }, M), true);
  assert.equal(Overlay.isCorrection({ id: 'early', text: 'x' }, M), true);
  /* the cue on the picture at a moment: the last one said, while it is still fresh */
  const cues = [{ id: 'raise', text: 'Lift your hips', t: 1000 }, { id: 'hipHigh', text: 'Not so high', t: 4000 }];
  const isC = (c) => Overlay.isCorrection(c, M);
  assert.equal(Overlay.bannerAt(cues, 500, isC), null);
  assert.equal(Overlay.bannerAt(cues, 2000, isC).text, 'Lift your hips');
  assert.equal(Overlay.bannerAt(cues, 2000, isC).colour, Overlay.C.ink);
  assert.equal(Overlay.bannerAt(cues, 3900, isC), null, 'gone after its time');
  assert.equal(Overlay.bannerAt(cues, 4100, isC).colour, Overlay.C.bad, 'a fault in red');
});
