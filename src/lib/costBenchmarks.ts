import { collection, doc, documentId, getDocFromServer, getDocsFromServer, limit, query, runTransaction, serverTimestamp, where, type Firestore } from 'firebase/firestore';
import { db } from './firebase';
import type { Vehicle } from './types';
import type { TcoResult } from './tco';
import { rawDocumentMatches } from './rawDocument';
import { toEpochMillis } from './fillupSerializer';
import { benchmarkDocId, modelKey } from './benchmarkIdentity';
import { compareCosts, costBenchmark } from './costBenchmarkModel';

export const COST_COLLECTION = 'costBenchmarks';
const ownedCosts = (database: Firestore, uid: string) => query(collection(database, COST_COLLECTION),
  where(documentId(), '>=', `${uid}__`), where(documentId(), '<', `${uid}__\uf8ff`));

/** Transactions never queue a financial publication offline; consent is read from the server. */
export async function publishCostBenchmark(uid: string, vehicle: Vehicle, tco: TcoResult, isCurrent: () => boolean, database: Firestore = db): Promise<boolean> {
  const payload = costBenchmark(vehicle, tco);
  if (!payload || !isCurrent()) return false;
  return runTransaction(database, async transaction => {
    const profile = await transaction.get(doc(database, 'users', uid));
    const source = await transaction.get(doc(database, 'users', uid, 'vehicles', vehicle.id));
    const account = profile.data(), current = source.data();
    if (!isCurrent() || !source.exists() || account?.settings?.shareTcoBenchmarks !== true || account?.deletionPending === true
      || typeof current?.make !== 'string' || typeof current?.model !== 'string' || ('archived' in current && current.archived !== false) || current?.deletionPending === true || current?.fuelType !== vehicle.fuelType
      || modelKey(current as Vehicle) !== payload.modelKey || !rawDocumentMatches(current?.docs, vehicle.docs)) return false;
    // Old PWAs do not know this collection. Preserve a private marker so Rules
    // require the new erasure protocol before an account can be deleted.
    if (account?.costSharingUsed !== true) transaction.set(doc(database, 'users', uid), { costSharingUsed: true }, { merge: true });
    transaction.set(doc(database, COST_COLLECTION, benchmarkDocId(uid, vehicle.id)), { ...payload, updatedAt: serverTimestamp() });
    return true;
  });
}

/** Server readback + transaction consent check prevent a late withdrawal deleting a newly opted-in summary. */
export async function withdrawCostBenchmarks(uid: string, database: Firestore = db): Promise<boolean> {
  const target = ownedCosts(database, uid);
  const owned = (row: { id: string; data: () => Record<string, unknown> }) => typeof row.data().vehicleId === 'string' && benchmarkDocId(uid, row.data().vehicleId as string) === row.id;
  const rows = (await getDocsFromServer(target)).docs.filter(owned);
  // Each delete may perform a Rules ownership lookup; stay below the batch access-call budget.
  for (let i = 0; i < rows.length; i += 10) {
    const removed = await runTransaction(database, async transaction => {
      const profile = await transaction.get(doc(database, 'users', uid));
      if (profile.data()?.settings?.shareTcoBenchmarks === true && profile.data()?.deletionPending !== true) return false;
      rows.slice(i, i + 10).forEach(row => transaction.delete(row.ref));
      return true;
    });
    if (!removed) return false;
  }
  const profile = await getDocFromServer(doc(database, 'users', uid));
  if (profile.data()?.settings?.shareTcoBenchmarks === true && profile.data()?.deletionPending !== true) return false;
  if ((await getDocsFromServer(target)).docs.some(owned)) throw new Error('הסרת סיכומי העלות טרם אושרה מהשרת');
  return true;
}

export async function withdrawVehicleCost(uid: string, vehicleId: string, database: Firestore = db, isCurrent = () => true): Promise<void> {
  const ref = doc(database, COST_COLLECTION, benchmarkDocId(uid, vehicleId));
  await runTransaction(database, async transaction => {
    const row = await transaction.get(ref);
    if (isCurrent() && row.exists()) transaction.delete(ref);
  });
  if (isCurrent() && (await getDocFromServer(ref)).exists()) throw new Error('הסרת סיכום עלות הרכב טרם אושרה');
}

export async function fetchCostComparison(uid: string, vehicle: Vehicle, monthly: number | null, database: Firestore = db) {
  const snapshot = await getDocsFromServer(query(collection(database, COST_COLLECTION), where('modelKey', '==', modelKey(vehicle)), limit(120)));
  return compareCosts(uid, vehicle, monthly, snapshot.docs.map(row => ({ ...row.data(), id: row.id, updatedAt: toEpochMillis(row.data().updatedAt) })), Date.now());
}
