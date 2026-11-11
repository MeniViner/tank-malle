import sharp from 'sharp'; import { load } from './lib.mjs';
const { demoPhoto } = await load('src/lib/scan/fixtures.ts');
for (const kind of ['pump', 'odometer']) { const i = demoPhoto(kind); await sharp(Buffer.from(i.data.buffer), { raw: { width: i.width, height: i.height, channels: 4 } }).png().toFile(`${process.argv[2]}/demo-${kind}.png`); }
