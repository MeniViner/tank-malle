import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { build } from 'vite';

// Two real optimized emulator-only builds, with a test-only older version
// label. No deployed source, browser profile or customer data is modified.
const before = resolve('.care-device/unified/upgrade-before');
const after = resolve('.care-device/unified/upgrade-after');
const previousVersion = 'acceptance-before';
await build({ mode: 'care-test', build: { outDir: before }, plugins: [{
  name: 'acceptance-previous-version', enforce: 'pre',
  load(id) {
    if (id === resolve('src/lib/version.ts')) return readFileSync(id, 'utf8').replace(/APP_VERSION = "[^"]+"/, `APP_VERSION = "${previousVersion}"`);
  },
  generateBundle(_options, bundle) {
    const info = bundle['build-info.json'];
    if (info?.type === 'asset') info.source = JSON.stringify({ ...JSON.parse(String(info.source)), version: previousVersion });
  },
}] });
await build({ mode: 'care-test', build: { outDir: after } });
let published = false;
const mime = { '.js':'application/javascript', '.mjs':'application/javascript', '.css':'text/css', '.html':'text/html', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2', '.ttf':'font/ttf' };
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1:5289').pathname);
  if (path === '/__acceptance/publish' || path === '/__acceptance/reset') {
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return; }
    published = path.endsWith('/publish'); response.writeHead(204); response.end(); return;
  }
  const root = published ? after : before;
  let file = resolve(root, '.' + path);
  if (!file.startsWith(root + sep) && file !== root) { response.writeHead(400); response.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (path.startsWith('/assets/')) { response.writeHead(404); response.end(); return; }
    file = resolve(root, 'index.html');
  }
  response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': path.startsWith('/assets/') ? 'public,max-age=31536000,immutable' : 'no-store' });
  response.end(readFileSync(file));
});
server.listen(5289, '127.0.0.1');
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit()));
