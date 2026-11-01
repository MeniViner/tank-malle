// The remaining wrong fills on TRODO, each paired with valid neighbours from
// its own display (same group) and its family, so a fix cannot pass by
// rejecting a whole display family. Every photo here was already exposed by
// earlier runs: results on this set are regression evidence, never accuracy.
//   node scripts/scan-benchmark/paired-failures.mjs   (writes benchmarks/scan/paired-failures.json)
//   node scripts/scan-benchmark/run.mjs --sessions benchmarks/scan/paired-failures.json --split tuning,test,challenge --text ppocr-v5+v6 --out run.json
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const trodo = JSON.parse(await readFile('benchmarks/scan/trodo-sessions.json', 'utf8'));
const before = new Map();
for (const split of ['tuning', 'test', 'challenge']) for (const r of JSON.parse(await readFile(`benchmarks/scan/runs/${split}-current-ppocr-cycle3.json`, 'utf8')).rows) before.set(r.id, r);
const correct = s => { const r = before.get(s.id); return r?.role === 'eligible' && r.status === 'accepted' && Number(r.values?.odometer) === Number(s.label); };
// Deterministic sample, independent of file order.
const sample = (list, n) => [...list].sort((a, b) => createHash('sha256').update(a.id).digest('hex').localeCompare(createHash('sha256').update(b.id).digest('hex'))).slice(0, n);
const FAILURES = [
  { id: 'trodo:00001307-PHOTO-2020-12-11-13-27-55', mechanism: 'last narrow "1" dropped before a superscript "km"', like: s => /1$/.test(s.label) },
  { id: 'trodo:00000526-PHOTO-2020-11-29-11-16-41', mechanism: 'first of two seven-segment "1"s dropped', like: s => /^11/.test(s.label) },
  { id: 'trodo:00000554-PHOTO-2020-11-29-19-35-41', mechanism: 'first of two seven-segment "1"s dropped', like: s => /^11/.test(s.label) },
  { id: 'trodo:00000390-PHOTO-2020-11-26-21-23-48', mechanism: 'clock row "11°C 19:43" read as 1121943; the odometer row read with its icon as "30115853"', like: () => true },
  { id: 'trodo:00000598-PHOTO-2020-11-30-13-27-18', mechanism: '"7" with a short top bar read as "1"', like: s => /7/.test(s.label) },
  { id: 'trodo:00000604-PHOTO-2020-11-30-13-27-18', mechanism: '"7" with a short top bar read as "1"', like: s => /7/.test(s.label) },
  { id: 'trodo:00000206-PHOTO-2020-12-22-20-41-57', mechanism: '"77" read as "11"', like: s => /7/.test(s.label) },
  { id: 'trodo:00000170-PHOTO-2020-12-20-18-47-24', mechanism: 'unlit "888" segments read as digits (trip 84.9 read as 888849)', like: () => true },
];
const failures = FAILURES.map(f => {
  const s = trodo.sessions.find(x => x.id === f.id), r = before.get(f.id);
  // The whole display group, then correctly read photos of the same family
  // and device whose value has the same pattern.
  const group = trodo.sessions.filter(x => x.group === s.group && x.id !== s.id);
  const family = sample(trodo.sessions.filter(x => x.group !== s.group && x.family === s.family && x.device === s.device && correct(x) && f.like(x)), 25);
  return { id: f.id, split: s.split, group: s.group, family: s.family, label: s.label, read: r?.values?.odometer ?? null, mechanism: f.mechanism, neighbours: { group: group.map(x => x.id), family: family.map(x => x.id) } };
});
const ids = new Set(failures.flatMap(f => [f.id, ...f.neighbours.group, ...f.neighbours.family]));
const manifest = { ...trodo, note: 'Remaining wrong fills with same-display and same-family neighbours. Already exposed photos: regression evidence only.', failures, sessions: trodo.sessions.filter(s => ids.has(s.id)) };
await writeFile('benchmarks/scan/paired-failures.json', JSON.stringify(manifest, null, 1) + '\n');
console.log(JSON.stringify({ sessions: manifest.sessions.length, bySplit: manifest.sessions.reduce((m, s) => ({ ...m, [s.split]: (m[s.split] ?? 0) + 1 }), {}), failures: failures.map(f => `${f.label}: ${f.neighbours.group.length} group, ${f.neighbours.family.length} family`) }));
