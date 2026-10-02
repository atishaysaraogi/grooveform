/* ---------------------------------------------------------------------------
   An exercise file in a link. The studio builds a draft on one device and the
   person wants to try it on the phone: the file goes into the address itself,
   gzipped and base64url-encoded after index.html#/ex/~ — the same road the
   plans take (plans.js), with compression because a file is ten kilobytes
   where a plan is a few hundred bytes. The phone's app decodes it, checks it,
   lays it over the library as the draft and opens it. Nothing is sent anywhere;
   the link is the file.

     Share.encode(file)  → Promise<code>   'z' + base64url(gzip(JSON))
     Share.decode(code)  → Promise<file>   throws when the code is not a file
   Where the browser has no CompressionStream the code is 'j' + base64url(JSON).
   --------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Share = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const b64 = {
    enc: (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
    dec: (s) => { const t = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4); const bin = typeof atob === 'function' ? atob(t) : Buffer.from(t, 'base64').toString('binary'); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; },
  };
  const utf8 = { enc: (s) => new TextEncoder().encode(s), dec: (b) => new TextDecoder().decode(b) };
  async function pipe(bytes, stream) {
    const r = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(r).arrayBuffer());
  }
  const can = () => typeof CompressionStream === 'function' && typeof Blob === 'function' && typeof Response === 'function';
  async function encode(file) {
    const json = utf8.enc(JSON.stringify(file));
    if (!can()) return 'j' + b64.enc(json);
    return 'z' + b64.enc(await pipe(json, new CompressionStream('gzip')));
  }
  async function decode(code) {
    code = String(code || '');
    const kind = code[0], body = b64.dec(code.slice(1));
    let json;
    if (kind === 'z') { if (!can()) throw new Error('this browser cannot open a compressed link'); json = utf8.dec(await pipe(body, new DecompressionStream('gzip'))); }
    else if (kind === 'j') json = utf8.dec(body);
    else throw new Error('not an exercise link');
    const file = JSON.parse(json);
    if (!file || typeof file !== 'object' || !file.id || !file.measurements) throw new Error('not an exercise file');
    return file;
  }
  return { encode, decode };
});
