// What the segment reader finds on one image, per polarity (diagnosis).
//   node scripts/scan-benchmark/segment-probe.mjs <image> <pump|odometer>
import { resolve } from 'node:path';
import sharp from 'sharp';
import { runnerImport } from 'vite';
const [file, kind = 'odometer'] = process.argv.slice(2);
const { analyzeDisplay, decideDisplay } = (await runnerImport(resolve('src/lib/scan/automaticDisplay.ts'))).module, { scaled } = (await runnerImport(resolve('src/lib/scan/frame.ts'))).module;
const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (const size of [960, 1280]) {
  const { image } = scaled({ width: info.width, height: info.height, data: new Uint8ClampedArray(data) }, size), lines = analyzeDisplay(image, kind);
  console.log(size, JSON.stringify(decideDisplay(lines, kind)), lines.map(p => `${p.polarity}: ${p.stable.map(l => l.text).join(',')}${p.conflicts.length ? ' conflicts ' + p.conflicts.map(c => c.text).join(',') : ''}`).join(' | '));
}
