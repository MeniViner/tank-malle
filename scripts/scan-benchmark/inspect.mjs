// Print what each recognition path saw for chosen sessions (tuning analysis).
//   node scripts/scan-benchmark/inspect.mjs <run.json> <text reader> <filter js expression on row> [count]
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { runnerImport } from 'vite';
import { createTextReader } from './readers.mjs';
const [runFile, text, filter, count = '12'] = process.argv.slice(2);
const run = JSON.parse(await readFile(runFile, 'utf8')), manifest = JSON.parse(await readFile(resolve(run.sessionsFile), 'utf8'));
if (run.splits.some(s => s !== 'tuning')) throw new Error('inspection is for the tuning split only');
const rows = run.rows.filter(row => Function('row', `return ${filter}`)(row)).slice(0, Number(count));
const pipeline = (await runnerImport(resolve('src/lib/scan/pipeline.ts'))).module, strokes = (await runnerImport(resolve('src/lib/scan/strokes.ts'))).module, reader = await createTextReader(text);
for (const row of rows) {
  const session = manifest.sessions.find(s => s.id === row.id);
  const { data, info } = await sharp(join('.scan-corpus', session.frames[0].file), { failOn: 'none' }).rotate().resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const source = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
  const seen = []; const spy = { name: reader.name, read: async image => { const items = await reader.read(image); const { lines } = pipeline.fromText(items); seen.push(items.map(i => `${i.text}${i.contested ? `?v(${i.verifierText})` : ''}`).join(' | ') + '  ⇒ lines: ' + lines.map(l => `${l.text}${l.contested ? '?' + l.contested : strokes.strayStroke(image, l) ? '?stroke' : ''}`).join(' ')); return items; } };
  const analysis = await pipeline.analyzeFrame(source, session.kind, 0, { textReader: spy });
  console.log(`${row.id} label=${row.label} ${row.family}`);
  for (const s of seen) console.log('   text:', s);
  for (const a of analysis.attempts) console.log('   ', a.path, JSON.stringify(a.result));
}
process.exit(0);
