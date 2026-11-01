// Labelled display fixtures with exact truth, for scripts/scan-benchmark/photos.mjs.
//
//   node scripts/scan-benchmark/fixture-set.mjs <name> <seed> <scenes>
//
// Writes PNGs to .scan-corpus/fixtures/<name>/ and the sessions (truth, group,
// sha256) to benchmarks/scan/fixtures-<name>.json. Varies: seven-segment and
// four fonts, both polarities, pump layouts (amount / volume / price, 2- or
// 3-place, '.' or ','), printed English or Hebrew labels on either side, a
// foreign currency (must not be filled as ₪), odometers with ODO / km / ק״מ,
// a TRIP row or a clock beside them, leading and trailing narrow "1"s, and
// blur / JPEG / noise / tilt. A scene and its degraded copies share a group.
// Synthetic: these test mechanisms and generalisation across rendering, not
// real-world accuracy.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { runnerImport } from 'vite';

const [name = 'varied', seedArg = '1', countArg = '120'] = process.argv.slice(2);
const { blank, drawDigits } = (await runnerImport(resolve('src/lib/scan/fixtures.ts'))).module;
let seed = Number(seedArg); const random = () => ((seed = Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
const pick = list => list[Math.floor(random() * list.length)];
const FONTS = ['seven-segment', 'seven-segment', 'DIN Condensed', 'Andale Mono', 'Courier New', 'Arial'];
const LABELS = { english: { total: 'SALE', liters: 'LITRES', unitPrice: 'PRICE/L', odometer: 'ODO', trip: 'TRIP', km: 'km' }, hebrew: { total: 'סה״כ לתשלום', liters: 'ליטרים', unitPrice: 'מחיר לליטר', odometer: 'ODO', trip: 'TRIP', km: 'ק״מ' } };
const W = 1100, ROW = 190, DIGIT = 78;
const xml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function pumpScene() {
  const places = pick([2, 3]), comma = random() < .25, labels = pick(['none', 'english', 'english', 'hebrew']), foreign = random() < .12;
  const liters = (5 + random() * 60).toFixed(places), price = (6.2 + random() * 1.8).toFixed(pick([2, 3]));
  const total = (Math.round(Number(liters) * Number(price) * 100) / 100).toFixed(2);
  const layout = pick([['total', 'liters'], ['liters', 'total'], ['total', 'liters', 'unitPrice'], ['unitPrice', 'total', 'liters']]);
  const values = { total, liters, unitPrice: price }, show = v => (comma ? v.replace('.', ',') : v);
  return { kind: 'pump', rows: layout.map(role => ({ role, text: show(values[role]) })), labels, currency: foreign ? '€' : labels === 'none' ? '' : '₪',
    expected: foreign ? null : { total, liters }, note: `${layout.join('/')} ${places}-place${comma ? ', decimal comma' : ''}${foreign ? ', euros' : ''}` };
}
function odometerScene() {
  const style = pick(['random', 'leading-one', 'trailing-one', 'ones']), labels = pick(['none', 'english', 'english', 'hebrew']);
  const body = String(10000 + Math.floor(random() * 289999));
  const odometer = style === 'leading-one' ? '1' + body.slice(1) : style === 'trailing-one' ? body.slice(0, -1) + '1' : style === 'ones' ? [...body].map(c => (random() < .5 ? '1' : c)).join('') : body;
  const extra = pick(['none', 'trip', 'trip-integer', 'clock']);
  const rows = [...(extra === 'trip' ? [{ role: 'trip', text: (random() * 999).toFixed(1) }] : extra === 'trip-integer' ? [{ role: 'trip', text: String(10000 + Math.floor(random() * 89999)) }] : extra === 'clock' ? [{ role: 'clock', text: `${10 + Math.floor(random() * 12)}:${String(Math.floor(random() * 60)).padStart(2, '0')}` }] : []), { role: 'odometer', text: odometer.replace(/^0/, '1') }];
  return { kind: 'odometer', rows, labels, currency: '', expected: { odometer: rows.at(-1).text }, note: `${style}, ${extra}` };
}
async function render(scene, polarity, font, labelSide) {
  const [bg, ink] = polarity === 'lcd' ? [[203, 217, 201], [15, 29, 23]] : [[8, 15, 24], pick([[255, 196, 80], [40, 170, 255], [250, 80, 60], [120, 255, 140]])];
  const height = 140 + scene.rows.length * ROW, x = labelSide === 'left' ? 420 : 120;
  let image = blank(W, height, bg);
  const texts = [];
  scene.rows.forEach((row, r) => {
    const y = 60 + r * ROW;
    if (font === 'seven-segment' && !row.text.includes(':')) drawDigits(image, row.text.replace(',', '.'), x, y, ink);
    else texts.push(`<text x="${x}" y="${y + 100}" font-family="${font === 'seven-segment' ? 'DIN Condensed' : font}" font-size="${font === 'Arial' || font === 'Courier New' ? 118 : 132}" fill="rgb(${ink})">${xml(row.text)}</text>`);
    if (font === 'seven-segment' && row.text.includes(',')) { const i = row.text.indexOf(','); texts.push(`<rect x="${x + i * DIGIT + 4}" y="${y + 92}" width="8" height="16" fill="rgb(${ink})" transform="skewX(-12)"/>`); }
    const word = scene.labels === 'none' ? (row.role === 'odometer' && random() < .4 ? 'km' : '') : row.role === 'clock' ? '' : row.role === 'odometer' ? LABELS[scene.labels][pick(['odometer', 'km'])] : LABELS[scene.labels][row.role];
    const currency = row.role === 'total' && scene.currency ? scene.currency : '';
    const label = [word, currency].filter(Boolean).join(' ');
    if (label) texts.push(`<text x="${labelSide === 'left' ? 60 : x + row.text.length * DIGIT + 40}" y="${y + 80}" font-family="Arial" font-size="${pick([40, 48, 56])}" fill="rgb(${ink})">${xml(label)}</text>`);
  });
  if (texts.length) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}">${texts.join('')}</svg>`;
    const { data } = await sharp(Buffer.from(image.data), { raw: { width: W, height, channels: 4 } }).composite([{ input: Buffer.from(svg) }]).raw().toBuffer({ resolveWithObject: true });
    image = { width: W, height, data: new Uint8ClampedArray(data) };
  }
  return sharp(Buffer.from(image.data), { raw: { width: W, height, channels: 4 } });
}
async function degrade(base, how) {
  if (how === 'blur') return base.blur(1.4);
  if (how === 'tilt') return base.rotate(pick([-4, 3]), { background: { r: 60, g: 60, b: 60 } });
  if (how === 'jpeg') return sharp(await base.jpeg({ quality: 45 }).toBuffer());
  if (how === 'noise') { const { data, info } = await base.raw().toBuffer({ resolveWithObject: true }); for (let i = 0; i < data.length; i += 4) { const n = (random() - .5) * 60; data[i] += n; data[i + 1] += n; data[i + 2] += n; } return sharp(data, { raw: info }); }
  return base;
}

