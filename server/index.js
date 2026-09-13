'use strict';
// Entry point: HTTP server, static files, API dispatch, security headers, housekeeping timer.
process.removeAllListeners('warning'); process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w); }); // node:sqlite is marked experimental in Node 22
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const api = require('./api');
const { HttpError, send } = require('./http');

const CLIENT_DIR = path.join(__dirname, '..', 'client');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
// Camera video never leaves the device; the pose model and fonts load from Google/jsDelivr CDNs, everything else is same-origin.
// 'wasm-unsafe-eval' lets the MediaPipe pose model (WebAssembly, loaded from jsDelivr) compile; without it Chrome/Safari refuse with "WebAssembly.instantiate() violates CSP".
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://checkout.razorpay.com; connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com https://api.razorpay.com https://lumberjack.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; img-src 'self' data: blob: https://*.razorpay.com; media-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function securityHeaders(res) {
  res.setHeader('content-security-policy', CSP);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('x-frame-options', 'DENY');
  if (config.publicUrl.startsWith('https://')) res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(CLIENT_DIR, rel));
  if (!file.startsWith(CLIENT_DIR)) return send(res, 400, 'Bad path');
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {   // a folder with its own index.html (the Studio) — served the way GitHub Pages would
      if (!pathname.endsWith('/')) { res.writeHead(301, { Location: pathname + '/' }); return res.end(); }
      return streamFile(path.join(file, 'index.html'), res, 'no-cache');
    }
    if (err || !st.isFile()) { // SPA fallback for client-side routes
      if (!path.extname(rel)) return streamFile(path.join(CLIENT_DIR, 'index.html'), res, 'no-cache');
      return send(res, 404, 'Not found');
    }
    streamFile(file, res, rel === '/index.html' ? 'no-cache' : 'public, max-age=3600');
  });
}
function streamFile(file, res, cache) {
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': cache });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/healthz') return send(res, 200, { ok: true, time: Date.now() });
    if (url.pathname.startsWith('/api/')) return await api.handle(req, res, url.pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    serveStatic(req, res, url.pathname);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.extra || {}) });
    console.error('[error]', req.method, url.pathname, e);
    send(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
});

function start() {
  db.open(); api.bootstrap(); auth.housekeeping();
  setInterval(() => { try { auth.housekeeping(); } catch (e) { console.error('[housekeeping]', e); } }, 15 * 60_000).unref();
  return new Promise(resolve => server.listen(config.port, config.host, () => { console.log(`[fyzio] ${config.nodeEnv} server on http://${config.host}:${config.port} (public: ${config.publicUrl}) db=${config.dbPath} otp=${config.notifyProvider}`); resolve(server); }));
}
if (require.main === module) start();
module.exports = { start, server };
