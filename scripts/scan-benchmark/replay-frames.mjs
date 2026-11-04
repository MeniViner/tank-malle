// Writes each distinct frame of the camera-replay scenes (e2e/helpers/replay.ts)
// as a PNG with a sessions file, so photos.mjs can trace what the still
// pipeline sees. Each session's truth is the scene's own for that moment:
// positive, blurred, partial, counting, negative, or absent (that kind of
// display is not in the frame: nothing may be filled).
//   node scripts/scan-benchmark/replay-frames.mjs [scene ...]
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { runnerImport } from 'vite';
const { SCENES, sceneTimes } = (await runnerImport(resolve('e2e/helpers/replay.ts'))).module;
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES);
await mkdir(resolve('.scan-corpus/replay-frames'), { recursive: true });
const sessions = [];
for (const name of names) {
  const scene = SCENES[name], seen = new Map();
  for (const t of sceneTimes(name)) {
    const frame = scene.frame(t), png = await sharp(Buffer.from(frame.data), { raw: { width: frame.width, height: frame.height, channels: 4 } }).png().toBuffer();
    const sha256 = createHash('sha256').update(png).digest('hex'), truth = scene.truth(t);
    // Identical frames are one photograph; the truth must agree across them.
    if (seen.has(sha256)) { const first = seen.get(sha256); if (JSON.stringify(first.truth) !== JSON.stringify(truth)) throw new Error(`${name}: one frame, two truths`); first.times.push(t); continue; }
    const file = `replay-frames/${name}-${t.toFixed(2)}s.png`;
    await writeFile(resolve('.scan-corpus', file), png);
    seen.set(sha256, { truth, times: [t] });
    for (const kind of ['pump', 'odometer']) {
      const k = truth[kind];
      sessions.push({ id: `${name}-${t.toFixed(2)}s-${kind}`, group: name, kind, file, sha256, times: seen.get(sha256).times, state: k.state, expected: k.fill, ...(k.displayed ? { displayed: k.displayed } : {}), ...(k.note ? { note: k.note } : {}) });
    }
  }
}
await writeFile(resolve('.scan-corpus/replay-frames/sessions.json'), JSON.stringify({ format: 'tank-maleh-scan-photo-sessions-v1', set: 'replay-frames', note: 'Distinct frames of the camera-replay scenes. expected is what may be filled (null: nothing); state says why.', sessions }, null, 1));
console.log(JSON.stringify({ frames: new Set(sessions.map(s => s.file)).size, sessions: sessions.length, byState: sessions.reduce((m, s) => ({ ...m, [s.state]: (m[s.state] ?? 0) + 1 }), {}) }));
