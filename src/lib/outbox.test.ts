import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  Outbox,
  OutboxStorageError,
  QUARANTINE_PREFIX,
  orphanGroups,
  outboxKey,
  reconcileWithServer,
  unacknowledgedState,
  type KeyValueStorage,
  type OutboxOperation,
} from "./outbox";
import { genericPayloadMatches } from "./writesPayload";
import { fillupPayloadMatches, serializeFillup } from "./fillupSerializer";

/** In-memory Web Storage for the legacy-migration paths. */
function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

let dbCounter = 0;
/** A fresh IndexedDB per test, so no test can see another's rows. */
function fresh() {
  dbCounter += 1;
  return {
    indexedDB: new IDBFactory(),
    dbName: `test-outbox-${dbCounter}`,
    storage: memoryStorage(),
    channel: null as null,
  };
}

const PATH = "users/alice/vehicles/v1/fillups/f1";

const payload = (over: Record<string, unknown> = {}) =>
  serializeFillup({
    date: Date.UTC(2026, 8, 5, 8, 0),
    odometer: 123_456,
    liters: 38.2,
    pricePerLiter: 7.19,
    totalCost: 274.66,
    isFullTank: true,
    station: { name: "פז", stationId: "1234" },
    notes: "הערה",
    ...over,
  });

const add = (over: Partial<Parameters<Outbox["enqueue"]>[0]> = {}) => ({
  kind: "fillup.add" as const,
  path: PATH,
  vehicleId: "v1",
  payload: payload(),
  ...over,
});

describe("durability", () => {
  it("persists the full payload before submission and survives a reload", async () => {
    const env = fresh();
    const outbox = await Outbox.open("alice", "1.1.0", env);
    const op = await outbox.enqueue(add());
    outbox.close();

    // "Reload": a new instance over the same database.
    const again = await Outbox.open("alice", "1.1.0", env);
    const stored = (await again.get(op.opId))!;
    expect(stored.status).toBe("pending");
    expect(stored.payload).toEqual(payload());
    expect(stored.path).toBe(PATH);
    expect(stored.docKey).toBe("alice|" + PATH);
    expect(stored.revision).toBe(1);
    expect(stored.version).toBe(1);
    expect(stored.clientVersion).toBe("1.1.0");
  });

  it("keeps an admin price draft account-scoped through offline reload, rejection and safe retry", async () => {
    const env = fresh();
    const outbox = await Outbox.open("alice", "1.1.0", env);
    const draft = { "gasoline95.pricePerLiter": 7.31, "gasoline95.effectiveFrom": 1000, "gasoline95.updatedAt": "__serverTimestamp__" };
    const op = await outbox.enqueue({ kind: "adminPrice.update", path: "appConfig/fuelPrices", vehicleId: null, opType: "update", payload: draft });
    outbox.close();
    const again = await Outbox.open("alice", "1.1.0", env);
    expect((await again.get(op.opId))?.payload).toEqual(draft);
    await again.fail(op.opId, op.version, { code: "permission-denied", message: "denied", at: 1 });
    expect((await again.get(op.opId))?.payload).toEqual(draft);
    const bob = await Outbox.open("bob", "1.1.0", env);
    expect(await bob.list()).toEqual([]);
    const retry = (await again.claimRetry(op.opId))!;
    expect(retry.payload).toEqual(draft);
    expect(retry.version).toBe(op.version + 1);
    const server = { gasoline95: { pricePerLiter: 7.31, effectiveFrom: { toMillis: () => 1000 }, updatedAt: { toMillis: () => 2000 } } };
    expect(genericPayloadMatches(draft, server)).toBe(true);
    expect(genericPayloadMatches(draft, { gasoline95: { ...server.gasoline95, pricePerLiter: 7.32 } })).toBe(false);
    await again.acknowledge(retry.opId, retry.version);
    expect(await again.list()).toEqual([]);
  });

  it("keeps three offline records through reload and a rejection of all of them", async () => {
    const env = fresh();
    const outbox = await Outbox.open("alice", "1.1.0", env);
    const ops = await Promise.all(
      ["f1", "f2", "f3"].map((id) =>
        outbox.enqueue(add({ path: `users/alice/vehicles/v1/fillups/${id}`, payload: payload({ odometer: 1 }) })),
      ),
    );
    outbox.close();

    const reloaded = await Outbox.open("alice", "1.1.0", env);
    expect(await reloaded.list()).toHaveLength(3);
    for (const op of ops) {
      await reloaded.fail(op.opId, op.version, { code: "permission-denied", message: "denied", at: 1 });
    }
    const failed = await reloaded.list();
    expect(failed.every((op) => op.status === "failed" && op.payload !== null)).toBe(true);
    expect(new Set(failed.map((op) => op.docId)).size).toBe(3);
  });

  it("scopes entries by account: B never sees A's, and A's survive B's session", async () => {
    const env = fresh();
    const alice = await Outbox.open("alice", "1.1.0", env);
    await alice.enqueue(add());
    const bob = await Outbox.open("bob", "1.1.0", env);
    expect(await bob.list()).toHaveLength(0);
    await bob.enqueue(add({ path: "users/bob/vehicles/vb/fillups/b1", vehicleId: "vb" }));
    expect((await alice.list()).map((op) => op.docId)).toEqual(["f1"]);
    // B cannot even acknowledge A's entry by guessing its id.
    const aliceOp = (await alice.list())[0];
    expect(await bob.acknowledge(aliceOp.opId, aliceOp.version)).toBe(false);
    expect(await alice.list()).toHaveLength(1);
  });

  it("refuses a false success when storage cannot be written", async () => {
    const env = fresh();
    const outbox = await Outbox.open("alice", "1.1.0", env);
    // Simulate a quota failure: every readwrite transaction refuses to open.
    const db = (outbox as unknown as { db: IDBDatabase }).db;
    const original = db.transaction.bind(db);
    db.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
      if (mode === "readwrite") throw new DOMException("QuotaExceededError", "QuotaExceededError");
      return original(names, mode);
    }) as typeof db.transaction;

    await expect(outbox.enqueue(add())).rejects.toBeInstanceOf(OutboxStorageError);
    expect(await outbox.list()).toHaveLength(0);
  });

  it("refuses to open at all when IndexedDB is unavailable — state unknown, not empty", async () => {
    const broken = {
      open: () => {
        throw new Error("blocked by the browser");
      },
      databases: async () => [],
    };
    await expect(
      Outbox.open("alice", "1.1.0", { indexedDB: broken, storage: memoryStorage(), channel: null }),
    ).rejects.toBeInstanceOf(OutboxStorageError);
    expect(await unacknowledgedState({ indexedDB: broken, storage: memoryStorage() })).toBe("unknown");
  });
});

