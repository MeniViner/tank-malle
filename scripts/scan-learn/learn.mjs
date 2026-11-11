/**
 * The scanner's feedback loop. No model, no Cloud Function: a scheduled GitHub Action
 * (.github/workflows/scan-learn.yml) runs this with the Admin SDK.
 *
 * 1. Reads the labelled scan attempts (`scanSamples` whose fill-up was saved) of the current engine.
 * 2. For each threshold (odometer with / without a previous reading, pump) finds the lowest value
 *    that would have kept wrong readings at or under 1% of those shown, moving at most 0.05 per run
 *    and only with 200+ labelled attempts (`tuneThreshold`).
 * 3. Writes `appConfig/scanTuning`; every device reads it on its next scan (the engine clamps it).
 * 4. Deletes scan pictures older than a year (the privacy policy promises this).
 *
 *   FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",…}' node scripts/scan-learn/learn.mjs [--dry-run] [--days 180]
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8087 GCLOUD_PROJECT=demo-x node scripts/scan-learn/learn.mjs   (emulator, no key)
 */
import { ACCEPT, ACCEPT_RANGE, tunedAccept } from '../../src/lib/scan/engine/accept.ts';
import { ENGINE_VERSION } from '../../src/lib/scan/engine/version.ts';
import { acceptKeyOf, tally, toSampleRow, tuneThreshold, wrongRate, rightRate, readRate } from '../../src/lib/scan/sampleStats.ts';

const args = process.argv.slice(2), dryRun = args.includes('--dry-run');
const days = Number(args[args.indexOf('--days') + 1]) > 0 && args.includes('--days') ? Number(args[args.indexOf('--days') + 1]) : 180;
const RETENTION_DAYS = 365;

export async function learn(db, { now = Date.now(), write = true, log = console.log } = {}) {
  const snapshot = await db.collection('scanSamples').where('createdAt', '>=', now - days * 86_400_000).get();
  const rows = snapshot.docs.flatMap(d => { const r = toSampleRow(d.id, d.data()); return r && r.engine === ENGINE_VERSION ? [r] : []; });
  const previous = (await db.doc('appConfig/scanTuning').get()).data();
  const current = tunedAccept(previous?.engine === ENGINE_VERSION ? previous.accept : null);
  const accept = { ...current }, labeled = {}, notes = [];
  for (const key of Object.keys(ACCEPT)) {
    const mine = rows.filter(r => acceptKeyOf(r) === key), tuned = tuneThreshold(mine, current[key], ACCEPT_RANGE[key]);
    labeled[key] = mine.filter(r => r.final).length;
    if (!tuned) { notes.push(`${key}: ${labeled[key]} labelled attempts, not enough to tune; stays ${current[key]}`); continue; }
    accept[key] = tuned.value;
    notes.push(`${key}: ${current[key]} -> ${tuned.value} (${tuned.labeled} with a guess; at the new value ${tuned.right} right, ${tuned.wrong} wrong shown)`);
  }
  const all = tally(rows), pct = v => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
  log(`engine ${ENGINE_VERSION}: ${all.attempts} attempts in ${days} days · shown ${pct(readRate(all))} · right of saved ${pct(rightRate(all))} · wrong of shown ${pct(wrongRate(all))}`);
  for (const n of notes) log('  ' + n);
  const changed = Object.keys(ACCEPT).some(k => accept[k] !== current[k]);
  if (write) await db.doc('appConfig/scanTuning').set({ engine: ENGINE_VERSION, accept, labeled, attempts: all.attempts, updatedAt: now, changed });
  // Retention: pictures older than a year go; the small numeric record stays for long-term trends.
  const old = await db.collection('scanImages').where('createdAt', '<', now - RETENTION_DAYS * 86_400_000).limit(2000).get();
  if (write) for (let i = 0; i < old.docs.length; i += 400) { const batch = db.batch(); old.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref)); await batch.commit(); }
  log(`${write ? 'deleted' : 'would delete'} ${old.size} scan pictures older than ${RETENTION_DAYS} days${write ? '' : ' (dry run: nothing written)'}`);
  return { accept, labeled, changed, attempts: all.attempts, expired: old.size };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('learn.mjs')) {
  const { initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const key = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!key && !process.env.FIRESTORE_EMULATOR_HOST) { console.error('FIREBASE_SERVICE_ACCOUNT is not set (see .github/workflows/fuel-prices.yml for the one-time setup).'); process.exit(1); }
  initializeApp(key ? { credential: cert(JSON.parse(key)) } : { credential: applicationDefault(), projectId: process.env.GCLOUD_PROJECT });
  await learn(getFirestore(), { write: !dryRun });
}
