import { doc, getDocFromServer, runTransaction, waitForPendingWrites, type Firestore } from 'firebase/firestore';
import type { Outbox, OutboxOperation, OutboxPayload } from './outbox';
import type { Vehicle } from './types';
import { assertMutationScope, decodeRawDocument, hasRawDocumentEnvelope, rawDocumentMatches } from './rawDocument';
import { immutableRawImage } from './recordUndo';
import { FillupConflictError } from './writesConditional';
import { assertVehicleAttempt, retireVehicleAttempt, sameVehicleAttempt, vehicleWriteError, failUnverifiableVehicleAttempt } from './vehicleWriteAttempt';
import {
  VEHICLE_DOC_KEYS, isVehicleDocMap, validVehicleDocChanges,
  type VehicleDocKey, type VehicleDocChanges, type VehicleDocumentSnapshot,
} from './vehicle/documents';

const IDENTITY = ['make', 'model', 'fuelType', 'year', 'plateNumber', 'tozeretCd', 'degemCd', 'createdAt'] as const;
const INTENT = 'vehicle-document-intent';
const BASE = 'vehicle-document-base';
const has = (value: OutboxPayload, key: string) => Object.hasOwn(value, key);
const keyValid = (value: unknown): value is VehicleDocKey => typeof value === 'string' && (VEHICLE_DOC_KEYS as readonly string[]).includes(value);
const unverified = () => vehicleWriteError('vehicle-document-unverified', 'לא ניתן לאמת את מסמך הרכב — הפרטים נשמרו לבדיקה');
type Presence = { present: false } | { present: true; value: OutboxPayload | null };

export interface VehicleDocumentGuard {
  tag: typeof BASE;
  schemaVersion: 1;
  key: VehicleDocKey;
  identity: OutboxPayload;
  container: 'missing' | 'null' | 'map';
  selected: Presence;
  deleting: boolean;
}
interface DocumentIntent { key: VehicleDocKey; changes: OutboxPayload }
export type VehicleDocumentImages = Readonly<Partial<Record<VehicleDocKey, OutboxPayload>>>;

/** Only raw identity fields; unrelated future siblings never enter the codec. */
export function rawVehicleIdentity(raw: OutboxPayload): OutboxPayload {
  if (typeof raw.make !== 'string' || !raw.make || typeof raw.model !== 'string' ||
      typeof raw.fuelType !== 'string' || !['95', '98', 'diesel', 'other'].includes(raw.fuelType)) throw unverified();
  return Object.fromEntries(IDENTITY.filter(field => has(raw, field)).map(field => [field, raw[field]]));
}

export function vehicleDocumentGuard(raw: OutboxPayload, key: VehicleDocKey): VehicleDocumentGuard {
  const docs = raw.docs;
  const container = !has(raw, 'docs') ? 'missing' : docs === null ? 'null' : isVehicleDocMap(docs) ? 'map' : null;
  if (!container) throw unverified();
  let selected: Presence = { present: false };
  if (container === 'map' && isVehicleDocMap(docs) && has(docs, key)) {
    if (docs[key] !== null && !isVehicleDocMap(docs[key])) throw unverified();
    selected = { present: true, value: docs[key] as OutboxPayload | null };
  }
  return { tag: BASE, schemaVersion: 1, key, identity: rawVehicleIdentity(raw), container, selected,
    deleting: raw.deletionPending === true };
}

/** Each key can remain writable even when another sibling has unsupported values. */
export function captureVehicleDocumentImages(raw: OutboxPayload): VehicleDocumentImages {
  const images: Partial<Record<VehicleDocKey, OutboxPayload>> = {};
  for (const key of VEHICLE_DOC_KEYS) {
    try { images[key] = immutableRawImage(vehicleDocumentGuard(raw, key) as unknown as OutboxPayload); }
    catch { /* This key is unavailable; no placeholder base is invented. */ }
  }
  return Object.freeze(images);
}

interface CapturedDocument {
  vehicleId: string;
  key: VehicleDocKey;
  beforeImage: OutboxPayload;
  isCurrent: () => boolean;
}
const captures = new WeakMap<VehicleDocumentSnapshot, CapturedDocument>();

