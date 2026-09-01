import { readFileSync } from "node:fs";
// No `expect` here on purpose: assertSucceeds/assertFails ARE the assertions —
// they resolve or reject, and vitest fails the test on a rejection.
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  Timestamp,
} from "firebase/firestore";

/**
 * Firestore Rules, exercised against the emulator.
 *
 * These are the security tests. They assert both directions for every path:
 * what the owner may do, and what everyone else — another signed-in user, an
 * admin, an unauthenticated client — must not.
 *
 * Run with:  npm run test:rules   (needs Java and the Firebase CLI)
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

const ALICE = "alice";
const BOB = "bob";

const alice = () => testEnv.authenticatedContext(ALICE).firestore();
const bob = () => testEnv.authenticatedContext(BOB).firestore();
const admin = () =>
  testEnv.authenticatedContext("root", { admin: true }).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();

/** A fill-up whose totalCost reconciles with liters x price. */
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

function vehicle(over: Record<string, unknown> = {}) {
  return {
    make: "מאזדה",
    model: "3",
    fuelType: "95",
    archived: false,
    priceAdjustment: 0,
    ...over,
  };
}

const fillupRef = (db: ReturnType<typeof alice>, uid = ALICE, id = "f1") =>
  doc(db, "users", uid, "vehicles", "v1", "fillups", id);

/* ------------------------------------------------------------------ *
 * Ownership
 * ------------------------------------------------------------------ */

describe("user documents", () => {
  it("lets the owner create and read their profile", async () => {
    const ref = doc(alice(), "users", ALICE);
    await assertSucceeds(setDoc(ref, { settings: { units: "kmPerLiter" } }));
    await assertSucceeds(getDoc(ref));
  });

  it("refuses another signed-in user", async () => {
    await assertFails(setDoc(doc(bob(), "users", ALICE), { settings: {} }));
    await assertFails(getDoc(doc(bob(), "users", ALICE)));
  });

  it("refuses an unauthenticated client", async () => {
    await assertFails(getDoc(doc(anon(), "users", ALICE)));
    await assertFails(setDoc(doc(anon(), "users", ALICE), { settings: {} }));
  });

  it("lets an admin read but never write", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users", ALICE), { settings: {} });
    });
    await assertSucceeds(getDoc(doc(admin(), "users", ALICE)));
    await assertFails(setDoc(doc(admin(), "users", ALICE), { settings: {} }));
  });

  it("accepts the login stamps as numbers", async () => {
    await assertSucceeds(
      setDoc(doc(alice(), "users", ALICE), {
        settings: {},
        previousLoginAt: 1_700_000_000_000,
        currentLoginAt: 1_700_000_100_000,
        lastProcessedAuthTime: 1_700_000_100_000,
      }),
    );
  });

  it("rejects a login stamp that is not a number", async () => {
    await assertFails(
      setDoc(doc(alice(), "users", ALICE), {
        settings: {},
        currentLoginAt: { nested: "map" },
      }),
    );
    await assertFails(
      setDoc(doc(alice(), "users", ALICE), { settings: {}, currentLoginAt: "now" }),
    );
  });

  it("accepts a null previous login — the first ever sign-in", async () => {
    await assertSucceeds(
      setDoc(doc(alice(), "users", ALICE), {
        settings: {},
        previousLoginAt: null,
        currentLoginAt: 1_700_000_100_000,
        lastProcessedAuthTime: 1_700_000_100_000,
      }),
    );
  });

  it("rejects a login stamp outside any believable era", async () => {
    await assertFails(
      setDoc(doc(alice(), "users", ALICE), { settings: {}, currentLoginAt: -1 }),
    );
    await assertFails(
      setDoc(doc(alice(), "users", ALICE), {
        settings: {},
        currentLoginAt: 99_999_999_999_999,
      }),
    );
  });
});

/* ------------------------------------------------------------------ *
 * Fill-ups
 * ------------------------------------------------------------------ */

