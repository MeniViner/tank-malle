import type { NotificationState } from './model';

/** updateDoc preserves absent fields, so undo must explicitly clear a tombstone. */
export function restoredNotification(before: NotificationState, written: NotificationState): NotificationState {
  return { ...before, deleted: before.deleted ?? false, version: written.version + 1 };
}

/** One acknowledged notification action, one Undo, within its visible five seconds. */
export function createNotificationUndo(
  stillCurrent: () => boolean,
  restore: () => Promise<void>,
  now: () => number = Date.now,
): () => Promise<boolean> {
  const deadline = now() + 5_000;
  let used = false;
  return async () => {
    if (used || !stillCurrent() || now() >= deadline) return false;
    used = true;
    await restore();
    return true;
  };
}
