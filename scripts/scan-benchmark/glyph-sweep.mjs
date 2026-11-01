// Chooses the per-digit thresholds (pipeline.ts FAINT_DIGIT, TOP_BAR) and
// weighs a near-miss digit at any number edge, on the tuning split only:
// decisions recomputed from a --diagnose run's recorded lines (which carry
// each line's `faint` and `bar`, and each item's `doubts`), with lines marked
// unsure at each threshold.
//   node scripts/scan-benchmark/glyph-sweep.mjs <tuning --diagnose run.json>
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runnerImport } from 'vite';
const run = JSON.parse(await readFile(process.argv[2], 'utf8'));
const { CaptureSession } = (await runnerImport(resolve('src/lib/scan/session.ts'))).module;
const { decideDisplay } = (await runnerImport(resolve('src/lib/scan/automaticDisplay.ts'))).module;
const strip = t => String(t ?? '').replace(/^0+(?=\d)/, '');
const asPolarity = lines => [{ polarity: 'light', stable: lines.map(l => ({ ...l, polarity: 'light', support: 2 })), conflicts: [] }];
const rows = run.rows.filter(r => r.trace && (r.role === 'eligible' || r.role === 'negative-trip-or-clock'));
const eligible = rows.filter(r => r.role === 'eligible').length;
const decide = attempts => { const s = new CaptureSession('odometer', { still: true }); s.frame(0); for (const a of attempts) s.attempt({ frame: 0, ...a }); return s.decide(); };
const outcome = (r, d) => d.status !== 'accepted' ? 'abstained' : r.role === 'eligible' && strip(d.values.odometer) === strip(r.expected.odometer) ? 'correct' : 'wrong';
// The near-miss digit at either edge of each number (glued to a word or not), by number text.
const edgeDoubt = e => { const m = new Map(); for (const i of e.items ?? []) { if (!i.doubts) continue; const t = i.text, o = t.length - t.trimStart().length, tt = t.trim();
  for (const r of tt.matchAll(/\d(?:[\d\s,.:'`"]*\d)?/g)) {
    const text = r[0].replace(/\s+/g, '').replace(/,(?=\d{3}(?!\d))/g, ''), gaps = [i.doubts[o + r.index] ?? 0, i.doubts[o + r.index + r[0].length] ?? 0];
    // Over spaces the recogniser emitted beyond either edge ("15 177 ").
    for (let k = r.index; /\s/.test(t[o + k - 1] ?? ''); k--) gaps.push(i.doubts[o + k - 1] ?? 0);
    for (let k = r.index + r[0].length; /\s/.test(t[o + k] ?? ''); k++) gaps.push(i.doubts[o + k + 1] ?? 0);
    m.set(text, Math.max(m.get(text) ?? 0, ...gaps)); } } return m; };
function sweep(name, unsure) {
  let correct = 0, wrong = 0; const flipped = [];
  for (const r of rows) {
    const labels = [], byPath = new Map();
    for (const e of r.trace.filter(e => !e.path.startsWith('segment') && !e.path.endsWith('-words'))) {
      labels.push(...e.labels);
      const edges = edgeDoubt(e), lines = e.lines.map(l => (!l.contested && unsure(l, edges) ? { ...l, contested: name } : l));
      if (lines.length) byPath.set(e.path, decideDisplay(asPolarity(lines), 'odometer', [...e.labels, ...(e.path.endsWith('@roi') ? labels : [])]));
    }
    const before = outcome(r, decide(r.attempts)), o = outcome(r, decide(r.attempts.map(a => byPath.has(a.path) ? { path: a.path, result: byPath.get(a.path) } : a)));
    if (o === 'correct') correct++; if (o === 'wrong') wrong++;
    if (o !== before) flipped.push(`${r.id.slice(6, 14)}:${before}->${o}`);
  }
  console.log(`${name}: correct ${correct}/${eligible}, wrong ${wrong}/${rows.length} | ${flipped.length} flips ${flipped.slice(0, 10).join(' ')}`);
}
for (const T of [0, .2, .25, .3, .35, .4, .5]) sweep(`faint<${T}`, l => (l.faint ?? 1) < T);
for (const T of [Infinity, .6, .5, .45, .4, .35, .3, .25, .2]) sweep(`bar>${T}`, l => (l.bar ?? 0) > T);
for (const T of [Infinity, .6, .5, .45, .4, .35, .3]) sweep(`edge-doubt>=${T}`, (l, edges) => (edges.get(l.text) ?? 0) >= T);
sweep('unread-stroke', l => !!l.unread);
for (const T of [.2, .3, .4]) sweep(`unread-stroke+edge-doubt>=${T}`, (l, edges) => !!l.unread && (edges.get(l.text) ?? 0) >= T);
if (process.argv[3] === 'only') process.exit(0);
// Values on accepted readings' lines: what the thresholds would cost.
const q = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor((s.length - 1) * p)]; };
for (const key of ['faint', 'bar']) {
  const values = rows.filter(r => r.status === 'accepted' && r.role === 'eligible' && strip(r.values.odometer) === strip(r.expected.odometer)).flatMap(r => r.trace.flatMap(e => e.lines.filter(l => strip(l.text) === strip(r.values.odometer) && l[key] !== undefined).map(l => l[key])));
  if (values.length) console.log(`${key} on correct accepted lines: n ${values.length} min ${Math.min(...values)} p1 ${q(values, .01)} p5 ${q(values, .05)} p50 ${q(values, .5)} p95 ${q(values, .95)} p99 ${q(values, .99)} max ${Math.max(...values)}`);
}