const dir = resolve(`.scan-corpus/fixtures/${name}`); await mkdir(dir, { recursive: true });
const sessions = [];
for (let g = 0; g < Number(countArg); g++) {
  const scene = g % 2 ? odometerScene() : pumpScene(), polarity = pick(['night', 'night', 'lcd']), font = pick(FONTS), labelSide = scene.labels === 'hebrew' ? pick(['left', 'right']) : 'right';
  const group = `${name}-g${String(g).padStart(3, '0')}`;
  // Each scene once clean and once degraded: one group, never split.
  for (const how of ['clean', pick(['blur', 'tilt', 'jpeg', 'noise'])]) {
    const png = await (await degrade(await render(scene, polarity, font, labelSide), how)).png().toBuffer();
    const file = `fixtures/${name}/${group}-${how}.png`;
    await writeFile(resolve('.scan-corpus', file), png);
    sessions.push({ id: `${group}-${how}`, group, kind: scene.kind, file, sha256: createHash('sha256').update(png).digest('hex'), expected: scene.expected, rows: scene.rows, labels: scene.labels, currency: scene.currency || null, font, polarity, degradation: how, note: scene.note });
  }
}
const manifest = { format: 'tank-maleh-scan-photo-sessions-v1', set: name, seed: Number(seedArg), generator: 'scripts/scan-benchmark/fixture-set.mjs', note: 'Synthetic labelled displays. A scene and its degraded copy share a group. expected: null means nothing may be filled (foreign currency).', sessions };
await writeFile(resolve(`benchmarks/scan/fixtures-${name}.json`), JSON.stringify(manifest, null, 1) + '\n');
console.log(JSON.stringify({ set: name, sessions: sessions.length, groups: Number(countArg), pump: sessions.filter(s => s.kind === 'pump').length, odometer: sessions.filter(s => s.kind === 'odometer').length }));
