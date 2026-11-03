import {
  doc, getDocFromCache, getDocFromServer, runTransaction, waitForPendingWrites,
  type DocumentReference, type Firestore,
} from 'firebase/firestore';
import {
  collectionOf, reconcileWithServer,
  type Outbox, type OutboxOperation, type OutboxPayload, type ReconcileVerdict,
} from './outbox';
import {
  assertMutationScope, decodeRawDocument, encodeRawDocument,
  hasRawDocumentEnvelope, rawDocumentMatches,
} from './rawDocument';
import { immutableRawImage } from './recordUndo';
import {
  VEHICLE_COLLECTIONS, decodeVehicleRecord, validVehicleRecord,
  type VehicleCollection, type VehicleRecord,
} from './vehicle/model';
import { requireRestorableVehicle } from './vehicleRestoreGuard';
import { FillupConflictError } from './writesConditional';

export type RecordCollection = VehicleCollection | 'observations';
export type RecordWriteResult = 'deleted' | 'already-absent' | 'restored' | 'already-present';

function unverified(): Error & { code: string } {
  return Object.assign(new Error('לא ניתן לאמת את הרשומה שנבחרה — יש לפתוח אותה מחדש'), { code: 'record-unverified' });
}

function changed(): Error & { code: string } {
  return Object.assign(new Error('הפעולה השתנתה — הפרטים נשמרו לבדיקה'), { code: 'record-operation-changed' });
}

/** Legacy observation deletes have no reliable base and may not replay blindly. */
export function isRecordUndoOperation(operation: OutboxOperation): boolean {
  return operation.kind === 'tank.observation.delete' ||
    ((operation.kind === 'tank.observation' || operation.kind.startsWith('maintenance.')) &&
      [operation.payload, operation.beforeImage, operation.serverImage].some(hasRawDocumentEnvelope));
}

function recordCollection(operation: OutboxOperation): RecordCollection {
  const parts = operation.path.split('/');
  if (parts.length !== 6 || parts[0] !== 'users' || parts[1] !== operation.uid ||
      parts[2] !== 'vehicles' || !operation.vehicleId || parts[3] !== operation.vehicleId ||
      !parts[5] || parts[5] !== operation.docId) throw unverified();
  const name = parts[4];
  const deleting = operation.opType === 'delete';
  if (name === 'observations') {
    if (operation.kind !== (deleting ? 'tank.observation.delete' : 'tank.observation')) throw unverified();
    return name;
  }
  if (!(VEHICLE_COLLECTIONS as readonly string[]).includes(name) ||
      operation.kind !== (deleting ? 'maintenance.delete' : 'maintenance.save')) throw unverified();
  return name as VehicleCollection;
}

function decodedImage(image: OutboxPayload | null): OutboxPayload | null {
  if (image === null) return null;
  if (!hasRawDocumentEnvelope(image)) throw unverified();
  return decodeRawDocument(image);
}

function decodedOperation(operation: OutboxOperation): OutboxOperation {
  recordCollection(operation);
  const payload = decodedImage(operation.payload);
  const beforeImage = decodedImage(operation.beforeImage);
  if (operation.opType === 'delete' ? payload !== null || beforeImage === null :
      payload === null || (operation.opType === 'update' && beforeImage === null)) throw unverified();
  return { ...operation, payload, beforeImage };
}

function sameAttempt(current: OutboxOperation, captured: OutboxOperation): boolean {
  return current.opId === captured.opId && current.uid === captured.uid && current.vehicleId === captured.vehicleId &&
    current.path === captured.path && current.kind === captured.kind && current.opType === captured.opType &&
    current.version === captured.version && current.revision === captured.revision &&
    rawDocumentMatches(current.payload, captured.payload) && rawDocumentMatches(current.beforeImage, captured.beforeImage);
}

/** Other unresolved input for this exact document must be resolved first. */
export async function assertRecordUncontended(outbox: Outbox, path: string, own?: OutboxOperation): Promise<void> {
  const operations = await outbox.list();
  if (operations.some(operation => operation.path === path && operation.opId !== own?.opId)) {
    throw Object.assign(new Error('לרשומה הזאת יש שינויים שממתינים לבדיקה — יש להשלים אותם קודם'), { code: 'record-write-pending' });
  }
}

