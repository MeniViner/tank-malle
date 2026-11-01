// Full-frame, capture-session scan benchmark.
//
//   node scripts/scan-benchmark/run.mjs --sessions benchmarks/scan/trodo-sessions.json \
//     --root .scan-corpus --split test --reader current --text none --out run.json
//
// --live N simulates a camera session: N frames derived from the photo (small
// seeded shifts, zoom and exposure changes) go through the live session rules.
// Derived frames are not independent observations; this exercises the live
// consensus path on real images, it does not add trials.
//
// Each session is recognised from the whole photograph through the same code
// the app runs (src/lib/scan/pipeline.ts), never from an annotated crop. The
// annotated crop is only used for the separate, diagnostic component metric.
// A missing or altered corpus file makes the run INCOMPLETE (exit code 2):
// an accuracy gate is never reported green on a partial corpus.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../..');
const SCORED = new Set(['eligible', 'negative-trip-or-clock', 'negative-derived', 'unreadable-derived', 'synthetic']);
const strip = text => String(text ?? '').replace(/^0+(?=\d)/, '');

if (isMainThread) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]] : pairs, []));
  const sessionsFile = resolve(args.sessions ?? 'benchmarks/scan/trodo-sessions.json'), root = resolve(args.root ?? '.scan-corpus');
  const splits = (args.split ?? 'test').split(','), reader = args.reader ?? 'current', text = args.text ?? 'none';
  const manifest = JSON.parse(await readFile(sessionsFile, 'utf8'));
  let sessions = manifest.sessions.filter(s => splits.includes(s.split));
  if (args.limit) sessions = sessions.filter((_, i) => i % Math.ceil(sessions.length / Number(args.limit)) === 0);
  // Integrity first: every frame must exist and match its recorded hash.
  const missing = [];
  await Promise.all(sessions.flatMap(s => s.frames.map(async frame => {
    const path = join(root, frame.file);
    if (!existsSync(path)) return missing.push({ session: s.id, file: frame.file, problem: 'missing' });
    const digest = createHash('sha256').update(await readFile(path)).digest('hex');
    if (digest !== frame.sha256) missing.push({ session: s.id, file: frame.file, problem: 'hash-mismatch' });
  })));
  const runnable = sessions.filter(s => !missing.some(m => m.session === s.id));
  // --workers 0 runs in this process: tesseract.js cannot start its own
  // workers from inside a worker thread.
  const workers = args.workers === '0' ? 0 : Math.max(1, Math.min(Number(args.workers ?? availableParallelism() - 1), runnable.length));
  const started = Date.now(), rows = [], options = { root, reader, text, live: Number(args.live ?? 0), components: args.components === 'true', readerOptions: args['reader-options'] ? JSON.parse(args['reader-options']) : {} };
  if (workers === 0) await work({ ...options, sessions: runnable }, row => rows.push(row));
  else await Promise.all([...Array(workers)].map((_, w) => new Promise((done, fail) => {
    const share = runnable.filter((_, i) => i % workers === w);
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { ...options, sessions: share } });
    worker.on('message', row => { rows.push(row); if (rows.length % 100 === 0) process.stderr.write(`${rows.length}/${runnable.length}\n`); });
    worker.on('error', fail); worker.on('exit', code => code ? fail(new Error(`worker ${w} exited ${code}`)) : done());
  })));
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const { runnerImport } = await import('vite');
  const metrics = (await runnerImport(join(here, 'metrics.ts'))).module;
  const scored = rows.filter(r => SCORED.has(r.role));
  const summary = metrics.summarize(scored);
  const report = {
    format: 'tank-maleh-scan-run-v1', at: new Date().toISOString(), commit: (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    reader, text, live: Number(args.live ?? 0) || null, splits, sessionsFile: sessionsFile.replace(repo + '/', ''), wallMs: Date.now() - started, workers, node: process.version,
    status: missing.length ? 'incomplete' : 'complete', missing,
    counts: { requested: sessions.length, run: rows.length, scored: scored.length, byRole: rows.reduce((m, r) => ({ ...m, [r.role]: (m[r.role] ?? 0) + 1 }), {}) },
    summary,
    targets: {
      correctAutomaticCompletionEligible: { target: .95, verdict: metrics.verdict(summary.coverageEligible, .95) },
      acceptedPrecision: { target: .995, verdict: metrics.verdict(summary.acceptedPrecision, .995) },
    },
    // Unscored roles, reported both ways: as labelled, and with the label's
    // last digit taken as a tenths drum.
    unscored: Object.fromEntries(['unscored-analog-register', 'excluded-label-check', 'unscored-ambiguous-label'].map(role => {
      const subset = rows.filter(r => r.role === role), accepted = subset.filter(r => r.status === 'accepted');
      return [role, { sessions: subset.length, accepted: accepted.length, acceptedMatchingLabel: accepted.filter(r => strip(r.values?.odometer) === strip(r.label)).length, acceptedMatchingLabelWithoutLastDigit: accepted.filter(r => strip(r.values?.odometer) === strip(String(r.label).slice(0, -1))).length }];
    })),
    byFamily: metrics.breakdown(scored, r => r.family), byRole: metrics.breakdown(scored, r => r.role), byDevice: metrics.breakdown(scored, r => r.device),
    acceptedPaths: scored.filter(r => r.status === 'accepted').reduce((m, r) => ({ ...m, [(r.paths ?? []).join('+') || 'single']: (m[(r.paths ?? []).join('+') || 'single'] ?? 0) + 1 }), {}),
    stageMs: Object.fromEntries([...new Set(rows.flatMap(r => Object.keys(r.ms ?? {})))].map(k => [k, { p50: metrics.percentile(rows.map(r => r.ms?.[k] ?? 0), .5), p95: metrics.percentile(rows.map(r => r.ms?.[k] ?? 0), .95) }])),
    component: args.components === 'true' ? { note: 'Diagnostic only: recognizeLine on the annotated odometer crop.', ...metrics.wilson(rows.filter(r => r.component?.correct).length, rows.filter(r => r.role === 'eligible' && r.component).length), accepted: rows.filter(r => r.component?.accepted).length } : null,
    rows,
  };
  if (args.out) { await mkdir(dirname(resolve(args.out)), { recursive: true }); await writeFile(resolve(args.out), JSON.stringify(report, null, 1) + '\n'); }
  const brief = { status: report.status, reader, text, splits, counts: report.counts, coverageEligible: summary.coverageEligible, acceptedPrecision: summary.acceptedPrecision, wrongAcceptanceAmongAll: summary.wrongAcceptanceAmongAll, latencyMs: summary.latencyMs, sessionReasons: summary.sessionReasons, targets: report.targets, missing: missing.length };
  console.log(JSON.stringify(brief, null, 1));
  if (missing.length) process.exitCode = 2;
} else await work(workerData, row => parentPort.postMessage(row));

