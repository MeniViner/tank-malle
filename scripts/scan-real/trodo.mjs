// Benchmark of the scan engine on TRODO, a public set of odometer photos
// (Mouheb, Yürekli, Yılmazel 2021, CC BY 4.0, doi:10.17632/6y8m379mkt.2).
// The photos are not in the repository; download and unzip trodo-v01.zip and pass its folder.
//   node scripts/scan-real/trodo.mjs --dir <trodo-v01> [--type digital|analog|all] [--limit N] [--sample K] [--journal] [--out file.json] [--fails]
// Counts what the app would show: a reading `acceptOdometer` accepts, else "not clear".
import { readFile, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { args, load, readRGBA } from './lib.mjs';

if (!isMainThread) {
  const { scanPhoto } = await load('src/lib/scan/engine/read.ts');
  for (const item of workerData.items) {
    try {
      const image = await readRGBA(join(workerData.dir, 'images', item.image));
      const r = scanPhoto(image, 'odometer', item.context ?? {});
      parentPort.postMessage({ image: item.image, ms: r.ms, top: r.odometer.slice(0, 5).map(o => ({ text: o.text, c: +o.confidence.toFixed(3) })) });
    } catch (e) { parentPort.postMessage({ image: item.image, ms: 0, top: [], error: String(e) }); }
  }
} else {
  const { acceptOdometer } = await load('src/lib/scan/engine/index.ts');
  const type = args.type ?? 'digital';
  let items = JSON.parse(await readFile(join(args.dir, 'ground truth', 'groundtruth.json'), 'utf8')).odometers
    // A few labels are placeholders ("0", "12"); an odometer reading has at least three digits.
    .filter(o => (type === 'all' || o.odometer_type === type) && /^\d{3,7}$/.test(o.mileage));
  // --journal: the app knows the last reading from the journal; simulate one a few hundred km back.
  if (args.journal) items = items.map(o => ({ ...o, context: { lastOdometer: Math.max(0, Number(o.mileage) - 350) } }));
  if (args.sample) { const k = Number(args.sample); items = items.filter((_, i) => i % k === 0); }
  if (args.limit) items = items.slice(0, Number(args.limit));
  const workers = Math.max(1, Math.min(availableParallelism() - 2, items.length)), rows = new Map();
  const started = Date.now();
  await Promise.all([...Array(workers)].map((_, w) => new Promise((done, fail) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { dir: args.dir, items: items.filter((_, i) => i % workers === w) } });
    worker.on('message', r => { rows.set(r.image, r); if (rows.size % 100 === 0) process.stderr.write(`${rows.size}/${items.length}\n`); });
    worker.on('error', fail); worker.on('exit', c => c ? fail(new Error('worker ' + c)) : done());
  })));
  const stats = { right: 0, wrong: 0, abstain: 0, bestRight: 0, inTop: 0 }, table = [];
  for (const item of items) {
    const r = rows.get(item.image), best = r.top[0], shown = best && acceptOdometer(best.c, item.context);
    const outcome = !shown ? 'abstain' : best.text === item.mileage ? 'right' : 'wrong';
    stats[outcome]++; if (best?.text === item.mileage) stats.bestRight++; if (r.top.some(o => o.text === item.mileage)) stats.inTop++;
    table.push({ image: item.image, type: item.odometer_type, want: item.mileage, got: best?.text ?? null, c: best?.c ?? null, outcome, ms: r.ms, error: r.error, top: r.top });
    if (args.fails && outcome !== 'right') console.log(`${outcome.padEnd(7)} ${item.image}  want ${item.mileage.padEnd(8)} got ${(best?.text ?? '—').padEnd(8)} c=${best?.c ?? '-'}`);
  }
  const n = items.length, pct = x => `${(100 * x / n).toFixed(1)}%`;
  console.log(`\nTRODO ${type}: ${n} photos · shown right ${stats.right} (${pct(stats.right)}) · shown WRONG ${stats.wrong} (${pct(stats.wrong)}) · not clear ${stats.abstain} (${pct(stats.abstain)})`);
  console.log(`best guess right regardless of threshold ${stats.bestRight} (${pct(stats.bestRight)}) · right answer in top 5 ${stats.inTop} (${pct(stats.inTop)}) · ${((Date.now() - started) / 1000).toFixed(0)} s`);
  if (args.out) await writeFile(args.out, JSON.stringify({ at: new Date().toISOString(), type, stats, n, table }, null, 1));
}
