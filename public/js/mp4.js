/* ---------------------------------------------------------------------------
   An MP4 file written from a list of encoded frames and the clock times they
   were taken at. Video only, one track, everything in memory.

   Why the page writes its own file: a recording of a real set on a phone came
   back from the browser's recorder with a hundred and fifty distinct frames
   stamped as if they were two milliseconds apart, and a sound track that stopped
   after a second. The frames were right; the recorder's clock was not. So the
   page encodes the frames itself (WebCodecs), keeps the time each was taken at,
   and writes them here with those times as their durations. Nothing in the file
   is timed by anything but the clock the frames were taken by.

   The layout is the plain one — ftyp, moov, mdat — with the index (moov) before
   the data, so a player can read the length and seek before the download has
   finished. One chunk holds every sample. Durations come from consecutive
   timestamps; the last frame is held as long as the one before it.
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Mp4 = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TIMESCALE = 90000;                 // ticks per second for the video track: 1/90000 s
  const EPOCH_1904 = 2082844800;           // seconds from 1904-01-01 to 1970-01-01, which MP4 dates count from

  /* ---- byte building ---- */
  const enc = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
  const u8 = (...v) => new Uint8Array(v);
  const u16 = (v) => u8((v >>> 8) & 255, v & 255);
  const u32 = (v) => u8((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const fixed16 = (v) => u32(Math.round(v * 65536) >>> 0);
  function cat(parts) {
    let n = 0; for (const p of parts) n += p.length;
    const out = new Uint8Array(n); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  function box(type, ...parts) {
    const body = cat(parts);
    return cat([u32(8 + body.length), enc(type), body]);
  }
  const full = (type, version, flags, ...parts) => box(type, u8(version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255), ...parts);

  /* ---- timing ---- */
  /* Sample durations in ticks, from timestamps in microseconds. Each frame lasts
     until the next one was taken; the last lasts as long as the one before it, or
     a thirtieth of a second when it is alone. A frame stamped no later than the
     one before it (a clock that stood still) is given one tick rather than none,
     so the file stays in order. */
  function durations(tsUs) {
    const ticks = tsUs.map((t) => Math.round((t - tsUs[0]) * TIMESCALE / 1e6));
    const d = [];
    for (let i = 0; i + 1 < ticks.length; i++) d.push(Math.max(1, ticks[i + 1] - ticks[i]));
    d.push(d.length ? d[d.length - 1] : Math.round(TIMESCALE / 30));
    return d;
  }
  /* run-length, as stts wants it */
  function runs(d) {
    const out = [];
    for (const v of d) {
      if (out.length && out[out.length - 1][1] === v) out[out.length - 1][0]++;
      else out.push([1, v]);
    }
    return out;
  }

  /* ---- sample entries ---- */
  function visual(kind, width, height, extra) {
    return box(kind,
      u8(0, 0, 0, 0, 0, 0), u16(1),              // reserved, data reference index
      u16(0), u16(0), u32(0), u32(0), u32(0),   // pre-defined / reserved
      u16(width), u16(height),
      fixed16(72), fixed16(72),                 // resolution
      u32(0), u16(1),                           // reserved, frame count
      new Uint8Array(32),                       // compressor name, blank
      u16(24), u16(0xffff),                     // depth, pre-defined
      extra);
  }
  function avc1(width, height, description) {
    if (!description || !description.length) throw new Error('an avc track needs its decoder description (avcC)');
    return visual('avc1', width, height, box('avcC', description));
  }
  /* VP9 in MP4: the codec string names the profile, level and bit depth,
     'vp09.PP.LL.DD', and the rest of vpcC is the usual BT.709 4:2:0 description. */
  function vp09(width, height, codec) {
    const m = /^vp09\.(\d+)\.(\d+)\.(\d+)/.exec(codec || '') || [0, '0', '10', '8'];
    const profile = Number(m[1]), level = Number(m[2]), depth = Number(m[3]);
    const vpcC = full('vpcC', 1, 0,
      u8(profile, level, (depth << 4) | (1 << 1) | 0),   // bit depth, chroma 4:2:0 (1), studio range
      u8(1, 1, 1),                                        // BT.709 primaries, transfer, matrix
      u16(0));                                            // no codec initialisation data
    return visual('vp09', width, height, vpcC);
  }

  /* ---- the file ----
     samples: [{ data: Uint8Array, ts: microseconds, key: boolean }] in the order
     they were taken. codec: 'avc' with `description` (the avcC payload WebCodecs
     hands over with the first chunk), or 'vp9' with the codec string. */
  function write({ width, height, codec, description, codecString, samples, created }) {
    if (!samples || !samples.length) throw new Error('no frames to write');
    const dur = durations(samples.map((s) => s.ts));
    const total = dur.reduce((a, b) => a + b, 0);
    const now = Math.floor(((created ? created.getTime() : Date.now()) / 1000) + EPOCH_1904) >>> 0;
    const movieScale = 1000;
    const movieDur = Math.round(total * movieScale / TIMESCALE);
    const entry = codec === 'vp9' ? vp09(width, height, codecString) : avc1(width, height, description);
    const keys = []; samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
    const allKey = keys.length === samples.length;

    const stsd = full('stsd', 0, 0, u32(1), entry);
    const stts = full('stts', 0, 0, u32(runs(dur).length), ...runs(dur).map(([n, d]) => cat([u32(n), u32(d)])));
    const stss = allKey ? null : full('stss', 0, 0, u32(keys.length), ...keys.map(u32));
    const stsc = full('stsc', 0, 0, u32(1), u32(1), u32(samples.length), u32(1));
    const stsz = full('stsz', 0, 0, u32(0), u32(samples.length), ...samples.map((s) => u32(s.data.length)));
    const dataSize = samples.reduce((a, s) => a + s.data.length, 0);

    /* the chunk offset points into mdat, which sits after moov; moov's size does
       not depend on the offset's value (it is always four bytes), so it is
       measured once with a placeholder and then written for real */
    const build = (offset) => {
      const stco = full('stco', 0, 0, u32(1), u32(offset));
      const stbl = box('stbl', stsd, stts, ...(stss ? [stss] : []), stsc, stsz, stco);
      const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
      const minf = box('minf', full('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)), dinf, stbl);
      const hdlr = full('hdlr', 0, 0, u32(0), enc('vide'), u32(0), u32(0), u32(0), enc('VideoHandler\0'));
      const mdhd = full('mdhd', 0, 0, u32(now), u32(now), u32(TIMESCALE), u32(total), u16(0x55c4), u16(0)); // 'und'
      const mdia = box('mdia', mdhd, hdlr, minf);
      const tkhd = full('tkhd', 0, 3, u32(now), u32(now), u32(1), u32(0), u32(movieDur),
        u32(0), u32(0), u16(0), u16(0), u16(0), u16(0),
        u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000),
        fixed16(width), fixed16(height));
      const trak = box('trak', tkhd, mdia);
      const mvhd = full('mvhd', 0, 0, u32(now), u32(now), u32(movieScale), u32(movieDur),
        u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0),
        u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000),
        u32(0), u32(0), u32(0), u32(0), u32(0), u32(0),
        u32(2));
      return box('moov', mvhd, trak);
    };
    const ftyp = box('ftyp', enc('isom'), u32(0x200), enc('isom'), enc('iso2'), enc(codec === 'vp9' ? 'mp41' : 'avc1'), enc('mp41'));
    const moovSize = build(0).length;
    const offset = ftyp.length + moovSize + 8;
    const moov = build(offset);
    const mdat = box('mdat', ...samples.map((s) => s.data));
    return cat([ftyp, moov, mdat]);
  }

  /* ---- reading back, enough to check a file ----
     Walks the box tree and returns the timing and sizes a player would use. Used
     by the tests, and handy for looking at what a browser wrote. */
  function boxes(buf, off = 0, end = buf.length) {
    const out = [];
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    while (off + 8 <= end) {
      let size = dv.getUint32(off), hdr = 8;
      const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
      if (size === 1) { size = Number(dv.getBigUint64(off + 8)); hdr = 16; }
      if (size === 0) size = end - off;
      out.push({ type, start: off + hdr, end: off + size, at: off });
      off += size;
    }
    return out;
  }
  function find(buf, path, off = 0, end = buf.length) {
    let list = [{ start: off, end }];
    for (const type of path) {
      const next = [];
      for (const b of list) for (const c of boxes(buf, b.start, b.end)) if (c.type === type) next.push(c);
      list = next;
    }
    return list;
  }
  function inspect(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const top = boxes(buf).map((b) => b.type);
    const mvhd = find(buf, ['moov', 'mvhd'])[0];
    const mdhd = find(buf, ['moov', 'trak', 'mdia', 'mdhd'])[0];
    const stts = find(buf, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stts'])[0];
    const stsz = find(buf, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsz'])[0];
    const stco = find(buf, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stco'])[0];
    const stss = find(buf, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stss'])[0];
    const stsd = find(buf, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd'])[0];
    const tkhd = find(buf, ['moov', 'trak', 'tkhd'])[0];
    if (!mvhd || !mdhd || !stts || !stsz) return { top, tracks: 0 };
    const scale = dv.getUint32(mdhd.start + 12);
    const durs = [];
    const n = dv.getUint32(stts.start + 4);
    for (let i = 0; i < n; i++) {
      const count = dv.getUint32(stts.start + 8 + i * 8), d = dv.getUint32(stts.start + 12 + i * 8);
      for (let k = 0; k < count; k++) durs.push(d / scale);
    }
    const sizes = [];
    const one = dv.getUint32(stsz.start + 4), m = dv.getUint32(stsz.start + 8);
    for (let i = 0; i < m; i++) sizes.push(one || dv.getUint32(stsz.start + 12 + i * 4));
    const keys = [];
    if (stss) { const k = dv.getUint32(stss.start + 4); for (let i = 0; i < k; i++) keys.push(dv.getUint32(stss.start + 8 + i * 4)); }
    const entry = stsd ? boxes(buf, stsd.start + 8, stsd.end)[0] : null;
    return {
      top, tracks: 1,
      duration: dv.getUint32(mvhd.start + 16) / dv.getUint32(mvhd.start + 12),
      trackDuration: dv.getUint32(mdhd.start + 16) / scale,
      timescale: scale,
      width: tkhd ? dv.getUint32(tkhd.start + 76) / 65536 : 0,
      height: tkhd ? dv.getUint32(tkhd.start + 80) / 65536 : 0,
      codec: entry ? entry.type : '',
      samples: durs.length, durations: durs, sizes,
      keyframes: stss ? keys : sizes.map((_, i) => i + 1),
      chunkOffset: stco ? dv.getUint32(stco.start + 8) : 0,
      moovBeforeMdat: top.indexOf('moov') < top.indexOf('mdat'),
    };
  }

  return { TIMESCALE, write, durations, boxes, find, inspect };
});
