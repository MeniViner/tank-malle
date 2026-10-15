import {
  collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, query,
  setDoc, where, writeBatch, type Firestore, type Query,
} from "firebase/firestore";
import { withdrawBenchmark } from "./benchmarks";

export interface DeletionResult {
  ok: boolean;
  deleted: string[];
  failed: string[];
  needsReauth?: boolean;
}

const deletionKey = (uid: string) => `tm.deleting.${uid}`;
export function isAccountDeleting(uid: string): boolean {
  try { return localStorage.getItem(deletionKey(uid)) === "1"; } catch { return false; }
}
export function markAccountDeleting(uid: string): void {
  localStorage.setItem(deletionKey(uid), "1");
}
export function clearAccountLocalStorage(uid: string): void {
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
  for (const key of keys) {
    if (key && ((key.startsWith("tm.cache.v") && key.includes(`.${uid}.`)) ||
      key.startsWith(`tm.fillup-draft.v1.${uid}.`))) localStorage.removeItem(key);
  }
}
export function finishAccountDeletion(uid: string): void {
  localStorage.removeItem(deletionKey(uid));
}

/** Server-only reads: an empty offline cache is never proof of erasure. */
export async function eraseQuery(db: Firestore, target: Query): Promise<void> {
  const snapshot = await getDocsFromServer(target);
  for (let i = 0; i < snapshot.docs.length; i += 400) {
    const batch = writeBatch(db);
    snapshot.docs.slice(i, i + 400).forEach((entry) => batch.delete(entry.ref));
    await batch.commit();
  }
  if (!(await getDocsFromServer(target)).empty) throw new Error("deletion-not-confirmed");
}

/** All steps are retryable. The identity is retained on ANY failed prerequisite. */
export async function runAccountDeletion(steps: {
  reauthenticate: () => Promise<boolean>;
  preflight: () => Promise<void>;
  data: { label: string; run: () => Promise<void> }[];
  profile: () => Promise<void>;
  local: () => Promise<void>;
  identity: () => Promise<void>;
}): Promise<DeletionResult> {
  const deleted: string[] = [];
  try {
    if (!(await steps.reauthenticate())) return { ok: false, deleted, failed: [], needsReauth: true };
  } catch { return { ok: false, deleted, failed: [], needsReauth: true }; }
  for (const step of [
    { label: "pending-writes", run: steps.preflight }, ...steps.data,
    { label: "profile", run: steps.profile }, { label: "local-cache", run: steps.local },
    { label: "auth", run: steps.identity },
  ]) {
    try { await step.run(); if (step.label !== "pending-writes") deleted.push(step.label); }
    catch { return { ok: false, deleted, failed: [step.label] }; }
  }
  return { ok: true, deleted, failed: [] };
}

export function accountDataDeletionSteps(db: Firestore, uid: string) {
  return [
    // A server-side guard prevents other open tabs from adding new personal
    // records while the bounded deletion walks the account's collections.
    { label: "deletion-lock", run: () => setDoc(doc(db, "users", uid), { deletionPending: true }, { merge: true }) },
    { label: "vehicles", run: async () => {
      const vehicles = await getDocsFromServer(collection(db, "users", uid, "vehicles"));
      for (const vehicle of vehicles.docs) {
        for (const name of ["fillups", "observations", "tankPlans"]) await eraseQuery(db, collection(vehicle.ref, name));
        await deleteDoc(vehicle.ref);
      }
      if (!(await getDocsFromServer(collection(db, "users", uid, "vehicles"))).empty) throw new Error("vehicles-remain");
    } },
    ...["stationPriceReports", "personalPriceRules", "importBatches"].map((name) => ({
      label: name, run: () => eraseQuery(db, collection(db, "users", uid, name)),
    })),
    { label: "benchmark", run: () => withdrawBenchmark(uid, [], db) },
    { label: "summary", run: async () => {
      const ref = doc(db, "userSummaries", uid);
      await deleteDoc(ref);
      if ((await getDocFromServer(ref)).exists()) throw new Error("summary-remains");
    } },
    { label: "feedback", run: () => eraseQuery(db, query(collection(db, "feedback"), where("uid", "==", uid))) },
  ];
}
