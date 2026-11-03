import { doc, getDocFromServer, runTransaction, waitForPendingWrites, type Firestore } from 'firebase/firestore';
import type { Outbox, OutboxOperation, OutboxPayload } from './outbox';
import { assertMutationScope, decodeRawDocument, hasRawDocumentEnvelope, rawDocumentMatches } from './rawDocument';
import { immutableRawImage } from './recordUndo';
import { FillupConflictError } from './writesConditional';
import { rawVehicleIdentity } from './vehicleDocumentPersistence';
import { isVehicleDocMap } from './vehicle/documents';
import { assertVehicleAttempt, retireVehicleAttempt, sameVehicleAttempt, vehicleWriteError, failUnverifiableVehicleAttempt } from './vehicleWriteAttempt';

const INTENT = 'vehicle-selection-intent';
const BASE = 'vehicle-selection-base';
const has = (value: OutboxPayload, key: string) => Object.hasOwn(value, key);
const idValid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !value.includes('/');
const unverified = () => vehicleWriteError('vehicle-selection-unverified', 'לא ניתן לאמת את בחירת הרכב — הבחירה הקיימת נשמרה');
type Leaf = { present: false } | { present: true; value: string | null };
interface SelectionGuard {
  tag: typeof BASE; schemaVersion: 1; identity: OutboxPayload;
  container: 'missing' | 'null' | 'map'; selected: Leaf; deleting: boolean;
}
interface SelectionIntent {
  target: { vehicleId: string; identity: OutboxPayload } | null;
  sourceId: string | null;
}
function keys(value: OutboxPayload, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every(key => has(value, key));
}
function rawGuard(raw: OutboxPayload): SelectionGuard {
  const settings = raw.settings;
  const container = !has(raw, 'settings') ? 'missing' : settings === null ? 'null' : isVehicleDocMap(settings) ? 'map' : null;
  if (!container) throw unverified();
  let selected: Leaf = { present: false };
  if (isVehicleDocMap(settings) && has(settings, 'activeVehicleId')) {
    if (settings.activeVehicleId !== null && !idValid(settings.activeVehicleId)) throw unverified();
    selected = { present: true, value: settings.activeVehicleId as string | null };
  }
  return { tag: BASE, schemaVersion: 1, identity: has(raw, 'createdAt') ? { createdAt: raw.createdAt } : {},
    container, selected, deleting: raw.deletionPending === true };
}

/** Only the original preference leaf and account identity; never a whole-settings patch. */
export function vehicleSelectionBase(rawProfile: OutboxPayload): OutboxPayload {
  return immutableRawImage(rawGuard(rawProfile) as unknown as OutboxPayload);
}
function readGuard(image: OutboxPayload | null | undefined): SelectionGuard {
  if (!image || !hasRawDocumentEnvelope(image)) throw unverified();
  const value = decodeRawDocument(image);
  if (!keys(value, ['tag', 'schemaVersion', 'identity', 'container', 'selected', 'deleting']) ||
      value.tag !== BASE || value.schemaVersion !== 1 || !isVehicleDocMap(value.identity) ||
      Object.keys(value.identity).some(key => key !== 'createdAt') ||
      typeof value.container !== 'string' || !['missing', 'null', 'map'].includes(value.container) || !isVehicleDocMap(value.selected) ||
      typeof value.deleting !== 'boolean') throw unverified();
  const selected = value.selected;
  if (selected.present === false ? !keys(selected, ['present']) : selected.present !== true ||
      !keys(selected, ['present', 'value']) || selected.value !== null && !idValid(selected.value)) throw unverified();
  if (value.container !== 'map' && selected.present) throw unverified();
  return value as unknown as SelectionGuard;
}
export function selectedVehicleFromBase(image: OutboxPayload): string | null | undefined {
  const guard = readGuard(image);
  return guard.selected.present ? guard.selected.value : undefined;
}
export function vehicleSelectionIntent(
  target: { vehicleId: string; raw: OutboxPayload } | null, sourceId: string | null = null,
): OutboxPayload {
  if (target && !idValid(target.vehicleId) || sourceId !== null && !idValid(sourceId) ||
      sourceId !== null && sourceId === target?.vehicleId || target === null && sourceId === null) throw unverified();
  return immutableRawImage({ tag: INTENT, schemaVersion: 1,
    target: target ? { vehicleId: target.vehicleId, identity: rawVehicleIdentity(target.raw) } : null, sourceId });
}
function readIntent(image: OutboxPayload | null): SelectionIntent {
  if (!image || !hasRawDocumentEnvelope(image)) throw unverified();
  const value = decodeRawDocument(image);
  if (!keys(value, ['tag', 'schemaVersion', 'target', 'sourceId']) || value.tag !== INTENT || value.schemaVersion !== 1 ||
      value.sourceId !== null && !idValid(value.sourceId)) throw unverified();
  const target = value.target;
  if (target !== null && (!isVehicleDocMap(target) || !keys(target, ['vehicleId', 'identity']) || !idValid(target.vehicleId) ||
      !isVehicleDocMap(target.identity) || !rawDocumentMatches(rawVehicleIdentity(target.identity), target.identity))) throw unverified();
  if (target === null && value.sourceId === null || target !== null && target.vehicleId === value.sourceId) throw unverified();
  return value as unknown as SelectionIntent;
}

