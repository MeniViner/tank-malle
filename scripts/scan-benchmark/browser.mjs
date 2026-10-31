// Runtime budget of the shipped recogniser in real browser engines: cold start
// (bytes and time until the first decided frame), warm per-scene latency and
// renderer memory. It loads the BUILT worker (dist/assets/display.worker-*.js)
// from a `vite preview` server, exactly as the PWA does.
//
//   npx vite build && node scripts/scan-benchmark/browser.mjs [chromium|webkit] [scenes] [out.json]
//
// Desktop engines on this machine are not phones: these numbers bound the
// code's cost; they are not Samsung Galaxy S25 or iPhone measurements.
import { execFileSync, spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, webkit } from '@playwright/test';

const [engine = 'chromium', count = '40', out] = process.argv.slice(2);
const root = resolve('.'), port = 5291, origin = `http://127.0.0.1:${port}`;
const worker = (await readdir('dist/assets')).find(f => /^display\.worker-.*\.js$/.test(f));
if (!worker) throw new Error('Build first: npx vite build');
const manifest = JSON.parse(await readFile('benchmarks/scan/trodo-sessions.json', 'utf8'));
// A fixed, deterministic sample of test-split photographs (every k-th one).
const test = manifest.sessions.filter(s => s.split === 'test' && s.role === 'eligible');
const scenes = test.filter((_, i) => i % Math.ceil(test.length / Number(count)) === 0).slice(0, Number(count));

const server = spawn('npx', ['--no-install', 'vite', 'preview', '--outDir', 'dist', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(origin); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
const browser = await (engine === 'webkit' ? webkit.launch({ executablePath: process.env.CARE_WEBKIT_PATH }) : chromium.launch());
const page = await (await browser.newContext()).newPage();
await page.route(`${origin}/bench-image/**`, async route => route.fulfill({ body: await readFile(join(root, '.scan-corpus', decodeURIComponent(new URL(route.request().url()).pathname.slice('/bench-image/'.length)))), contentType: 'image/jpeg' }));
const downloads = {};
page.on('response', async response => { if (/scan-models|ort-wasm/.test(response.url())) downloads[new URL(response.url()).pathname.split('/').pop()] = (await response.body().catch(() => Buffer.alloc(0))).length; });
await page.goto(`${origin}/favicon.svg`);
const rss = () => {
  // Resident memory of the browser's renderer/web-content processes, in MB.
  const ps = execFileSync('ps', ['-axo', 'rss=,command='], { encoding: 'utf8' }).split('\n');
  return Math.round(ps.filter(l => engine === 'webkit' ? /WebKitWebProcess|com\.apple\.WebKit\.WebContent|WebContent/i.test(l) && /ms-playwright/.test(l) : /--type=renderer/.test(l) && /ms-playwright/.test(l)).reduce((s, l) => s + Number(l.trim().split(/\s+/)[0]), 0) / 1024);
};
const before = rss();
const results = await page.evaluate(async ({ worker, files }) => {
  const w = new Worker(`/assets/${worker}`, { type: 'module' });
  let id = 0; const pending = new Map(); let state = 'loading';
  w.onmessage = e => { if (e.data.type === 'state') { state = e.data.recognizer; return; } pending.get(e.data.id)?.(e.data); pending.delete(e.data.id); };
  const pixels = async file => {
    const bitmap = await createImageBitmap(await (await fetch(`/bench-image/${encodeURIComponent(file)}`)).blob());
    const ratio = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height)), canvas = new OffscreenCanvas(Math.round(bitmap.width * ratio), Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); return ctx.getImageData(0, 0, canvas.width, canvas.height);
  };
  const post = image => new Promise(resolve => { const request = ++id; pending.set(request, resolve); w.postMessage({ type: 'frame', id: request, frame: 0, kind: 'odometer', width: image.width, height: image.height, data: image.data.buffer, wait: true }, [image.data.buffer]); });
  const rows = [];
  for (const [index, file] of files.entries()) {
    const image = await pixels(file), started = performance.now(), reply = await post(image);
    rows.push({ file, cold: index === 0, ms: performance.now() - started, recognizer: reply.recognizer ?? state, attempts: reply.analysis?.attempts?.length ?? 0, stages: reply.analysis?.ms ?? {} });
  }
  w.terminate();
  return rows;
}, { worker, files: scenes.map(s => s.frames[0].file) });
const after = rss();
const warm = results.filter(r => !r.cold).map(r => r.ms).sort((a, b) => a - b), q = p => warm[Math.min(warm.length - 1, Math.floor((warm.length - 1) * p))];
const report = {
  format: 'tank-maleh-scan-browser-v1', at: new Date().toISOString(), engine, browserVersion: browser.version(), machine: execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim(),
  scenes: results.length, recognizer: [...new Set(results.map(r => r.recognizer))],
  coldStart: { firstSceneMs: Math.round(results[0].ms), downloadedBytes: Object.values(downloads).reduce((a, b) => a + b, 0), downloads, note: 'Local preview server, no network throttling; includes download, sha256 verification, Cache Storage write and session creation.' },
  warmMs: { p50: Math.round(q(.5)), p95: Math.round(q(.95)), max: Math.round(warm.at(-1)) },
  rendererRssMb: { before, after, note: 'Sum of renderer/web-content processes; includes the page and the worker.' },
  rows: results,
};
if (out) await writeFile(resolve(out), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ engine, browser: report.browserVersion, machine: report.machine, scenes: report.scenes, recognizer: report.recognizer, coldStart: report.coldStart, warmMs: report.warmMs, rendererRssMb: report.rendererRssMb }, null, 1));
await browser.close(); server.kill();
process.exit(0);
