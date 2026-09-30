import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, Timestamp } from "firebase/firestore";

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
