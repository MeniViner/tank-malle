// Writes one frame of each camera-replay scene (e2e/helpers/replay.ts) as a PNG
// with a sessions file, so photos.mjs can trace what the pipeline sees.
//   node scripts/scan-benchmark/replay-frames.mjs [seconds]
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { runnerImport } from 'vite';
const t = Number(process.argv[2] ?? 0);
const { SCENES } = (await runnerImport(resolve('e2e/helpers/replay.ts'))).module;
await mkdir(resolve('.scan-corpus/replay-frames'), { recursive: true });
const sessions = [];
for (const [name, scene] of Object.entries(SCENES)) {
  const frame = await scene.frame(t), png = await sharp(Buffer.from(frame.data), { raw: { width: frame.width, height: frame.height, channels: 4 } }).png().toBuffer();
  const file = `replay-frames/${name}-${t}s.png`; await writeFile(resolve('.scan-corpus', file), png);
  for (const kind of ['pump', 'odometer']) sessions.push({ id: `${name}-${t}s-${kind}`, kind, file, sha256: createHash('sha256').update(png).digest('hex'), expected: kind === 'pump' ? { total: '287.40', liters: '40.000' } : { odometer: '128450' } });
}
await writeFile(resolve('.scan-corpus/replay-frames/sessions.json'), JSON.stringify({ sessions }, null, 1));
console.log(sessions.length, 'sessions');
