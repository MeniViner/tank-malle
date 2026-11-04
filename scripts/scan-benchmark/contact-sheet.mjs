// Contact sheet of labelled odometer crops, for a person to check labels by eye.
// node scripts/scan-benchmark/contact-sheet.mjs <sessions.json> <corpus root> <out.jpg> <label regex> <every nth> [count]
import sharp from "sharp"; import { readFile } from "node:fs/promises";
const [file, root, out, pattern, step, count = '16'] = process.argv.slice(2);
const all = JSON.parse(await readFile(file, "utf8")).sessions;
const pick = all.filter(x => new RegExp(pattern).test(x.expected?.odometer ?? '')).filter((_, i) => i % Number(step) === 0).slice(0, Number(count)); const tiles = [];
for (const x of pick) { const b = x.odometerBox; const src = root + '/' + x.frames[0].file; const m = await sharp(src, { failOn: "none" }).metadata();
  const pad = 50, left = Math.max(0, Math.floor(b.xmin - pad)), top = Math.max(0, Math.floor(b.ymin - pad));
  const t = await sharp(src, { failOn: "none" }).extract({ left, top, width: Math.min(m.width - left, Math.ceil(b.xmax - b.xmin + 2 * pad)), height: Math.min(m.height - top, Math.ceil(b.ymax - b.ymin + 2 * pad)) }).resize(300, 140, { fit: "contain", background: "#fff" }).png().toBuffer();
  const label = Buffer.from(`<svg width="300" height="20"><rect width="300" height="20" fill="#000"/><text x="4" y="15" font-size="14" fill="#ff0">${x.expected.odometer} ${x.id.slice(6, 14)}</text></svg>`);
  tiles.push(await sharp({ create: { width: 300, height: 160, channels: 3, background: "#fff" } }).composite([{ input: t, top: 20, left: 0 }, { input: label, top: 0, left: 0 }]).png().toBuffer()); }
const rows = Math.ceil(tiles.length / 4);
await sharp({ create: { width: 1200, height: rows * 160, channels: 3, background: "#fff" } }).composite(tiles.map((t, i) => ({ input: t, left: (i % 4) * 300, top: Math.floor(i / 4) * 160 }))).jpeg().toFile(out);
