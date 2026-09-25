/* ---------------------------------------------------------------------------
   Which encoders this browser has, asked once: the video codecs the page's own
   MP4 writer can carry, in order of preference, and AAC for the sound. Shared
   by the coach's film and the Review page's rendering.
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Codec = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  /* H.264 first, because every phone plays it; a level for each size. VP9 in the
     same MP4 where there is no H.264 encoder (the open-source browser builds). */
  const CODECS = [
    ['avc1.42E01F', 'avc'], ['avc1.42E028', 'avc'], ['avc1.42E02A', 'avc'],
    ['avc1.4D401F', 'avc'], ['avc1.4D4028', 'avc'], ['avc1.64001F', 'avc'], ['avc1.640028', 'avc'], ['avc1.64002A', 'avc'],
    ['vp09.00.31.08', 'vp9'], ['vp09.00.40.08', 'vp9'], ['vp09.00.51.08', 'vp9'],
  ];
  async function pickCodec(w, h, fps, realtime) {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
    for (const [codec, kind] of CODECS) {
      const config = { codec, width: w, height: h, bitrate: 3.5e6, framerate: fps || 30, latencyMode: realtime === false ? 'quality' : 'realtime' };
      if (kind === 'avc') config.avc = { format: 'avc' };
      try { const r = await VideoEncoder.isConfigSupported(config); if (r && r.supported) return { config, kind, codec }; }
      catch { }
    }
    return null;
  }
  async function pickSound(sampleRate) {
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
    const config = { codec: 'mp4a.40.2', sampleRate, numberOfChannels: 1, bitrate: 96000 };
    try { const r = await AudioEncoder.isConfigSupported(config); return r && r.supported ? config : null; }
    catch { return null; }
  }
  const bytesOf = (d) => d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));

  /* a whole buffer of samples encoded as AAC, as the MP4 writer's audio track,
     or null where this browser cannot */
  async function encodeAudio(pcm, sampleRate) {
    const config = await pickSound(sampleRate);
    if (!config) return null;
    const packets = []; let desc = null, why = null;
    const enc = new AudioEncoder({
      output: (chunk, meta) => {
        const dc = meta && meta.decoderConfig;
        if (dc && dc.description && !desc) desc = bytesOf(dc.description);
        const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
        packets.push({ data, ts: chunk.timestamp, key: true });
      },
      error: (e) => { why = why || e; },
    });
    enc.configure(config);
    const BLOCK = 4096;
    for (let i = 0; i < pcm.length; i += BLOCK) {
      const n = Math.min(BLOCK, pcm.length - i);
      const ad = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: 1, timestamp: Math.round(i * 1e6 / sampleRate), data: pcm.subarray(i, i + n) });
      enc.encode(ad); ad.close();
    }
    await enc.flush(); enc.close();
    if (why) throw why;
    return packets.length ? { sampleRate, channels: 1, description: desc, samples: packets, bitrate: 96000 } : null;
  }

  return { CODECS, pickCodec, pickSound, bytesOf, encodeAudio };
});
