/**
 * Durable outbox — IndexedDB, transactional, per account.
 *
 * Firestore's persistent cache makes a write feel instant and keeps it queued
 * while offline — but when the SERVER rejects a write (rules, validation, a
 * permission problem), the SDK rolls the local copy back and the record is
 * gone from every place the app can see. The in-memory `WriteTracker` knew a
 * write had failed; it never kept WHAT had failed.
 *
 * This module keeps the user's input itself, per account, BEFORE the write is
 * handed to Firestore:
 *
 *   pending   → journaled locally; Firestore's own queue owns delivery
 *   failed    → the server rejected it (or its fate is unknown after a
 *               reload); the payload is intact and retryable
 *   conflict  → a retry found a newer acknowledged version on the server
 *   (synced)  → the server acknowledged it; the entry is removed
 *
 * Three properties the first version of this file did not have:
 *
 *  1. Every transition is ONE IndexedDB transaction, so two tabs (or two
 *     callbacks in one tab) cannot interleave a read-modify-write and lose
 *     each other's entry. Re-reading before writing was never a lock.
 *  2. Every operation carries an immutable `version` that changes whenever
 *     its input changes (an edit-and-resend) or a retry is claimed. An
 *     acknowledgement or a rejection is bound to the version it was issued
 *     for: a late answer to version 1 can never remove or mark version 2.
 *  3. Unreadable storage is UNKNOWN, not empty. A legacy localStorage entry
 *     that fails to parse is quarantined byte-for-byte, never overwritten,
 *     and the account is reported as "state unknown" so nothing claims
 *     "all synced" and nothing clears a cache on the strength of it.
 *
 * It is deliberately NOT a second dispatcher. Delivery of a pending write is
 * still Firestore's job; the outbox only remembers, reconciles and — on an
 * explicit user action — retries. Nothing here touches React or Firebase.
 *
 * Storage limits, honestly: IndexedDB survives reloads, crashes and
 * sign-outs; it does not survive "clear site data", storage eviction under
 * pressure, or a lost device. The export on the unsynced screen is the backup
 * for those.
 */

import type { MutationKind } from "./writes";

export type OutboxStatus = "pending" | "failed" | "conflict";

/** Every user-data mutation kind is journaled. */
export type OutboxKind = MutationKind;

/** What the write does to its document, so a retry can be rebuilt generically. */
export type OutboxOpType = "set" | "update" | "delete";

/** A JSON-safe document body. Dates are epoch ms; server timestamps are sentinels. */
export type OutboxPayload = Record<string, unknown>;

export interface OutboxError {
  code: string;
  message: string;
  at: number;
}

export interface OutboxOperation {
  /** Stable operation id. Survives retries and edits; a retry never mints a new one. */
  opId: string;
  uid: string;
  vehicleId: string | null;
  kind: OutboxKind;
  opType: OutboxOpType;
  /** Full Firestore document path, e.g. `users/u1/vehicles/v1/fillups/f1`. */
  path: string;
  /** Account-scoped document identity: uid + collection + document. */
  docKey: string;
  /** Last path segment, for display and routing. */
  docId: string;
  /** Complete serialisable payload for set/update; null for deletes. */
  payload: OutboxPayload | null;
  /** The document as the client last saw it before an update/delete, when known. */
  beforeImage: OutboxPayload | null;
  /** Per-document revision within this account; a later revision supersedes. */
  revision: number;
  /**
   * Immutable identity of THIS input and attempt. Bumped on every
   * edit-and-resend and every claimed retry. Acknowledgements and rejections
   * carry the version they were issued for and apply only if it still holds.
   */
  version: number;
  status: OutboxStatus;
  error: OutboxError | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  /** Client build that produced the operation, for diagnosis. */
  clientVersion: string;
  /** Set when a conflict was detected: what the server held at that moment. */
  serverImage?: OutboxPayload | null;
  /** Groups the rows of one import (or one rollback) together. */
  batchId?: string | null;
}

export interface OutboxSnapshot {
  operations: OutboxOperation[];
}

