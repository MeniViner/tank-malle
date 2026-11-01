// Runs the exported recogniser with onnxruntime-web's WASM backend inside
// Chromium (one thread, as the app) and compares every logit with PyTorch.
//   node scripts/scan-train/parity.mjs .scan-corpus/train/digits
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
const dir = resolve(process.argv[2] ?? '.scan-corpus/train/digits'), origin = 'http://parity.invalid';
const samples = JSON.parse(await readFile(join(dir, 'parity-samples.json'), 'utf8'));
const browser = await chromium.launch(), page = await browser.newPage();
const files = { '/ort.wasm.min.mjs': 'node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', '/ort-wasm-simd-threaded.wasm': 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', '/ort-wasm-simd-threaded.mjs': 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', '/digits.onnx': join(dir, 'digits.onnx') };
await page.route(`${origin}/**`, async route => {
  const path = new URL(route.request().url()).pathname, file = files[path];
  if (path === '/') return route.fulfill({ body: '<!doctype html><title>parity</title>', contentType: 'text/html' });
  if (!file) return route.fulfill({ status: 404 });
  return route.fulfill({ body: await readFile(file), contentType: path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream' });
});
await page.goto(origin + '/');
const outputs = await page.evaluate(async samples => {
  const ort = await import('/ort.wasm.min.mjs');
  ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false; ort.env.wasm.wasmPaths = '/';
  const session = await ort.InferenceSession.create(await (await fetch('/digits.onnx')).arrayBuffer(), { executionProviders: ['wasm'] });
  const out = [];
  for (const s of samples) { const r = await session.run({ x: new ort.Tensor('float32', Float32Array.from(s.x), s.shape) }); out.push([...r.logits.data]); }
  return out;
}, samples);
let worst = 0, sameArgmax = 0;
samples.forEach((s, i) => {
  const [, classes, steps] = s.logitsShape, a = s.logits, b = outputs[i];
  for (let k = 0; k < a.length; k++) worst = Math.max(worst, Math.abs(a[k] - b[k]));
  const arg = (v, t) => { let best = 0; for (let c = 1; c < classes; c++) if (v[c * steps + t] > v[best * steps + t]) best = c; return best; };
  sameArgmax += [...Array(steps).keys()].every(t => arg(a, t) === arg(b, t));
});
console.log(JSON.stringify({ engine: `chromium ${browser.version()}`, backend: 'onnxruntime-web 1.30.0 wasm, 1 thread', samples: samples.length, maxAbsLogitDiff: worst, sameGreedyPath: sameArgmax }));
await browser.close();
