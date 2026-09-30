import { describe, expect, it } from "vitest";
import {
  Outbox,
  OutboxStorageError,
  reconcileWithServer,
  type KeyValueStorage,
  type OutboxOperation,
} from "./outbox";
import { fillupPayloadMatches, serializeFillup } from "./fillupSerializer";

/** In-memory Web Storage; `quota` makes setItem throw like a full browser. */
function memoryStorage(options: { quota?: number } = {}): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      if (options.quota !== undefined && value.length > options.quota) {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      }
      map.set(key, value);
    },
    removeItem: (key) => void map.delete(key),
  };
}

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

describe("outbox durability", () => {
  it("persists the full payload before submission and survives a reload", () => {
    const storage = memoryStorage();
    const outbox = new Outbox("alice", storage, "1.1.0", () => 1000);
    const op = outbox.enqueue({
      kind: "fillup.add",
      docId: "f1",
      vehicleId: "v1",
      payload: payload(),
    });

    // "Reload": a brand new instance over the same storage.
    const again = new Outbox("alice", storage, "1.1.0");
    const stored = again.get(op.opId)!;
    expect(stored.status).toBe("pending");
    expect(stored.payload).toEqual(payload());
    expect(stored.docId).toBe("f1");
    expect(stored.revision).toBe(1);
    expect(stored.clientVersion).toBe("1.1.0");
  });

  it("keeps three offline records through reload and a rejection of all of them", () => {
    const storage = memoryStorage();
    const outbox = new Outbox("alice", storage, "1.1.0");
    const ids = ["f1", "f2", "f3"].map(
      (docId) =>
        outbox.enqueue({ kind: "fillup.add", docId, vehicleId: "v1", payload: payload({ odometer: 1 }) })
          .opId,
    );

    const reloaded = new Outbox("alice", storage, "1.1.0");
    expect(reloaded.operations()).toHaveLength(3);

    for (const id of ids) reloaded.fail(id, { code: "permission-denied", message: "denied", at: 1 });
    const failed = reloaded.operations();
    expect(failed.every((op) => op.status === "failed")).toBe(true);
    expect(failed.every((op) => op.payload !== null)).toBe(true);
    // No duplicates: the same three op ids, the same three documents.
    expect(new Set(failed.map((op) => op.docId)).size).toBe(3);
  });

  it("refuses a false success when storage is full", () => {
    const storage = memoryStorage({ quota: 10 });
    const outbox = new Outbox("alice", storage, "1.1.0");
    expect(() =>
      outbox.enqueue({ kind: "fillup.add", docId: "f1", vehicleId: "v1", payload: payload() }),
    ).toThrow(OutboxStorageError);
    expect(outbox.operations()).toHaveLength(0);
  });

  it("scopes entries by account: B never sees A's records, and A's survive B's session", () => {
    const storage = memoryStorage();
    const alice = new Outbox("alice", storage, "1.1.0");
    alice.enqueue({ kind: "fillup.add", docId: "f1", vehicleId: "v1", payload: payload() });

    const bob = new Outbox("bob", storage, "1.1.0");
    expect(bob.operations()).toHaveLength(0);
    bob.enqueue({ kind: "fillup.add", docId: "b1", vehicleId: "vb", payload: payload() });

    const aliceAgain = new Outbox("alice", storage, "1.1.0");
    expect(aliceAgain.operations().map((op) => op.docId)).toEqual(["f1"]);
  });

  it("keeps a stable op id and increments attempts on retry", () => {
    const storage = memoryStorage();
    const outbox = new Outbox("alice", storage, "1.1.0");
    const op = outbox.enqueue({ kind: "fillup.add", docId: "f1", vehicleId: "v1", payload: payload() });
    outbox.fail(op.opId, { code: "permission-denied", message: "x", at: 1 });
    const retried = outbox.retrying(op.opId)!;
    expect(retried.opId).toBe(op.opId);
    expect(retried.attempts).toBe(2);
    expect(retried.status).toBe("pending");
    expect(retried.error).toBeNull();
  });

  it("orders revisions per document across two tabs sharing storage", () => {
    const storage = memoryStorage();
    const tabA = new Outbox("alice", storage, "1.1.0");
    const tabB = new Outbox("alice", storage, "1.1.0");
    const first = tabA.enqueue({ kind: "fillup.update", docId: "f1", vehicleId: "v1", payload: payload({ liters: 30 }) });
    const second = tabB.enqueue({ kind: "fillup.update", docId: "f1", vehicleId: "v1", payload: payload({ liters: 31 }) });
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    // A late acknowledgement of the first op removes only itself.
    tabA.acknowledge(first.opId);
    expect(tabB.operations().map((op) => op.opId)).toEqual([second.opId]);
    expect(tabB.revisionOf("f1")).toBe(2);
  });

  it("removes exactly the acknowledged operation and nothing else", () => {
    const storage = memoryStorage();
    const outbox = new Outbox("alice", storage, "1.1.0");
    const a = outbox.enqueue({ kind: "fillup.add", docId: "f1", vehicleId: "v1", payload: payload() });
    const b = outbox.enqueue({ kind: "fillup.add", docId: "f2", vehicleId: "v1", payload: payload() });
    outbox.acknowledge(a.opId);
    expect(outbox.operations().map((op) => op.opId)).toEqual([b.opId]);
  });

  it("treats malformed storage as empty without throwing", () => {
    const storage = memoryStorage();
    storage.setItem("tm.outbox.v1.alice", "{not json");
    const outbox = new Outbox("alice", storage, "1.1.0");
    expect(outbox.operations()).toEqual([]);
  });

  it("notifies subscribers on every change", () => {
    const outbox = new Outbox("alice", memoryStorage(), "1.1.0");
    const seen: number[] = [];
    outbox.subscribe((snapshot) => seen.push(snapshot.operations.length));
    const op = outbox.enqueue({ kind: "fillup.add", docId: "f1", vehicleId: "v1", payload: payload() });
    outbox.acknowledge(op.opId);
    expect(seen).toEqual([0, 1, 0]);
  });
});

