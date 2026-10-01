import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, Timestamp, getDoc, runTransaction } from "firebase/firestore";

import { conditionalFillupWrite, fillupBaseMatches, FillupConflictError } from "../../src/lib/writesConditional";

/**
 * Mixed client versions during the rollout.
 *
 * A version-aware client stamps `version` (stored + 1) AND a fresh `writeId`
 * on every write. A pre-version client stamps neither. The update rule tells
 * them apart by whether the write CHANGES `writeId`: only then is the
 * stored + 1 check applied. A legacy `updateDoc` merges the stored fields back
 * in unchanged and a legacy `setDoc` carries neither, so both are accepted as
 * they were before versions existed — nothing a pre-version device writes
 * is refused and lost.
 */

const PROJECT_ID = "tank-maleh-rules-test";
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
}, 60_000);

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

const UID = "alice";
const db = () => testEnv.authenticatedContext(UID).firestore();
const ref = () => doc(db(), "users", UID, "vehicles", "v1", "fillups", "f1");

function fillup(over: Record<string, unknown> = {}) {
  return {
    date: Timestamp.fromMillis(Date.UTC(2026, 0, 5, 8, 0)),
    odometer: 100_000,
    liters: 40,
    pricePerLiter: 7.31,
    totalCost: 292.4,
    isFullTank: true,
    ...over,
  };
}

/** Seed a stored document as the server would hold it, bypassing rules. */
async function stored(data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", UID, "vehicles", "v1", "fillups", "f1"), data);
  });
}

describe("version-aware client (writes change writeId)", () => {
  it("accepts stored + 1 and refuses a stale or equal version", async () => {
    await stored(fillup({ version: 3, writeId: "w-3" }));
    await assertFails(updateDoc(ref(), { liters: 41, version: 3, writeId: "w-x" }));
    await assertFails(updateDoc(ref(), { liters: 41, version: 2, writeId: "w-x" }));
    await assertFails(updateDoc(ref(), { liters: 41, version: 5, writeId: "w-x" }));
    await assertSucceeds(updateDoc(ref(), { liters: 41, version: 4, writeId: "w-4" }));
  });

  it("refuses the one-step-stale edit that an 'unchanged version' relaxation would accept", async () => {
    // Device X wrote version 1; device Y, which opened at version 0, sends 1.
    await stored(fillup({ liters: 42, version: 1, writeId: "x-1" }));
    await assertFails(updateDoc(ref(), { liters: 35, version: 1, writeId: "y-1" }));
  });

  it("first versioned write over a legacy document must be version 1", async () => {
    await stored(fillup());
    await assertFails(updateDoc(ref(), { liters: 41, version: 2, writeId: "w-2" }));
    await assertSucceeds(updateDoc(ref(), { liters: 41, version: 1, writeId: "w-1" }));
  });

  it("full overwrite (restore) over a versioned document follows the same rule", async () => {
    await stored(fillup({ version: 2, writeId: "w-2" }));
    await assertFails(setDoc(ref(), fillup({ version: 1, writeId: "w-r" })));
    await assertSucceeds(setDoc(ref(), fillup({ version: 3, writeId: "w-r" })));
  });

  it("create accepts a writeId and bounds it", async () => {
    await assertSucceeds(setDoc(ref(), fillup({ version: 1, writeId: "op_abc.1" })));
    await testEnv.clearFirestore();
    await assertFails(setDoc(ref(), fillup({ version: 1, writeId: "x".repeat(65) })));
    await testEnv.clearFirestore();
    await assertFails(setDoc(ref(), fillup({ version: 1, writeId: 7 })));
  });
});

describe("pre-version client (never touches writeId)", () => {
  it("a patch on a versioned document is accepted: the merged version is unchanged", async () => {
    await stored(fillup({ version: 3, writeId: "w-3" }));
    await assertSucceeds(updateDoc(ref(), { liters: 41 }));
    await assertSucceeds(updateDoc(ref(), { notes: "מהטלפון הישן" }));
  });

  it("a patch on a legacy document is accepted", async () => {
    await stored(fillup());
    await assertSucceeds(updateDoc(ref(), { liters: 41 }));
  });

  it("a full overwrite carrying neither field is accepted over a versioned document", async () => {
    await stored(fillup({ version: 3, writeId: "w-3" }));
    await assertSucceeds(setDoc(ref(), fillup({ liters: 41 })));
  });

  it("a patch that tries to move the version without a fresh writeId is still refused", async () => {
    await stored(fillup({ version: 3, writeId: "w-3" }));
    await assertFails(updateDoc(ref(), { liters: 41, version: 9 }));
  });
});

