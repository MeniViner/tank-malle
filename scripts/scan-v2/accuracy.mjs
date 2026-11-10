// Scan v1 ("before") vs scan v2 ("after") digit-level accuracy.
//
//   node scripts/scan-v2/accuracy.mjs --corpus <dir> --split tuning \
//     --crop display --context none --out design/v3/evidence/stage-6/runs/x.json
//
// --corpus   folder holding trodo-v2/ and commons-pumps/ (never written to)
// --split    tuning | test | challenge (TRODO splits from PR #19), or pumps
// --crop     what stands in for the viewfinder guide box on a TRODO photo:
//            display = annotated display box + 10% (the person framed the
//            whole dashboard display); digits = union of the annotated
//            mileage digit boxes + 25% (framed only the number); both are
//            annotation-assisted SIMULATIONS of framing, not real captures.
// --context  none | simulated. simulated gives v2 a "last odometer" drawn
//            0..2,000 km below the LABEL (deterministic per image). It shows
//            what the app's constraint can do with a true history; it uses
//            the label and is never pooled with the context-free numbers.
// --workers  parallel worker threads (default: cores - 1)
//
// v1 is the shipped recogniser (src/lib/scan/automaticDisplay.ts) read on the
// whole photo exactly as the app does today (longest side 960, then 1280), and
// on the same crop. v2 is src/lib/scan/v2/pipeline.ts on the crop.
// A missing or altered corpus file makes the run INCOMPLETE (exit code 2).
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../..');

async function load(module) {
  const { runnerImport } = await import('vite');
  return (await runnerImport(join(repo, module))).module;
}

function hashUnit(text) {
  return parseInt(createHash('sha256').update(text).digest('hex').slice(0, 8), 16) / 0xffffffff;
}

