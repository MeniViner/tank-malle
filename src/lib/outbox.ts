/**
 * Durable outbox.
 *
 * Firestore's persistent cache makes a write feel instant and keeps it queued
 * while offline — but when the SERVER rejects a write (rules, validation, a
 * permission problem), the SDK rolls the local copy back and the record is
 * gone from every place the app can see. The in-memory `WriteTracker` knew a
 * write had failed; it never kept WHAT had failed.
 *
 * This module keeps the user's input itself, per account, in browser storage,
 * BEFORE the write is handed to Firestore:
 *
 *   pending   → written locally, Firestore's queue owns delivery
 *   failed    → the server rejected it; the payload is intact and retryable
 *   conflict  → a retry found a newer acknowledged version on the server
 *   (synced)  → the server acknowledged it; the entry is removed
 *
 * It is deliberately NOT a second dispatcher. Delivery of a pending write is
 * still Firestore's job; the outbox only remembers, reconciles and — on an
 * explicit user action — retries. Nothing here touches React or Firebase.
 *
 * Storage limits, honestly: this lives in `localStorage` (a few MB per origin,
 * synchronous, cleared by "clear site data", private windows and browser
 * eviction). It protects against server rejection, reloads, crashes and
 * account switches — not against the user or the browser deleting site data.
 * A separate export (see the unsynced screen) is the backup for that.
 */

import type { MutationKind } from "./writes";

export type OutboxStatus = "pending" | "failed" | "conflict";

export type OutboxKind = Extract<
  MutationKind,
  | "fillup.add"
  | "fillup.update"
  | "fillup.delete"
  | "fillup.restore"
  | "vehicle.delete"
  | "tank.observation"
  | "tank.observation.delete"
>;

/** A JSON-safe document body. Dates are epoch ms; server timestamps are sentinels. */
export type OutboxPayload = Record<string, unknown>;

export interface OutboxError {
  code: string;
  message: string;
  at: number;
}

export interface OutboxOperation {
  /** Stable operation id. Survives retries; a retry never mints a new one. */
  opId: string;
  uid: string;
  vehicleId: string | null;
  kind: OutboxKind;
  /** The Firestore document id the operation targets. Stable across retries. */
  docId: string;
  /** Complete serialisable payload for create/update/restore; null for deletes. */
  payload: OutboxPayload | null;
  /** The document as the client last saw it before an update/delete, when known. */
  beforeImage: OutboxPayload | null;
  /** Per-document revision; a later revision supersedes an earlier one. */
  revision: number;
  status: OutboxStatus;
  error: OutboxError | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  /** Client build that produced the operation, for diagnosis. */
  clientVersion: string;
  /** Set when a conflict was detected: what the server held at that moment. */
  serverImage?: OutboxPayload | null;
}

export interface OutboxSnapshot {
  operations: OutboxOperation[];
  revisions: Record<string, number>;
}

/** The subset of the Web Storage API the outbox needs; injectable for tests. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class OutboxStorageError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "OutboxStorageError";
    this.cause = cause;
  }
}

const VERSION = 1;
const PREFIX = `tm.outbox.v${VERSION}`;

export function outboxKey(uid: string): string {
  return `${PREFIX}.${uid}`;
}

function readSnapshot(storage: KeyValueStorage, uid: string): OutboxSnapshot {
  try {
    const raw = storage.getItem(outboxKey(uid));
    if (!raw) return { operations: [], revisions: {} };
    const parsed = JSON.parse(raw) as Partial<OutboxSnapshot> & { v?: number };
    if (!parsed || !Array.isArray(parsed.operations)) return { operations: [], revisions: {} };
    return {
      operations: parsed.operations.filter(
        (op): op is OutboxOperation =>
          Boolean(op) && typeof op.opId === "string" && op.uid === uid,
      ),
      revisions: parsed.revisions && typeof parsed.revisions === "object" ? parsed.revisions : {},
    };
  } catch {
    // Malformed storage is treated as empty rather than fatal. The raw value
    // is left in place so it can still be inspected by hand.
    return { operations: [], revisions: {} };
  }
}

function writeSnapshot(storage: KeyValueStorage, uid: string, snapshot: OutboxSnapshot): void {
  try {
    storage.setItem(outboxKey(uid), JSON.stringify({ v: VERSION, ...snapshot }));
  } catch (error) {
    throw new OutboxStorageError("האחסון המקומי מלא או אינו זמין — הרשומה לא נשמרה", error);
  }
}

let counter = 0;

/** Unique enough for one browser profile: time, a counter and randomness. */
export function newOpId(now = Date.now()): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `op_${now.toString(36)}_${counter.toString(36)}_${random}`;
}

