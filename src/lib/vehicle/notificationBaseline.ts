import type { NotificationState } from './model';

/** Collection knowledge belongs to one subscription lifetime, including A → B → A. */
export interface NotificationBaselineSnapshot {
  lifetime: object;
  rows: readonly NotificationState[];
  rawIds: ReadonlySet<string>;
  confirmedRawIds: ReadonlySet<string> | null;
}

export type NotificationBaseline =
  | { kind: 'existing'; before: NotificationState }
  | { kind: 'absent' }
  | { kind: 'unavailable' };

export function advanceNotificationBaseline(
  previous: NotificationBaselineSnapshot | undefined,
  lifetime: object,
  rows: readonly NotificationState[],
  rawIds: readonly string[],
  serverConfirmed: boolean,
): NotificationBaselineSnapshot {
  const currentIds = new Set(rawIds);
  return {
    lifetime, rows, rawIds: currentIds,
    confirmedRawIds: serverConfirmed ? currentIds
      : previous?.lifetime === lifetime ? previous.confirmedRawIds : null,
  };
}

/** A missing decoded row is not evidence that a new version-1 document is safe. */
export function notificationBaseline(
  lifetime: object,
  snapshot: NotificationBaselineSnapshot | undefined,
  readError: boolean,
  note: { id: string; occurrence: string },
): NotificationBaseline {
  if (!snapshot || snapshot.lifetime !== lifetime || readError) return { kind: 'unavailable' };
  const before = snapshot.rows.find(row => row.id === note.id);
  if (before) return snapshot.rawIds.has(note.id) && before.occurrence === note.occurrence
    ? { kind: 'existing', before } : { kind: 'unavailable' };
  if (snapshot.rawIds.has(note.id) || !snapshot.confirmedRawIds || snapshot.confirmedRawIds.has(note.id)) {
    return { kind: 'unavailable' };
  }
  return { kind: 'absent' };
}