describe("expression budget with both fields present", () => {
  function maximal(over: Record<string, unknown> = {}) {
    return {
      ...fillup(),
      odometer: 123_456,
      liters: 38.2,
      pricePerLiter: 7.19,
      totalCost: 274.66,
      isFullTank: false,
      fullTankSource: "user",
      continuityBreakBefore: true,
      postedPricePerLiter: 7.19,
      fuelType: "95",
      importSource: "legacy-fuel-tracker",
      importBatchId: "batch-1",
      importRowHash: "abcdef",
      schemaVersion: 2,
      fillEndState: "partial",
      fillEndStateSource: "user-confirmed",
      preFillLevel: 0.25,
      preFillLevelSource: "direct-gauge",
      preFillLevelUncertainty: 0.05,
      postFillLevel: 0.9,
      postFillLevelSource: "user-correction",
      postFillLevelUncertainty: 0.05,
      refuelReason: "low-fuel",
      capacityLitersAtEntry: 45,
      tankSchemaVersion: 2,
      station: { name: "פז צומת גולני", lat: 32.77, lng: 35.4, stationId: "1234", brand: "פז" },
      notes: "א".repeat(500),
      version: 1,
      writeId: "op_abcdefghijklmnopqrstuvwxyz0123456789.1234567890",
      ...over,
    };
  }

  it("accepts the maximal document on create and on a versioned update", async () => {
    await assertSucceeds(setDoc(ref(), maximal()));
    const { date: _d, ...patch } = maximal({ version: 2, writeId: "op_next.2" });
    await assertSucceeds(updateDoc(ref(), patch));
  });

  it("still refuses a stale maximal update", async () => {
    await assertSucceeds(setDoc(ref(), maximal()));
    const { date: _d, ...patch } = maximal({ version: 1, writeId: "op_next.2" });
    await assertFails(updateDoc(ref(), patch));
  });
});


const guarded = (opType: "set" | "update" | "delete", data: Record<string, unknown> | null, before: Record<string, unknown> | null, restore = false) => {
  const target = ref();
  return conditionalFillupWrite(target.firestore, target, opType, data, before, restore);
};

describe("modern server-conditional mutations across mixed clients", () => {
  it("reproduces the old marker-only overwrite, then rejects the same stale modern edit", async () => {
    const before = fillup({ version: 5, writeId: "c1-opened" });
    await stored(before);
    await assertSucceeds(updateDoc(ref(), { liters: 42 })); // C0 keeps v5/writeId
    await assertSucceeds(updateDoc(ref(), { liters: 39, version: 6, writeId: "old-c1" }));
    await stored({ ...before, liters: 42 });
    await expect(guarded( "update", { ...before, liters: 39, version: 6, writeId: "new-c1" }, before)).rejects.toMatchObject({ code: "conflict" });
    expect((await getDoc(ref())).data()?.liters).toBe(42);
  });

  it("allows a single modern winner for two edits opened at the same base", async () => {
    const before = fillup({ version: 5, writeId: "base" });
    await stored(before);
    const outcomes = await Promise.allSettled([41, 42].map(liters => guarded( "update", { ...before, liters, version: 6, writeId: `winner-${liters}` }, before)));
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
  });

  it("server retries the transaction if a legacy patch races the checked read, and refuses its new state", async () => {
    const before = fillup({ version: 5, writeId: "base" });
    await stored(before);
    const firestore = db();
    const target = doc(firestore, "users", UID, "vehicles", "v1", "fillups", "f1");
    let first = true;
    let attempts = 0;
    const mutation = runTransaction(firestore, async transaction => {
      attempts++;
      const snapshot = await transaction.get(target);
      if (!fillupBaseMatches(before, snapshot.data()!)) throw new FillupConflictError(snapshot.data()!);
      if (first) {
        first = false;
        await updateDoc(ref(), { notes: "legacy write after conditional read" });
      }
      transaction.update(target, { liters: 39, version: 6, writeId: "c1" });
    });
    await expect(mutation).rejects.toMatchObject({ code: "conflict" });
    expect(attempts).toBeGreaterThan(1);
    expect((await getDoc(ref())).data()?.notes).toBe("legacy write after conditional read");
    expect((await getDoc(ref())).data()?.liters).toBe(40);
  });

  it("rejects deletion retries, restores and rollback against legacy-changed records", async () => {
    const before = fillup({ version: 5, writeId: "base" });
    await stored(before);
    await updateDoc(ref(), { notes: "new evidence", liters: 42 });
    await expect(guarded( "delete", null, before)).rejects.toMatchObject({ code: "conflict" });
    await expect(guarded( "set", { ...before, version: 6, writeId: "restore" }, before, true)).rejects.toMatchObject({ code: "conflict" });
    expect((await getDoc(ref())).data()?.notes).toBe("new evidence");
  });

  it("protects modern updates from legacy full overwrite and preserves legacy replay compatibility", async () => {
    const before = fillup({ version: 5, writeId: "base" });
    await stored(before);
    await assertSucceeds(setDoc(ref(), fillup({ liters: 42 })));
    await expect(guarded( "update", { ...before, liters: 39, version: 6, writeId: "modern" }, before)).rejects.toMatchObject({ code: "conflict" });
    await assertSucceeds(updateDoc(ref(), { notes: "legacy queued replay" }));
    expect((await getDoc(ref())).data()?.liters).toBe(42);
  });

  it("safely deletes unchanged versioned records, replays deletion, restores absent records and replays restore", async () => {
    const before = fillup({ version: 5, writeId: "base" });
    await stored(before);
    await guarded( "delete", null, before);
    await guarded( "delete", null, before);
    expect((await getDoc(ref())).exists()).toBe(false);
    const restored = { ...before, version: 6, writeId: "restored" };
    await guarded( "set", restored, before, true);
    await guarded( "set", restored, before, true);
    expect((await getDoc(ref())).data()?.version).toBe(6);
  });
});
