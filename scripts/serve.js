/* A static server for public/, with nothing in it but node. The camera needs a secure
   context, and localhost counts as one, so this is enough to test the real thing.
   Run: npm run dev   →   http://localhost:8000 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 8000);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  /* the exercise library's index, from the folder as it is right now */
  if (url === '/exercises/index.json') {
    const dir = path.join(ROOT, 'exercises');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.json$/.test(f) && f !== 'index.json').sort() : [];
    res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
    res.end(JSON.stringify({ v: 1, files, live: true }));
    return;
  }
  let file = path.join(ROOT, url === '/' ? 'index.html' : url);
  /* never serve outside public/ */
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('no'); return; }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (e, body) => {
      if (e) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    });
  });
});
/* started here when run directly; the smoke test imports it and picks its own port */
if (require.main === module) server.listen(PORT, () => console.log(`wall sit coach on http://localhost:${server.address().port}`));
module.exports = { server };