async function rgba(sharp, path, rect) {
  let pipeline = sharp(path, { failOn: 'none' }).rotate();
  if (rect) pipeline = pipeline.extract(rect);
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

async function digitBox(root, id) {
  const xml = await readFile(join(root, 'trodo-v2/trodo-v01/pascal voc 1.1/Annotations', `${id}.xml`), 'utf8').catch(() => null);
  if (!xml) return null;
  let box = null;
  for (const m of xml.matchAll(/<object>\s*<name>([^<]+)<\/name>[\s\S]*?<xmin>([\d.]+)<\/xmin>\s*<ymin>([\d.]+)<\/ymin>\s*<xmax>([\d.]+)<\/xmax>\s*<ymax>([\d.]+)<\/ymax>/g)) {
    if (!/^\d$/.test(m[1])) continue;
    const [x0, y0, x1, y1] = m.slice(2).map(Number);
    box = box ? [Math.min(box[0], x0), Math.min(box[1], y0), Math.max(box[2], x1), Math.max(box[3], y1)] : [x0, y0, x1, y1];
  }
  return box;
}

const clampRect = ([x0, y0, x1, y1], pad, width, height) => {
  const w = x1 - x0, h = y1 - y0;
  const left = Math.max(0, Math.floor(x0 - w * pad)), top = Math.max(0, Math.floor(y0 - h * pad));
  return { left, top, width: Math.max(1, Math.min(width, Math.ceil(x1 + w * pad)) - left), height: Math.max(1, Math.min(height, Math.ceil(y1 + h * pad)) - top) };
};

async function work({ sessions, root, crop, context, v2options = {}, skipV1 = false }, emit) {
  const sharp = (await import('sharp')).default;
  const { recognizeDisplay } = await load('src/lib/scan/automaticDisplay.ts');
  const { scanV2 } = await load('src/lib/scan/v2/pipeline.ts');
  for (const s of sessions) {
    const path = join(root, s.file);
    const meta = await sharp(path, { failOn: 'none' }).rotate().metadata();
    const width = meta.autoOrient?.width ?? meta.width, height = meta.autoOrient?.height ?? meta.height;
    const kind = s.kind ?? 'odometer';
    const row = { id: s.id, role: s.role, family: s.family, label: s.label, kind };
    // v1 on the whole photo, as the app reads a chosen file today.
    let v1full = null;
    for (const maximum of skipV1 ? [] : Math.max(width, height) > 960 ? [960, 1280] : [960]) {
      const ratio = Math.min(1, maximum / Math.max(width, height));
      const { data, info } = await sharp(path, { failOn: 'none' }).rotate().resize({ width: Math.round(width * ratio), height: Math.round(height * ratio), fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const r = recognizeDisplay({ width: info.width, height: info.height, data }, kind);
      if (r.status === 'read') { v1full = r.values; break; }
    }
    let box = s.cropBox ?? null;
    if (!box && kind === 'odometer') box = crop === 'number' ? await digitBox(root, s.id) : s.box;
    const rect = box ? clampRect(box, crop === 'number' ? .25 : .1, width, height) : { left: 0, top: 0, width, height };
    row.cropRect = rect;
    const cropped = await rgba(sharp, path, rect);
    // v1 on the same crop (scaled so its longest side is at most 1280, at least 320).
    const scale = Math.min(4, Math.max(320 / Math.max(rect.width, rect.height), Math.min(1, 1280 / Math.max(rect.width, rect.height))));
    const { data: cd, info: ci } = await sharp(path, { failOn: 'none' }).rotate().extract(rect).resize({ width: Math.max(32, Math.round(rect.width * scale)), height: Math.max(32, Math.round(rect.height * scale)), fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const v1crop = skipV1 ? { status: 'skipped' } : recognizeDisplay({ width: ci.width, height: ci.height, data: cd }, kind);
    const lastOdometer = context === 'simulated' && kind === 'odometer' && /^\d+$/.test(s.label) ? Math.max(1, Number(s.label) - Math.round(hashUnit(s.id) * 2000) - 1) : null;
    const started = performance.now();
    const v2 = scanV2(cropped, kind, { lastOdometer }, v2options);
    row.v2ms = Math.round(performance.now() - started);
    if (kind === 'odometer') {
      row.v1full = v1full?.odometer ?? null;
      row.v1crop = v1crop.status === 'read' ? v1crop.values.odometer : null;
      row.v2top3 = (v2.fields.odometer ?? []).map(c => c.text);
      row.v2 = v2.odometer?.odometer?.text ?? null;
      row.v2top1raw = row.v2top3[0] ?? null;
      row.v2conf = v2.odometer?.odometer?.confidence ?? null;
    } else {
      row.v1full = v1full ?? null;
      row.v1crop = v1crop.status === 'read' ? v1crop.values : null;
      row.v2 = v2.pump ? { total: v2.pump.total?.text ?? null, liters: v2.pump.liters?.text ?? null, price: v2.pump.price?.text ?? null, consistent: v2.pump.consistent } : null;
      row.v2fields = Object.fromEntries(Object.entries(v2.fields).map(([k, list]) => [k, list.map(c => c.text)]));
    }
    row.v2status = v2.status;
    emit(row);
  }
}

if (!isMainThread) {
  await work(workerData, row => parentPort.postMessage(row));
} else {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]] : pairs, []));
  const root = resolve(args.corpus ?? '.scan-corpus');
  const split = args.split ?? 'tuning', crop = args.crop ?? 'display', context = args.context ?? 'none';
  let sessions;
  if (split === 'pumps') {
    const manifest = JSON.parse(await readFile(join(here, 'pump-manifest.json'), 'utf8'));
    sessions = manifest.sessions.map(s => ({ ...s, kind: 'pump', role: s.expected ? 'eligible' : 'must-not-fill', label: s.expected ? `${s.expected.total}|${s.expected.liters}` : '' }));
  } else {
    const manifest = JSON.parse(await readFile(join(here, 'trodo-manifest.json'), 'utf8'));
    sessions = manifest.sessions.filter(s => s.split === split && s.role === (args.role ?? 'eligible'));
    if (args.limit) sessions = sessions.filter((_, i) => i % Math.ceil(sessions.length / Number(args.limit)) === 0);
  }
  const missing = [];
  await Promise.all(sessions.map(async s => {
    const path = join(root, s.file);
    if (!existsSync(path)) return missing.push({ id: s.id, problem: 'missing' });
    if (s.sha256 && createHash('sha256').update(await readFile(path)).digest('hex') !== s.sha256) missing.push({ id: s.id, problem: 'hash-mismatch' });
  }));
  const runnable = sessions.filter(s => !missing.some(m => m.id === s.id));
  const workers = Math.max(1, Math.min(Number(args.workers ?? availableParallelism() - 1), runnable.length));
  const rows = [], started = Date.now();
  await Promise.all([...Array(workers)].map((_, w) => new Promise((done, fail) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { sessions: runnable.filter((_, i) => i % workers === w), root, crop, context, v2options: args['v2-options'] ? JSON.parse(args['v2-options']) : {}, skipV1: args['skip-v1'] === 'true' } });
    worker.on('message', row => { rows.push(row); if (rows.length % 50 === 0) process.stderr.write(`${rows.length}/${runnable.length}\n`); });
    worker.on('error', fail); worker.on('exit', code => code ? fail(new Error(`worker ${w} exited ${code}`)) : done());
  })));
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const { summarise } = await load('scripts/scan-v2/metrics.ts');
  const { execFileSync } = await import('node:child_process');
  let summary;
  if (split === 'pumps') {
    const pumpText = v => v ? `${v.total ?? ''}|${v.liters ?? ''}` : null;
    const scored = rows.filter(r => r.role === 'eligible');
    summary = {
      v1full: summarise(scored.map(r => ({ id: r.id, label: r.label, predicted: pumpText(r.v1full) }))),
      v1crop: summarise(scored.map(r => ({ id: r.id, label: r.label, predicted: pumpText(r.v1crop) }))),
      v2: summarise(scored.map(r => ({ id: r.id, label: r.label, predicted: pumpText(r.v2) }))),
      mustNotFill: rows.filter(r => r.role === 'must-not-fill').map(r => ({ id: r.id, v1full: r.v1full, v1crop: r.v1crop, v2: r.v2 })),
    };
  } else {
    summary = {
      v1full: summarise(rows.map(r => ({ id: r.id, label: r.label, predicted: r.v1full }))),
      v1crop: summarise(rows.map(r => ({ id: r.id, label: r.label, predicted: r.v1crop }))),
      v2: summarise(rows.map(r => ({ id: r.id, label: r.label, predicted: r.v2, top3: r.v2top3 }))),
      // Operating point fixed on the tuning split before any test run: only a
      // candidate with confidence >= 0.8 counts as answered; the rest abstain.
      v2confident: summarise(rows.map(r => ({ id: r.id, label: r.label, predicted: r.v2conf >= .8 ? r.v2 : null }))),
    };
  }
  const report = {
    format: 'tank-malle-scan-v2-accuracy-v1', at: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain', 'src/lib/scan'], { cwd: repo, encoding: 'utf8' }).trim().length > 0,
    v2options: args['v2-options'] ? JSON.parse(args['v2-options']) : {}, split, crop, context, role: args.role ?? 'eligible', status: missing.length ? 'incomplete' : 'complete', missing,
    wallMs: Date.now() - started, v2msMedian: rows.map(r => r.v2ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? null,
    summary, rows,
  };
  if (args.out) { await mkdir(dirname(resolve(args.out)), { recursive: true }); await writeFile(resolve(args.out), JSON.stringify(report, null, 1)); }
  console.log(JSON.stringify({ split, crop, context, status: report.status, missing: missing.length, wallMs: report.wallMs, v2msMedian: report.v2msMedian, summary: split === 'pumps' ? summary : Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, v])) }, null, 1));
  if (missing.length) process.exitCode = 2;
}