/** The subset of the Web Storage API the legacy migration needs; injectable for tests. */
export interface KeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type OutboxHealthState =
  /** Storage is readable and writable; an empty list really is empty. */
  | "ok"
  /**
   * A legacy entry for this account could not be read and was quarantined.
   * Its bytes are preserved; what it contained is unknown.
   */
  | "corrupt-legacy"
  /** IndexedDB could not be opened. Nothing can be journaled or trusted. */
  | "unavailable";

export interface OutboxHealth {
  state: OutboxHealthState;
  /** localStorage keys holding quarantined bytes for this account. */
  quarantined: string[];
  message: string | null;
}

export class OutboxStorageError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "OutboxStorageError";
    this.cause = cause;
  }
}

/* ------------------------------------------------------------------ *
 * Keys and naming
 * ------------------------------------------------------------------ */

const LEGACY_VERSION = 1;
const LEGACY_PREFIX = `tm.outbox.v${LEGACY_VERSION}`;
const MIGRATED_PREFIX = `${LEGACY_PREFIX}.migrated`;
export const QUARANTINE_PREFIX = "tm.outbox.quarantine";

export const OUTBOX_DB_NAME = "tm-outbox";
const DB_VERSION = 1;
const STORE_OPS = "operations";
const STORE_DOCS = "documents";
const CHANNEL = "tm-outbox";

/** The legacy localStorage key of an account's outbox (pre-IndexedDB). */
export function outboxKey(uid: string): string {
  return `${LEGACY_PREFIX}.${uid}`;
}

export function docKeyFor(uid: string, path: string): string {
  return `${uid}|${path}`;
}

let counter = 0;

/** Unique enough for one browser profile: time, a counter and randomness. */
export function newOpId(now = Date.now()): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `op_${now.toString(36)}_${counter.toString(36)}_${random}`;
}

/** Firestore document path → its last segment. */
export function docIdOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Firestore document path → its collection path. */
export function collectionOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

/* ------------------------------------------------------------------ *
 * IndexedDB plumbing
 * ------------------------------------------------------------------ */

type IDBFactoryLike = Pick<IDBFactory, "open" | "databases">;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function openDatabase(factory: IDBFactoryLike, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(name, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_OPS)) {
        const ops = db.createObjectStore(STORE_OPS, { keyPath: "opId" });
        ops.createIndex("uid", "uid", { unique: false });
        ops.createIndex("docKey", "docKey", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_DOCS)) {
        db.createObjectStore(STORE_DOCS, { keyPath: "docKey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

/**
 * Run `work` inside ONE transaction. Everything read and written by `work`
 * is atomic with respect to every other transaction on the same stores,
 * across tabs — that is the whole point of moving off localStorage.
 */
function transact<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (ops: IDBObjectStore, docs: IDBObjectStore) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([STORE_OPS, STORE_DOCS], mode);
    } catch (error) {
      reject(error);
      return;
    }
    let result: T;
    let failed: unknown = null;
    tx.oncomplete = () => (failed ? reject(failed) : resolve(result));
    tx.onerror = () => reject(tx.error ?? failed ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? failed ?? new Error("IndexedDB transaction aborted"));
    work(tx.objectStore(STORE_OPS), tx.objectStore(STORE_DOCS)).then(
      (value) => {
        result = value;
      },
      (error: unknown) => {
        failed = error;
        try {
          tx.abort();
        } catch {
          /* already finished */
        }
      },
    );
  });
}

interface DocumentRow {
  docKey: string;
  revision: number;
}

/* ------------------------------------------------------------------ *
 * Legacy record shape (localStorage era), for migration
 * ------------------------------------------------------------------ */

interface LegacyOperation {
  opId: string;
  uid: string;
  vehicleId: string | null;
  kind: string;
  docId: string;
  payload: OutboxPayload | null;
  beforeImage: OutboxPayload | null;
  revision: number;
  status: OutboxStatus;
  error: OutboxError | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  clientVersion: string;
  serverImage?: OutboxPayload | null;
}