export function createVehicleDocumentCapture(source: {
  records: readonly Vehicle[];
  images: ReadonlyMap<string, VehicleDocumentImages>;
  pendingIds: ReadonlySet<string>;
  vehicleId: string | null;
}, isCurrent: () => boolean) {
  return <K extends VehicleDocKey>(record: Vehicle, key: K): VehicleDocumentSnapshot<K> | null => {
    if (!isCurrent() || !keyValid(key) || source.vehicleId !== record.id || !source.records.includes(record) ||
        source.pendingIds.has(record.id) || record.deletionPending) return null;
    const beforeImage = source.images.get(record.id)?.[key];
    if (!beforeImage) return null;
    const token = Object.freeze({ vehicleId: record.id, key }) as VehicleDocumentSnapshot<K>;
    captures.set(token, { vehicleId: record.id, key, beforeImage, isCurrent });
    return token;
  };
}

export function readVehicleDocumentCapture<K extends VehicleDocKey>(
  token: VehicleDocumentSnapshot<K>, vehicleId: string, key: K,
): CapturedDocument {
  const captured = captures.get(token);
  if (!captured || captured.vehicleId !== vehicleId || captured.key !== key) throw unverified();
  assertMutationScope(captured.isCurrent);
  return captured;
}

export function vehicleDocumentIntent<K extends VehicleDocKey>(key: K, changes: VehicleDocChanges<K>): OutboxPayload {
  if (!keyValid(key) || !validVehicleDocChanges(key, changes)) {
    throw vehicleWriteError('vehicle-document-invalid', 'פרטי המסמך אינם תקינים או שלא נבחר שינוי');
  }
  return immutableRawImage({ tag: INTENT, schemaVersion: 1, key, changes });
}

function decodeImage(image: OutboxPayload | null | undefined): OutboxPayload {
  if (!image || !hasRawDocumentEnvelope(image)) throw unverified();
  return decodeRawDocument(image);
}
function exactKeys(value: OutboxPayload, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => has(value, key));
}
function readGuard(image: OutboxPayload | null | undefined): VehicleDocumentGuard {
  const value = decodeImage(image);
  if (!exactKeys(value, ['tag', 'schemaVersion', 'key', 'identity', 'container', 'selected', 'deleting']) ||
      value.tag !== BASE || value.schemaVersion !== 1 || !keyValid(value.key) ||
      !isVehicleDocMap(value.identity) || !rawDocumentMatches(rawVehicleIdentity(value.identity), value.identity) ||
      typeof value.container !== 'string' || !['missing', 'null', 'map'].includes(value.container) || typeof value.deleting !== 'boolean' ||
      !isVehicleDocMap(value.selected)) throw unverified();
  const selected = value.selected;
  if (selected.present === false ? !exactKeys(selected, ['present']) : selected.present !== true ||
      !exactKeys(selected, ['present', 'value']) || (selected.value !== null && !isVehicleDocMap(selected.value))) throw unverified();
  if (value.container !== 'map' && selected.present) throw unverified();
  return value as unknown as VehicleDocumentGuard;
}
function readIntent(image: OutboxPayload | null): DocumentIntent {
  const value = decodeImage(image);
  if (!exactKeys(value, ['tag', 'schemaVersion', 'key', 'changes']) || value.tag !== INTENT || value.schemaVersion !== 1 ||
      !keyValid(value.key) || !validVehicleDocChanges(value.key, value.changes)) throw unverified();
  return { key: value.key, changes: value.changes };
}

/** Candidate detection must also quarantine malformed envelopes and old direct writes. */
export function isVehicleDocumentOperation(operation: OutboxOperation): boolean {
  return operation.kind === 'vehicle.update' && (
    [operation.payload, operation.beforeImage, operation.serverImage].some(hasRawDocumentEnvelope) ||
    !!operation.payload && Object.keys(operation.payload).some(key => key === 'docs' || key.startsWith('docs.')));
}
function readOperation(operation: OutboxOperation) {
  const expected = `users/${operation.uid}/vehicles/${operation.vehicleId}`;
  if (operation.kind !== 'vehicle.update' || operation.opType !== 'update' || !operation.uid || !operation.vehicleId ||
      operation.uid.includes('/') || operation.vehicleId.includes('/') || operation.path !== expected ||
      operation.docId !== operation.vehicleId || operation.docKey !== `${operation.uid}|${expected}`) throw unverified();
  const intent = readIntent(operation.payload), before = readGuard(operation.beforeImage);
  if (before.key !== intent.key || before.deleting) throw unverified();
  return { intent, before };
}
function selectedMap(guard: VehicleDocumentGuard): OutboxPayload {
  return guard.selected.present && guard.selected.value !== null ? guard.selected.value : {};
}
function target(before: VehicleDocumentGuard, intent: DocumentIntent): VehicleDocumentGuard {
  return { ...before, container: 'map', selected: { present: true, value: { ...selectedMap(before), ...intent.changes } } };
}
function sameSelected(left: VehicleDocumentGuard, right: VehicleDocumentGuard): boolean {
  return left.key === right.key && left.deleting === right.deleting && rawDocumentMatches(left.identity, right.identity) &&
    (left.container === 'null' || right.container === 'null' ? left.container === right.container : true) &&
    rawDocumentMatches(left.selected, right.selected);
}

