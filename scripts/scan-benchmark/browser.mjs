// Runtime budget of the shipped recogniser in real browser engines: cold start
// (bytes and time until the first decided photo), reopening with the models in
// Cache Storage, warm per-photo latency split by outcome, and renderer memory.
// It loads the BUILT worker (dist/assets/display.worker-*.js) from a
// `vite preview` server, exactly as the PWA does, and decides each photo with
// the app's own still-photo session rule.
//
//   npx vite build && node scripts/scan-benchmark/browser.mjs [chromium|webkit] [scenes] [out.json]
//   CARE_THROTTLE=10,150 (Mbit/s down, ms round trip; Chromium only) emulates a network for the cold start.
//
// Desktop engines on this machine are not phones: these numbers bound the
// code's cost; they are not Samsung Galaxy S25 or iPhone measurements.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { runnerImport } from 'vite';
import sharp from 'sharp';

const [engine = 'chromium', count = '40', out] = process.argv.slice(2);
const root = resolve('.'), port = 5291, origin = `http://127.0.0.1:${port}`;
const worker = (await readdir('dist/assets')).find(f => /^display\.worker-.*\.js$/.test(f));
if (!worker) throw new Error('Build first: npx vite build');
const { CaptureSession } = (await runnerImport(join(root, 'src/lib/scan/session.ts'))).module;
const manifest = JSON.parse(await readFile('benchmarks/scan/trodo-sessions.json', 'utf8'));
// A fixed, deterministic sample of test-split photographs (every k-th one).
const test = manifest.sessions.filter(s => s.split === 'test' && s.role === 'eligible');
const scenes = test.filter((_, i) => i % Math.ceil(test.length / Number(count)) === 0).slice(0, Number(count));

const server = spawn('npx', ['--no-install', 'vite', 'preview', '--outDir', 'dist', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { await fetch(origin); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
// A fresh persistent profile, as an installed PWA has. An ephemeral WebKit
// context drops Cache Storage entries a worker wrote once that worker is
// terminated (unless the page read them first), which a real profile does not.
const launcher = engine === 'webkit' ? webkit : chromium, options = engine === 'webkit' ? { executablePath: process.env.CARE_WEBKIT_PATH } : {};
const probe = await launcher.launch(options), browserVersion = probe.version(); await probe.close();
const profile = await mkdtemp(join(tmpdir(), 'tank-maleh-scan-bench-')), context = await launcher.launchPersistentContext(profile, options);
const page = context.pages()[0] ?? await context.newPage();
// Photos are decoded as the Node runner decodes them (78 TRODO JPEGs are
// truncated, which browsers refuse) and served as lossless PNG; decoding is
// outside the timed interval.
const decoded = file => sharp(join(root, '.scan-corpus', file), { failOn: 'none', limitInputPixels: 60_000_000 }).rotate().resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 1 }).toBuffer();
await page.route(`${origin}/bench-image/**`, async route => route.fulfill({ body: await decoded(decodeURIComponent(new URL(route.request().url()).pathname.slice('/bench-image/'.length))), contentType: 'image/png' }));
const [mbps, rtt] = (process.env.CARE_THROTTLE ?? '').split(',').map(Number);
if (mbps) {
  if (engine !== 'chromium') throw new Error('CARE_THROTTLE needs chromium');
  await (await context.newCDPSession(page)).send('Network.emulateNetworkConditions', { offline: false, latency: rtt || 0, downloadThroughput: mbps * 125_000, uploadThroughput: mbps * 125_000 });
}
let downloads = {}, requests = 0;
page.on('request', request => { if (/scan-models|ort-wasm/.test(request.url())) requests++; });
page.on('response', async response => { if (/scan-models|ort-wasm/.test(response.url())) downloads[new URL(response.url()).pathname.split('/').pop()] = (await response.body().catch(() => Buffer.alloc(0))).length; });
await page.goto(`${origin}/favicon.svg`);
const rss = () => {
  // Resident memory of the browser's renderer/web-content processes, in MB.
  const ps = execFileSync('ps', ['-axo', 'rss=,command='], { encoding: 'utf8' }).split('\n');
  return Math.round(ps.filter(l => engine === 'webkit' ? /WebKitWebProcess|com\.apple\.WebKit\.WebContent|WebContent/i.test(l) && /ms-playwright/.test(l) : /--type=renderer/.test(l) && /ms-playwright/.test(l)).reduce((s, l) => s + Number(l.trim().split(/\s+/)[0]), 0) / 1024);
};
// One worker, as the app creates it (the recogniser starts loading at
// creation); each photo is timed from posting the pixels to the reply.
const scan = (files, phase) => page.evaluate(async ({ worker, files, phase }) => {
  const w = new Worker(`/assets/${worker}`, { type: 'module' }), created = performance.now(), pending = new Map();
  let id = 0, state = 'loading', readyMs = null;
  w.onmessage = e => {
    if (e.data.type === 'state') { state = e.data.recognizer; if (state !== 'loading') readyMs ??= performance.now() - created; return; }
    pending.get(e.data.id)?.(e.data); pending.delete(e.data.id);
  };
  const pixels = async file => {
    const bitmap = await createImageBitmap(await (await fetch(`/bench-image/${encodeURIComponent(file)}`)).blob());
    const ratio = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height)), canvas = new OffscreenCanvas(Math.round(bitmap.width * ratio), Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); return ctx.getImageData(0, 0, canvas.width, canvas.height);
  };
  const post = image => new Promise(resolve => { const request = ++id; pending.set(request, resolve); w.postMessage({ type: 'frame', id: request, frame: 0, kind: 'odometer', width: image.width, height: image.height, data: image.data.buffer, wait: true }, [image.data.buffer]); });
  const rows = [];
  for (const [index, file] of files.entries()) {
    const image = await pixels(file), started = performance.now(), reply = await post(image);
    rows.push({ file, phase: index === 0 ? phase : 'warm', ms: performance.now() - started, recognizer: reply.recognizer ?? state, error: reply.type === 'error', hint: reply.analysis?.quality?.hint ?? null, attempts: reply.analysis?.attempts ?? [], stages: reply.analysis?.ms ?? {} });
  }
  w.terminate();
  return { rows, readyMs };
}, { worker, files, phase });