async function assertCurrentAttempt(outbox: Outbox, operation: OutboxOperation, stillCurrent: () => boolean): Promise<void> {
  assertMutationScope(stillCurrent);
  const current = await outbox.get(operation.opId);
  assertMutationScope(stillCurrent);
  if (!current || current.status !== 'pending' || !sameAttempt(current, operation)) throw changed();
  await assertRecordUncontended(outbox, operation.path, operation);
  assertMutationScope(stillCurrent);
}

/** Decode only for comparison; retain the original JSON strings and raw fields. */
export async function captureCareImage(
  ref: DocumentReference,
  name: VehicleCollection,
  record: VehicleRecord,
  stillCurrent: () => boolean,
): Promise<OutboxPayload> {
  assertMutationScope(stillCurrent);
  const selected = decodeRawDocument(encodeRawDocument(record as unknown as OutboxPayload));
  if (!validVehicleRecord(name, selected) || selected.id !== ref.id) throw unverified();
  const snapshot = await getDocFromCache(ref);
  assertMutationScope(stillCurrent);
  if (!snapshot.exists() || snapshot.metadata.hasPendingWrites) throw unverified();
  const raw = snapshot.data();
  const displayed = decodeVehicleRecord(name, { ...raw, id: ref.id });
  if (!validVehicleRecord(name, displayed) || !rawDocumentMatches(selected, displayed)) throw unverified();
  return immutableRawImage(raw);
}

/** Care create rules require version 1; every other original field is unchanged. */
export function recordRestoreImage(before: OutboxPayload, collection: RecordCollection): OutboxPayload {
  const raw = decodedImage(before);
  if (!raw) throw unverified();
  return immutableRawImage(collection === 'observations' ? raw : { ...raw, version: 1 });
}

/**
 * Called after commit, before resolving the receipt or granting Undo. The
 * general submit wrapper's later duplicate ACK is harmless, but is not proof
 * on which this wrapper relies.
 */
async function retireAttempt(outbox: Outbox, operation: OutboxOperation, stillCurrent: () => boolean): Promise<void> {
  assertMutationScope(stillCurrent);
  await assertRecordUncontended(outbox, operation.path, operation);
  const current = await outbox.get(operation.opId);
  assertMutationScope(stillCurrent);
  if (!current) return; // The exact server outcome was also acknowledged elsewhere.
  if (current.status === 'conflict' || !sameAttempt(current, operation)) throw changed();
  if (!await outbox.acknowledge(operation.opId, operation.version) && await outbox.get(operation.opId)) throw changed();
  assertMutationScope(stillCurrent);
}

/** Exact same-ID conditional deletion/restoration; no ordinary care save uses it. */
export async function writeRecordOperation(
  db: Firestore,
  outbox: Outbox,
  operation: OutboxOperation,
  stillCurrent: () => boolean,
): Promise<RecordWriteResult> {
  const decoded = decodedOperation(operation);
  await assertCurrentAttempt(outbox, operation, stillCurrent);
  // A previously queued SDK write must not arrive after this conditional delete.
  // Offline work remains journaled while this barrier waits for acknowledgement.
  await waitForPendingWrites(db);
  await assertCurrentAttempt(outbox, operation, stillCurrent);
  const ref = doc(db, operation.path);
  const result = await runTransaction(db, async transaction => {
    await assertCurrentAttempt(outbox, operation, stillCurrent);
    if (operation.opType !== 'delete') await requireRestorableVehicle(transaction, ref, stillCurrent);
    const snapshot = await transaction.get(ref);
    assertMutationScope(stillCurrent);
    const server = snapshot.exists() ? snapshot.data() : null;
    await assertCurrentAttempt(outbox, operation, stillCurrent);
    const conflict = () => new FillupConflictError(server === null ? null : encodeRawDocument(server));
    if (operation.opType === 'delete') {
      if (!server) return 'already-absent' as const;
      if (!rawDocumentMatches(decoded.beforeImage, server)) throw conflict();
      transaction.delete(ref);
      return 'deleted' as const;
    }
    if (server && rawDocumentMatches(decoded.payload, server)) return 'already-present' as const;
    // A crash may occur after explicit conflict rebase but before the outbox
    // changes set → update. Its exact non-null base still requires an existing
    // unchanged document; it never authorizes recreating a newly absent one.
    const creating = operation.opType === 'set' && decoded.beforeImage === null;
    if (creating ? server !== null : !server || !rawDocumentMatches(decoded.beforeImage, server)) throw conflict();
    transaction.set(ref, decoded.payload!);
    return 'restored' as const;
  });
  await retireAttempt(outbox, operation, stillCurrent);
  return result;
}

