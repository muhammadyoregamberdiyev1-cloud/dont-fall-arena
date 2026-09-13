/**
 * Zero-dependency static server for local play.
 *   node tools/serve.mjs [port]
 */

import http from 'node:http';
import net from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const filePath = resolve(join(root, normalize(pathname)));
    if (!filePath.startsWith(root + sep) && filePath !== root) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(filePath).catch(() => null);
    if (!info) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 — topilmadi');
      return;
    }
    const target = info.isDirectory() ? join(filePath, 'index.html') : filePath;
    const data = await readFile(target);
    const ext = extname(target).toLowerCase();
    const etag = '"' + createHash('sha1').update(data).digest('hex').slice(0, 16) + '"';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': 'no-store, must-revalidate' });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-store, must-revalidate',
      etag,
      'content-length': data.length,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('500: ' + err.message);
  }
});

/**
 * /ws uchun tunnel: brauzer same-origin WebSocket ochadi, biz uni
 * python relay-serveriga (127.0.0.1:RELAY_PORT) uzatamiz. Shunda preview
 * proxy faqat bitta portni bilsa ham onlayn rejim ishlaydi.
 */
const RELAY_PORT = Number(process.env.ARENA_RELAY_PORT || 8081);
const RELAY_HOST = process.env.ARENA_RELAY_HOST || '127.0.0.1';

server.on('upgrade', (req, socket) => {
  const head = `${req.method} ${req.url} HTTP/1.1\r\n` +
    Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n') + '\r\n\r\n';
  const upstream = net.connect(RELAY_PORT, RELAY_HOST, () => {
    upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  const bye = () => {
    socket.destroy();
    upstream.destroy();
  };
  socket.on('error', bye);
  upstream.on('error', bye);
  socket.on('close', bye);
  upstream.on('close', bye);
});

server.listen(port, host, () => {
  console.log(`Don't Fall Arena → http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(`  /ws → ${RELAY_HOST}:${RELAY_PORT} (python relay: python3 server/main.py)`);
});