const before = rss();
const first = await scan(scenes.map(s => s.frames[0].file), 'cold');
const coldDownloads = downloads, coldRequests = requests; downloads = {}; requests = 0;
const after = rss();
const cached = await page.evaluate(async () => { const out = {}; for (const key of await caches.keys()) out[key] = (await (await caches.open(key)).keys()).length; return out; });
// Reopening the app: a new worker; the recogniser comes from Cache Storage.
const reopen = await scan([scenes[0].frames[0].file], 'reopen');
const reopenDownloads = downloads, reopenRequests = requests;

const rows = [...first.rows, ...reopen.rows].map(row => {
  const scene = scenes.find(s => s.frames[0].file === row.file), session = new CaptureSession('odometer', { still: true });
  session.frame(0, row.hint);
  for (const attempt of row.attempts) session.attempt(attempt);
  const d = session.decide(), { attempts, ...kept } = row;
  const outcome = row.error ? 'error' : d.status !== 'accepted' ? 'abstained' : scene.expected && BigInt(d.values.odometer) === BigInt(scene.expected.odometer) ? 'correct' : 'wrong';
  return { ...kept, id: scene.id, label: scene.label ?? null, attempts: attempts.length, outcome, ...(d.status === 'accepted' ? { odometer: d.values.odometer, paths: d.paths } : { reason: d.reason ?? null }) };
});
const stats = list => {
  const v = list.map(r => r.ms).sort((a, b) => a - b), q = p => v.length ? Math.round(v[Math.min(v.length - 1, Math.floor((v.length - 1) * p))]) : null;
  return { n: v.length, p50: q(.5), p95: q(.95), max: v.length ? Math.round(v.at(-1)) : null };
};
const warm = rows.filter(r => r.phase === 'warm'), cold = rows.find(r => r.phase === 'cold'), again = rows.find(r => r.phase === 'reopen');
const bytes = d => Object.values(d).reduce((a, b) => a + b, 0);
const report = {
  format: 'tank-maleh-scan-browser-v2', at: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), engine, browserVersion, profile: 'fresh persistent profile', machine: execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim(),
  network: mbps ? { downloadMbps: mbps, roundTripMs: rtt || 0, method: 'Chromium DevTools Network.emulateNetworkConditions' } : 'local preview server, no throttling',
  scenes: first.rows.length, recognizer: [...new Set(rows.map(r => r.recognizer))],
  coldStart: { firstScanMs: Math.round(cold.ms), recognizerReadyMs: Math.round(first.readyMs), outcome: cold.outcome, requests: coldRequests, downloadedBytes: bytes(coldDownloads), downloads: coldDownloads, note: 'First scan after install: local preview server, no network throttling. Includes download, sha256 verification, Cache Storage write, session creation and reading the photo.' },
  reopen: { firstScanMs: Math.round(again.ms), recognizerReadyMs: Math.round(reopen.readyMs), outcome: again.outcome, cacheEntriesBefore: cached, requests: reopenRequests, downloadedBytes: bytes(reopenDownloads), note: 'A new worker after the first: recogniser read from Cache Storage, verified, sessions created, then the same photo as the cold scan.' },
  warmMs: { all: stats(warm), accepted: stats(warm.filter(r => r.outcome === 'correct' || r.outcome === 'wrong')), abstained: stats(warm.filter(r => r.outcome === 'abstained')) },
  outcomes: { correct: warm.filter(r => r.outcome === 'correct').length, wrong: warm.filter(r => r.outcome === 'wrong').length, abstained: warm.filter(r => r.outcome === 'abstained').length, error: warm.filter(r => r.outcome === 'error').length, reasons: warm.filter(r => r.reason).reduce((m, r) => ({ ...m, [r.reason]: (m[r.reason] ?? 0) + 1 }), {}) },
  rendererRssMb: { before, after, note: 'Sum of renderer/web-content processes; includes the page and the worker.' },
  rows,
};
if (out) await writeFile(resolve(out), JSON.stringify(report, null, 1) + '\n');
const { rows: _, ...brief } = report;
console.log(JSON.stringify(brief, null, 1));
await context.close(); await rm(profile, { recursive: true, force: true }); server.kill();
process.exit(0);