describe("reconciling pending operations with a server snapshot", () => {
  const pending = (over: Partial<OutboxOperation>): OutboxOperation => ({
    opId: "op1",
    uid: "alice",
    vehicleId: "v1",
    kind: "fillup.add",
    docId: "f1",
    payload: payload(),
    beforeImage: null,
    revision: 1,
    status: "pending",
    error: null,
    attempts: 1,
    createdAt: 0,
    updatedAt: 0,
    clientVersion: "1.1.0",
    ...over,
  });

  it("marks a create synced when the server holds the same content", () => {
    const verdicts = reconcileWithServer(
      [pending({})],
      "v1",
      [{ id: "f1", data: { ...payload(), createdAt: { seconds: 1 } }, hasPendingWrites: false }],
      fillupPayloadMatches,
    );
    expect(verdicts).toEqual([{ opId: "op1", verdict: "synced" }]);
  });

  it("leaves a create pending while the SDK still queues it", () => {
    const verdicts = reconcileWithServer(
      [pending({})],
      "v1",
      [{ id: "f1", data: payload(), hasPendingWrites: true }],
      fillupPayloadMatches,
    );
    expect(verdicts[0].verdict).toBe("still-pending");
  });

  it("reports a create that vanished from the server without a queued write — the rollback case", () => {
    const verdicts = reconcileWithServer([pending({})], "v1", [], fillupPayloadMatches);
    expect(verdicts[0].verdict).toBe("unconfirmed");
  });

  it("detects a newer acknowledged version instead of choosing a winner", () => {
    const verdicts = reconcileWithServer(
      [pending({ kind: "fillup.update" })],
      "v1",
      [{ id: "f1", data: payload({ liters: 99 }), hasPendingWrites: false }],
      fillupPayloadMatches,
    );
    expect(verdicts[0].verdict).toBe("conflict");
  });

  it("only reconciles operations for the vehicle the snapshot describes", () => {
    const verdicts = reconcileWithServer(
      [pending({ vehicleId: "other" })],
      "v1",
      [],
      fillupPayloadMatches,
    );
    expect(verdicts).toEqual([]);
  });

  it("confirms a delete once the document is gone, and flags one that is still there", () => {
    expect(
      reconcileWithServer([pending({ kind: "fillup.delete", payload: null })], "v1", [], fillupPayloadMatches)[0]
        .verdict,
    ).toBe("synced");
    expect(
      reconcileWithServer(
        [pending({ kind: "fillup.delete", payload: null })],
        "v1",
        [{ id: "f1", data: payload(), hasPendingWrites: false }],
        fillupPayloadMatches,
      )[0].verdict,
    ).toBe("unconfirmed");
  });
});
