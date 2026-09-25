'use strict';
/* The file the page writes for a set: is it timed by the clock the frames were
   taken by, and laid out the way a player expects. Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Mp4 = require('../public/js/mp4.js');

const frame = (n, key) => ({ data: new Uint8Array(n).fill(key ? 0x65 : 0x41), key });
const avcC = new Uint8Array([1, 66, 0x80, 31, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0x80, 0x1f, 1, 0, 2, 0x68, 0xce]);

test('thirty frames a second stay a thirtieth of a second apart, and the file is as long as the set', () => {
  const samples = [];
  for (let i = 0; i < 90; i++) samples.push(Object.assign(frame(i % 30 === 0 ? 3000 : 800, i % 30 === 0), { ts: i * 33333 }));
  const file = Mp4.write({ width: 720, height: 1280, codec: 'avc', description: avcC, samples });
  const f = Mp4.inspect(file);
  assert.deepEqual(f.top, ['ftyp', 'moov', 'mdat'], 'the index comes before the data');
  assert.equal(f.samples, 90);
  assert.ok(Math.abs(f.duration - 3) < 0.01, 'three seconds long: ' + f.duration);
  assert.ok(Math.abs(f.trackDuration - 3) < 0.01);
  for (const d of f.durations) assert.ok(Math.abs(d - 1 / 30) < 0.001, 'a thirtieth of a second each: ' + d);
  assert.deepEqual(f.keyframes, [1, 31, 61], 'the key frames are listed');
  assert.equal(f.codec, 'avc1'); assert.equal(f.width, 720); assert.equal(f.height, 1280);
  assert.deepEqual(f.sizes.slice(0, 3), [3000, 800, 800]);
});

test('frames taken late stay late: the film is timed by the clock, not by a frame count', () => {
  /* a model stall: nothing for four hundred milliseconds, then frames again. The
     frame before the gap holds for the gap; nothing is sped up to fill it. */
  const ts = [0, 33333, 66666, 466666, 500000, 533333];
  const samples = ts.map((t, i) => Object.assign(frame(500, i === 0), { ts: t }));
  const f = Mp4.inspect(Mp4.write({ width: 640, height: 480, codec: 'avc', description: avcC, samples }));
  assert.ok(Math.abs(f.durations[2] - 0.4) < 0.001, 'the frame before the stall lasts the stall: ' + f.durations[2]);
  assert.ok(Math.abs(f.durations[3] - 1 / 30) < 0.001, 'and the pace resumes after it');
  assert.ok(Math.abs(f.durations[5] - 1 / 30) < 0.001, 'the last frame is held as long as the one before it');
  assert.ok(Math.abs(f.duration - (0.533333 + 1 / 30)) < 0.002, 'and the whole is the clock\'s length: ' + f.duration);
});

test('a clock that stands still gives a frame one tick, never none, so the file stays in order', () => {
  const d = Mp4.durations([0, 1000, 1000, 1000, 2000]);
  assert.deepEqual(d.slice(1, 3), [1, 1]);
  assert.ok(d.every((x) => x >= 1));
  assert.deepEqual(Mp4.durations([5000]), [3000], 'a single frame lasts a thirtieth of a second');
});