/**
 * One account's outbox.
 *
 * Every method re-reads storage before it writes, so two tabs sharing the
 * same account cannot overwrite each other's entries: the last writer only
 * ever replaces the ENTRY it touched, never the whole list it remembered.
 */
export class Outbox {
  private listeners = new Set<(snapshot: OutboxSnapshot) => void>();
  readonly uid: string;
  private readonly storage: KeyValueStorage;
  private readonly clientVersion: string;
  private readonly now: () => number;

  constructor(
    uid: string,
    storage: KeyValueStorage,
    clientVersion: string,
    now: () => number = () => Date.now(),
  ) {
    this.uid = uid;
    this.storage = storage;
    this.clientVersion = clientVersion;
    this.now = now;
  }

  read(): OutboxSnapshot {
    return readSnapshot(this.storage, this.uid);
  }

  operations(): OutboxOperation[] {
    return this.read().operations;
  }

  subscribe(listener: (snapshot: OutboxSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.read());
    return () => void this.listeners.delete(listener);
  }

  /** Called by the host when another tab changed storage. */
  notify(): void {
    const snapshot = this.read();
    for (const listener of this.listeners) listener(snapshot);
  }

  /**
   * Record an operation BEFORE the write is submitted. Throws
   * `OutboxStorageError` when storage refuses — the caller must then keep the
   * form open and must not report success.
   */
  enqueue(input: {
    kind: OutboxKind;
    docId: string;
    vehicleId: string | null;
    payload: OutboxPayload | null;
    beforeImage?: OutboxPayload | null;
    /** Reuse an existing op id (an edit of a failed op replaces it). */
    replaceOpId?: string | null;
  }): OutboxOperation {
    const snapshot = this.read();
    const now = this.now();
    const revision = (snapshot.revisions[input.docId] ?? 0) + 1;

    const operation: OutboxOperation = {
      opId: input.replaceOpId ?? newOpId(now),
      uid: this.uid,
      vehicleId: input.vehicleId,
      kind: input.kind,
      docId: input.docId,
      payload: input.payload,
      beforeImage: input.beforeImage ?? null,
      revision,
      status: "pending",
      error: null,
      attempts: 1,
      createdAt: now,
      updatedAt: now,
      clientVersion: this.clientVersion,
    };

    const operations = snapshot.operations.filter((op) => op.opId !== operation.opId);
    operations.push(operation);
    writeSnapshot(this.storage, this.uid, {
      operations,
      revisions: { ...snapshot.revisions, [input.docId]: revision },
    });
    this.notify();
    return operation;
  }

  /** The server acknowledged the operation: nothing left to remember. */
  acknowledge(opId: string): void {
    const snapshot = this.read();
    const remaining = snapshot.operations.filter((op) => op.opId !== opId);
    if (remaining.length === snapshot.operations.length) return;
    writeSnapshot(this.storage, this.uid, { ...snapshot, operations: remaining });
    this.notify();
  }

  /** The server rejected the operation. The payload stays exactly as it was. */
  fail(opId: string, error: OutboxError): void {
    this.patch(opId, (op) => ({ ...op, status: "failed", error, updatedAt: this.now() }));
  }

  /** A retry found a newer acknowledged version of the document. */
  markConflict(opId: string, serverImage: OutboxPayload | null): void {
    this.patch(opId, (op) => ({
      ...op,
      status: "conflict",
      serverImage,
      error: {
        code: "conflict",
        message: "הרשומה בשרת השתנתה מאז העריכה — יש לבחור איזו גרסה נכונה",
        at: this.now(),
      },
      updatedAt: this.now(),
    }));
  }

  /** Back to pending for a retry; the op id and revision are kept. */
  retrying(opId: string): OutboxOperation | null {
    let result: OutboxOperation | null = null;
    this.patch(opId, (op) => {
      result = {
        ...op,
        status: "pending",
        error: null,
        serverImage: null,
        attempts: op.attempts + 1,
        updatedAt: this.now(),
      };
      return result;
    });
    return result;
  }

  /** Explicit user discard. The only way user input leaves the outbox unacknowledged. */
  discard(opId: string): void {
    this.acknowledge(opId);
  }

  get(opId: string): OutboxOperation | null {
    return this.read().operations.find((op) => op.opId === opId) ?? null;
  }

  /** The newest revision recorded for a document, or 0. */
  revisionOf(docId: string): number {
    return this.read().revisions[docId] ?? 0;
  }

