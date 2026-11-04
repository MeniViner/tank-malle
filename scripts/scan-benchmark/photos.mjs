// Real photographs outside TRODO (e.g. benchmarks/scan/commons-pump-sessions.json)
// through the complete shipped still-photo pipeline: segment reader plus the
// local text recogniser, as the app runs them. Every path is kept.
//   node scripts/scan-benchmark/photos.mjs <sessions.json> <text reader|none> [out.json]
// A session with `expected: null` shows no complete reading; filling nothing is correct.
// `state` (replay frames) separates positive, blurred, partial, counting, negative and absent.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { runnerImport } from 'vite';
const [sessionsFile, text = 'ppocr-v5+v6', out] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(sessionsFile, 'utf8'));
const { readStill } = (await runnerImport(resolve('src/lib/scan/pipeline.ts'))).module;
const textReader = text === 'none' ? null : await (await import('./readers.mjs')).createTextReader(text);
const rows = [];
for (const session of manifest.sessions) {
  const bytes = await readFile(join('.scan-corpus', session.file));
  if (createHash('sha256').update(bytes).digest('hex') !== session.sha256) { rows.push({ id: session.id, status: 'missing-or-altered' }); continue; }
  // Decoded as the app decodes a chosen photo (EXIF orientation, at most 2560 px).
  const { data, info } = await sharp(bytes, { failOn: 'none' }).rotate().resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const trace = [];
  const { decision, analysis } = await readStill({ width: info.width, height: info.height, data: new Uint8ClampedArray(data) }, session.kind, { textReader, trace: e => trace.push(e) });
  const accepted = decision.status === 'accepted', same = values => !!values && Object.entries(values).every(([k, v]) => Number(decision.values[k]) === Number(v));
  // A counting pump's frame read as displayed is a faithful reading, but not a final one.
  const outcome = !accepted ? (session.expected ? 'abstained' : 'correctly-empty') : same(session.expected) ? 'correct' : session.state === 'counting' && same(session.displayed) ? 'intermediate' : 'wrong';
  rows.push({ id: session.id, kind: session.kind, group: session.group ?? session.id, ...(session.state ? { state: session.state } : {}), ...(session.labels ? { labels: session.labels, font: session.font } : {}), expected: session.expected, ...(session.displayed ? { displayed: session.displayed } : {}), status: decision.status, outcome, values: decision.values ?? null, reason: decision.reason ?? null, reasons: decision.reasons ?? null, paths: decision.paths ?? null,
    ms: Object.fromEntries(Object.entries(analysis.ms).map(([k, v]) => [k, Math.round(v)])), seen: trace.map(e => ({ path: e.path, text: (e.items ?? []).map(i => i.text + (i.contested ? `~${i.verifierText}` : '')), lines: e.lines.map(l => l.text + (l.contested ? `?${l.contested}` : '')) })), attempts: analysis.attempts });
}
await textReader?.close?.();
const report = { format: 'tank-maleh-scan-photos-v1', at: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sessionsFile, text, note: 'Individual real photographs; too few for an accuracy estimate.', outcomes: rows.reduce((m, r) => ({ ...m, [r.outcome ?? r.status]: (m[r.outcome ?? r.status] ?? 0) + 1 }), {}),
  ...(rows.some(r => r.state) ? { byState: rows.reduce((m, r) => ({ ...m, [r.state]: { ...m[r.state], [r.outcome ?? r.status]: (m[r.state]?.[r.outcome ?? r.status] ?? 0) + 1 } }), {}) } : {}), rows };
if (out) await writeFile(resolve(out), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ outcomes: report.outcomes, byState: report.byState, rows: rows.map(r => ({ id: r.id, outcome: r.outcome, values: r.values, reason: r.reason, reasons: r.reasons })) }, null, 1));
process.exit(0);