/** Malformed recognized candidates must never enter generic settings recovery. */
export function isVehicleSelectionOperation(operation: OutboxOperation): boolean {
  return operation.kind === 'settings.update' && ([operation.payload, operation.beforeImage, operation.serverImage].some(hasRawDocumentEnvelope) ||
    !!operation.payload && Object.keys(operation.payload).some(key => key === 'settings.activeVehicleId'));
}
function readOperation(operation: OutboxOperation) {
  const expected = `users/${operation.uid}`;
  if (!idValid(operation.uid) || operation.kind !== 'settings.update' || operation.opType !== 'update' ||
      operation.path !== expected || operation.docId !== operation.uid || operation.docKey !== `${operation.uid}|${expected}` ||
      operation.vehicleId !== null) throw unverified();
  const before = readGuard(operation.beforeImage), intent = readIntent(operation.payload);
  if (before.deleting) throw unverified();
  if (intent.sourceId !== null && (!before.selected.present || before.selected.value !== intent.sourceId)) throw unverified();
  return { before, intent };
}
function samePreference(left: SelectionGuard, right: SelectionGuard): boolean {
  return left.deleting === right.deleting && rawDocumentMatches(left.identity, right.identity) &&
    (left.container === 'null' || right.container === 'null' ? left.container === right.container : true) &&
    rawDocumentMatches(left.selected, right.selected);
}
function targetGuard(before: SelectionGuard, intent: SelectionIntent): SelectionGuard {
  return { ...before, container: 'map', selected: { present: true, value: intent.target?.vehicleId ?? null } };
}
function eligible(raw: OutboxPayload | null): boolean { return raw !== null && raw.archived !== true && raw.deletionPending !== true; }
function requireTarget(intent: SelectionIntent, raw: OutboxPayload | null): void {
  if (!intent.target) return;
  if (!eligible(raw) || !rawDocumentMatches(rawVehicleIdentity(raw!), intent.target.identity)) {
    throw vehicleWriteError('vehicle-selection-target', 'הרכב לבחירה השתנה או אינו זמין — הבחירה הקיימת נשמרה');
  }
}
export function vehicleSelectionTargetId(payload: OutboxPayload): string | null { return readIntent(payload).target?.vehicleId ?? null; }
export function vehicleSelectionApplied(payload: OutboxPayload, beforeImage: OutboxPayload, profile: OutboxPayload, target: OutboxPayload | null): boolean {
  const intent = readIntent(payload), before = readGuard(beforeImage);
  requireTarget(intent, target);
  return samePreference(targetGuard(before, intent), rawGuard(profile));
}
function neighbors(operation: OutboxOperation, operations: readonly OutboxOperation[]): void {
  if (operations.some(other => other.opId !== operation.opId && other.path === operation.path)) {
    throw vehicleWriteError('vehicle-selection-pending', 'יש שינוי בהגדרות שממתין לבדיקה — בחירת הרכב הקיימת נשמרה');
  }
}

