import type { OutboxPayload } from './outbox';
import type { TankObservation } from './tank/types';
import type { MutationReceipt } from './writes';
import { assertMutationScope, decodeRawDocument, encodeRawDocument } from './rawDocument';

export interface RecordDeletionSubmission {
  readonly receipt: MutationReceipt;
  /** Provider session, independent of the route that submitted the deletion. */
  readonly isCurrent: () => boolean;
  readonly canRestore: () => boolean;
  /** Established once, after actual deletion and exact journal retirement. */
  readonly undoDeadline: number | null;
  readonly restoreDeleted: () => Promise<MutationReceipt>;
}

export interface RecordDeletionOptions {
  onSubmitted?: (submission: RecordDeletionSubmission) => void;
}

/** Only a provider-issued token can carry the reviewed observation's raw image. */
export interface ObservationDeletionSnapshot {
  readonly id: string;
  readonly vehicleId: string;
  readonly record: Readonly<TankObservation>;
}

interface CapturedObservation {
  readonly vehicleId: string;
  readonly id: string;
  readonly beforeImage: OutboxPayload;
  readonly isCurrent: () => boolean;
}

const observations = new WeakMap<ObservationDeletionSnapshot, CapturedObservation>();

function freezeImage<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeImage);
    Object.freeze(value);
  }
  return value;
}

/** Clone the encoded image, so neither a listener nor a caller can advance it. */
export function immutableRawImage(raw: OutboxPayload): OutboxPayload {
  return freezeImage(encodeRawDocument(raw));
}

/** Called for one render's coherent records/images/metadata snapshot. */
export function createObservationCapture(
  source: {
    vehicleId: string | null;
    records: readonly TankObservation[];
    rawImages: ReadonlyMap<string, OutboxPayload>;
    pendingIds: ReadonlySet<string>;
  },
  isCurrent: () => boolean,
): (record: TankObservation) => ObservationDeletionSnapshot | null {
  return record => {
    if (!isCurrent() || !source.vehicleId || record.vehicleId !== source.vehicleId ||
        !source.records.includes(record) || source.pendingIds.has(record.id)) return null;
    const image = source.rawImages.get(record.id);
    if (!image) return null;
    const beforeImage = immutableRawImage(decodeRawDocument(image));
    const token = Object.freeze({ id: record.id, vehicleId: source.vehicleId, record: Object.freeze({ ...record }) });
    observations.set(token, { id: record.id, vehicleId: source.vehicleId, beforeImage, isCurrent });
    return token;
  };
}

export function readObservationCapture(
  token: ObservationDeletionSnapshot,
  id: string,
  vehicleId: string,
): CapturedObservation {
  const captured = observations.get(token);
  if (!captured || captured.id !== id || captured.vehicleId !== vehicleId) {
    throw Object.assign(new Error('יש לפתוח מחדש את הרשומה לפני המחיקה'), { code: 'record-unverified' });
  }
  assertMutationScope(captured.isCurrent);
  return captured;
}

/** The deadline is set only by the deletion wrapper after durable retirement. */
export function createRecordUndo(
  isCurrent: () => boolean,
  restore: () => Promise<MutationReceipt>,
  now: () => number = Date.now,
) {
  let deadline: number | null = null;
  let used = false;
  const canRestore = () => isCurrent() && deadline !== null && now() < deadline && !used;
  return {
    deleted: () => {
      assertMutationScope(isCurrent);
      if (deadline === null) deadline = now() + 5_000;
    },
    submission: (receipt: MutationReceipt): RecordDeletionSubmission => Object.freeze({
      receipt,
      isCurrent,
      canRestore,
      get undoDeadline() { return deadline; },
      restoreDeleted: async () => {
        assertMutationScope(isCurrent);
        if (!canRestore()) throw Object.assign(new Error('זמן השחזור הסתיים'), { code: 'undo-expired' });
        used = true;
        try { return await restore(); }
        catch (error) {
          // A submission failure before journaling may be retried within the
          // original window. A returned receipt belongs to the durable queue.
          used = false;
          throw error;
        }
      },
    }),
  };
}