async function work({ sessions, root, reader, text, live, components, readerOptions }, emit) {
  const sharp = (await import('sharp')).default, { runnerImport } = await import('vite');
  const load = async file => (await runnerImport(join(repo, file))).module;
  const pipeline = await load('src/lib/scan/pipeline.ts'), frames = await load('src/lib/scan/frame.ts'), { CaptureSession } = await load('src/lib/scan/session.ts');
  const baseline = reader === 'baseline' ? await load('scripts/scan-benchmark/baseline-1.6.0/automaticDisplay.ts') : null;
  const segment = components ? await load('src/lib/scan/sevenSegment.ts') : null;
  const textReader = text === 'none' ? null : await (await import('./readers.mjs')).createTextReader(text, readerOptions);
  // The app decodes a chosen photo with EXIF orientation applied and keeps at
  // most 2560 px on the long side (see PhotoReader).
  const decode = async file => {
    const { data, info } = await sharp(join(root, file), { failOn: 'none', limitInputPixels: 60_000_000 }).rotate().resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
  };
  for (const session of sessions) {
    const row = { id: session.id, kind: session.kind, group: session.group, family: session.family, device: session.device, split: session.split, role: session.role, eligible: session.eligible, expected: session.expected, label: session.label ?? null, frames: session.frames.length };
    try {
      const source = await decode(session.frames[0].file);
      const started = performance.now();
      if (baseline) {
        // 1.6.0 still-photo flow: 960, then 1280; the first read is accepted.
        let result = { status: 'unreadable' };
        for (const maximum of Math.max(source.width, source.height) > 960 ? [960, 1280] : [960]) {
          result = baseline.recognizeDisplay(frames.scaled(source, maximum).image, session.kind);
          if (result.status === 'read') break;
        }
        Object.assign(row, result.status === 'read' ? { status: 'accepted', values: result.values, paths: ['baseline'] } : { status: 'abstained', reason: 'unreadable' });
      } else if (live) {
        let seed = [...session.id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);
        const random = () => ((seed = Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
        const capture = new CaptureSession(session.kind, { maxFrames: live, maxMs: Infinity });
        let decision = capture.decide(), frame = 0;
        for (; frame < live && decision.status === 'scanning'; frame++) {
          // A hand-held camera: the view drifts a few percent and zooms slightly.
          const zoom = .9 + random() * .1, w = source.width * zoom, h = source.height * zoom;
          const view = frames.resample(source, { x: random() * (source.width - w), y: random() * (source.height - h), w, h }, Math.round(w), Math.round(h));
          const gain = .9 + random() * .2; for (let i = 0; i < view.data.length; i += 4) { view.data[i] *= gain; view.data[i + 1] *= gain; view.data[i + 2] *= gain; }
          const analysis = await pipeline.analyzeFrame(view, session.kind, frame, { textReader });
          capture.frame(frame, analysis.quality.hint);
          for (const attempt of analysis.attempts) capture.attempt(attempt);
          decision = capture.decide();
        }
        row.frames = frame;
        Object.assign(row, decision.status === 'accepted' ? { status: 'accepted', values: decision.values, paths: decision.paths, evidence: decision.evidence } : { status: 'abstained', reason: decision.status === 'abstained' ? decision.reason : 'timeout', reasons: decision.reasons });
      } else {
        const { decision, analysis } = await pipeline.readStill(source, session.kind, { textReader });
        row.ms = analysis.ms; row.quality = { hint: analysis.quality.hint, sharpness: Math.round(analysis.quality.sharpness * 100) / 100 };
        Object.assign(row, decision.status === 'accepted' ? { status: 'accepted', values: decision.values, paths: decision.paths, evidence: decision.evidence } : { status: 'abstained', reason: decision.reason, reasons: decision.reasons });
      }
      row.latencyMs = performance.now() - started;
      if (segment && session.odometerBox) {
        const b = session.odometerBox, rect = { x: b.xmin, y: b.ymin, w: b.xmax - b.xmin, h: b.ymax - b.ymin };
        const original = await sharp(join(root, session.frames[0].file), { failOn: 'none' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const cut = frames.crop({ width: original.info.width, height: original.info.height, data: original.data }, rect, Math.min(4, 96 / Math.max(1, rect.h)));
        const read = segment.recognizeLine(cut.image, { kind: 'odometer' });
        row.component = { accepted: read.status === 'candidate', correct: read.status === 'candidate' && !!session.expected && BigInt(read.text) === BigInt(session.expected.odometer) };
      }
    } catch (error) {
      Object.assign(row, { status: 'abstained', reason: 'runner-error', error: String(error), latencyMs: 0 });
    }
    if (textReader?.timeouts !== undefined) row.textReaderTimeouts = textReader.timeouts;
    emit(row);
  }
  await textReader?.close?.();
}
