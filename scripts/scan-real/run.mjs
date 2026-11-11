// Benchmark of the scan engine on the owner's real photos.
//   node scripts/scan-real/run.mjs --dir "<photos folder>" [--only <substr>] [--history] [--out file.json] [--verbose]
// --history gives each odometer photo the previous photo's label as "last odometer",
// as the app would know it from the journal. Without it the reader gets no context.
import { readFile, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { args, here, load, readRGBA } from './lib.mjs';

if (!isMainThread) {
  const { scanPhoto } = await load('src/lib/scan/engine/read.ts');
  for (const item of workerData.items) {
    const image = await readRGBA(join(workerData.dir, item.file));
    const r = scanPhoto(image, item.kind, item.context ?? {});
    parentPort.postMessage({ file: item.file, ms: r.ms, size: [image.width, image.height],
      odometer: r.odometer.map(o => ({ text: o.text, c: +o.confidence.toFixed(3) })),
      pump: r.pump.map(p => ({ total: p.total, liters: p.liters, price: p.price, c: +p.confidence.toFixed(3) })),
      words: r.words.filter(w => w.fit > .6).sort((a, b) => b.fit - a.fit).slice(0, 14).map(w => `${w.text}@${w.fit.toFixed(2)}`) });
  }
} else {
  const labels = JSON.parse(await readFile(join(here, 'labels.json'), 'utf8')).items.filter(i => !args.only || i.file.includes(args.only)).filter(i => args.screenshots === 'only' ? i.screenshot : args.screenshots === 'no' ? !i.screenshot : true);
  if (args.history) { const odo = labels.filter(i => i.kind === 'odometer' && !i.screenshot); odo.forEach((item, k) => { if (k) item.context = { lastOdometer: Number(odo[k - 1].odometer) }; }); for (const s of labels.filter(i => i.screenshot && i.kind === 'odometer')) s.context = { lastOdometer: Number(s.odometer) - 150 }; }
  const workers = Math.max(1, Math.min(availableParallelism() - 2, labels.length)), rows = [];
  await Promise.all([...Array(workers)].map((_, w) => new Promise((done, fail) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { dir: args.dir, items: labels.filter((_, i) => i % workers === w) } });
    worker.on('message', r => rows.push(r)); worker.on('error', fail); worker.on('exit', c => c ? fail(new Error('worker ' + c)) : done());
  })));
  const { ACCEPT, acceptOdometer } = await load('src/lib/scan/engine/index.ts');
  let pass = 0, top5 = 0, shownWrong = 0, shownRight = 0; const table = [];
  for (const item of labels) {
    const r = rows.find(x => x.file === item.file); let ok, inTop, got;
    if (item.kind === 'odometer') { got = r.odometer[0]?.text ?? '—'; ok = got === item.odometer; inTop = r.odometer.some(o => o.text === item.odometer); }
    else { const p = r.pump[0]; got = p ? `${p.total}|${p.liters}|${p.price ?? '?'}` : '—'; const same = q => q.total === item.total && Number(q.liters) === Number(item.liters); ok = !!p && same(p); inTop = r.pump.some(same); }
    pass += ok; top5 += inTop;
    const shown = item.kind === 'odometer' ? !!r.odometer[0] && acceptOdometer(r.odometer[0].c, item.context ?? {}) : !!r.pump[0] && r.pump[0].c >= ACCEPT.pump;
    if (shown) { if (ok) shownRight++; else shownWrong++; }
    table.push({ file: item.file, kind: item.kind, expected: item.kind === 'odometer' ? item.odometer : `${item.total}|${item.liters}|${item.price}`, got, ok, inTop, ms: r.ms });
    console.log(`${ok ? 'PASS' : inTop ? 'top5' : 'FAIL'}  ${item.file.replace('Screenshot_', 'S_').replace('_Photos', '').padEnd(26)} ${item.kind.padEnd(8)} want ${table.at(-1).expected.padEnd(20)} got ${got.padEnd(22)} c=${(item.kind === 'odometer' ? r.odometer[0]?.c : r.pump[0]?.c) ?? '-'} ${r.ms}ms`);
    if (args.verbose && !ok) console.log('      ', r.words.join('  '));
  }
  const byKind = k => { const t = table.filter(x => x.kind === k); return `${t.filter(x => x.ok).length}/${t.length}`; };
  console.log(`\nTOTAL ${pass}/${labels.length} first answer correct (${top5} in top 5) · odometer ${byKind('odometer')} · pump ${byKind('pump')} · shown right ${shownRight}, shown WRONG ${shownWrong} · median ${table.map(t => t.ms).sort((a, b) => a - b)[table.length >> 1]} ms`);
  if (args.out) await writeFile(args.out, JSON.stringify({ at: new Date().toISOString(), history: !!args.history, pass, total: labels.length, table }, null, 1));
}
