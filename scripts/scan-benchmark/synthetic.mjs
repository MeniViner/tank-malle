// Synthetic mechanism suite: seven-segment pump and odometer scenes with known
// truth, varied row order, precision, polarity and degradation. It proves
// mechanisms (identity, abstention, polarity, 1/7 rows); it is NOT evidence of
// real-world accuracy and is never pooled with photographs.
//
//   node scripts/scan-benchmark/synthetic.mjs [count] [out.json] [current|baseline]
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { runnerImport } from 'vite';

const count = Number(process.argv[2] ?? 120), out = process.argv[3], reader = process.argv[4] ?? 'current';
const load = async file => (await runnerImport(resolve(file))).module;
const { blank, drawDigits } = await load('src/lib/scan/fixtures.ts'), { readStill } = await load('src/lib/scan/pipeline.ts'), { scaled } = await load('src/lib/scan/frame.ts');
const baseline = reader === 'baseline' ? await load('scripts/scan-benchmark/baseline-1.6.0/automaticDisplay.ts') : null;
// The 1.6.0 still-photo flow: 960, then 1280; the first read is accepted.
const readBaseline = (image, kind) => {
  for (const maximum of Math.max(image.width, image.height) > 960 ? [960, 1280] : [960]) {
    const result = baseline.recognizeDisplay(scaled(image, maximum).image, kind);
    if (result.status === 'read') return { status: 'accepted', values: result.values };
  }
  return { status: 'abstained', reason: 'unreadable' };
};
let seed = 20261101; const random = () => ((seed = Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
const pick = list => list[Math.floor(random() * list.length)];
const POLARITY = { lcd: { bg: [203, 217, 201], ink: [15, 29, 23] }, night: { bg: [8, 15, 24], ink: [255, 196, 80] }, blue: { bg: [8, 15, 24], ink: [40, 170, 255] } };

async function degrade(image, how) {
  if (how === 'clean') return image;
  let pipeline = sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } });
  if (how === 'blur') pipeline = pipeline.blur(1.2);
  if (how === 'tilt') pipeline = pipeline.rotate(pick([-3, 3]), { background: { r: 60, g: 60, b: 60 } });
  if (how === 'jpeg') pipeline = sharp(await pipeline.jpeg({ quality: 70 }).toBuffer());
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}
function pumpScene() {
  const litersPlaces = pick([2, 3]), pricePlaces = pick([2, 3]);
  const liters = (5 + random() * 60).toFixed(litersPlaces), price = (6.5 + random() * 1.5).toFixed(pricePlaces);
  const total = (Math.round(Number(liters) * Number(price) * 100) / 100).toFixed(2);
  const layout = pick([['total', 'liters'], ['liters', 'total'], ['total', 'liters', 'unitPrice'], ['unitPrice', 'total', 'liters'], ['liters', 'unitPrice', 'total']]);
  const values = { total, liters, unitPrice: price };
  // What image evidence alone can settle (see identity.ts): a 3-place volume
  // beside a 2-place amount; anything else has no unique assignment here.
  const decidable = layout.length === 2 && litersPlaces === 3;
  return { kind: 'pump', rows: layout.map(role => values[role]), expected: { total, liters }, decidable, label: `${layout.join('/')} L${litersPlaces} P${pricePlaces}` };
}
function odometerScene() {
  const style = pick(['random', 'ones-sevens', 'short']);
  const text = style === 'short' ? String(100 + Math.floor(random() * 899)) : style === 'ones-sevens' ? [...Array(6)].map(() => pick(['1', '7', '1', '7', '4'])).join('').replace(/^0/, '1') : String(10000 + Math.floor(random() * 289999));
  return { kind: 'odometer', rows: [text], expected: { odometer: text }, decidable: text.length >= 5, label: style };
}
const rows = [];
for (let i = 0; i < count; i++) {
  const scene = i % 2 ? odometerScene() : pumpScene(), polarity = pick(Object.keys(POLARITY)), how = pick(['clean', 'clean', 'blur', 'tilt', 'jpeg']);
  const { bg, ink } = POLARITY[polarity], image = blank(900, 220 + scene.rows.length * 190, bg);
  scene.rows.forEach((text, r) => drawDigits(image, text, 120, 60 + r * 190, ink));
  const input = await degrade(image, how), decision = baseline ? readBaseline(input, scene.kind) : (await readStill(input, scene.kind)).decision;
  const correct = decision.status === 'accepted' && Object.entries(scene.expected).every(([k, v]) => Number(decision.values[k]) === Number(v));
  rows.push({ kind: scene.kind, label: scene.label, truth: scene.expected, read: decision.values ?? null, paths: decision.paths ?? null, polarity, degradation: how, decidable: scene.decidable, status: decision.status, correct, wrong: decision.status === 'accepted' && !correct, reason: decision.status === 'abstained' ? decision.reason : null, frameReasons: decision.reasons ?? null });
}
const tally = filter => { const s = rows.filter(filter); return { scenes: s.length, accepted: s.filter(r => r.status === 'accepted').length, correct: s.filter(r => r.correct).length, wrong: s.filter(r => r.wrong).length }; };
const report = {
  format: 'tank-maleh-scan-synthetic-v1', note: 'Synthetic mechanism suite; not real-world accuracy.', seed: 20261101, count, reader,
  pump: { decidable: tally(r => r.kind === 'pump' && r.decidable), undecidable: tally(r => r.kind === 'pump' && !r.decidable) },
  odometer: { decidable: tally(r => r.kind === 'odometer' && r.decidable), undecidable: tally(r => r.kind === 'odometer' && !r.decidable) },
  byDegradation: Object.fromEntries(['clean', 'blur', 'tilt', 'jpeg'].map(d => [d, tally(r => r.degradation === d)])),
  byPolarity: Object.fromEntries(Object.keys(POLARITY).map(p => [p, tally(r => r.polarity === p)])),
  wrong: rows.filter(r => r.wrong), rows,
};
if (out) await writeFile(resolve(out), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ pump: report.pump, odometer: report.odometer, byDegradation: report.byDegradation, byPolarity: report.byPolarity, wrong: report.wrong.length }, null, 1));
process.exit(0);
