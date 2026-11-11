/**
 * Downloads scan samples and their pictures for work on the engine's rules: where it
 * fails in people's hands, with the numbers they saved as ground truth.
 *
 *   FIREBASE_SERVICE_ACCOUNT='…' node scripts/scan-learn/pull.mjs --out <folder> [--days 90] [--only problems]
 *
 * Writes <folder>/samples.json and <folder>/<id>-<n>.jpg. The folder holds people's data:
 * keep it out of the repository and delete it when done.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { toSampleRow } from '../../src/lib/scan/sampleStats.ts';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : pairs, []));
if (!args.out) { console.error('--out <folder> is required'); process.exit(1); }
const key = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!key && !process.env.FIRESTORE_EMULATOR_HOST) { console.error('FIREBASE_SERVICE_ACCOUNT is not set.'); process.exit(1); }
initializeApp(key ? { credential: cert(JSON.parse(key)) } : { credential: applicationDefault(), projectId: process.env.GCLOUD_PROJECT });
const db = getFirestore(), since = Date.now() - Number(args.days ?? 90) * 86_400_000;
let rows = (await db.collection('scanSamples').where('createdAt', '>=', since).get()).docs.flatMap(d => { const r = toSampleRow(d.id, d.data()); return r ? [r] : []; });
if (args.only === 'problems') rows = rows.filter(r => r.final && (r.outcome === 'unreadable' || r.guess !== r.final));
await mkdir(args.out, { recursive: true });
let pictures = 0;
for (const row of rows) {
  const data = (await db.doc(`scanImages/${row.id}`).get()).data(); if (!data) continue;
  const list = [...(data.strips ?? []), ...(data.thumb ? [{ ...data.thumb, role: 'thumb' }] : [])];
  row.pictures = [];
  for (const [n, p] of list.entries()) {
    const name = `${row.id}-${n}.jpg`; await writeFile(join(args.out, name), Buffer.from(p.jpeg, 'base64')); pictures++;
    row.pictures.push({ file: name, role: p.role ?? null, text: p.text ?? null, confidence: p.confidence ?? null });
  }
  delete row.uid;
}
await writeFile(join(args.out, 'samples.json'), JSON.stringify(rows, null, 1));
console.log(`${rows.length} samples, ${pictures} pictures -> ${args.out}`);