describe("fill-ups", () => {
  it("accepts a well-formed record from its owner", async () => {
    await assertSucceeds(setDoc(fillupRef(alice()), fillup()));
  });

  it("refuses another user's record", async () => {
    await assertFails(setDoc(fillupRef(bob(), ALICE), fillup()));
    await assertFails(getDoc(fillupRef(bob(), ALICE)));
  });

  it("accepts the new optional fields", async () => {
    await assertSucceeds(
      setDoc(
        fillupRef(alice()),
        fillup({
          continuityBreakBefore: true,
          fullTankSource: "legacy-assumption",
          postedPricePerLiter: 7.5,
          fuelType: "diesel",
          importSource: "legacy-fuel-tracker",
          importBatchId: "imp_abc",
          importRowHash: "0123456789abcdef",
          schemaVersion: 2,
          notes: "מלא",
        }),
      ),
    );
  });

  it("accepts a record with no optional fields at all — pre-upgrade shape", async () => {
    await assertSucceeds(
      setDoc(doc(alice(), "users", ALICE, "vehicles", "v1", "fillups", "old"), {
        date: Timestamp.fromMillis(Date.UTC(2025, 0, 5)),
        odometer: 90_000,
        liters: 30,
        pricePerLiter: 7,
        totalCost: 210,
        isFullTank: false,
      }),
    );
  });

  it("rejects an unrecognised field", async () => {
    await assertFails(setDoc(fillupRef(alice()), fillup({ somethingElse: "x" })));
  });

  it("rejects an arbitrary nested map smuggled into the station", async () => {
    await assertFails(
      setDoc(fillupRef(alice()), fillup({ station: { name: "פז", tracking: { a: 1 } } })),
    );
  });

  it("accepts a well-formed station reference", async () => {
    await assertSucceeds(
      setDoc(
        fillupRef(alice()),
        fillup({
          station: { name: "פז חגור", lat: 32.1, lng: 34.9, stationId: "st-42", brand: "פז" },
        }),
      ),
    );
  });

  it("rejects a non-positive odometer or liters", async () => {
    await assertFails(setDoc(fillupRef(alice()), fillup({ odometer: 0 })));
    await assertFails(setDoc(fillupRef(alice()), fillup({ liters: 0 })));
    await assertFails(setDoc(fillupRef(alice()), fillup({ odometer: -5 })));
  });

  it("rejects a date that is not a timestamp", async () => {
    await assertFails(setDoc(fillupRef(alice()), fillup({ date: 1_700_000_000_000 })));
  });

  it("rejects a non-boolean full-tank flag", async () => {
    await assertFails(setDoc(fillupRef(alice()), fillup({ isFullTank: "yes" })));
    await assertFails(setDoc(fillupRef(alice()), fillup({ continuityBreakBefore: 1 })));
  });

  it("rejects a total that cannot be reconciled with liters and price", async () => {
    // 40 L at 7.31 is about 292; 900 is not a rounding difference.
    await assertFails(setDoc(fillupRef(alice()), fillup({ totalCost: 900 })));
  });

  it("allows pump rounding and a small manual edit", async () => {
    await assertSucceeds(setDoc(fillupRef(alice()), fillup({ totalCost: 292.0 })));
    await assertSucceeds(setDoc(fillupRef(alice()), fillup({ totalCost: 295.0 })));
  });

  it("rejects an implausible price or an over-long note", async () => {
    await assertFails(setDoc(fillupRef(alice()), fillup({ pricePerLiter: 500, totalCost: 20000 })));
    await assertFails(setDoc(fillupRef(alice()), fillup({ notes: "x".repeat(501) })));
  });

  it("rejects an invalid fuel type", async () => {
    await assertFails(setDoc(fillupRef(alice()), fillup({ fuelType: "kerosene" })));
    await assertFails(setDoc(fillupRef(alice()), fillup({ fullTankSource: "invented" })));
  });

  it("is not readable by an admin at all", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(fillupRef(context.firestore() as never), fillup());
    });
    // The dashboard reads published summaries, so this permission was removed
    // rather than left in place unused.
    await assertFails(getDoc(fillupRef(admin())));
    await assertFails(setDoc(fillupRef(admin()), fillup({ odometer: 1 })));
  });

  it("lets the owner delete their own record", async () => {
    await setDoc(fillupRef(alice()), fillup());
    await assertSucceeds(deleteDoc(fillupRef(alice())));
  });
});

/* ------------------------------------------------------------------ *
 * Vehicles
 * ------------------------------------------------------------------ */

