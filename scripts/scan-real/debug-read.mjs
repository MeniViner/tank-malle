// node scripts/scan-real/debug-read.mjs --dir <photos> --file <name> [--out png]
import sharp from 'sharp';
import { join } from 'node:path';
import { args, load, readRGBA } from './lib.mjs';
const { luma, pyramid } = await load('src/lib/scan/engine/image.ts');
const { proposeLines, rectify } = await load('src/lib/scan/engine/proposals.ts');
const { readStrip, binarise } = await load('src/lib/scan/engine/decode.ts');
const want = args.want ?? null;
const image = await readRGBA(join(args.dir, args.file));
const levels = pyramid(luma(image)), lines = proposeLines(levels);
const rows = [];
const near = args.near ? args.near.split(',').map(Number) : null;
for (const l of lines) {
  if (near && Math.hypot(l.cx - near[0], l.cy - near[1]) > (near[2] ?? 400)) continue;
  const strip = rectify(levels, l, 64, false, 3), read = readStrip(strip, l.polarity);
  if (!read || read.cells.length < 3) { if (near) console.log('unread', 'L' + l.level, l.polarity, 'n=' + l.count, Math.round(l.cx), Math.round(l.cy)); continue; }
  const text = read.cells.map((c, i) => c.options[0].digit + (read.dots.includes(i) ? '.' : '')).join('');
  const fit = read.cells.reduce((s, c) => s + c.fit, 0) / read.cells.length;
  if (want && !text.replace('.', '').includes(want)) continue;
  rows.push({ l, strip, read, text, fit });
}
rows.sort((a, b) => b.fit - a.fit);
for (const r of rows.slice(0, Number(args.top ?? 15))) console.log(r.text.padEnd(12), r.fit.toFixed(2), 'L' + r.l.level, r.l.polarity, 'n=' + r.l.count, 'h=' + Math.round(r.l.height), Math.round(r.l.cx), Math.round(r.l.cy), 'shear', r.read.shear.toFixed(2), r.read.cells.map(c => c.fit.toFixed(1)).join(' '), 'band', r.read.top, r.read.bottom, r.read.cells.map(c => Math.round(c.x0) + '-' + Math.round(c.x1)).join(' '));
if (args.ascii) for (const r of rows.slice(0, Number(args.ascii))) {
  const w = r.strip.width, m = r.read.mask, x0 = Math.max(0, Math.round(r.read.cells[0].x0) - 2), x1 = Math.min(w, Math.round(r.read.cells.at(-1).x1) + 2);
  const edges = new Set(r.read.cells.flatMap(c => [Math.round(c.x0), Math.round(c.x1)]));
  console.log(r.text, 'cols', x0, x1);
  for (let y = Math.max(0, r.read.top - 4); y <= Math.min(63, r.read.bottom + 4); y++) { let line = ''; for (let x = x0; x < x1; x++) line += m[y * w + x] ? '#' : edges.has(x) ? '|' : (y === r.read.top || y === r.read.bottom) ? '-' : ' '; console.log(String(y).padStart(2), line); }
  console.log(r.read.cells.map(c => c.options[0].digit + ':' + c.segments.map(v => Math.round(v * 9)).join('')).join('  '));
}
if (args.out) {
  const top = rows.slice(0, Number(args.top ?? 15)), W = 640, rowH = 132, canvas = Buffer.alloc(W * rowH * top.length, 40);
  top.forEach((r, i) => { const b = binarise(r.strip, r.l.polarity); for (let y = 0; y < 64; y++) for (let x = 0; x < Math.min(W, r.strip.width); x++) { canvas[(i * rowH + y) * W + x] = r.strip.data[y * r.strip.width + x]; canvas[(i * rowH + 66 + y) * W + x] = b[y * r.strip.width + x] * 255; } });
  await sharp(canvas, { raw: { width: W, height: rowH * top.length, channels: 1 } }).png().toFile(args.out);
}