function legacyPath(op: LegacyOperation): string | null {
  const vehicle = op.vehicleId;
  if (op.kind.startsWith("fillup.") && vehicle) {
    return `users/${op.uid}/vehicles/${vehicle}/fillups/${op.docId}`;
  }
  if (op.kind.startsWith("tank.observation") && vehicle) {
    return `users/${op.uid}/vehicles/${vehicle}/observations/${op.docId}`;
  }
  if (op.kind === "vehicle.delete") return `users/${op.uid}/vehicles/${op.docId}`;
  return null;
}

export function opTypeForKind(kind: OutboxKind): OutboxOpType {
  if (kind.endsWith(".delete") || kind === "import.rollback") return "delete";
  if (kind === "fillup.update" || kind === "vehicle.update" || kind === "settings.update") {
    return "update";
  }
  return "set";
}

/* ------------------------------------------------------------------ *
 * The outbox
 * ------------------------------------------------------------------ */

export interface EnqueueInput {
  kind: OutboxKind;
  /** Full document path. */
  path: string;
  vehicleId: string | null;
  payload: OutboxPayload | null;
  beforeImage?: OutboxPayload | null;
  opType?: OutboxOpType;
  /** Reuse an existing op id: an edit of a failed or pending op replaces it. */
  replaceOpId?: string | null;
  batchId?: string | null;
}

export interface OutboxOptions {
  indexedDB?: IDBFactoryLike | null;
  /** localStorage, for the one-time legacy migration and quarantine. */
  storage?: KeyValueStorage | null;
  dbName?: string;
  now?: () => number;
  /** Cross-tab change notification; a fresh channel per instance by default. */
  channel?: { postMessage(message: unknown): void; addEventListener?: unknown } | null;
}

export class Outbox {
  readonly uid: string;
  private readonly db: IDBDatabase;
  private readonly clientVersion: string;
  private readonly now: () => number;
  private readonly channel: BroadcastChannel | null;
  private readonly listeners = new Set<(snapshot: OutboxSnapshot) => void>();
  private healthState: OutboxHealth;
  private closed = false;

