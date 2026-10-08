// Minimal static file server for local development. No dependencies.
// Usage: npm start            (serves ./site on http://127.0.0.1:8080)
//        PORT=3000 npm start
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../site', import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function log(status, method, url) {
  console.log(`${new Date().toISOString()} ${status} ${method} ${url}`);
}

const server = createServer(async (req, res) => {
  const method = req.method || 'GET';
  try {
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY_HEADERS }).end();
      log(405, method, req.url);
      return;
    }
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let file = normalize(join(ROOT, pathname));
    // Refuse anything that resolves outside the site directory.
    if (file !== ROOT && !file.startsWith(ROOT + sep)) {
      res.writeHead(403, SECURITY_HEADERS).end('Forbidden');
      log(403, method, req.url);
      return;
    }
    const info = await stat(file).catch(() => null);
    if (info && info.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file).catch(() => null);
    if (!body) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS }).end('Not found');
      log(404, method, req.url);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
    });
    res.end(method === 'HEAD' ? undefined : body);
    log(200, method, req.url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, SECURITY_HEADERS);
    res.end('Internal server error');
    log(500, method, req.url);
  }
});

server.on('error', (err) => {
  console.error(`Server failed to start: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Serving ${ROOT} at http://${HOST}:${PORT}`);
});
