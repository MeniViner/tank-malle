import { load } from './lib.mjs';
const { demoPhoto } = await load('src/lib/scan/fixtures.ts');
const { scanPhoto } = await load('src/lib/scan/engine/read.ts');
for (const kind of ['pump', 'odometer']) { const img = demoPhoto(kind); const r = scanPhoto(img, kind); console.log(kind, img.width, img.height, JSON.stringify(kind === 'pump' ? r.pump.slice(0, 2).map(p => [p.total, p.liters, p.price, +p.confidence.toFixed(2)]) : r.odometer.slice(0, 2).map(o => [o.text, +o.confidence.toFixed(2)])), r.ms + 'ms', r.words.filter(w => w.fit > .7).map(w => w.text).join(' ')); }
