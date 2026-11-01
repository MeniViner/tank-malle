// Where the remaining odometer failures come from (development data only).
//
//   node scripts/scan-benchmark/run.mjs --split tuning --text ppocr-v5+v6 --diagnose --out tuning-diagnose.json
//   node scripts/scan-benchmark/diagnose.mjs tuning-diagnose.json [out.json]
//
// Each eligible session that was not filled in correctly is attributed to the
// first stage that lost the correct value: localisation (no text box or
// segment line on the annotated odometer), raw recognition (located, but no
// path read the digits), parsing (the text held the digits, no numeric line
// did), an unsure line (verifier, stroke, adjacent, text), identity (an
// unsure-free line held the value, no path resolved it) or the session rule
// (a path read it, the session did not accept it).
//
// The annotated box is used only to say where the odometer is and to read
// that crop as an oracle; nothing here is a headline accuracy. Ablations and
// acceptance policies are recomputed from the recorded paths of the same
// sessions, so they compare like with like (and are just as post-hoc).
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runnerImport } from 'vite';

const [runFile, out] = process.argv.slice(2);
const run = JSON.parse(await readFile(runFile, 'utf8'));
if (!run.diagnose || run.splits.some(s => s !== 'tuning')) throw new Error('needs a --diagnose run of the tuning split');
const { CaptureSession } = (await runnerImport(resolve('src/lib/scan/session.ts'))).module;
const { decideDisplay } = (await runnerImport(resolve('src/lib/scan/automaticDisplay.ts'))).module;

