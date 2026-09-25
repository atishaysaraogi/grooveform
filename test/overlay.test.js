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