describe("vehicles", () => {
  const ref = (db: ReturnType<typeof alice>, uid = ALICE) =>
    doc(db, "users", uid, "vehicles", "v1");

  it("accepts a well-formed vehicle", async () => {
    await assertSucceeds(setDoc(ref(alice()), vehicle()));
  });

  it("preserves the legacy price fields during migration", async () => {
    await assertSucceeds(
      setDoc(ref(alice()), vehicle({ priceAdjustment: -0.05, manualPricePerLiter: 6.8 })),
    );
  });

  it("rejects an invalid fuel type and an over-long make", async () => {
    await assertFails(setDoc(ref(alice()), vehicle({ fuelType: "steam" })));
    await assertFails(setDoc(ref(alice()), vehicle({ make: "x".repeat(61) })));
  });

  it("rejects a nonsensical tank size", async () => {
    await assertFails(setDoc(ref(alice()), vehicle({ tankLiters: -1 })));
  });

  it("refuses another user entirely", async () => {
    await assertFails(setDoc(ref(bob(), ALICE), vehicle()));
  });

  it("is not readable by an admin either", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users", ALICE, "vehicles", "v1"), vehicle());
    });
    await assertFails(getDoc(ref(admin(), ALICE)));
  });
});

/* ------------------------------------------------------------------ *
 * Community price reports — private by construction
 * ------------------------------------------------------------------ */

describe("station price reports", () => {
  const report = (over: Record<string, unknown> = {}) => ({
    stationId: "st-42",
    fuelType: "95",
    serviceMode: "self",
    postedPrice: 7.18,
    observedAt: Timestamp.fromMillis(Date.UTC(2026, 7, 20)),
    ...over,
  });

  const ref = (db: ReturnType<typeof alice>, uid = ALICE, id = "r1") =>
    doc(db, "users", uid, "stationPriceReports", id);

  it("lets the owner file and read their own report", async () => {
    await assertSucceeds(setDoc(ref(alice()), report()));
    await assertSucceeds(getDoc(ref(alice())));
  });

  it("is NOT readable by another signed-in user", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "users", ALICE, "stationPriceReports", "r1"),
        report(),
      );
    });
    await assertFails(getDoc(ref(bob(), ALICE)));
    await assertFails(getDocs(collection(bob(), "users", ALICE, "stationPriceReports")));
  });

  it("is not readable by an admin either", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "users", ALICE, "stationPriceReports", "r1"),
        report(),
      );
    });
    await assertFails(getDoc(ref(admin(), ALICE)));
  });

  it("cannot be revised after the fact", async () => {
    await setDoc(ref(alice()), report());
    await assertFails(updateDoc(ref(alice()), { postedPrice: 1 }));
  });

  it("rejects a price outside the plausible band", async () => {
    await assertFails(setDoc(ref(alice()), report({ postedPrice: 0.5 })));
    await assertFails(setDoc(ref(alice()), report({ postedPrice: 99 })));
  });

  it("rejects an unknown field or an invalid fuel type", async () => {
    await assertFails(setDoc(ref(alice()), report({ reporterName: "אליס" })));
    await assertFails(setDoc(ref(alice()), report({ fuelType: "kerosene" })));
  });
});

/* ------------------------------------------------------------------ *
 * Public aggregates — read-only to every client
 * ------------------------------------------------------------------ */

describe("station price aggregates", () => {
  const id = "st-42_95_self";

  it("is readable by any signed-in user", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "stationPriceAggregates", id), {
        medianPrice: 7.18,
        uniqueReporters: 5,
      });
    });
    await assertSucceeds(getDoc(doc(alice(), "stationPriceAggregates", id)));
  });

  it("cannot be written by a client — confidence and counts are unforgeable", async () => {
    await assertFails(
      setDoc(doc(alice(), "stationPriceAggregates", id), {
        medianPrice: 0.01,
        uniqueReporters: 9999,
      }),
    );
    await assertFails(
      setDoc(doc(admin(), "stationPriceAggregates", id), { medianPrice: 1 }),
    );
  });

  it("is not readable by an unauthenticated client", async () => {
    await assertFails(getDoc(doc(anon(), "stationPriceAggregates", id)));
  });
});

/* ------------------------------------------------------------------ *
 * Benchmarks — per vehicle, owner-writable only
 * ------------------------------------------------------------------ */

