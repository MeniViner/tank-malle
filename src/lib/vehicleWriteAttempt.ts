import type { Outbox, OutboxOperation } from './outbox';
import { assertMutationScope, rawDocumentMatches } from './rawDocument';

export function vehicleWriteError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function sameVehicleAttempt(current: OutboxOperation, expected: OutboxOperation): boolean {
  return current.opId === expected.opId && current.uid === expected.uid && current.vehicleId === expected.vehicleId &&
    current.kind === expected.kind && current.opType === expected.opType && current.path === expected.path &&
    current.docId === expected.docId && current.docKey === expected.docKey &&
    current.version === expected.version && current.revision === expected.revision &&
    rawDocumentMatches(current.payload, expected.payload) && rawDocumentMatches(current.beforeImage, expected.beforeImage);
}

/** Read the actual attempt LAST, after any awaited neighboring-operation check. */
export async function assertVehicleAttempt(
  outbox: Outbox, operation: OutboxOperation, isCurrent: () => boolean,
  checkNeighbors?: (operations: readonly OutboxOperation[]) => void,
): Promise<void> {
  assertMutationScope(isCurrent);
  if (checkNeighbors) checkNeighbors(await outbox.list());
  assertMutationScope(isCurrent);
  const current = await outbox.get(operation.opId);
  assertMutationScope(isCurrent);
  if (!current || current.status !== 'pending' || !sameVehicleAttempt(current, operation)) {
    throw vehicleWriteError('vehicle-operation-changed', 'הפעולה השתנתה — הפרטים נשמרו לבדיקה');
  }
}

export async function retireVehicleAttempt(outbox: Outbox, operation: OutboxOperation, isCurrent: () => boolean): Promise<void> {
  assertMutationScope(isCurrent);
  const current = await outbox.get(operation.opId);
  assertMutationScope(isCurrent);
  if (!current) return;
  if (current.status !== 'pending' || !sameVehicleAttempt(current, operation)) {
    throw vehicleWriteError('vehicle-operation-changed', 'הפעולה השתנתה — הפרטים נשמרו לבדיקה');
  }
  if (!await outbox.acknowledge(operation.opId, operation.version) && await outbox.get(operation.opId)) {
    throw vehicleWriteError('vehicle-operation-changed', 'הפעולה השתנתה — הפרטים נשמרו לבדיקה');
  }
  assertMutationScope(isCurrent);
}

/** An unreadable recovered candidate is reviewable, never left looking SDK-owned forever. */
export async function failUnverifiableVehicleAttempt(outbox: Outbox, operation: OutboxOperation, isCurrent: () => boolean, error: unknown): Promise<boolean> {
  const code = (error as { code?: unknown } | null)?.code;
  if (!['raw-document-unverified', 'vehicle-document-unverified', 'vehicle-selection-unverified', 'vehicle-selection-target'].includes(String(code))) return false;
  try {
    assertMutationScope(isCurrent);
    const current = await outbox.get(operation.opId);
    assertMutationScope(isCurrent);
    if (!current || current.status === 'conflict' || !sameVehicleAttempt(current, operation)) return true;
    await outbox.fail(current.opId, current.version, { code: 'unverified',
      message: error instanceof Error ? error.message : 'לא ניתן לאמת את הפעולה — הפרטים נשמרו לבדיקה', at: Date.now() });
    return true;
  } catch { return false; }
}