  private constructor(
    uid: string,
    db: IDBDatabase,
    clientVersion: string,
    now: () => number,
    channel: BroadcastChannel | null,
    health: OutboxHealth,
  ) {
    this.uid = uid;
    this.db = db;
    this.clientVersion = clientVersion;
    this.now = now;
    this.channel = channel;
    this.healthState = health;
    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        const data = event.data as { uid?: string } | null;
        if (!data || data.uid === uid) void this.notify();
      };
    }
  }

  /**
   * Open an account's outbox. Migrates the legacy localStorage entry if one
   * exists (losslessly: the bytes are copied first and only then removed),
   * and quarantines it instead if it cannot be read.
   *
   * Throws `OutboxStorageError` when IndexedDB cannot be opened; the caller
   * must then treat the account's state as UNKNOWN.
   */
  static async open(
    uid: string,
    clientVersion: string,
    options: OutboxOptions = {},
  ): Promise<Outbox> {
    const factory =
      options.indexedDB ??
      (typeof indexedDB !== "undefined" ? (indexedDB as IDBFactoryLike) : null);
    if (!factory) {
      throw new OutboxStorageError("אחסון IndexedDB אינו זמין בדפדפן הזה");
    }
    const now = options.now ?? (() => Date.now());
    let db: IDBDatabase;
    try {
      db = await openDatabase(factory, options.dbName ?? OUTBOX_DB_NAME);
    } catch (error) {
      throw new OutboxStorageError("לא ניתן לפתוח את אחסון הפעולות המקומי", error);
    }
    const channel =
      options.channel === null
        ? null
        : typeof BroadcastChannel !== "undefined"
          ? new BroadcastChannel(CHANNEL)
          : null;

    const health = await migrateLegacy(uid, db, options.storage ?? defaultStorage(), clientVersion, now);
    return new Outbox(uid, db, clientVersion, now, channel, health);
  }

  health(): OutboxHealth {
    return this.healthState;
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    this.channel?.close();
    this.db.close();
  }

  /* ---------- reads ---------- */

  async list(): Promise<OutboxOperation[]> {
    const rows = await transact(this.db, "readonly", (ops) =>
      request(ops.index("uid").getAll(IDBKeyRange.only(this.uid))),
    );
    return (rows as OutboxOperation[]).sort((a, b) => a.createdAt - b.createdAt);
  }

  async get(opId: string): Promise<OutboxOperation | null> {
    const row = await transact(this.db, "readonly", (ops) => request(ops.get(opId)));
    const op = (row ?? null) as OutboxOperation | null;
    return op && op.uid === this.uid ? op : null;
  }

  async revisionOf(path: string): Promise<number> {
    const row = (await transact(this.db, "readonly", (_ops, docs) =>
      request(docs.get(docKeyFor(this.uid, path))),
    )) as DocumentRow | undefined;
    return row?.revision ?? 0;
  }

  subscribe(listener: (snapshot: OutboxSnapshot) => void): () => void {
    this.listeners.add(listener);
    void this.list().then((operations) => {
      if (this.listeners.has(listener)) listener({ operations });
    });
    return () => void this.listeners.delete(listener);
  }

  /** Re-read and notify local listeners (another tab wrote, or we did). */
  async notify(): Promise<void> {
    if (this.closed || this.listeners.size === 0) return;
    const operations = await this.list().catch(() => null);
    if (!operations) return;
    for (const listener of this.listeners) listener({ operations });
  }

  private broadcast(): void {
    try {
      this.channel?.postMessage({ uid: this.uid });
    } catch {
      /* channel closed */
    }
    void this.notify();
  }

  /* ---------- transitions (each one transaction) ---------- */

  /**
   * Journal an operation BEFORE the write is submitted.
   *
   * With `replaceOpId`, the existing entry is superseded in place: same id,
   * a higher revision for its document, and a NEW version — so an answer
   * that arrives later for the previous input cannot touch this one.
   */
  async enqueue(input: EnqueueInput): Promise<OutboxOperation> {
    const [op] = await this.enqueueMany([input]);
    return op;
  }

  /** Several operations, atomically: either all are journaled or none. */
  async enqueueMany(inputs: EnqueueInput[]): Promise<OutboxOperation[]> {
    const now = this.now();
    let result: OutboxOperation[];
    try {
      result = await transact(this.db, "readwrite", async (ops, docs) => {
        const out: OutboxOperation[] = [];
        for (const input of inputs) {
          const docKey = docKeyFor(this.uid, input.path);
          const docRow = ((await request(docs.get(docKey))) ?? { docKey, revision: 0 }) as DocumentRow;
          const revision = docRow.revision + 1;
          await request(docs.put({ docKey, revision } satisfies DocumentRow));

          const existing = input.replaceOpId
            ? ((await request(ops.get(input.replaceOpId))) as OutboxOperation | undefined)
            : undefined;
          const op: OutboxOperation = {
            opId: input.replaceOpId ?? newOpId(now),
            uid: this.uid,
            vehicleId: input.vehicleId,
            kind: input.kind,
            opType: input.opType ?? opTypeForKind(input.kind),
            path: input.path,
            docKey,
            docId: docIdOf(input.path),
            payload: input.payload,
            beforeImage: input.beforeImage ?? null,
            revision,
            version: (existing?.version ?? 0) + 1,
            status: "pending",
            error: null,
            attempts: (existing?.attempts ?? 0) + 1,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            clientVersion: this.clientVersion,
            serverImage: null,
            batchId: input.batchId ?? existing?.batchId ?? null,
          };
          await request(ops.put(op));
          out.push(op);
        }
        return out;
      });
    } catch (error) {
      throw new OutboxStorageError("האחסון המקומי מלא או אינו זמין — הרשומה לא נשמרה", error);
    }
    this.broadcast();
    return result;
  }

  /**
   * The server acknowledged THIS version. Returns false — and changes
   * nothing — when the entry has since been edited or retried (its version
   * moved on), or was already removed.
   */
  async acknowledge(opId: string, version: number): Promise<boolean> {
    const done = await this.transition(opId, version, () => null);
    if (done) this.broadcast();
    return done;
  }

  /** The server rejected THIS version. The payload stays exactly as it was. */
  async fail(opId: string, version: number, error: OutboxError): Promise<boolean> {
    const done = await this.transition(opId, version, (op) =>
      // A conflict already explains this rejection better than the bare
      // error code; a later plain rejection must not downgrade it.
      op.status === "conflict"
        ? op
        : { ...op, status: "failed", error, updatedAt: this.now() },
    );
    if (done) this.broadcast();
    return done;
  }

  /** A retry of THIS version found a newer acknowledged document on the server. */
  async markConflict(
    opId: string,
    version: number,
    serverImage: OutboxPayload | null,
  ): Promise<boolean> {
    const done = await this.transition(opId, version, (op) => ({
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
    if (done) this.broadcast();
    return done;
  }

  /**
   * Claim a retry. Atomic: only a failed or conflicted entry can be claimed,
   * and claiming it moves it to pending under a new version — so a second
   * tab pressing "retry" at the same moment finds it pending and gets null,
   * and the SDK never receives two competing writes for one input.
   */
  async claimRetry(opId: string): Promise<OutboxOperation | null> {
    let claimed: OutboxOperation | null = null;
    await transact(this.db, "readwrite", async (ops) => {
      const op = (await request(ops.get(opId))) as OutboxOperation | undefined;
      if (!op || op.uid !== this.uid || op.status === "pending") return;
      claimed = {
        ...op,
        status: "pending",
        error: null,
        serverImage: null,
        version: op.version + 1,
        attempts: op.attempts + 1,
        updatedAt: this.now(),
      };
      await request(ops.put(claimed));
    });
    if (claimed) this.broadcast();
    return claimed;
  }

  /**
   * Re-base a conflicted update on what the server holds now, so the next
   * retry compares — and the server's version check counts — against the
   * right base. Only meaningful for a conflicted entry.
   */
  async rebase(
    opId: string,
    serverImage: OutboxPayload,
    payloadPatch: OutboxPayload,
  ): Promise<OutboxOperation | null> {
    let rebased: OutboxOperation | null = null;
    await transact(this.db, "readwrite", async (ops) => {
      const op = (await request(ops.get(opId))) as OutboxOperation | undefined;
      if (!op || op.uid !== this.uid || op.status !== "conflict") return;
      rebased = {
        ...op,
        beforeImage: serverImage,
        payload: op.payload ? { ...op.payload, ...payloadPatch } : op.payload,
        serverImage: null,
        version: op.version + 1,
        updatedAt: this.now(),
      };
      await request(ops.put(rebased));
    });
    if (rebased) this.broadcast();
    return rebased;
  }

  /**
   * Explicit user discard. Removes the JOURNAL ENTRY only: a write the SDK
   * already holds in its own queue is not cancelled by this and may still
   * reach the server. The UI says so before offering it on a pending entry.
   */
  async discard(opId: string): Promise<void> {
    await transact(this.db, "readwrite", async (ops) => {
      const op = (await request(ops.get(opId))) as OutboxOperation | undefined;
      if (op && op.uid === this.uid) await request(ops.delete(opId));
    });
    this.broadcast();
  }

  private async transition(
    opId: string,
    version: number,
    update: (op: OutboxOperation) => OutboxOperation | null,
  ): Promise<boolean> {
    return transact(this.db, "readwrite", async (ops) => {
      const op = (await request(ops.get(opId))) as OutboxOperation | undefined;
      if (!op || op.uid !== this.uid || op.version !== version) return false;
      const next = update(op);
      if (next === null) await request(ops.delete(opId));
      else await request(ops.put(next));
      return true;
    });
  }
}

/* ------------------------------------------------------------------ *
 * Device-wide state, for sign-out and cache decisions
 * ------------------------------------------------------------------ */

export type UnacknowledgedState = "none" | "some" | "unknown";

/**
 * Whether ANY account on this device has journaled writes the server has
 * not acknowledged. "unknown" — storage unreadable, or quarantined legacy
 * bytes that were never read — must be treated as "maybe": never as
 * permission to clear anything.
 */
export async function unacknowledgedState(options: OutboxOptions = {}): Promise<UnacknowledgedState> {
  const storage = options.storage ?? defaultStorage();
  let unknown = false;
  if (storage) {
    try {
      for (let i = 0; i < storage.length; i += 1) {
        const name = storage.key(i) ?? "";
        if (name.startsWith(`${QUARANTINE_PREFIX}.`)) unknown = true;
        // A legacy entry nobody has migrated yet (that account has not
        // signed in since the upgrade) still holds journaled input.
        if (name.startsWith(`${LEGACY_PREFIX}.`) && !name.startsWith(`${MIGRATED_PREFIX}.`)) {
          const raw = storage.getItem(name);
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw) as Partial<OutboxSnapshot>;
            if (Array.isArray(parsed.operations) && parsed.operations.length > 0) return "some";
          } catch {
            unknown = true;
          }
        }
      }
    } catch {
      unknown = true;
    }
  }

  const factory =
    options.indexedDB ??
    (typeof indexedDB !== "undefined" ? (indexedDB as IDBFactoryLike) : null);
  if (!factory) return "unknown";
  try {
    const db = await openDatabase(factory, options.dbName ?? OUTBOX_DB_NAME);
    try {
      const count = await transact(db, "readonly", (ops) => request(ops.count()));
      if (count > 0) return "some";
    } finally {
      db.close();
    }
  } catch {
    return "unknown";
  }
  return unknown ? "unknown" : "none";
}