describe("benchmarks", () => {
  const summary = (over: Record<string, unknown> = {}) => ({
    vehicleId: "v1",
    modelKey: "מאזדה 3",
    fuelType: "95",
    year: 2018,
    avgKmPerLiter: 14.2,
    segments: 6,
    avgPricePerLiter: 7.2,
    ...over,
  });

  it("lets a user write their own per-vehicle document", async () => {
    await assertSucceeds(
      setDoc(doc(alice(), "benchmarks", `${ALICE}__v1`), summary()),
    );
    await assertSucceeds(
      setDoc(doc(alice(), "benchmarks", `${ALICE}__v2`), summary({ vehicleId: "v2" })),
    );
  });

  it("still accepts the pre-upgrade uid-only document", async () => {
    await assertSucceeds(setDoc(doc(alice(), "benchmarks", ALICE), summary()));
    await assertSucceeds(deleteDoc(doc(alice(), "benchmarks", ALICE)));
  });

  it("refuses to let one user write another's document", async () => {
    await assertFails(setDoc(doc(bob(), "benchmarks", `${ALICE}__v1`), summary()));
    await assertFails(setDoc(doc(bob(), "benchmarks", ALICE), summary()));
  });

  it("rejects any field that could identify a person or a place", async () => {
    await assertFails(
      setDoc(doc(alice(), "benchmarks", `${ALICE}__v1`), summary({ email: "a@b.c" })),
    );
    await assertFails(
      setDoc(doc(alice(), "benchmarks", `${ALICE}__v1`), summary({ plateNumber: "12345678" })),
    );
    await assertFails(
      setDoc(doc(alice(), "benchmarks", `${ALICE}__v1`), summary({ odometer: 100000 })),
    );
  });

  it("rejects an implausible economy figure", async () => {
    await assertFails(
      setDoc(doc(alice(), "benchmarks", `${ALICE}__v1`), summary({ avgKmPerLiter: 0 })),
    );
    await assertFails(
      setDoc(doc(alice(), "benchmarks", `${ALICE}__v1`), summary({ avgKmPerLiter: 500 })),
    );
  });

  it("is readable by any signed-in user, and by nobody else", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "benchmarks", `${BOB}__v1`), summary());
    });
    await assertSucceeds(getDoc(doc(alice(), "benchmarks", `${BOB}__v1`)));
    await assertFails(getDoc(doc(anon(), "benchmarks", `${BOB}__v1`)));
  });
});

/* ------------------------------------------------------------------ *
 * Global config and feedback
 * ------------------------------------------------------------------ */

describe("app config", () => {
  it("is readable by any signed-in user and writable only by an admin", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "appConfig", "fuelPrices"), {
        current: { pricePerLiter: 7.31 },
      });
    });
    await assertSucceeds(getDoc(doc(alice(), "appConfig", "fuelPrices")));
    await assertFails(
      setDoc(doc(alice(), "appConfig", "fuelPrices"), { current: { pricePerLiter: 1 } }),
    );
    await assertSucceeds(
      setDoc(doc(admin(), "appConfig", "fuelPrices"), { current: { pricePerLiter: 7.4 } }),
    );
  });
});

describe("feedback", () => {
  it("is append-only", async () => {
    const ref = doc(alice(), "feedback", "e1");
    await assertSucceeds(setDoc(ref, { uid: ALICE, message: "שלום" }));
    await assertFails(updateDoc(ref, { message: "שונה" }));
  });

  it("cannot be filed in someone else's name", async () => {
    await assertFails(setDoc(doc(bob(), "feedback", "e2"), { uid: ALICE, message: "x" }));
  });
});

/* ------------------------------------------------------------------ *
 * Everything else is closed
 * ------------------------------------------------------------------ */

describe("default deny", () => {
  it("refuses an unlisted collection", async () => {
    await assertFails(setDoc(doc(alice(), "somethingElse", "x"), { a: 1 }));
    await assertFails(getDoc(doc(alice(), "somethingElse", "x")));
  });
});

/* ------------------------------------------------------------------ *
 * Import batches and personal pricing rules
 * ------------------------------------------------------------------ */