  private patch(opId: string, update: (op: OutboxOperation) => OutboxOperation): void {
    const snapshot = this.read();
    const index = snapshot.operations.findIndex((op) => op.opId === opId);
    if (index === -1) return;
    const operations = [...snapshot.operations];
    operations[index] = update(operations[index]);
    writeSnapshot(this.storage, this.uid, { ...snapshot, operations });
    this.notify();
  }
}

/* ------------------------------------------------------------------ *
 * Reconciliation against a server snapshot
 * ------------------------------------------------------------------ */

/** One document as the server (not the cache) currently holds it. */
export interface ServerDocument {
  id: string;
  data: OutboxPayload;
  /** True while the local SDK still has an unsent mutation for this document. */
  hasPendingWrites: boolean;
}

export type ReconcileVerdict =
  | { opId: string; verdict: "synced" }
  | { opId: string; verdict: "still-pending" }
  | { opId: string; verdict: "unconfirmed"; reason: string }
  | { opId: string; verdict: "conflict"; serverImage: OutboxPayload | null };

/**
 * Decide the fate of pending operations from a SERVER-sourced snapshot of the
 * collection they target.
 *
 * Call only with a snapshot whose metadata says it did not come from cache.
 * Firestore replays queued mutations across reloads, so a pending op is either
 * still in the SDK's queue (its document shows `hasPendingWrites`), already
 * acknowledged (the document is on the server with the op's content), or
 * gone (rejected or never queued) — which is the case a plain listener could
 * never tell apart from "deleted".
 */
export function reconcileWithServer(
  operations: readonly OutboxOperation[],
  vehicleId: string | null,
  documents: readonly ServerDocument[],
  matches: (payload: OutboxPayload, server: OutboxPayload) => boolean,
): ReconcileVerdict[] {
  const byId = new Map(documents.map((entry) => [entry.id, entry]));
  const verdicts: ReconcileVerdict[] = [];

  for (const op of operations) {
    if (op.status !== "pending") continue;
    if (op.vehicleId !== vehicleId) continue;
    if (
      op.kind !== "fillup.add" &&
      op.kind !== "fillup.update" &&
      op.kind !== "fillup.restore" &&
      op.kind !== "fillup.delete"
    ) {
      continue;
    }

    const server = byId.get(op.docId);

    if (op.kind === "fillup.delete") {
      if (!server) verdicts.push({ opId: op.opId, verdict: "synced" });
      else if (server.hasPendingWrites) verdicts.push({ opId: op.opId, verdict: "still-pending" });
      else
        verdicts.push({
          opId: op.opId,
          verdict: "unconfirmed",
          reason: "הרשומה עדיין קיימת בשרת — המחיקה לא אושרה",
        });
      continue;
    }

    if (!server) {
      verdicts.push({
        opId: op.opId,
        verdict: "unconfirmed",
        reason: "הרשומה לא נמצאת בשרת ואינה ממתינה לשליחה — כנראה נדחתה",
      });
      continue;
    }
    if (server.hasPendingWrites) {
      verdicts.push({ opId: op.opId, verdict: "still-pending" });
      continue;
    }
    if (op.payload && matches(op.payload, server.data)) {
      verdicts.push({ opId: op.opId, verdict: "synced" });
    } else {
      verdicts.push({ opId: op.opId, verdict: "conflict", serverImage: server.data });
    }
  }

  return verdicts;
}

/**
 * True when ANY account on this device has an operation the server has not
 * acknowledged. Firestore's persistent cache is shared by every account that
 * signed in on the device, so clearing it on one account's sign-out would
 * also drop another account's queued writes.
 */
export function hasAnyUnacknowledged(storage: KeyValueStorage & { length: number; key(i: number): string | null }): boolean {
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const name = storage.key(i);
      if (!name?.startsWith(`${PREFIX}.`)) continue;
      const raw = storage.getItem(name);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Partial<OutboxSnapshot>;
      if (Array.isArray(parsed.operations) && parsed.operations.length > 0) return true;
    }
  } catch {
    // Unreadable storage: assume nothing is pending rather than block sign-out.
  }
  return false;
}

/** Hebrew label for an outbox status, kept distinct from the sync labels. */
export function outboxStatusText(status: OutboxStatus): string {
  switch (status) {
    case "pending":
      return "ממתין לאישור השרת";
    case "failed":
      return "נדחה — הנתונים נשמרו לתיקון";
    case "conflict":
      return "התנגשות עם גרסה חדשה יותר";
  }
}

/** A portable, human-readable export of the operations (no credentials). */
export function exportOperations(operations: readonly OutboxOperation[]): string {
  return JSON.stringify(
    {
      format: "tank-malle-outbox-export-v1",
      exportedAt: new Date().toISOString(),
      operations,
    },
    null,
    2,
  );
}