/** Display-only intent; raw capture images and the conditional server write stay unchanged. */
export function vehicleDocumentView(operation: OutboxOperation, images: VehicleDocumentImages) {
  if (operation.status !== 'pending') return null;
  try {
    const { intent, before } = readOperation(operation);
    const image = images[intent.key];
    if (!image) return null;
    const current = readGuard(image), desired = target(before, intent);
    if (!sameSelected(current, before) && !sameSelected(current, desired)) return null;
    return { key: intent.key, value: desired.selected.present ? desired.selected.value : null,
      image: immutableRawImage(desired as unknown as OutboxPayload), applied: sameSelected(current, desired) };
  } catch { return null; }
}

export function projectVehicleDocuments(uid: string, vehicle: Vehicle, images: VehicleDocumentImages, operations: readonly OutboxOperation[]): Vehicle {
  const path = `users/${uid}/vehicles/${vehicle.id}`;
  const candidates = operations.filter(operation => operation.uid === uid && operation.vehicleId === vehicle.id &&
    operation.path === path && isVehicleDocumentOperation(operation));
  const views = candidates.map(operation => ({ operation, view: vehicleDocumentView(operation, images) }));
  let result = vehicle;
  for (const { operation, view } of views) {
    if (!view || view.applied || candidates.some(other => {
      if (other.opId === operation.opId) return false;
      try { return readOperation(other).intent.key === view.key; } catch { return true; }
    })) continue;
    result = { ...result, docs: { ...(isVehicleDocMap(result.docs) ? result.docs : {}), [view.key]: view.value } };
  }
  return result;
}

function checkNeighbors(operation: OutboxOperation, key: VehicleDocKey, operations: readonly OutboxOperation[]): void {
  for (const other of operations) {
    if (other.opId === operation.opId || other.path !== operation.path) continue;
    if (isVehicleDocumentOperation(other)) {
      let otherKey: VehicleDocKey;
      try { otherKey = readOperation(other).intent.key; } catch { throw unverified(); }
      if (otherKey !== key) continue;
    } else if (other.kind === 'vehicle.update' && other.opType === 'update') continue;
    throw vehicleWriteError('vehicle-document-pending', 'למסמך הזה יש שינוי שממתין לבדיקה');
  }
}

export async function writeVehicleDocumentOperation(
  db: Firestore, outbox: Outbox, operation: OutboxOperation, isCurrent: () => boolean,
  onCommitted?: () => void,
): Promise<void> {
  const { intent, before } = readOperation(operation);
  const neighbors = (all: readonly OutboxOperation[]) => checkNeighbors(operation, intent.key, all);
  await assertVehicleAttempt(outbox, operation, isCurrent, neighbors);
  await waitForPendingWrites(db);
  await assertVehicleAttempt(outbox, operation, isCurrent, neighbors);
  const desired = target(before, intent);
  await runTransaction(db, async transaction => {
    const ref = doc(db, operation.path), snapshot = await transaction.get(ref);
    await assertVehicleAttempt(outbox, operation, isCurrent, neighbors);
    if (!snapshot.exists()) throw new FillupConflictError(null);
    const server = vehicleDocumentGuard(snapshot.data(), intent.key);
    const conflict = () => new FillupConflictError(immutableRawImage(server as unknown as OutboxPayload));
    if (server.deleting) throw conflict();
    if (sameSelected(desired, server)) return;
    if (!sameSelected(before, server)) throw conflict();
    transaction.update(ref, { [`docs.${intent.key}`]: desired.selected.present ? desired.selected.value : null });
  });
  // Publish the acknowledged view before retiring its optimistic journal view.
  // This also covers a lagging collection listener without a manual reload.
  if (isCurrent()) onCommitted?.();
  await retireVehicleAttempt(outbox, operation, isCurrent);
}

