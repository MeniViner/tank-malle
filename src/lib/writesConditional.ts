/**
 * Modern fill-up mutations use Firestore transactions, not version-only writes.
 * Legacy patches may leave version/writeId unchanged. The transaction reads and
 * compares the editor's immutable base on EVERY attempt; Firestore's server
 * read-version precondition closes the race between that check and the commit.
 * Offline transactions fail safely: the already-journaled input remains in the
 * durable outbox for explicit retry. Never fall back to an unconditional write.
 */
import { runTransaction, type DocumentReference, type Firestore } from "firebase/firestore";
import { fillupBaseMatches } from "./writesBase";
export { fillupBaseMatches } from "./writesBase";
import type { OutboxOpType, OutboxPayload } from "./outbox";

export class FillupConflictError extends Error {
  readonly code = "conflict";
  readonly serverImage: OutboxPayload | null;
  constructor(serverImage: OutboxPayload | null) {
    super("הרשומה השתנתה בשרת — הנתונים שלך נשמרו במכשיר להשוואה ולניסיון חוזר");
    this.serverImage = serverImage;
  }
}

export function conditionalFillupWrite(
  db: Firestore,
  ref: DocumentReference,
  opType: OutboxOpType,
  data: OutboxPayload | null,
  before: OutboxPayload | null,
  /** Undo may recreate an absent document OR restore an unchanged base. */
  restore = false,
): Promise<void> {
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    const server = snapshot.exists() ? snapshot.data() as OutboxPayload : null;
    if (opType === "delete") {
      if (!server) return; // idempotent retry
      if (!before || !fillupBaseMatches(before, server)) throw new FillupConflictError(server);
      transaction.delete(ref);
      return;
    }
    if (!data) throw new Error("missing fill-up payload");
    if (server && fillupBaseMatches(data, server)) return; // already acknowledged
    if (opType === "update" || (restore && server)) {
      if (!server || !before || !fillupBaseMatches(before, server)) throw new FillupConflictError(server);
    } else if (server) {
      throw new FillupConflictError(server); // create must never overwrite
    }
    if (opType === "update") transaction.update(ref, data);
    else transaction.set(ref, data);
  });
}