describe("import batches", () => {
  const batch = (over: Record<string, unknown> = {}) => ({
    vehicleId: "v1",
    format: "legacy-fuel-tracker",
    fileName: "old-log.xlsx",
    recordCount: 25,
    vehicleLabel: "מאזדה 3",
    ...over,
  });

  const ref = (db: ReturnType<typeof alice>, uid = ALICE, id = "b1") =>
    doc(db, "users", uid, "importBatches", id);

  it("lets the owner record and remove a batch", async () => {
    await assertSucceeds(setDoc(ref(alice()), batch()));
    await assertSucceeds(getDoc(ref(alice())));
    await assertSucceeds(deleteDoc(ref(alice())));
  });

  it("refuses another user", async () => {
    await assertFails(setDoc(ref(bob(), ALICE), batch()));
    await assertFails(getDoc(ref(bob(), ALICE)));
  });

  it("rejects an unknown field or an absurd record count", async () => {
    await assertFails(setDoc(ref(alice()), batch({ secret: "x" })));
    await assertFails(setDoc(ref(alice()), batch({ recordCount: -1 })));
    await assertFails(setDoc(ref(alice()), batch({ recordCount: 10_000_000 })));
  });
});

describe("personal price rules", () => {
  const rule = (over: Record<string, unknown> = {}) => ({
    vehicleId: "v1",
    stationId: "st-42",
    stationName: "פז חגור",
    fuelType: "95",
    discountPerLiter: 0.25,
    fixedPricePerLiter: null,
    label: "כרטיס דלק",
    expiresAt: null,
    legacy: false,
    reviewed: true,
    ...over,
  });

  const ref = (db: ReturnType<typeof alice>, uid = ALICE, id = "r1") =>
    doc(db, "users", uid, "personalPriceRules", id);

  it("lets the owner create, read and delete a rule", async () => {
    await assertSucceeds(setDoc(ref(alice()), rule()));
    await assertSucceeds(getDoc(ref(alice())));
    await assertSucceeds(deleteDoc(ref(alice())));
  });

  it("is private — not readable by another user, nor by an admin", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "users", ALICE, "personalPriceRules", "r1"),
        rule(),
      );
    });
    // A negotiated discount is nobody else's business.
    await assertFails(getDoc(ref(bob(), ALICE)));
    await assertFails(getDoc(ref(admin(), ALICE)));
  });

  it("accepts a migrated legacy rule awaiting review", async () => {
    await assertSucceeds(
      setDoc(ref(alice()), rule({ legacy: true, reviewed: false, stationId: null })),
    );
  });

  it("rejects an unknown field or an implausible discount", async () => {
    await assertFails(setDoc(ref(alice()), rule({ ownerEmail: "a@b.c" })));
    await assertFails(setDoc(ref(alice()), rule({ discountPerLiter: 500 })));
    await assertFails(setDoc(ref(alice()), rule({ fuelType: "kerosene" })));
  });
});


describe("operational summaries", () => {
  const summary = (over: Record<string, unknown> = {}) => ({
    version: 1,
    vehicleCount: 2,
    vehicles: {
      v1: {
        fuelType: "95",
        fillups: 12,
        trackedKm: 4800,
        liters: 410.5,
        cost: 3021.4,
        kmPerLiter: 11.7,
        segments: 9,
        lastFillupAt: 1_780_000_000_000,
        updatedAt: 1_780_000_000_000,
      },
    },
    ...over,
  });

  it("lets the owner publish its own summary", async () => {
    await assertSucceeds(setDoc(doc(alice(), "userSummaries", ALICE), summary()));
    await assertSucceeds(getDoc(doc(alice(), "userSummaries", ALICE)));
  });

  it("is readable by an admin — this is what replaced raw fill-up access", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "userSummaries", ALICE), summary());
    });
    await assertSucceeds(getDoc(doc(admin(), "userSummaries", ALICE)));
  });

  it("cannot be written for someone else", async () => {
    await assertFails(setDoc(doc(bob(), "userSummaries", ALICE), summary()));
    // Not even by an admin: a summary is the account's own statement.
    await assertFails(setDoc(doc(admin(), "userSummaries", ALICE), summary()));
  });

  it("is not readable by another signed-in user", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "userSummaries", ALICE), summary());
    });
    await assertFails(getDoc(doc(bob(), "userSummaries", ALICE)));
  });

  it("is bounded, so a hostile value cannot break the dashboard", async () => {
    await assertFails(
      setDoc(doc(alice(), "userSummaries", ALICE), summary({ vehicleCount: 5000 })),
    );
    await assertFails(
      setDoc(doc(alice(), "userSummaries", ALICE), summary({ rawFillups: [] })),
    );
    await assertFails(
      setDoc(doc(alice(), "userSummaries", ALICE), summary({ vehicles: "not a map" })),
    );
  });
});