describe("immutable versions", () => {
  it("a late acknowledgement of version 1 never removes the edited version 2, and its rejection is kept", async () => {
    const env = fresh();
    const outbox = await Outbox.open("alice", "1.1.0", env);
    const v1 = await outbox.enqueue(add({ payload: payload({ liters: 30 }) }));
    // Edit-and-resend under the same op id before v1 settles.
    const v2 = await outbox.enqueue(add({ payload: payload({ liters: 31 }), replaceOpId: v1.opId }));
    expect(v2.opId).toBe(v1.opId);
    expect(v2.version).toBe(2);
    expect(v2.revision).toBe(2);

    // v1's acknowledgement arrives: it must not touch v2.
    expect(await outbox.acknowledge(v1.opId, v1.version)).toBe(false);
    expect((await outbox.get(v1.opId))!.payload!.liters).toBe(31);

    // v2 is rejected: its complete input remains recoverable.
    expect(await outbox.fail(v2.opId, v2.version, { code: "permission-denied", message: "x", at: 1 })).toBe(true);
    const stored = (await outbox.get(v1.opId))!;
    expect(stored.status).toBe("failed");
    expect(stored.payload!.liters).toBe(31);
    expect(stored.version).toBe(2);
  });

  it("a late rejection of version 1 does not mark the newer version failed", async () => {
    const env = fresh();
    const outbox = await Outbox.open("alice", "1.1.0", env);
    const v1 = await outbox.enqueue(add());
    const v2 = await outbox.enqueue(add({ payload: payload({ liters: 40 }), replaceOpId: v1.opId }));
    expect(await outbox.fail(v1.opId, 1, { code: "permission-denied", message: "old", at: 1 })).toBe(false);
    const stored = (await outbox.get(v2.opId))!;
    expect(stored.status).toBe("pending");
    expect(stored.error).toBeNull();
  });

  it("a claimed retry moves the version, so the pre-retry answer is ignored", async () => {
    const env = fresh();
    const outbox = await Outbox.open("alice", "1.1.0", env);
    const op = await outbox.enqueue(add());
    await outbox.fail(op.opId, op.version, { code: "permission-denied", message: "x", at: 1 });
    const retried = (await outbox.claimRetry(op.opId))!;
    expect(retried.version).toBe(2);
    expect(retried.attempts).toBe(2);
    expect(retried.status).toBe("pending");
    // The original write's rejection lands late.
    expect(await outbox.fail(op.opId, 1, { code: "permission-denied", message: "late", at: 2 })).toBe(false);
    expect((await outbox.get(op.opId))!.status).toBe("pending");
    // The retry's own acknowledgement lands.
    expect(await outbox.acknowledge(op.opId, 2)).toBe(true);
    expect(await outbox.get(op.opId)).toBeNull();
  });

  it("only a failed or conflicted entry can be claimed for retry, and only once", async () => {
    const env = fresh();
    const outbox = await Outbox.open("alice", "1.1.0", env);
    const op = await outbox.enqueue(add());
    // Pending: the SDK still owns the write.
    expect(await outbox.claimRetry(op.opId)).toBeNull();
    await outbox.fail(op.opId, op.version, { code: "x", message: "x", at: 1 });
    // Two tabs press retry at once: exactly one claim succeeds.
    const [a, b] = await Promise.all([outbox.claimRetry(op.opId), outbox.claimRetry(op.opId)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("a plain rejection never downgrades a conflict verdict", async () => {
    const env = fresh();
    const outbox = await Outbox.open("alice", "1.1.0", env);
    const op = await outbox.enqueue(add());
    await outbox.markConflict(op.opId, op.version, payload({ liters: 99 }));
    await outbox.fail(op.opId, op.version, { code: "permission-denied", message: "late", at: 1 });
    const stored = (await outbox.get(op.opId))!;
    expect(stored.status).toBe("conflict");
    expect(stored.serverImage!.liters).toBe(99);
  });

  it("conflict resolution re-bases on the server image under a new version", async () => {
    const env = fresh();
    const outbox = await Outbox.open("alice", "1.1.0", env);
    const op = await outbox.enqueue({ ...add({ kind: "fillup.update", payload: payload({ version: 2 }) }), beforeImage: payload({ version: 1 }) });
    await outbox.markConflict(op.opId, op.version, payload({ liters: 50, version: 5 }));
    const rebased = (await outbox.rebase(op.opId, payload({ liters: 50, version: 5 }), { version: 6 }))!;
    expect(rebased.beforeImage!.version).toBe(5);
    expect(rebased.payload!.version).toBe(6);
    expect(rebased.payload!.liters).toBe(38.2);
    expect(rebased.version).toBe(op.version + 1);
    expect(rebased.status).toBe("conflict");
    expect(await outbox.claimRetry(op.opId)).not.toBeNull();
  });
});

describe("concurrency (two clients on one database)", () => {
  it("simultaneous enqueues from two pages are both retained with distinct revisions", async () => {
    const env = fresh();
    const tabA = await Outbox.open("alice", "1.1.0", env);
    const tabB = await Outbox.open("alice", "1.1.0", env);
    const results = await Promise.all([
      tabA.enqueue(add({ kind: "fillup.update", payload: payload({ liters: 1 }) })),
      tabB.enqueue(add({ kind: "fillup.update", payload: payload({ liters: 2 }) })),
      tabA.enqueue(add({ path: "users/alice/vehicles/v1/fillups/f2", payload: payload({ liters: 3 }) })),
      tabB.enqueue(add({ path: "users/alice/vehicles/v1/fillups/f3", payload: payload({ liters: 4 }) })),
    ]);
    const stored = await tabB.list();
    expect(stored).toHaveLength(4);
    expect(new Set(results.filter((op) => op.path === PATH).map((op) => op.revision))).toEqual(new Set([1, 2]));
    expect(stored.map((op) => op.payload!.liters).sort()).toEqual([1, 2, 3, 4]);
  });

  it("acknowledgement racing an edit-and-resend keeps the edited input, in both orders", async () => {
    for (const ackFirst of [true, false]) {
      const env = fresh();
      const tabA = await Outbox.open("alice", "1.1.0", env);
      const tabB = await Outbox.open("alice", "1.1.0", env);
      const v1 = await tabA.enqueue(add({ payload: payload({ liters: 10 }) }));
      const ack = () => tabA.acknowledge(v1.opId, v1.version);
      const edit = () => tabB.enqueue(add({ payload: payload({ liters: 11 }), replaceOpId: v1.opId }));
      await Promise.all(ackFirst ? [ack(), edit()] : [edit(), ack()]);
      const stored = (await tabA.get(v1.opId))!;
      expect(stored).not.toBeNull();
      expect(stored.payload!.liters).toBe(11);
      expect(stored.status).toBe("pending");
    }
  });

  it("a rejection racing a replacement never marks the replacement failed", async () => {
    for (const failFirst of [true, false]) {
      const env = fresh();
      const tabA = await Outbox.open("alice", "1.1.0", env);
      const tabB = await Outbox.open("alice", "1.1.0", env);
      const v1 = await tabA.enqueue(add({ payload: payload({ liters: 10 }) }));
      const reject = () => tabA.fail(v1.opId, v1.version, { code: "permission-denied", message: "v1", at: 1 });
      const replace = () => tabB.enqueue(add({ payload: payload({ liters: 11 }), replaceOpId: v1.opId }));
      await Promise.all(failFirst ? [reject(), replace()] : [replace(), reject()]);
      const stored = (await tabB.get(v1.opId))!;
      expect(stored.payload!.liters).toBe(11);
      expect(stored.status).toBe("pending");
      expect(stored.version).toBe(2);
    }
  });

  it("retry claims from two pages: exactly one wins", async () => {
    const env = fresh();
    const tabA = await Outbox.open("alice", "1.1.0", env);
    const tabB = await Outbox.open("alice", "1.1.0", env);
    const op = await tabA.enqueue(add());
    await tabA.fail(op.opId, op.version, { code: "x", message: "x", at: 1 });
    const [a, b] = await Promise.all([tabA.claimRetry(op.opId), tabB.claimRetry(op.opId)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await tabB.get(op.opId))!.version).toBe(2);
  });

  it("notifies the other page's subscribers through the channel", async () => {
    const env = fresh();
    const channelEnv = { ...env, channel: undefined };
    const tabA = await Outbox.open("alice", "1.1.0", channelEnv);
    const tabB = await Outbox.open("alice", "1.1.0", channelEnv);
    const seen: number[] = [];
    tabB.subscribe((snapshot) => seen.push(snapshot.operations.length));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await tabA.enqueue(add());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen.at(-1)).toBe(1);
    tabA.close();
    tabB.close();
  });
});

describe("legacy migration and storage health", () => {
  const legacyOp = (over: Record<string, unknown> = {}) => ({
    opId: "op_legacy_1",
    uid: "alice",
    vehicleId: "v1",
    kind: "fillup.add",
    docId: "f1",
    payload: payload(),
    beforeImage: null,
    revision: 1,
    status: "failed",
    error: { code: "permission-denied", message: "old", at: 1 },
    attempts: 2,
    createdAt: 100,
    updatedAt: 200,
    clientVersion: "1.1.0",
    ...over,
  });

  it("imports a readable legacy entry losslessly and keeps its bytes aside", async () => {
    const env = fresh();
    const raw = JSON.stringify({ v: 1, operations: [legacyOp()], revisions: { f1: 1 } });
    env.storage.setItem(outboxKey("alice"), raw);
    const outbox = await Outbox.open("alice", "1.1.0", env);
    expect(outbox.health().state).toBe("ok");
    const ops = await outbox.list();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      opId: "op_legacy_1",
      path: PATH,
      status: "failed",
      attempts: 2,
      payload: payload(),
    });
    expect(env.storage.getItem(outboxKey("alice"))).toBeNull();
    expect(env.storage.getItem("tm.outbox.v1.migrated.alice")).toBe(raw);
  });

  it("is idempotent: a crash between copy and remove re-imports nothing twice", async () => {
    const env = fresh();
    env.storage.setItem(outboxKey("alice"), JSON.stringify({ v: 1, operations: [legacyOp()], revisions: {} }));
    const first = await Outbox.open("alice", "1.1.0", env);
    // Simulate the crash: the legacy key is back as if the remove never ran.
    env.storage.setItem(outboxKey("alice"), JSON.stringify({ v: 1, operations: [legacyOp()], revisions: {} }));
    first.close();
    const second = await Outbox.open("alice", "1.1.0", env);
    expect(await second.list()).toHaveLength(1);
  });

  it("quarantines corrupt legacy bytes instead of treating them as empty, and never overwrites them", async () => {
    const env = fresh();
    const corrupt = '{"operations":[{"opId":"op_x","uid":"alice","payload":{"liters":';
    env.storage.setItem(outboxKey("alice"), corrupt);
    const outbox = await Outbox.open("alice", "1.1.0", env);
    expect(outbox.health().state).toBe("corrupt-legacy");
    expect(outbox.health().quarantined).toHaveLength(1);
    const quarantineKey = outbox.health().quarantined[0];
    expect(quarantineKey.startsWith(`${QUARANTINE_PREFIX}.alice.`)).toBe(true);
    expect(env.storage.getItem(quarantineKey)).toBe(corrupt);
    // A new enqueue goes to IndexedDB; the quarantined bytes are untouched.
    await outbox.enqueue(add());
    expect(env.storage.getItem(quarantineKey)).toBe(corrupt);
    expect(await unacknowledgedState(env)).toBe("some");
    await outbox.acknowledge((await outbox.list())[0].opId, 1);
    // Nothing pending in the database, but the quarantined bytes are unknown.
    expect(await unacknowledgedState(env)).toBe("unknown");
  });

  it("an unsupported or partial legacy record is quarantined, not dropped", async () => {
    const env = fresh();
    env.storage.setItem(outboxKey("alice"), JSON.stringify({ v: 99, operations: "not-a-list" }));
    const outbox = await Outbox.open("alice", "1.1.0", env);
    expect(outbox.health().state).toBe("corrupt-legacy");
    // A record without a mappable path is kept aside too.
    const env2 = fresh();
    env2.storage.setItem(
      outboxKey("alice"),
      JSON.stringify({ v: 1, operations: [legacyOp({ kind: "mystery.kind", vehicleId: null })] }),
    );
    const outbox2 = await Outbox.open("alice", "1.1.0", env2);
    expect(outbox2.health().state).toBe("corrupt-legacy");
    expect(await outbox2.list()).toHaveLength(0);
    const kept = outbox2.health().quarantined.map((key) => env2.storage.getItem(key));
    expect(kept.some((raw) => raw?.includes("op_legacy_1"))).toBe(true);
  });

  it("a read exception on storage reports unknown health rather than an empty queue", async () => {
    const env = fresh();
    const throwing: KeyValueStorage = {
      length: 1,
      key: () => outboxKey("alice"),
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const outbox = await Outbox.open("alice", "1.1.0", { ...env, storage: throwing });
    expect(outbox.health().state).toBe("corrupt-legacy");
    expect(await unacknowledgedState({ ...env, storage: throwing })).toBe("unknown");
  });

  it("one corrupt account entry does not hide another account's valid pending queue", async () => {
    const env = fresh();
    env.storage.setItem(outboxKey("alice"), "{corrupt");
    env.storage.setItem(outboxKey("bob"), JSON.stringify({ v: 1, operations: [legacyOp({ uid: "bob", opId: "op_bob" })] }));
    // Nobody has signed in yet: the device still reports pending work.
    expect(await unacknowledgedState(env)).toBe("some");
    const bob = await Outbox.open("bob", "1.1.0", env);
    expect(bob.health().state).toBe("ok");
    expect(await bob.list()).toHaveLength(1);
    // Alice's bytes are still there, unread and untouched.
    expect(env.storage.getItem(outboxKey("alice"))).toBe("{corrupt");
  });

  it("reports none only when every account is empty and nothing is quarantined", async () => {
    const env = fresh();
    expect(await unacknowledgedState(env)).toBe("none");
    const outbox = await Outbox.open("alice", "1.1.0", env);
    const op = await outbox.enqueue(add());
    expect(await unacknowledgedState(env)).toBe("some");
    await outbox.acknowledge(op.opId, op.version);
    expect(await unacknowledgedState(env)).toBe("none");
  });
});

describe("reconciling pending operations with a server snapshot", () => {
  const pending = (over: Partial<OutboxOperation>): OutboxOperation => ({
    opId: "op1",
    uid: "alice",
    vehicleId: "v1",
    kind: "fillup.add",
    opType: "set",
    path: PATH,
    docKey: "alice|" + PATH,
    docId: "f1",
    payload: payload(),
    beforeImage: null,
    revision: 1,
    version: 3,
    status: "pending",
    error: null,
    attempts: 1,
    createdAt: 0,
    updatedAt: 0,
    clientVersion: "1.1.0",
    ...over,
  });
  const COLLECTION = "users/alice/vehicles/v1/fillups";

  it("marks a create synced when the server holds the same content, carrying the version", () => {
    const verdicts = reconcileWithServer(
      [pending({})],
      COLLECTION,
      [{ id: "f1", data: { ...payload(), createdAt: { seconds: 1 } }, hasPendingWrites: false }],
      fillupPayloadMatches,
    );
    expect(verdicts).toEqual([{ opId: "op1", version: 3, verdict: "synced" }]);
  });

  it("leaves a create pending while the SDK still queues it", () => {
    expect(
      reconcileWithServer([pending({})], COLLECTION, [{ id: "f1", data: payload(), hasPendingWrites: true }], fillupPayloadMatches)[0]
        .verdict,
    ).toBe("still-pending");
  });

  it("reports a create that vanished from the server without a queued write — the rollback case", () => {
    expect(reconcileWithServer([pending({})], COLLECTION, [], fillupPayloadMatches)[0].verdict).toBe("unconfirmed");
  });

  it("detects a newer acknowledged version instead of choosing a winner", () => {
    expect(
      reconcileWithServer(
        [pending({ kind: "fillup.update", opType: "update" })],
        COLLECTION,
        [{ id: "f1", data: payload({ liters: 99 }), hasPendingWrites: false }],
        fillupPayloadMatches,
      )[0].verdict,
    ).toBe("conflict");
  });

  it("detects a legacy content edit even when version 5 and writeId are unchanged", () => {
    const op = pending({ kind: "fillup.update", opType: "update", payload: payload({ liters: 35, version: 6, writeId: "c1" }), beforeImage: payload({ liters: 40, version: 5, writeId: "c0" }) });
    expect(reconcileWithServer([op], COLLECTION, [{ id: "f1", data: payload({ liters: 42, version: 5, writeId: "c0" }), hasPendingWrites: false }], fillupPayloadMatches)[0].verdict).toBe("conflict");
  });

  it("detects changed records for deletion retries and restores, even after a rejection", () => {
    for (const kind of ["fillup.delete", "fillup.restore"] as const) {
      const op = pending({ kind, opType: kind === "fillup.delete" ? "delete" : "set", status: "failed", payload: kind === "fillup.delete" ? null : payload({ liters: 40, version: 6 }), beforeImage: payload({ liters: 40, version: 5, writeId: "base" }) });
      expect(reconcileWithServer([op], COLLECTION, [{ id: "f1", data: payload({ liters: 42, version: 5, writeId: "base" }), hasPendingWrites: false }], fillupPayloadMatches)[0]?.verdict).toBe("conflict");
    }
  });

  it("an update whose base the server still holds is a rejection to retry, not a conflict", () => {
    const op = pending({ kind: "fillup.update", opType: "update", payload: payload({ liters: 35, version: 1 }), beforeImage: payload({ liters: 40, version: 0 }) });
    expect(
      reconcileWithServer(
        [op],
        COLLECTION,
        [{ id: "f1", data: payload({ liters: 40 }), hasPendingWrites: false }],
        fillupPayloadMatches,
      )[0].verdict,
    ).toBe("unconfirmed");
    // The server moved past the base: a real conflict.
    expect(
      reconcileWithServer(
        [op],
        COLLECTION,
        [{ id: "f1", data: payload({ liters: 42, version: 1 }), hasPendingWrites: false }],
        fillupPayloadMatches,
      )[0].verdict,
    ).toBe("conflict");
  });

  it("upgrades a rejected update to a conflict once the server is seen past its base, whichever arrived first", () => {
    const failed = pending({
      kind: "fillup.update",
      opType: "update",
      status: "failed",
      payload: payload({ liters: 35, version: 1 }),
      beforeImage: payload({ liters: 40, version: 0 }),
    });
    expect(
      reconcileWithServer(
        [failed],
        COLLECTION,
        [{ id: "f1", data: payload({ liters: 42, version: 1 }), hasPendingWrites: false }],
        fillupPayloadMatches,
      )[0]?.verdict,
    ).toBe("conflict");
    // Server still at the base: the rejection stands, nothing to add.
    expect(
      reconcileWithServer(
        [failed],
        COLLECTION,
        [{ id: "f1", data: payload({ liters: 40 }), hasPendingWrites: false }],
        fillupPayloadMatches,
      ),
    ).toEqual([]);
    // The content did land after all: acknowledged.
    expect(
      reconcileWithServer(
        [failed],
        COLLECTION,
        [{ id: "f1", data: payload({ liters: 35, version: 1 }), hasPendingWrites: false }],
        fillupPayloadMatches,
      )[0]?.verdict,
    ).toBe("synced");
  });

  it("only reconciles operations in the collection the snapshot describes", () => {
    expect(
      reconcileWithServer([pending({ path: "users/alice/vehicles/other/fillups/f1" })], COLLECTION, [], fillupPayloadMatches),
    ).toEqual([]);
  });

  it("does not confirm a delete from absence while the snapshot still carries pending writes", () => {
    const del = pending({ kind: "fillup.delete", opType: "delete", payload: null });
    expect(reconcileWithServer([del], COLLECTION, [], fillupPayloadMatches, true)[0].verdict).toBe("still-pending");
    expect(reconcileWithServer([del], COLLECTION, [], fillupPayloadMatches, false)[0].verdict).toBe("synced");
    expect(
      reconcileWithServer([del], COLLECTION, [{ id: "f1", data: payload(), hasPendingWrites: false }], fillupPayloadMatches, false)[0]
        .verdict,
    ).toBe("unconfirmed");
  });
});

describe("orphaned pending entries after a reload", () => {
  const op = (over: Partial<OutboxOperation>): OutboxOperation => ({
    opId: "op",
    uid: "alice",
    vehicleId: null,
    kind: "settings.update",
    opType: "update",
    path: "users/alice",
    docKey: "alice|users/alice",
    docId: "alice",
    payload: { settings: { units: "kmPerLiter" } },
    beforeImage: null,
    revision: 1,
    version: 1,
    status: "pending",
    error: null,
    attempts: 1,
    createdAt: 0,
    updatedAt: 0,
    clientVersion: "1.1.0",
    ...over,
  });

  it("judges only the newest revision per document and settles the ones it superseded with it", () => {
    const groups = orphanGroups([
      op({ opId: "s1", revision: 1, payload: { settings: { units: "kmPerLiter" } } }),
      op({ opId: "s2", revision: 2, payload: { settings: { units: "litersPer100" } } }),
      op({ opId: "b", revision: 1, path: "users/alice/importBatches/x", docKey: "alice|users/alice/importBatches/x", docId: "x", kind: "import.batch", opType: "set" }),
      op({ opId: "done", revision: 3, status: "failed" }),
    ]);
    const settings = groups.find((group) => group.newest.docKey === "alice|users/alice")!;
    expect(settings.newest.opId).toBe("s2");
    expect(settings.superseded.map((entry) => entry.opId)).toEqual(["s1"]);
    const batch = groups.find((group) => group.newest.docKey.endsWith("importBatches/x"))!;
    expect(batch.superseded).toEqual([]);
    expect(groups).toHaveLength(2);
  });

  it("an orphaned create that the server does not hold, with nothing pending, is a rejection to retry", () => {
    const orphan = op({
      kind: "import.batch",
      opType: "set",
      path: "users/alice/importBatches/x",
      docKey: "alice|users/alice/importBatches/x",
      docId: "x",
      payload: { vehicleId: "v1", format: "csv" },
    });
    expect(reconcileWithServer([orphan], "users/alice/importBatches", [], () => false, false)[0].verdict).toBe(
      "unconfirmed",
    );
    expect(reconcileWithServer([orphan], "users/alice/importBatches", [], () => false, true)[0].verdict).toBe(
      "unconfirmed",
    );
  });
});