test('the data is where the index says it is', () => {
  const samples = [Object.assign(frame(10, true), { ts: 0 }), Object.assign(frame(20, false), { ts: 40000 })];
  const file = Mp4.write({ width: 320, height: 240, codec: 'avc', description: avcC, samples });
  const f = Mp4.inspect(file);
  const mdat = Mp4.boxes(file).find((b) => b.type === 'mdat');
  assert.equal(f.chunkOffset, mdat.start, 'the one chunk starts at the first byte of mdat');
  assert.equal(file[f.chunkOffset], 0x65, 'and that byte is the first frame\'s');
  assert.equal(file[f.chunkOffset + 10], 0x41, 'followed by the second\'s');
  assert.equal(mdat.end - mdat.start, 30);
  const avc = Mp4.find(file, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd']);
  const entry = Mp4.boxes(file, avc[0].start + 8, avc[0].end)[0];
  const conf = Mp4.boxes(file, entry.start + 78, entry.end).find((b) => b.type === 'avcC');
  assert.ok(conf, 'the decoder description is in the sample entry');
  assert.deepEqual(Array.from(file.slice(conf.start, conf.end)), Array.from(avcC));
});

test('VP9 goes in the same file with its own sample entry, and needs no description', () => {
  const samples = [Object.assign(frame(10, true), { ts: 0 }), Object.assign(frame(20, false), { ts: 33333 })];
  const file = Mp4.write({ width: 320, height: 240, codec: 'vp9', codecString: 'vp09.00.10.08', samples });
  const f = Mp4.inspect(file);
  assert.equal(f.codec, 'vp09');
  assert.deepEqual(f.keyframes, [1]);
  const sd = Mp4.find(file, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd'])[0];
  const entry = Mp4.boxes(file, sd.start + 8, sd.end)[0];
  const vpcC = Mp4.boxes(file, entry.start + 78, entry.end).find((b) => b.type === 'vpcC');
  assert.ok(vpcC);
  assert.deepEqual(Array.from(file.slice(vpcC.start + 4, vpcC.start + 7)), [0, 10, 0x82], 'profile 0, level 1.0, 8-bit 4:2:0');
  assert.throws(() => Mp4.write({ width: 1, height: 1, codec: 'avc', samples }), /description/, 'but avc without one is refused');
  assert.throws(() => Mp4.write({ width: 1, height: 1, codec: 'avc', description: avcC, samples: [] }), /no frames/);
});

/* ---------- sound ---------- */
const aacPacket = (n) => ({ data: new Uint8Array(n).fill(0x21), ts: 0, key: true });

test('a sound track goes in beside the picture: AAC, 1024 samples a packet, its own chunk after the video', () => {
  const samples = [];
  for (let i = 0; i < 60; i++) samples.push(Object.assign(frame(i % 30 === 0 ? 3000 : 800, i % 30 === 0), { ts: i * 33333 }));
  const packets = [];
  for (let i = 0; i < 94; i++) packets.push(Object.assign(aacPacket(120), { ts: Math.round(i * 1024 * 1e6 / 48000) }));   // two seconds of sound
  const file = Mp4.write({ width: 640, height: 480, codec: 'avc', description: avcC, samples,
    audio: { sampleRate: 48000, channels: 1, description: new Uint8Array([0x11, 0x88]), samples: packets, bitrate: 96000 } });
  const f = Mp4.inspect(file);
  assert.equal(f.tracks, 2);
  assert.equal(f.sound.handler, 'soun');
  assert.equal(f.sound.codec, 'mp4a');
  assert.equal(f.sound.sampleRate, 48000); assert.equal(f.sound.channels, 1);
  assert.equal(f.sound.samples, 94); assert.equal(f.sound.sampleDuration, 1024);
  assert.ok(Math.abs(f.sound.duration - 94 * 1024 / 48000) < 0.001, 'two seconds of sound: ' + f.sound.duration);
  assert.deepEqual(f.sound.config, [0x11, 0x88], 'the decoder description the encoder gave is in the entry');
  const videoBytes = samples.reduce((a, s) => a + s.data.length, 0);
  assert.equal(f.sound.chunkOffset, f.chunkOffset + videoBytes, 'the sound follows the picture in mdat');
  assert.equal(file[f.sound.chunkOffset], 0x21, 'and the first byte there is the first packet');
  assert.ok(Math.abs(f.duration - Math.max(2, 94 * 1024 / 48000)) < 0.01, 'the film is as long as the longer track: ' + f.duration);
  assert.equal(f.sound.delay, 0); assert.equal(f.delay, 0);
});

test('the two tracks share one clock: whichever started later gets an empty edit for the gap', () => {
  const samples = [0, 33333, 66666].map((t, i) => Object.assign(frame(500, i === 0), { ts: 140000 + t }));   // picture from 140 ms
  const packets = [0, 1, 2, 3].map((i) => Object.assign(aacPacket(100), { ts: 20000 + Math.round(i * 1024 * 1e6 / 48000) }));   // sound from 20 ms
  const f = Mp4.inspect(Mp4.write({ width: 320, height: 240, codec: 'avc', description: avcC, samples,
    audio: { sampleRate: 48000, channels: 1, samples: packets } }));
  assert.ok(Math.abs(f.delay - 0.12) < 0.0015, 'the picture waits the difference: ' + f.delay);
  assert.equal(f.sound.delay, 0, 'and the sound, which came first, does not');
  /* the other way round */
  const g = Mp4.inspect(Mp4.write({ width: 320, height: 240, codec: 'avc', description: avcC,
    samples: samples.map((s) => Object.assign({}, s, { ts: s.ts - 140000 })),
    audio: { sampleRate: 48000, channels: 1, samples: packets.map((p) => Object.assign({}, p, { ts: p.ts + 60000 })) } }));
  assert.equal(g.delay, 0);
  assert.ok(Math.abs(g.sound.delay - 0.08) < 0.0015, 'the sound waits: ' + g.sound.delay);
});

test('without a description from the encoder, AAC-LC\'s own two bytes are written from the rate and channels', () => {
  assert.deepEqual(Array.from(Mp4.aacConfig(48000, 1)), [0x11, 0x88]);
  assert.deepEqual(Array.from(Mp4.aacConfig(44100, 1)), [0x12, 0x08]);
  assert.deepEqual(Array.from(Mp4.aacConfig(44100, 2)), [0x12, 0x10]);
  const f = Mp4.inspect(Mp4.write({ width: 320, height: 240, codec: 'avc', description: avcC,
    samples: [Object.assign(frame(10, true), { ts: 0 })], audio: { sampleRate: 44100, channels: 1, samples: [aacPacket(10)] } }));
  assert.deepEqual(f.sound.config, [0x12, 0x08]);
  /* and no sound at all is the file as before */
  const s = Mp4.inspect(Mp4.write({ width: 320, height: 240, codec: 'avc', description: avcC, samples: [Object.assign(frame(10, true), { ts: 0 })], audio: null }));
  assert.equal(s.tracks, 1); assert.equal(s.sound, null);
});

test('the sound config is read out of whatever the encoder called its description', () => {
  /* a phone's film: Chrome on Android hands over the whole ES_Descriptor, and the
     writer once wrapped that as the config — a track no player could open */
  const fromPhone = [0x03, 0x80, 0x80, 0x80, 0x22, 0x00, 0x00, 0x00, 0x04, 0x80, 0x80, 0x80, 0x14, 0x40, 0x14, 0x00, 0x18, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x80, 0x80, 0x80, 0x02, 0x11, 0x88, 0x06, 0x80, 0x80, 0x80, 0x01, 0x02];
  assert.deepEqual(Array.from(Mp4.asc(fromPhone, 48000, 1)), [0x11, 0x88], 'the two bytes of config inside it');
  assert.deepEqual(Array.from(Mp4.asc(new Uint8Array([0x11, 0x88]), 48000, 1)), [0x11, 0x88], 'a bare config is kept');
  assert.deepEqual(Array.from(Mp4.asc(null, 44100, 1)), Array.from(Mp4.aacConfig(44100, 1)), 'none at all: made from the rate');
  assert.deepEqual(Array.from(Mp4.asc(new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]), 44100, 1)), Array.from(Mp4.aacConfig(44100, 1)), 'nonsense: likewise');
  /* and a file written with the phone's description now carries the real config */
  const samples = []; for (let i = 0; i < 30; i++) samples.push({ data: new Uint8Array(200), ts: i * 33333, key: i === 0 });
  const packets = []; for (let i = 0; i < 47; i++) packets.push({ data: new Uint8Array(120), ts: Math.round(i * 1024 * 1e6 / 48000), key: true });
  const f = Mp4.inspect(Mp4.write({ width: 640, height: 480, codec: 'avc', description: avcC, samples, audio: { sampleRate: 48000, channels: 1, description: Uint8Array.from(fromPhone), samples: packets, bitrate: 96000 } }));
  assert.deepEqual(f.sound.config, [0x11, 0x88]);
});