export async function writeVehicleSelectionOperation(db: Firestore, outbox: Outbox, operation: OutboxOperation, isCurrent: () => boolean): Promise<void> {
  const { before, intent } = readOperation(operation);
  const check = (all: readonly OutboxOperation[]) => neighbors(operation, all);
  await assertVehicleAttempt(outbox, operation, isCurrent, check);
  await waitForPendingWrites(db);
  await assertVehicleAttempt(outbox, operation, isCurrent, check);
  await runTransaction(db, async transaction => {
    const ref = doc(db, operation.path), profile = await transaction.get(ref);
    const target = intent.target ? await transaction.get(doc(db, `${operation.path}/vehicles/${intent.target.vehicleId}`)) : null;
    const source = intent.sourceId ? await transaction.get(doc(db, `${operation.path}/vehicles/${intent.sourceId}`)) : null;
    await assertVehicleAttempt(outbox, operation, isCurrent, check);
    if (!profile.exists()) throw new FillupConflictError(null);
    const server = rawGuard(profile.data());
    requireTarget(intent, target?.exists() ? target.data() : null);
    if (samePreference(targetGuard(before, intent), server)) return;
    if (!samePreference(before, server) || server.deleting) throw new FillupConflictError(immutableRawImage(server as unknown as OutboxPayload));
    if (intent.sourceId && eligible(source?.exists() ? source.data() : null)) {
      throw vehicleWriteError('vehicle-selection-obsolete', 'הרכב הקודם שוב זמין — הבחירה הקיימת נשמרה');
    }
    transaction.update(ref, { 'settings.activeVehicleId': intent.target?.vehicleId ?? null });
  });
  await retireVehicleAttempt(outbox, operation, isCurrent);
}

const reconciling = new WeakMap<Outbox, Set<string>>();
export async function reconcileVehicleSelectionOperation(db: Firestore, outbox: Outbox, operation: OutboxOperation, isCurrent: () => boolean): Promise<boolean> {
  if (!isVehicleSelectionOperation(operation) || operation.status === 'conflict') return false;
  const active = reconciling.get(outbox) ?? new Set<string>(); reconciling.set(outbox, active);
  const token = `${operation.opId}:${operation.version}`;
  if (active.has(token)) return false;
  active.add(token);
  try {
    const { before, intent } = readOperation(operation);
    assertMutationScope(isCurrent);
    await waitForPendingWrites(db);
    assertMutationScope(isCurrent);
    const target = intent.target ? await getDocFromServer(doc(db, `${operation.path}/vehicles/${intent.target.vehicleId}`)) : null;
    const profile = await getDocFromServer(doc(db, operation.path));
    if (profile.metadata.fromCache || profile.metadata.hasPendingWrites || target?.metadata.fromCache || target?.metadata.hasPendingWrites) return false;
    const all = await outbox.list(); neighbors(operation, all);
    const current = await outbox.get(operation.opId);
    assertMutationScope(isCurrent);
    if (!current || current.status === 'conflict' || !sameVehicleAttempt(current, operation)) return true;
    if (!profile.exists()) { await outbox.markConflict(current.opId, current.version, null); return true; }
    const server = rawGuard(profile.data());
    if (samePreference(targetGuard(before, intent), server)) {
      requireTarget(intent, target?.exists() ? target.data() : null);
      await outbox.acknowledge(current.opId, current.version);
    } else if (samePreference(before, server)) await outbox.fail(current.opId, current.version, {
      code: 'unconfirmed', message: 'בחירת הרכב לא אושרה — אפשר לנסות שוב', at: Date.now(),
    });
    else await outbox.markConflict(current.opId, current.version, immutableRawImage(server as unknown as OutboxPayload));
    return true;
  } catch (error) { return failUnverifiableVehicleAttempt(outbox, operation, isCurrent, error); }
  finally { active.delete(token); }
}

export function vehicleSelectionDisplay(operation: OutboxOperation): { mine: OutboxPayload; before: OutboxPayload; server: OutboxPayload | null } {
  const { intent, before } = readOperation(operation);
  const server = operation.serverImage == null ? null : readGuard(operation.serverImage);
  const display = (guard: SelectionGuard): OutboxPayload => guard.selected.present ? { activeVehicleId: guard.selected.value } : {};
  return { mine: display(targetGuard(before, intent)), before: display(before), server: server ? display(server) : null };
}