/** The outbox comparator must see the care version inside the decoded document. */
export function recordReconciliationVerdicts(
  operation: OutboxOperation,
  server: OutboxPayload | null,
): ReconcileVerdict[] {
  const decoded = decodedOperation(operation);
  if (operation.status === 'conflict') return [];
  if (operation.opType === 'delete' && server === null) {
    return [{ opId: operation.opId, version: operation.version, verdict: 'synced' }];
  }
  return reconcileWithServer([decoded], collectionOf(operation.path), server
    ? [{ id: operation.docId, data: server, hasPendingWrites: false }] : [], rawDocumentMatches)
    .map(verdict => verdict.verdict === 'conflict'
      ? { ...verdict, serverImage: verdict.serverImage === null ? null : encodeRawDocument(verdict.serverImage) } : verdict);
}

const reconciling = new WeakMap<Outbox, Set<string>>();

/** Listener snapshots trigger a fresh read; they are never a newer input's base. */
export async function reconcileRecordOperation(
  db: Firestore,
  outbox: Outbox,
  captured: OutboxOperation,
  stillCurrent: () => boolean,
): Promise<boolean> {
  if (!isRecordUndoOperation(captured) || captured.status === 'conflict') return false;
  const active = reconciling.get(outbox) ?? new Set<string>();
  reconciling.set(outbox, active);
  const key = `${captured.opId}:${captured.version}`;
  if (active.has(key)) return false;
  active.add(key);
  try {
    assertMutationScope(stillCurrent);
    await waitForPendingWrites(db);
    assertMutationScope(stillCurrent);
    const snapshot = await getDocFromServer(doc(db, captured.path));
    if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return false;
    assertMutationScope(stillCurrent);
    const current = await outbox.get(captured.opId);
    if (!current || current.version !== captured.version || current.status === 'conflict') return true;
    if (!sameAttempt(current, captured)) return false;
    await assertRecordUncontended(outbox, captured.path, captured);
    assertMutationScope(stillCurrent);
    const verdicts = recordReconciliationVerdicts(current, snapshot.exists() ? snapshot.data() : null);
    for (const verdict of verdicts) {
      const latest = await outbox.get(captured.opId);
      assertMutationScope(stillCurrent);
      if (!latest || latest.status === 'conflict' || !sameAttempt(latest, captured)) return true;
      if (verdict.verdict === 'synced') await outbox.acknowledge(verdict.opId, verdict.version);
      else if (verdict.verdict === 'conflict') await outbox.markConflict(verdict.opId, verdict.version, verdict.serverImage);
      else if (verdict.verdict === 'unconfirmed') await outbox.fail(verdict.opId, verdict.version, {
        code: 'unconfirmed', message: verdict.reason, at: Date.now(),
      });
    }
    return verdicts.length > 0;
  } catch {
    // Unreadable raw data, offline transport, storage or a changed scope cannot
    // justify erasing an operation or inventing an acknowledged deletion.
    return false;
  } finally {
    active.delete(key);
  }
}

/** A conflict rebase replaces the codec node, never adds an outer `version`. */
export function recordConflictPayloadPatch(operation: OutboxOperation): OutboxPayload {
  const name = recordCollection(operation);
  const decoded = decodedOperation(operation);
  const server = decodedImage(operation.serverImage ?? null);
  if (!server) throw unverified();
  if (decoded.payload === null) return {};
  if (name === 'observations') return encodeRawDocument(decoded.payload);
  if (typeof server.version !== 'number' || !Number.isSafeInteger(server.version) || server.version < 1 || server.version >= 1_000_000_000) throw unverified();
  return encodeRawDocument({ ...decoded.payload, version: server.version + 1 });
}
