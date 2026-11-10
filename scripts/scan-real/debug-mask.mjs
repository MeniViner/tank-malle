// node scripts/scan-real/debug-mask.mjs --dir d --file f --level 1 --rect x0,y0,x1,y1 [--polarity light] [--offset 14]
import { join } from 'node:path';
import { args, load, readRGBA } from './lib.mjs';
const { luma, pyramid, localInk, blobs } = await load('src/lib/scan/engine/image.ts');
const image = await readRGBA(join(args.dir, args.file)), levels = pyramid(luma(image)), L = Number(args.level ?? 0), g = levels[L], s = 1 << L;
const [x0, y0, x1, y1] = args.rect.split(',').map(v => Math.round(Number(v) / s));
const mask = localInk(g, Number(args.radius ?? 14), Number(args.offset ?? 14), args.polarity ?? 'light');
for (let y = y0; y < y1; y++) { let line = ''; for (let x = x0; x < x1; x++) line += mask[y * g.width + x] ? '#' : args.gray ? String(Math.min(9, g.data[y * g.width + x] >> 5)) : '.'; console.log(line); }
for (const b of blobs(mask, g.width, g.height, 8, 1e6)) if (b.cx >= x0 && b.cx < x1 && b.cy >= y0 && b.cy < y1 && b.area > 30) console.log('blob', Math.round(b.cx * s), Math.round(b.cy * s), 'area', b.area, 'major', b.major.toFixed(0), 'minor', b.minor.toFixed(0), 'ang', Math.round(b.angle * 57.3));
if (args.out) {
  const sharp = (await import('sharp')).default, w = x1 - x0, hh = y1 - y0, buf = Buffer.alloc(w * hh * 2);
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) { buf[y * w * 2 + x] = g.data[(y + y0) * g.width + x + x0]; buf[y * w * 2 + w + x] = mask[(y + y0) * g.width + x + x0] * 255; }
  await sharp(buf, { raw: { width: w * 2, height: hh, channels: 1 } }).resize({ width: w * 2 * Number(args.zoom ?? 3), kernel: 'nearest' }).png().toFile(args.out);
}
