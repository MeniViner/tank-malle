import type { OutboxOperation, OutboxPayload } from './outbox';
import { fillupBaseMatches } from './writesBase';

export interface FillupOrigin { opId: string; version: number }

/** Operation ids can contain dots; only the last component is the attempt. */
export function fillupOrigin(writeId: unknown): FillupOrigin | null {
  if (typeof writeId !== 'string') return null;
  const point = writeId.lastIndexOf('.');
  if (point <= 0 || !/^[1-9]\d*$/.test(writeId.slice(point + 1))) return null;
  const version = Number(writeId.slice(point + 1));
  return Number.isSafeInteger(version) ? { opId: writeId.slice(0, point), version } : null;
}

export function isVersionedFillupDelete(op: OutboxOperation): boolean {
  const path = `users/${op.uid}/vehicles/${op.vehicleId}/fillups/${op.docId}`;
  return op.kind === 'fillup.delete' && op.opType === 'delete' && !!op.uid && !!op.vehicleId &&
    !op.uid.includes('/') && !op.vehicleId.includes('/') && !op.docId.includes('/') &&
    op.path === path && op.docKey === `${op.uid}|${path}` && fillupOrigin(op.beforeImage?.writeId) !== null;
}

export type FillupOriginState = 'missing' | 'creation' | 'other-write' | 'changed';

/** A new attempt or a changed input must never be retired as the old create. */
export function fillupOriginState(deletion: OutboxOperation, original: OutboxOperation | null): FillupOriginState {
  const identity = fillupOrigin(deletion.beforeImage?.writeId);
  if (!identity || !isVersionedFillupDelete(deletion)) return 'changed';
  if (!original) return 'missing';
  if (original.opId !== identity.opId || original.version !== identity.version || original.uid !== deletion.uid ||
      original.path !== deletion.path || original.docKey !== deletion.docKey || original.docId !== deletion.docId ||
      original.vehicleId !== deletion.vehicleId || original.revision >= deletion.revision || !original.payload ||
      !fillupBaseMatches(deletion.beforeImage as OutboxPayload, { ...original.payload, writeId: `${original.opId}.${original.version}` })) return 'changed';
  if (original.kind === 'fillup.add' && original.opType === 'set') return 'creation';
  return ((original.kind === 'fillup.update' || original.kind === 'fillup.add') && original.opType === 'update') ||
    (original.kind === 'fillup.restore' && original.opType === 'set') ? 'other-write' : 'changed';
}

/** A retained Undo blocks a new attempt of the captured create, including after claim. */
export function retainedCreationUndo(operations: readonly OutboxOperation[], original: OutboxOperation): OutboxOperation | null {
  if (!original.kind.startsWith('fillup.') || original.opType === 'delete') return null;
  return operations.find(op => {
    if (!isVersionedFillupDelete(op) || op.uid !== original.uid || op.path !== original.path || op.docKey !== original.docKey) return false;
    const origin = fillupOrigin(op.beforeImage?.writeId);
    return origin?.opId === original.opId && origin.version <= original.version;
  }) ?? null;
}

/** Keep linked entries out of generic supersession/reconciliation. */
export function partitionFillupDeletes(operations: readonly OutboxOperation[]): {
  deletions: OutboxOperation[]; ordinary: OutboxOperation[];
} {
  const deletions = operations.filter(isVersionedFillupDelete);
  const ids = new Set(deletions.flatMap(op => [op.opId, fillupOrigin(op.beforeImage?.writeId)!.opId]));
  return { deletions, ordinary: operations.filter(op => !ids.has(op.opId)) };
}