const strip = text => String(text ?? '').replace(/^0+(?=\d)/, '');
const numbers = text => [...String(text).matchAll(/\d(?:[\d\s,.'`"]*\d)?/g)].flatMap(m => { const c = m[0].replace(/[\s,'`"]/g, ''); return [c, c.split('.')[0]]; }).map(strip);
/** A box whose centre lies on the annotated odometer (with a margin). */
const on = (b, gt) => { const x = (b.left + b.right) / 2, y = b.top + b.height / 2, mx = (gt.right - gt.left) * .15, my = gt.height * .25; return x >= gt.left - mx && x <= gt.right + mx && y >= gt.top - my && y <= gt.top + gt.height + my; };
const family = path => path.startsWith('segment') ? 'segment' : 'text';
const distance = (a, b) => { const d = [...Array(b.length + 1).keys()]; for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } } return d[b.length]; };
const nearMiss = (read, label) => {
  if (!read) return 'no digits';
  const d = distance(read, label);
  if (d === 0) return 'exact';
  if (d === 1) return read.length < label.length ? 'one digit dropped' : read.length > label.length ? 'one digit inserted' : 'one digit substituted';
  return d <= 2 ? 'two digits off' : 'other number';
};
const tally = (list, key) => list.reduce((m, x) => { const k = key(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const decide = (attempts, policy = 'current') => {
  const session = new CaptureSession('odometer', { still: true });
  session.frame(0);
  if (policy === 'current') { for (const a of attempts) session.attempt({ frame: 0, ...a }); return session.decide(); }
  // Alternative still-photo policies, on the same recorded paths.
  const reads = attempts.filter(a => a.result.status === 'read'), values = [...new Set(reads.map(a => a.result.values.odometer))];
  if (values.length !== 1) return { status: 'abstained', reason: values.length ? 'conflict' : 'unreadable' };
  const by = reads.map(a => a.path), families = new Set(by.map(family));
  const ok = policy === 'single-path' ? by.length >= 1 : policy === 'cross-family' ? families.size >= 2 : false;
  return ok ? { status: 'accepted', values: reads[0].result.values } : { status: 'abstained', reason: 'uncorroborated' };
};
const asPolarity = lines => [{ polarity: 'light', stable: lines.map(l => ({ ...l, polarity: 'light', support: 2 })), conflicts: [] }];
/** Text-path attempts recomputed from the recorded lines, optionally ignoring
 * verifier disagreement. Segment paths are kept as recorded. */
const recomputed = (row, { verifier = true } = {}) => {
  const text = row.trace.filter(e => family(e.path) === 'text'), labels = [];
  const byPath = new Map();
  for (const event of text) {
    labels.push(...event.labels);
    const lines = event.lines.map(l => (!verifier && l.contested === 'verifier' ? { ...l, contested: undefined } : l)).map(({ contested, ...l }) => (contested ? { ...l, contested } : l));
    if (lines.length) byPath.set(event.path, decideDisplay(asPolarity(lines), 'odometer', [...event.labels, ...(event.path.endsWith('@roi') ? labels : [])]));
  }
  return row.attempts.map(a => (byPath.has(a.path) ? { path: a.path, result: byPath.get(a.path) } : a));
};

const scored = run.rows.filter(r => r.role === 'eligible' || r.role === 'negative-trip-or-clock'), eligible = scored.filter(r => r.role === 'eligible');
const outcome = (row, decision) => decision.status !== 'accepted' ? 'abstained' : row.role === 'eligible' && strip(decision.values.odometer) === strip(row.expected?.odometer) ? 'correct' : 'wrong';
const stages = [];
for (const row of eligible) {
  const L = strip(row.expected.odometer), result = outcome(row, row.status === 'accepted' ? { status: 'accepted', values: row.values } : row);
  if (result === 'correct') { stages.push({ id: row.id, family: row.family, stage: 'correct' }); continue; }
  if (!row.gt || !row.trace) { stages.push({ id: row.id, family: row.family, stage: row.reason === 'runner-error' ? 'runner-error' : 'no-annotation' }); continue; }
  const items = row.trace.flatMap(e => (e.items ?? []).map(i => ({ ...i, path: e.path }))), lines = row.trace.flatMap(e => e.lines.map(l => ({ ...l, path: e.path })));
  const located = { text: items.filter(i => on(i, row.gt)), segment: lines.filter(l => family(l.path) === 'segment' && on(l, row.gt)) };
  const oracle = row.oracleCrop ? { raw: row.oracleCrop.items.some(i => numbers(i.text).includes(L)), read: row.oracleCrop.result.status === 'read' && strip(row.oracleCrop.result.values.odometer) === L, reason: row.oracleCrop.result.status === 'read' ? (strip(row.oracleCrop.result.values.odometer) === L ? 'read' : 'read-other') : row.oracleCrop.result.reason } : null;
  let stage, detail = null;
  if (result === 'wrong') { stage = 'wrong-accepted'; detail = `${row.values.odometer} via ${row.paths?.join('+')}`; }
  else if (!located.text.length && !located.segment.length) stage = 'localisation';
  else if (!located.text.some(i => numbers(i.text).includes(L)) && !located.segment.some(l => strip(l.text) === L)) {
    // Several boxes on the odometer that spell the value together.
    const joined = strip(located.text.filter(i => i.path === located.text[0].path).sort((a, b) => a.left - b.left).map(i => i.text.replace(/\D/g, '')).join(''));
    const best = [...located.text.flatMap(i => numbers(i.text)), ...located.segment.map(l => strip(l.text))].sort((a, b) => distance(a, L) - distance(b, L))[0];
    stage = joined === L ? 'raw:split-box' : 'raw-recognition'; detail = joined === L ? null : nearMiss(best, L);
  } else {
    const holding = lines.filter(l => strip(l.text) === L);
    if (!holding.length) stage = 'parsing';
    else if (holding.every(l => l.contested)) { stage = 'unsure-line'; detail = [...new Set(holding.map(l => l.contested))].sort().join('+'); }
    else {
      const readBy = row.attempts.filter(a => a.result.status === 'read' && strip(a.result.values.odometer) === L);
      if (!readBy.length) { stage = 'identity'; detail = [...new Set(row.attempts.filter(a => holding.some(l => l.path === a.path && !l.contested)).map(a => a.result.status === 'read' ? `chose ${a.result.values.odometer}` : a.result.reason))].sort().join('+') || 'path without attempt'; }
      else { stage = `session:${row.reason}`; detail = readBy.map(a => a.path).join('+'); }
    }
  }
  stages.push({ id: row.id, family: row.family, stage, detail, oracle, located: { text: located.text.length, segment: located.segment.length } });
}

const failures = stages.filter(s => s.stage !== 'correct');
const byStage = Object.entries(tally(failures, s => s.stage)).sort((a, b) => b[1] - a[1]).map(([stage, n]) => {
  const rows = failures.filter(s => s.stage === stage);
  return { stage, sessions: n, details: tally(rows.filter(r => r.detail), r => r.detail), oracleCropRead: rows.filter(r => r.oracle?.read).length, oracleCropRawDigits: rows.filter(r => r.oracle?.raw).length, oracleReasons: tally(rows.filter(r => r.oracle), r => r.oracle.reason) };
});

// Ablations and acceptance policies over the same recorded paths.
const same = (a, b) => a.status === b.status && JSON.stringify(a.values ?? null) === JSON.stringify(b.values ?? null);
const consistency = scored.filter(r => r.trace && same(decide(recomputed(r)), decide(r.attempts))).length;
const evaluate = (name, attemptsOf, policy = 'current') => {
  const outcomes = scored.map(r => ({ r, o: r.trace ? outcome(r, decide(attemptsOf(r), policy)) : 'abstained' }));
  const correct = outcomes.filter(x => x.r.role === 'eligible' && x.o === 'correct').length, wrong = outcomes.filter(x => x.o === 'wrong').length;
  return { name, policy, correct, eligible: eligible.length, wrong, scored: scored.length, accepted: correct + wrong, wrongOnNegatives: outcomes.filter(x => x.o === 'wrong' && x.r.role !== 'eligible').length };
};
const variants = [
  evaluate('recorded paths', r => r.attempts),
  evaluate('recomputed from recorded lines (consistency check)', r => recomputed(r)),
  evaluate('without the verifier (its disagreements ignored)', r => recomputed(r, { verifier: false })),
  evaluate('without full-resolution recrops (@roi paths dropped)', r => r.attempts.filter(a => !a.path.endsWith('@roi'))),
  evaluate('without the central-region retry', r => r.attempts.filter(a => !a.path.endsWith('@centre'))),
  evaluate('text recogniser only (segment paths dropped)', r => r.attempts.filter(a => family(a.path) === 'text')),
  evaluate('segment reader only', r => r.attempts.filter(a => family(a.path) === 'segment')),
  evaluate('policy: any single path, no disagreement', r => r.attempts, 'single-path'),
  evaluate('policy: segment and text recogniser must agree', r => r.attempts, 'cross-family'),
];
// How accepted readings were corroborated: by the same model at two
// resolutions, or by two different recognisers.
const accepted = scored.filter(r => r.status === 'accepted').map(r => ({ r, ok: outcome(r, { status: 'accepted', values: r.values }) === 'correct', families: [...new Set((r.paths ?? []).map(family))].sort().join('+') }));
const corroboration = Object.entries(tally(accepted, a => a.families)).map(([families, n]) => ({ families, accepted: n, correct: accepted.filter(a => a.families === families && a.ok).length }));
// Disagreements: the same number read differently, or a different number.
const conflicts = scored.filter(r => r.reason === 'conflict' && r.trace).map(r => {
  const reads = r.attempts.filter(a => a.result.status === 'read'), where = reads.map(a => r.trace.find(e => e.path === a.path)?.lines.find(l => strip(l.text) === strip(a.result.values.odometer)));
  const overlap = (a, b) => a && b && Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.top + a.height, b.top + b.height) > Math.max(a.top, b.top);
  return { id: r.id, values: reads.map(a => `${a.path}=${a.result.values.odometer}`), sameRegion: where.every(w => overlap(w, where[0])) };
});

const report = {
  format: 'tank-maleh-scan-diagnosis-v1', run: { file: runFile.split('/').pop(), commit: run.commit, at: run.at, text: run.text, splits: run.splits },
  note: 'Development (tuning) split only. The annotated box locates the odometer and gives an oracle crop; neither is part of any headline result. Variants are recomputed from the same recorded paths and are post-hoc.',
  eligible: eligible.length, correct: stages.filter(s => s.stage === 'correct').length, byStage, variants, corroboration, conflicts,
  consistency: { sessions: scored.filter(r => r.trace).length, sameDecisionWhenRecomputed: consistency },
  oracle: { note: 'Annotated odometer box (+15% / +25% margin) read by the same text recogniser; diagnostic only.', rawDigits: stages.filter(s => s.oracle?.raw).length, readCorrect: stages.filter(s => s.oracle?.read).length, of: stages.filter(s => s.oracle).length },
  sessions: stages,
};
if (out) await writeFile(resolve(out), JSON.stringify(report, null, 1) + '\n');
const { sessions: _, ...brief } = report;
console.log(JSON.stringify(brief, null, 1));