/* ------------------------------------------------------------------ *
 * Legacy migration
 * ------------------------------------------------------------------ */

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function quarantinedKeys(storage: KeyValueStorage | null, uid: string): string[] {
  if (!storage) return [];
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const name = storage.key(i) ?? "";
      if (name.startsWith(`${QUARANTINE_PREFIX}.${uid}.`)) keys.push(name);
    }
  } catch {
    /* unreadable: reported by the caller */
  }
  return keys;
}

/**
 * Move a legacy localStorage outbox into IndexedDB.
 *
 * Copy-then-remove, and idempotent: a crash halfway leaves both copies, and
 * the next open simply re-imports entries that are not there yet. Bytes that
 * cannot be read are moved to a quarantine key — never parsed "as empty",
 * never overwritten — and reported.
 */
async function migrateLegacy(
  uid: string,
  db: IDBDatabase,
  storage: KeyValueStorage | null,
  clientVersion: string,
  now: () => number,
): Promise<OutboxHealth> {
  const quarantined = quarantinedKeys(storage, uid);
  const health: OutboxHealth = {
    state: quarantined.length > 0 ? "corrupt-legacy" : "ok",
    quarantined,
    message:
      quarantined.length > 0
        ? "רשומה ישנה של פעולות לא סונכרנו לא ניתנת לקריאה ונשמרה בצד. ייתכן שיש פעולות שלא מופיעות כאן."
        : null,
  };
  if (!storage) return health;

  const key = outboxKey(uid);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { state: "corrupt-legacy", quarantined, message: "האחסון המקומי אינו קריא" };
  }
  if (!raw) return health;

  let parsed: { operations?: unknown } | null = null;
  try {
    parsed = JSON.parse(raw) as { operations?: unknown };
  } catch {
    parsed = null;
  }

  if (!parsed || !Array.isArray(parsed.operations)) {
    const quarantineKey = `${QUARANTINE_PREFIX}.${uid}.${now()}`;
    try {
      storage.setItem(quarantineKey, raw);
      storage.removeItem(key);
    } catch {
      // Could not even copy it aside: leave the original untouched.
    }
    return {
      state: "corrupt-legacy",
      quarantined: [...quarantined, quarantineKey],
      message:
        "רשומה ישנה של פעולות לא סונכרנו לא ניתנת לקריאה ונשמרה בצד. ייתכן שיש פעולות שלא מופיעות כאן.",
    };
  }

  const legacy = (parsed.operations as unknown[]).filter(
    (op): op is LegacyOperation =>
      Boolean(op) && typeof (op as LegacyOperation).opId === "string" && (op as LegacyOperation).uid === uid,
  );

  const unmappable: LegacyOperation[] = [];
  await transact(db, "readwrite", async (ops, docs) => {
    for (const op of legacy) {
      const existing = await request(ops.get(op.opId));
      if (existing) continue;
      const path = legacyPath(op);
      if (!path) {
        unmappable.push(op);
        continue;
      }
      const docKey = docKeyFor(uid, path);
      const docRow = ((await request(docs.get(docKey))) ?? { docKey, revision: 0 }) as DocumentRow;
      const revision = Math.max(docRow.revision, op.revision ?? 0) + 1;
      await request(docs.put({ docKey, revision } satisfies DocumentRow));
      const migrated: OutboxOperation = {
        opId: op.opId,
        uid,
        vehicleId: op.vehicleId ?? null,
        kind: op.kind as OutboxKind,
        opType: opTypeForKind(op.kind as OutboxKind),
        path,
        docKey,
        docId: docIdOf(path),
        payload: op.payload ?? null,
        beforeImage: op.beforeImage ?? null,
        revision,
        version: 1,
        status: op.status ?? "pending",
        error: op.error ?? null,
        attempts: op.attempts ?? 1,
        createdAt: op.createdAt ?? now(),
        updatedAt: op.updatedAt ?? now(),
        clientVersion: op.clientVersion ?? clientVersion,
        serverImage: op.serverImage ?? null,
        batchId: null,
      };
      await request(ops.put(migrated));
    }
  });

  try {
    if (unmappable.length > 0) {
      // Keep what could not be mapped, byte-exact, rather than dropping it.
      storage.setItem(`${QUARANTINE_PREFIX}.${uid}.${now()}`, JSON.stringify({ operations: unmappable }));
    }
    storage.setItem(`${MIGRATED_PREFIX}.${uid}`, raw);
    storage.removeItem(key);
  } catch {
    // The copy into IndexedDB succeeded; a failed rename only means the next
    // open re-imports idempotently.
  }
  return unmappable.length > 0
    ? {
        state: "corrupt-legacy",
        quarantined: quarantinedKeys(storage, uid),
        message: "חלק מהפעולות הישנות לא ניתנות לשיוך ונשמרו בצד.",
      }
    : health;
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
  | { opId: string; version: number; verdict: "synced" }
  | { opId: string; version: number; verdict: "still-pending" }
  | { opId: string; version: number; verdict: "unconfirmed"; reason: string }
  | { opId: string; version: number; verdict: "conflict"; serverImage: OutboxPayload | null };

