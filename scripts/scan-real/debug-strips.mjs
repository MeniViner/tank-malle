// node scripts/scan-real/debug-strips.mjs --dir <photos> --file <name> --out <png>
import sharp from 'sharp';
import { join } from 'node:path';
import { args, load, readRGBA } from './lib.mjs';
const { luma, pyramid } = await load('src/lib/scan/engine/image.ts');
const { proposeLines, rectify } = await load('src/lib/scan/engine/proposals.ts');
const image = await readRGBA(join(args.dir, args.file));
const t0 = performance.now();
const levels = pyramid(luma(image));
const lines = proposeLines(levels);
console.log(args.file, image.width, image.height, 'lines', lines.length, Math.round(performance.now() - t0), 'ms');
const top = lines.sort((a, b) => b.count - a.count || b.height - a.height).slice(0, Number(args.top ?? 40));
const strips = top.map(l => rectify(levels, l, 48));
const W = 520, rowH = 50, canvas = Buffer.alloc(W * rowH * strips.length, 40);
strips.forEach((s, i) => { for (let y = 0; y < s.height; y++) for (let x = 0; x < Math.min(W, s.width); x++) canvas[(i * rowH + y) * W + x] = s.data[y * s.width + x]; });
await sharp(canvas, { raw: { width: W, height: rowH * strips.length, channels: 1 } }).png().toFile(args.out);
top.forEach((l, i) => console.log(i, 'L' + l.level, l.polarity, 'n=' + l.count, 'h=' + Math.round(l.height), Math.round(l.cx), Math.round(l.cy), 'ang', Math.round(Math.atan2(l.uy, l.ux) * 57.3)));