const reconciling = new WeakMap<Outbox, Set<string>>();
export async function reconcileVehicleDocumentOperation(
  db: Firestore, outbox: Outbox, operation: OutboxOperation, isCurrent: () => boolean,
): Promise<boolean> {
  if (!isVehicleDocumentOperation(operation) || operation.status === 'conflict') return false;
  const active = reconciling.get(outbox) ?? new Set<string>(); reconciling.set(outbox, active);
  const token = `${operation.opId}:${operation.version}`;
  if (active.has(token)) return false;
  active.add(token);
  try {
    const { intent, before } = readOperation(operation);
    assertMutationScope(isCurrent);
    await waitForPendingWrites(db);
    assertMutationScope(isCurrent);
    const snapshot = await getDocFromServer(doc(db, operation.path));
    if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return false;
    const all = await outbox.list();
    checkNeighbors(operation, intent.key, all);
    const current = await outbox.get(operation.opId);
    assertMutationScope(isCurrent);
    if (!current || current.status === 'conflict' || !sameVehicleAttempt(current, operation)) return true;
    if (!snapshot.exists()) { await outbox.markConflict(current.opId, current.version, null); return true; }
    const server = vehicleDocumentGuard(snapshot.data(), intent.key);
    if (sameSelected(target(before, intent), server)) await outbox.acknowledge(current.opId, current.version);
    else if (sameSelected(before, server)) await outbox.fail(current.opId, current.version, {
      code: 'unconfirmed', message: 'שינוי המסמך לא אושר — אפשר לנסות שוב', at: Date.now(),
    });
    else await outbox.markConflict(current.opId, current.version, immutableRawImage(server as unknown as OutboxPayload));
    return true;
  } catch (error) { return failUnverifiableVehicleAttempt(outbox, operation, isCurrent, error); }
  finally { active.delete(token); }
}

/** Explicit rebase retains authored changes and learns only this verified parent's current child. */
export function canRebaseVehicleDocumentOperation(operation: OutboxOperation): boolean {
  try {
    const { before, intent } = readOperation(operation), server = readGuard(operation.serverImage);
    return !server.deleting && server.key === intent.key && rawDocumentMatches(before.identity, server.identity);
  } catch { return false; }
}

/** Compare the actual journal image inside its readwrite transaction, before changing any base. */
export async function rebaseVehicleDocumentOperation(
  outbox: Outbox, reviewed: OutboxOperation, isCurrent: () => boolean,
): Promise<OutboxOperation> {
  const captured = structuredClone(reviewed);
  const changed = () => vehicleWriteError('vehicle-conflict-changed', 'ההתנגשות השתנתה — יש לפתוח מחדש את הפרטים לפני החלפת הגרסה');
  assertMutationScope(isCurrent);
  if (captured.status !== 'conflict' || !captured.serverImage || !canRebaseVehicleDocumentOperation(captured)) throw changed();
  let rebased: OutboxOperation | null;
  try {
    rebased = await outbox.rebase(captured.opId, captured.serverImage, {}, actual =>
      isCurrent() && actual.status === 'conflict' && sameVehicleAttempt(actual, captured) &&
      rawDocumentMatches(actual.serverImage, captured.serverImage) && canRebaseVehicleDocumentOperation(actual));
  } catch { throw changed(); }
  if (!rebased) throw changed();
  assertMutationScope(isCurrent);
  return rebased;
}

export function vehicleDocumentDisplay(operation: OutboxOperation): {
  key: VehicleDocKey; mine: OutboxPayload; before: OutboxPayload; server: OutboxPayload | null; canOverwrite: boolean;
} {
  const { intent, before } = readOperation(operation);
  const server = operation.serverImage === null || operation.serverImage === undefined ? null : readGuard(operation.serverImage);
  const canOverwrite = operation.status === 'conflict' && canRebaseVehicleDocumentOperation(operation);
  const display = (guard: VehicleDocumentGuard): OutboxPayload => guard.selected.present && guard.selected.value !== null
    ? guard.selected.value : { documentPresence: !guard.selected.present ? (guard.container === 'null' ? 'null-container' : 'missing') : 'null' };
  return { key: intent.key, mine: display(target(canOverwrite && server ? server : before, intent)),
    before: display(before), server: server ? display(server) : null, canOverwrite };
}