/**
 * Decide the fate of pending operations from a SERVER-sourced snapshot of
 * one collection.
 *
 * Call only with a snapshot whose metadata says it did not come from cache.
 * Firestore replays queued mutations across reloads, so a pending set/update
 * is either still in the SDK's queue (its document shows `hasPendingWrites`),
 * already acknowledged (the document is on the server with the op's content),
 * or gone — rejected, which a plain listener reads as "deleted".
 *
 * A pending DELETE is different: the local view hides a document the SDK is
 * still deleting, so absence proves nothing while the snapshot carries any
 * pending write. Deletes are only confirmed from a snapshot with none.
 */
export function reconcileWithServer(
  operations: readonly OutboxOperation[],
  collectionPath: string,
  documents: readonly ServerDocument[],
  matches: (payload: OutboxPayload, server: OutboxPayload) => boolean,
  snapshotHasPendingWrites = false,
): ReconcileVerdict[] {
  const byId = new Map(documents.map((entry) => [entry.id, entry]));
  const verdicts: ReconcileVerdict[] = [];

  for (const op of operations) {
    if (op.status === "conflict") continue;
    if (collectionOf(op.path) !== collectionPath) continue;

    const server = byId.get(op.docId);
    const base = { opId: op.opId, version: op.version };

    // A FAILED entry is not re-judged as pending, but the server can still
    // say something more precise about it: its content already landed (an
    // earlier attempt got through), or the document moved past its base —
    // which is a conflict, whether the rejection or this snapshot came first.
    if (op.status === "failed") {
      if (op.opType === "delete" || !server || server.hasPendingWrites) continue;
      if (op.payload && matches(op.payload, server.data)) {
        verdicts.push({ ...base, verdict: "synced" });
      } else if (
        op.opType === "update" &&
        op.beforeImage &&
        !sameBase(op.beforeImage, server.data, matches)
      ) {
        verdicts.push({ ...base, verdict: "conflict", serverImage: server.data });
      } else if (op.opType === "set" && op.kind !== "fillup.restore") {
        verdicts.push({ ...base, verdict: "conflict", serverImage: server.data });
      }
      continue;
    }

    if (op.opType === "delete") {
      if (server) {
        if (server.hasPendingWrites || snapshotHasPendingWrites) {
          verdicts.push({ ...base, verdict: "still-pending" });
        } else {
          verdicts.push({
            ...base,
            verdict: "unconfirmed",
            reason: "הרשומה עדיין קיימת בשרת — המחיקה לא אושרה",
          });
        }
      } else if (snapshotHasPendingWrites) {
        verdicts.push({ ...base, verdict: "still-pending" });
      } else {
        verdicts.push({ ...base, verdict: "synced" });
      }
      continue;
    }

    if (!server) {
      verdicts.push({
        ...base,
        verdict: "unconfirmed",
        reason: "הרשומה לא נמצאת בשרת ואינה ממתינה לשליחה — כנראה נדחתה",
      });
      continue;
    }
    if (server.hasPendingWrites) {
      verdicts.push({ ...base, verdict: "still-pending" });
      continue;
    }
    if (op.payload && matches(op.payload, server.data)) {
      verdicts.push({ ...base, verdict: "synced" });
      continue;
    }
    // An UPDATE whose base the server still holds has simply not landed —
    // refused or lost — which is a rejection to retry, not a conflict. Only
    // a server document that differs from BOTH the input and its base means
    // somebody else wrote in between.
    if (op.opType === "update" && op.beforeImage && sameBase(op.beforeImage, server.data, matches)) {
      verdicts.push({
        ...base,
        verdict: "unconfirmed",
        reason: "העדכון לא הגיע לשרת — כנראה נדחה",
      });
      continue;
    }
    verdicts.push({ ...base, verdict: "conflict", serverImage: server.data });
  }

  return verdicts;
}

