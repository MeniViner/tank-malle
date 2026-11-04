import { doc, getDocFromServer, waitForPendingWrites, type Firestore } from 'firebase/firestore';
import type { Outbox, OutboxOperation } from './outbox';
import { fillupOrigin, fillupOriginState, isVersionedFillupDelete } from './fillupUndo';
import { assertMutationScope } from './rawDocument';
import { conditionalFillupWrite, fillupBaseMatches } from './writesConditional';

function changedOrigin(): Error & { code: string } {
  return Object.assign(new Error('פעולת השמירה השתנתה מאז הביטול — שתי הפעולות נשמרו לבדיקה'), { code: 'undo-origin-changed' });
}

async function currentDeletion(outbox: Outbox, captured: OutboxOperation, respectConflict = false): Promise<boolean> {
  const current = await outbox.get(captured.opId);
  return !!current && current.uid === captured.uid && current.path === captured.path && current.version === captured.version &&
    (!respectConflict || current.status !== 'conflict');
}

async function readOrigin(outbox: Outbox, deletion: OutboxOperation) {
  const identity = fillupOrigin(deletion.beforeImage?.writeId);
  if (!identity || !isVersionedFillupDelete(deletion)) throw changedOrigin();
  // A failed read is never treated as an absent (already acknowledged) parent.
  const original = await outbox.get(identity.opId);
  const state = fillupOriginState(deletion, original);
  if (state === 'changed') throw changedOrigin();
  return { original, state };
}

/** Retire only the exact originating write. A changed attempt keeps Undo unresolved. */
async function retireOrigin(outbox: Outbox, deletion: OutboxOperation, stillCurrent: () => boolean, respectConflict = false): Promise<void> {
  assertMutationScope(stillCurrent);
  if (!await currentDeletion(outbox, deletion, respectConflict)) throw changedOrigin();
  const { original, state } = await readOrigin(outbox, deletion);
  assertMutationScope(stillCurrent);
  if (state === 'missing' || !original) return;
  if (!await currentDeletion(outbox, deletion, respectConflict)) throw changedOrigin();
  if (!await outbox.acknowledge(original.opId, original.version)) {
    // Another ACK is harmless; a replacement/claimed retry is not.
    const after = await outbox.get(original.opId);
    if (after) throw changedOrigin();
  }
  assertMutationScope(stillCurrent);
}

/** Called only after the complete delete input has been durably journaled. */
export async function writeFillupDeletion(
  db: Firestore, outbox: Outbox, deletion: OutboxOperation, stillCurrent: () => boolean,
): Promise<void> {
  assertMutationScope(stillCurrent);
  if (isVersionedFillupDelete(deletion)) {
    // Queue completion includes rejected writes. It does not prove creation.
    await waitForPendingWrites(db);
    assertMutationScope(stillCurrent);
    if (!await currentDeletion(outbox, deletion)) throw changedOrigin();
    await readOrigin(outbox, deletion);
  }
  assertMutationScope(stillCurrent);
  await conditionalFillupWrite(db, doc(db, deletion.path), 'delete', null, deletion.beforeImage, false, stillCurrent);
  if (isVersionedFillupDelete(deletion)) await retireOrigin(outbox, deletion, stillCurrent);
}

const reconciling = new WeakMap<Outbox, Set<string>>();

/**
 * A collection/listener snapshot is only a trigger. Capture the child version,
 * drain already queued writes and obtain new server evidence before judging a
 * linked pair. Never manufacture a retryable creation after its Undo succeeded.
 */
export async function reconcileFillupDeletion(
  db: Firestore, outbox: Outbox, captured: OutboxOperation, stillCurrent: () => boolean,
): Promise<boolean> {
  if (!isVersionedFillupDelete(captured) || captured.status === 'conflict') return false;
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
    if (!await currentDeletion(outbox, captured, true)) return true;
    await readOrigin(outbox, captured);
    assertMutationScope(stillCurrent);
    if (!snapshot.exists()) {
      await retireOrigin(outbox, captured, stillCurrent, true);
      if (!await currentDeletion(outbox, captured, true)) return true;
      await outbox.acknowledge(captured.opId, captured.version);
    } else if (captured.beforeImage && fillupBaseMatches(captured.beforeImage, snapshot.data())) {
      // The create is proven on the server, but the delete has not happened.
      await retireOrigin(outbox, captured, stillCurrent, true);
      if (!await currentDeletion(outbox, captured, true)) return true;
      await outbox.fail(captured.opId, captured.version, {
        code: 'unconfirmed', message: 'התדלוק עדיין קיים בשרת — הביטול נשמר לניסיון חוזר', at: Date.now(),
      });
    } else {
      await outbox.markConflict(captured.opId, captured.version, snapshot.data());
    }
    return true;
  } catch (error) {
    if (stillCurrent() && (error as { code?: string }).code === 'undo-origin-changed') {
      await outbox.fail(captured.opId, captured.version, {
        code: 'undo-origin-changed', message: (error as Error).message, at: Date.now(),
      });
      return true;
    }
    // Offline, changed account, unreadable storage: preserve both inputs.
    return false;
  } finally {
    active.delete(key);
  }
}
