import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyRelease } from './verify.mjs';

const report = await verifyRelease();
const prefix = `/beta/releases/${report.release.buildId}/`;
const root = resolve('dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/') { response.writeHead(307, { Location: prefix, 'Cache-Control': 'no-store' }).end(); return; }
    if (!url.pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const path = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
    if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.split('/').some(part => part === '..')) { response.writeHead(400).end(); return; }
    const file = resolve(root, path);
    if (!(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
    const extension = file.slice(file.lastIndexOf('.'));
    response.writeHead(200, { 'Content-Type': types[extension] ?? 'application/octet-stream', 'Cache-Control': extension === '.html' || extension === '.json' ? 'no-store' : 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
server.listen(4186, '127.0.0.1', () => console.log(`Verified static release at http://127.0.0.1:4186${prefix}`));
const stop = () => server.close(() => process.exit());
process.once('SIGINT', stop); process.once('SIGTERM', stop);