/**
 * Whether the server still holds the document an update was based on. A
 * concurrency version decides when both sides carry one; otherwise the
 * content comparison does.
 */
function sameBase(
  before: OutboxPayload,
  server: OutboxPayload,
  matches: (a: OutboxPayload, b: OutboxPayload) => boolean,
): boolean {
  const mine = before.version;
  const theirs = server.version;
  if (typeof mine === "number" || typeof theirs === "number") {
    return (typeof mine === "number" ? mine : 0) === (typeof theirs === "number" ? theirs : 0);
  }
  return matches(before, server);
}

/**
 * Pending entries that belong to NO in-flight promise on this page — every
 * entry that was pending when the outbox opened — grouped so that only the
 * newest revision per document is verified against the server. Older
 * revisions of the same document were superseded by that newest input; they
 * are settled with it rather than judged on their own (an older settings
 * toggle "differs" from a server that already holds the newer one, and that
 * is not a conflict).
 */
export interface OrphanGroup {
  newest: OutboxOperation;
  superseded: OutboxOperation[];
}

export function orphanGroups(operations: readonly OutboxOperation[]): OrphanGroup[] {
  const byDoc = new Map<string, OutboxOperation[]>();
  for (const op of operations) {
    if (op.status !== "pending") continue;
    const list = byDoc.get(op.docKey) ?? [];
    list.push(op);
    byDoc.set(op.docKey, list);
  }
  const groups: OrphanGroup[] = [];
  for (const list of byDoc.values()) {
    list.sort((a, b) => a.revision - b.revision);
    const newest = list[list.length - 1];
    groups.push({ newest, superseded: list.slice(0, -1) });
  }
  return groups;
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
      format: "tank-malle-outbox-export-v2",
      exportedAt: new Date().toISOString(),
      operations,
    },
    null,
    2,
  );
}
