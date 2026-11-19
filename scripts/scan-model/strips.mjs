// Builds a labelled set of digit strips (the upright rows the engine cuts out) for the strip model.
//
//   node scripts/scan-model/strips.mjs --photos "<photos folder>" --out <folder>      # owner's photos + scan-real/labels.json
//   node scripts/scan-model/strips.mjs --pulled <pull.mjs folder> --out <folder>      # field samples from scan-learn/pull.mjs
//
// Writes <out>/<name>.png (grey, 64 px high, as the engine cuts it) and <out>/manifest.jsonl, one line per
// strip: { file, source, role, label, engine, distance }. `label` is the true digits (no decimal point),
// `engine` what the engine's decoder read from the same strip, `distance` the edit distance between them.
//
// The model only replaces the decoder (step 3 of docs/SCAN-ENGINE.md): the strips are still found by the
// engine. A row the engine never cut out cannot be learnt from here. The output holds people's data when
// built from --pulled: keep it out of the repository and delete it when done.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { args, here, load, readRGBA } from '../scan-real/lib.mjs';

if (!args.out || (!args.photos && !args.pulled)) { console.error('usage: --photos <dir> | --pulled <dir>, and --out <dir>'); process.exit(1); }
const sharp = (await import('sharp')).default;
await mkdir(args.out, { recursive: true });
const digits = s => String(s ?? '').replace(/\D/g, '');
function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) { const keep = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = keep; }
  }
  return row[b.length];
}
const lines = [];
async function save(name, gray, entry) {
  const file = `${name}.png`;
  await sharp(Buffer.from(gray.data), { raw: { width: gray.width, height: gray.height, channels: 1 } }).png().toFile(join(args.out, file));
  lines.push(JSON.stringify({ file, ...entry, distance: editDistance(entry.engine, entry.label) }));
}

if (args.photos) {
  const { scanPhoto, stripOf, sameRowOf } = await load('src/lib/scan/engine/read.ts');
  const items = JSON.parse(await readFile(join(here, 'labels.json'), 'utf8')).items;
  for (const item of items) {
    const truth = item.kind === 'odometer' ? { odometer: digits(item.odometer) } : { total: digits(item.total), liters: digits(item.liters), ...(item.price ? { price: digits(item.price) } : {}) };
    const result = scanPhoto(await readRGBA(join(args.photos, item.file)), item.kind, {});
    // Every distinct row the engine read, matched to the true value it is closest to. A row far from every
    // true value is another row of the display (a price board, a trip meter) and is left out.
    const rows = [];
    for (const w of [...result.words].sort((a, b) => b.fit - a.fit)) if (rows.length < 12 && !rows.some(r => sameRowOf(r, w))) rows.push(w);
    for (const [n, w] of rows.entries()) {
      const [role, label] = Object.entries(truth).map(([role, label]) => [role, label, editDistance(w.digits, label)]).sort((a, b) => a[2] - b[2])[0];
      // A short row (a price) must match exactly: one digit off is as likely another row of the display.
      if (editDistance(w.digits, label) > Math.floor(label.length / 4)) continue;
      await save(`${basename(item.file).replace(/\.\w+$/, '')}-${n}`, stripOf(result.levels, w), { source: 'photo', role, label, engine: w.digits });
    }
  }
}

if (args.pulled) {
  const rows = JSON.parse(await readFile(join(args.pulled, 'samples.json'), 'utf8'));
  for (const row of rows) {
    if (!row.final || !row.pictures) continue;
    const [a, b] = String(row.final).split('|');
    const truth = row.kind === 'odometer' ? { odometer: digits(a) } : { total: digits(a), liters: digits(b) };
    for (const p of row.pictures) {
      const label = truth[p.role]; if (!label) continue;   // thumbnails and price rows have no saved number
      const { data, info } = await sharp(join(args.pulled, p.file)).greyscale().raw().toBuffer({ resolveWithObject: true });
      await save(basename(p.file).replace(/\.\w+$/, ''), { width: info.width, height: info.height, data }, { source: 'field', role: p.role, label, engine: digits(p.text) });
    }
  }
}

await writeFile(join(args.out, 'manifest.jsonl'), lines.join('\n') + '\n');
const exact = lines.map(l => JSON.parse(l)).filter(l => l.distance === 0).length;
console.log(`${lines.length} strips -> ${args.out} (engine decoder exact on ${exact})`);
