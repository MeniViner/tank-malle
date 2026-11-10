import { load } from './lib.mjs';
const { lineFixture } = await load('src/lib/scan/fixtures.ts');
const { luma, pyramid } = await load('src/lib/scan/engine/image.ts');
const { proposeLines } = await load('src/lib/scan/engine/proposals.ts');
const { scanPhoto } = await load('src/lib/scan/engine/read.ts');
for (const o of [{ blue: true, scale: .6 }, { blue: true, scale: 1 }, { light: true, scale: 1.4 }, { scale: .45 }, { scale: 1 }]) {
  const img = lineFixture('170549', o), lines = proposeLines(pyramid(luma(img))), r = scanPhoto(img, 'odometer');
  console.log(JSON.stringify(o), img.width, img.height, 'lines', lines.map(l => `L${l.level}${l.polarity[0]}n${l.count}h${Math.round(l.height)}`).join(' '), '->', r.odometer[0]?.text, r.words.map(w => w.text + '@' + w.fit.toFixed(2)).join(' '));
}
