// Chooses the near-miss digit threshold (pipeline.ts DIGIT_DOUBT) on the tuning
// split: decisions recomputed from a --diagnose run's recorded lines, with lines
// marked unsure at each threshold. 'glued' uses only edges glued to a word.
//   node scripts/scan-benchmark/doubt-sweep.mjs <tuning --diagnose run.json> [glued]
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runnerImport } from 'vite';
const run = JSON.parse(await readFile(process.argv[2], 'utf8'));
const { CaptureSession } = (await runnerImport(resolve('src/lib/scan/session.ts'))).module;
const { decideDisplay } = (await runnerImport(resolve('src/lib/scan/automaticDisplay.ts'))).module;
const strip = t => String(t ?? '').replace(/^0+(?=\d)/, '');
const asPolarity = lines => [{ polarity: 'light', stable: lines.map(l => ({ ...l, polarity: 'light', support: 2 })), conflicts: [] }];
const rows = run.rows.filter(r => r.trace && (r.role === 'eligible' || r.role === 'negative-trip-or-clock'));
const decide = attempts => { const s = new CaptureSession('odometer', { still: true }); s.frame(0); for (const a of attempts) s.attempt({ frame: 0, ...a }); return s.decide(); };
const outcome = (r, d) => d.status !== 'accepted' ? 'abstained' : r.role === 'eligible' && strip(d.values.odometer) === strip(r.expected.odometer) ? 'correct' : 'wrong';
const dist = { correctLines: [], wrongLines: [] };
const GLUED = process.argv[3] === 'glued';
// Per path: the near-miss at a digit edge glued to a word ("19006km", "ODO128450"), by number text.
const gluedDoubt = e => { const m = new Map(); for (const i of e.items ?? []) { if (!i.doubts) continue; const t = i.text, o = t.length - t.trimStart().length, tt = t.trim();
  for (const r of tt.matchAll(/\d(?:[\d\s,.:'`"]*\d)?/g)) { const start = r.index, end = start + r[0].length, text = r[0].replace(/\s+/g, '').replace(/,(?=\d{3}(?!\d))/g, '');
    const d = Math.max(/\p{L}/u.test(tt[start - 1] ?? '') ? i.doubts[o + start] ?? 0 : 0, /\p{L}/u.test(tt[end] ?? '') ? i.doubts[o + end] ?? 0 : 0); m.set(text, Math.max(m.get(text) ?? 0, d)); } } return m; };
for (const T of [Infinity, .9, .7, .5, .4, .3, .2, .15, .1]) {
  let correct = 0, wrong = 0; const flipped = [];
  for (const r of rows) {
    const labels = [], byPath = new Map();
    for (const e of r.trace.filter(e => !e.path.startsWith('segment') && !e.path.endsWith('-words'))) {
      labels.push(...e.labels);
      const g = GLUED ? gluedDoubt(e) : null;
      const lines = e.lines.map(l => (!l.contested && (GLUED ? g.get(l.text) ?? 0 : l.doubt ?? 0) >= T ? { ...l, contested: 'doubt' } : l));
      if (lines.length) byPath.set(e.path, decideDisplay(asPolarity(lines), 'odometer', [...e.labels, ...(e.path.endsWith('@roi') ? labels : [])]));
    }
    const before = outcome(r, decide(r.attempts)), o = outcome(r, decide(r.attempts.map(a => byPath.has(a.path) ? { path: a.path, result: byPath.get(a.path) } : a)));
    if (o === 'correct') correct++; if (o === 'wrong') wrong++;
    if (o !== before) flipped.push(`${r.id.slice(6, 14)}:${before}->${o}`);
  }
  console.log(`T=${T}: correct ${correct}/371, wrong ${wrong}/436 | ${flipped.length} flips ${flipped.slice(0, 8).join(' ')}`);
}
// Doubt values of accepted readings' lines: correct vs wrong.
const acc = rows.filter(r => r.status === 'accepted');
for (const r of acc) { const ok = r.role === 'eligible' && strip(r.values.odometer) === strip(r.expected.odometer); const ds = r.trace.flatMap(e => e.lines.filter(l => strip(l.text) === strip(r.values.odometer)).map(l => l.doubt ?? 0)); (ok ? dist.correctLines : dist.wrongLines).push(Math.max(0, ...ds)); }
const q = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor((s.length - 1) * p)]; };
console.log('accepted correct: max doubt p50/p90/p99/max', q(dist.correctLines, .5), q(dist.correctLines, .9), q(dist.correctLines, .99), Math.max(...dist.correctLines), '| wrong:', dist.wrongLines.join(','));
