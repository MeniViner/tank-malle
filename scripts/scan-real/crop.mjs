// Debug helper: node scripts/scan-real/crop.mjs <src> <out> <x0> <y0> <x1> <y1> [maxSide]  (fractions of the upright image)
import sharp from 'sharp';
const [src, out, x0, y0, x1, y1, max = 1000] = process.argv.slice(2);
const meta = await sharp(src).rotate().metadata();
const W = meta.autoOrient?.width ?? meta.width, H = meta.autoOrient?.height ?? meta.height;
const rect = { left: Math.round(W * x0), top: Math.round(H * y0), width: Math.round(W * (x1 - x0)), height: Math.round(H * (y1 - y0)) };
await sharp(src).rotate().extract(rect).resize({ width: Number(max), height: Number(max), fit: 'inside' }).jpeg({ quality: 85 }).toFile(out);
console.log(W, H, JSON.stringify(rect));
