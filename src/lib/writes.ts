/**
 * Mutation tracking.
 *
 * Firestore's offline cache makes a write feel instant, and the write promise
 * only settles when the SERVER acknowledges it — which may be never, if the
 * document violates the rules. Swallowing that rejection is how a UI ends up
 * telling someone their fill-up was saved when it was permanently rejected.
 *
 * Four states are kept distinct:
 *
 *   accepted locally  → the local cache applied it; the UI can move on
 *   queued            → waiting for the network
 *   synced            → the server acknowledged it
 *   failed            → the server rejected it, permanently
 *
 * Nothing here blocks the UI. An offline write simply stays pending, visibly,
 * until the connection returns.
 */

export type MutationKind =
  | "fillup.add"
  | "fillup.update"
  | "fillup.delete"
  | "fillup.restore"
  | "vehicle.add"
  | "vehicle.update"
  | "vehicle.delete"
  | "settings.update"
  | "import.batch"
  | "import.rollback"
  | "priceReport.add"
  | "priceRule.save"
  | "priceRule.delete"
  | "account.delete";

export type MutationState = "pending" | "synced" | "failed";

export interface Mutation {
  id: string;
  kind: MutationKind;
  state: MutationState;
  startedAt: number;
  settledAt?: number;
  error?: string;
  /** Short Hebrew description, for the pending/failed list. */
  label: string;
}

export interface WriteStatus {
  /** Writes accepted locally but not yet acknowledged by the server. */
  pending: Mutation[];
  /** Writes the server permanently rejected. These need the user's attention. */
  failed: Mutation[];
  /** True while at least one write is unacknowledged. */
  syncing: boolean;
}

export const EMPTY_WRITE_STATUS: WriteStatus = {
  pending: [],
  failed: [],
  syncing: false,
};

/** A handle on one mutation. `settled` resolves when the server has answered. */
export interface MutationReceipt {
  id: string;
  /** Resolves true on server acknowledgement, false on permanent rejection. */
  settled: Promise<boolean>;
}

const LABELS: Record<MutationKind, string> = {
  "fillup.add": "הוספת תדלוק",
  "fillup.update": "עדכון תדלוק",
  "fillup.delete": "מחיקת תדלוק",
  "fillup.restore": "שחזור תדלוק",
  "vehicle.add": "הוספת רכב",
  "vehicle.update": "עדכון רכב",
  "vehicle.delete": "מחיקת רכב",
  "settings.update": "עדכון הגדרות",
  "import.batch": "ייבוא נתונים",
  "import.rollback": "ביטול ייבוא",
  "priceReport.add": "דיווח מחיר",
  "priceRule.save": "שמירת כלל תמחור",
  "priceRule.delete": "מחיקת כלל תמחור",
  "account.delete": "מחיקת חשבון",
};

let counter = 0;

/**
 * Tracks in-flight writes for one signed-in user.
 *
 * A tracker belongs to a single user generation: switching accounts creates a
 * new one, so a late acknowledgement from the previous account can never write
 * into the next account's state.
 */
export class WriteTracker {
  private mutations = new Map<string, Mutation>();
  private listeners = new Set<(status: WriteStatus) => void>();
  private disposed = false;

  subscribe(listener: (status: WriteStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status());
    return () => void this.listeners.delete(listener);
  }

  status(): WriteStatus {
    const all = [...this.mutations.values()];
    const pending = all.filter((m) => m.state === "pending");
    return {
      pending,
      failed: all.filter((m) => m.state === "failed"),
      syncing: pending.length > 0,
    };
  }

  /**
   * Register a write and follow it to its conclusion.
   *
   * The returned receipt is deliberately not awaited by callers on the UI
   * path: the point is that the caller can proceed while the write is still
   * in flight, and still be told later if it failed.
   */
  track(kind: MutationKind, promise: Promise<unknown>): MutationReceipt {
    counter += 1;
    const id = `m${counter}`;

    const mutation: Mutation = {
      id,
      kind,
      state: "pending",
      startedAt: Date.now(),
      label: LABELS[kind],
    };
    this.mutations.set(id, mutation);
    this.emit();

    const settled = promise.then(
      () => {
        this.finish(id, "synced");
        return true;
      },
      (error: unknown) => {
        this.finish(id, "failed", describeError(error));
        return false;
      },
    );

    return { id, settled };
  }

  /** Drop a settled failure once the user has acknowledged it. */
  dismiss(id: string): void {
    this.mutations.delete(id);
    this.emit();
  }

  /** Everything that has not been acknowledged by the server. */
  unacknowledged(): Mutation[] {
    return [...this.mutations.values()].filter((m) => m.state === "pending");
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.mutations.clear();
  }

  private finish(id: string, state: MutationState, error?: string): void {
    if (this.disposed) return;
    const mutation = this.mutations.get(id);
    if (!mutation) return;

    mutation.state = state;
    mutation.settledAt = Date.now();
    if (error) mutation.error = error;

    // A success needs no record; a failure is kept until it is acknowledged.
    if (state === "synced") this.mutations.delete(id);
    this.emit();
  }

  private emit(): void {
    if (this.disposed) return;
    const status = this.status();
    for (const listener of this.listeners) listener(status);
  }
}

/** Hebrew explanation for the failure states worth distinguishing. */
export function describeError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  if (code === "permission-denied") return "אין הרשאה לשמור את הרשומה הזו";
  if (code === "invalid-argument") return "הנתונים שנשלחו אינם תקינים";
  if (code === "not-found") return "הרשומה כבר לא קיימת";
  if (code === "resource-exhausted") return "חריגה ממכסת השימוש — נסו שוב מאוחר יותר";
  if (code === "unauthenticated") return "החיבור פג. התחברו מחדש ונסו שוב";
  return "השמירה נכשלה בשרת";
}

/** The one-line sync state shown in the UI. */
export type SyncLabel = "saved-locally" | "pending" | "synced" | "failed";

export function syncLabelText(label: SyncLabel): string {
  switch (label) {
    case "saved-locally":
      return "נשמר במכשיר";
    case "pending":
      return "ממתין לסנכרון";
    case "synced":
      return "סונכרן";
    case "failed":
      return "הסנכרון נכשל";
  }
}
