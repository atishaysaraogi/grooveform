'use strict';
// Tiny router + helpers on top of node:http. No framework.
const config = require('./config');

class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }

function parseCookies(req) { const out = {}; (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return out; }
function clientIp(req) { if (config.trustProxy) { const xf = req.headers['x-forwarded-for']; if (xf) return String(xf).split(',')[0].trim(); } return req.socket.remoteAddress || ''; }
function readJson(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON')); } });
    req.on('error', reject);
  });
}
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  const data = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, { 'content-type': isJson ? 'application/json; charset=utf-8' : (headers['content-type'] || 'text/plain; charset=utf-8'), 'cache-control': 'no-store', ...headers });
  res.end(data);
}
function setCookie(res, name, value, { maxAgeMs, httpOnly = true, path = '/' } = {}) {
  const secure = config.publicUrl.startsWith('https://');
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'SameSite=Lax']; if (httpOnly) parts.push('HttpOnly'); if (secure) parts.push('Secure');
  if (maxAgeMs !== undefined) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  const prev = res.getHeader('set-cookie'); res.setHeader('set-cookie', [...(prev ? [].concat(prev) : []), parts.join('; ')]);
}

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) {
    const keys = []; const re = new RegExp('^' + pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^\\/]+)'; }) + '\\/?$');
    this.routes.push({ method, re, keys, handlers });
  }
  get(p, ...h) { this.add('GET', p, ...h); } post(p, ...h) { this.add('POST', p, ...h); } put(p, ...h) { this.add('PUT', p, ...h); } patch(p, ...h) { this.add('PATCH', p, ...h); } delete(p, ...h) { this.add('DELETE', p, ...h); }
  match(method, pathname) {
    for (const r of this.routes) { if (r.method !== method) continue; const m = pathname.match(r.re); if (m) { const params = {}; r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1])); return { handlers: r.handlers, params }; } }
    return null;
  }
}

// Validation helpers
const v = {
  str: (x, { min = 0, max = 500, name = 'field' } = {}) => { if (typeof x !== 'string' || x.length < min || x.length > max) throw new HttpError(400, `${name} must be a string of ${min}–${max} characters`); return x; },
  optStr: (x, o = {}) => (x === undefined || x === null || x === '') ? null : v.str(x, o),
  int: (x, { min = -1e9, max = 1e9, name = 'field' } = {}) => { const n = Number(x); if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be an integer between ${min} and ${max}`); return n; },
  oneOf: (x, list, name = 'field') => { if (!list.includes(x)) throw new HttpError(400, `${name} must be one of ${list.join(', ')}`); return x; },
  arr: (x, name = 'field') => { if (!Array.isArray(x)) throw new HttpError(400, `${name} must be an array`); return x; },
};

module.exports = { HttpError, Router, parseCookies, clientIp, readJson, send, setCookie, v };
