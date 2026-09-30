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
import { deleteDoc, doc, setDoc, updateDoc, Timestamp } from "firebase/firestore";

/**
 * The optimistic-concurrency contract on fill-ups.
 *
 * Every fill-up a current client writes carries a `version` number. The
 * rules enforce, server-side:
 *
 *   create : `version` absent (a pre-version client), or a number >= 1.
 *   update : if the incoming document carries `version`, it must be exactly
 *            the stored version + 1 (a legacy document with no stamp counts
 *            as 0). An update that does not carry it at all is let through.
 *   delete : no version check.
 *
 * So two devices editing the same record from the same snapshot cannot both
 * win: the second write arrives with a stamp equal to what is now stored and
 * is refused, instead of silently overwriting the first.
 *
 * One consequence worth spelling out: `updateDoc` merges the stored fields
 * into `request.resource.data`, so a partial patch that never mentions
 * `version` still carries the STORED version on a versioned document, and
 * `stored == stored + 1` fails. "Absent" therefore only happens when the
 * stored document has no version yet. Both behaviours are pinned below.
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

const alice = () => testEnv.authenticatedContext(ALICE).firestore();

const fillupRef = (db: ReturnType<typeof alice>, uid = ALICE, id = "f1") =>
  doc(db, "users", uid, "vehicles", "v1", "fillups", id);

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

/** Seed a document as the owner, bypassing nothing — the rules must accept it. */
async function seed(data: Record<string, unknown>) {
  await assertSucceeds(setDoc(fillupRef(alice()), data));
}

/* ------------------------------------------------------------------ *
 * create
 * ------------------------------------------------------------------ */

describe("fill-up create — the version stamp", () => {
  it("accepts a record without a version (pre-version client)", async () => {
    await assertSucceeds(setDoc(fillupRef(alice()), fillup()));
  });

  it("accepts version 1", async () => {
    await assertSucceeds(setDoc(fillupRef(alice()), fillup({ version: 1 })));
  });

  it("accepts a version above 1 — a retried create is still a create", async () => {
    await assertSucceeds(setDoc(fillupRef(alice()), fillup({ version: 7 })));
  });

  it("rejects version 0", async () => {
    await assertFails(setDoc(fillupRef(alice()), fillup({ version: 0 })));
  });

  it("rejects version NaN", async () => {
    await assertFails(setDoc(fillupRef(alice()), fillup({ version: NaN })));
  });

  it("rejects version Infinity", async () => {
    await assertFails(setDoc(fillupRef(alice()), fillup({ version: Infinity })));
  });

  it("rejects a version given as a string", async () => {
    await assertFails(setDoc(fillupRef(alice()), fillup({ version: "1" })));
  });

  it("rejects an explicit null version", async () => {
    await assertFails(setDoc(fillupRef(alice()), fillup({ version: null })));
  });

  it("rejects a negative version", async () => {
    await assertFails(setDoc(fillupRef(alice()), fillup({ version: -1 })));
  });
});

/* ------------------------------------------------------------------ *
 * update — stored version present
 * ------------------------------------------------------------------ */

describe("fill-up update over a stored version of 3", () => {
  beforeEach(async () => {
    await seed(fillup({ version: 3 }));
  });

  it("accepts version 4 (stored + 1)", async () => {
    await assertSucceeds(updateDoc(fillupRef(alice()), fillup({ notes: "עודכן", version: 4 })));
  });

  it("rejects version 3 — the stale, same-as-stored stamp", async () => {
    await assertFails(updateDoc(fillupRef(alice()), fillup({ notes: "עודכן", version: 3 })));
  });

  it("rejects version 5 — skipping ahead", async () => {
    await assertFails(updateDoc(fillupRef(alice()), fillup({ notes: "עודכן", version: 5 })));
  });

  it("rejects version 2 — going backwards", async () => {
    await assertFails(updateDoc(fillupRef(alice()), fillup({ notes: "עודכן", version: 2 })));
  });

  it("rejects a version that is not a number, even on update", async () => {
    await assertFails(updateDoc(fillupRef(alice()), fillup({ version: "4" })));
    await assertFails(updateDoc(fillupRef(alice()), fillup({ version: NaN })));
  });

  it("accepts consecutive updates that keep counting", async () => {
    await assertSucceeds(updateDoc(fillupRef(alice()), fillup({ version: 4 })));
    await assertSucceeds(updateDoc(fillupRef(alice()), fillup({ version: 5 })));
    await assertFails(updateDoc(fillupRef(alice()), fillup({ version: 5 })));
  });
});

/* ------------------------------------------------------------------ *
 * update — legacy document, no stored version
 * ------------------------------------------------------------------ */

describe("fill-up update over a legacy document (no stored version)", () => {
  beforeEach(async () => {
    await seed(fillup());
  });

  it("accepts version 1 — a missing stamp counts as 0", async () => {
    await assertSucceeds(updateDoc(fillupRef(alice()), fillup({ version: 1 })));
  });

  it("rejects version 2", async () => {
    await assertFails(updateDoc(fillupRef(alice()), fillup({ version: 2 })));
  });

  it("rejects version 0", async () => {
    await assertFails(updateDoc(fillupRef(alice()), fillup({ version: 0 })));
  });
});

/* ------------------------------------------------------------------ *
 * setDoc — a full overwrite is still an update to the rules
 * ------------------------------------------------------------------ */

describe("fill-up setDoc over an existing versioned document", () => {
  beforeEach(async () => {
    await seed(fillup({ version: 3 }));
  });

  it("accepts a full overwrite stamped stored + 1", async () => {
    await assertSucceeds(setDoc(fillupRef(alice()), fillup({ liters: 41, totalCost: 299.7, version: 4 })));
  });

  it("rejects a retried create (version 1) over a newer document", async () => {
    // The client created this record, lost the acknowledgement, and retries
    // the create with its original stamp — meanwhile another device already
    // moved the record on. The retry must not roll it back.
    await assertFails(setDoc(fillupRef(alice()), fillup({ version: 1 })));
  });

  it("accepts a version-less full overwrite — setDoc merges nothing back in", async () => {
    // Unlike updateDoc, setDoc replaces the whole document, so the stored
    // version is NOT merged back in and the write really is version-less.
    // This is the one path where a pre-version client can rewrite a
    // versioned record; the observed behaviour is pinned so a change to it
    // is a deliberate one.
    await assertSucceeds(setDoc(fillupRef(alice()), fillup({ notes: "ללא גרסה" })));
  });
});

/* ------------------------------------------------------------------ *
 * updateDoc patches that never mention `version`
 * ------------------------------------------------------------------ */

describe("an updateDoc patch that does not mention version", () => {
  it("is REJECTED on a versioned document — the stored version is merged in and equals itself", async () => {
    await seed(fillup({ version: 3 }));
    // request.resource.data is the merge of the stored document and the
    // patch, so it carries version 3, and 3 == 3 + 1 is false. A client
    // that edits a versioned record must stamp it.
    await assertFails(updateDoc(fillupRef(alice()), { notes: "רק הערה" }));
  });

  it("is accepted on a legacy document — nothing to merge, nothing to check", async () => {
    await seed(fillup());
    await assertSucceeds(updateDoc(fillupRef(alice()), { notes: "רק הערה" }));
  });
});

/* ------------------------------------------------------------------ *
 * delete — untouched by the contract
 * ------------------------------------------------------------------ */

describe("fill-up delete", () => {
  it("is allowed on a versioned document", async () => {
    await seed(fillup({ version: 12 }));
    await assertSucceeds(deleteDoc(fillupRef(alice())));
  });

  it("is allowed on a legacy document", async () => {
    await seed(fillup());
    await assertSucceeds(deleteDoc(fillupRef(alice())));
  });
});

/* ------------------------------------------------------------------ *
 * Budget headroom — the maximal document from fillup-budget.test.ts
 * ------------------------------------------------------------------ */

/**
 * A copy of the maximal fill-up from fillup-budget.test.ts (every whitelisted
 * key present and non-null), plus the version stamp. If this passes on
 * create AND on update — the update path is the dearer one, it runs the
 * "stored + 1" comparison on top of validFillup — the version check fits
 * inside the 1,000-expression budget on the most expensive record the rules
 * can be asked to evaluate.
 */
const LONG_NOTE = (() => {
  const s = "תדלקתי מלא בפז חגור אחרי נסיעה ארוכה מהצפון, המחיר היה טוב יחסית לשבוע שעבר. ";
  let out = "";
  while (out.length < 500) out += s;
  return out.slice(0, 500);
})();

const maximal = () => ({
  ...fillup(),
  createdAt: Timestamp.fromMillis(Date.UTC(2026, 0, 5, 8, 1)),
  continuityBreakBefore: false,
  fullTankSource: "user",
  postedPricePerLiter: 7.45,
  fuelType: "95",
  importSource: "fuelio-csv",
  importBatchId: "batch-2026-01-05-0001",
  importRowHash: "a3f1c9e2b7d4085f6e1a2c3b4d5e6f70",
  schemaVersion: 3,
  notes: LONG_NOTE,
  station: {
    name: "פז חגור — כביש 6 צומת עירון",
    lat: 32.4321,
    lng: 35.0123,
    stationId: "st-42",
    brand: "פז",
  },
  fillEndState: "full",
  fillEndStateSource: "user-confirmed",
  preFillLevel: 0.2,
  preFillLevelSource: "direct-gauge",
  preFillLevelUncertainty: 0.05,
  postFillLevel: 1,
  postFillLevelSource: "derived-from-full-and-liters",
  postFillLevelUncertainty: 0.02,
  refuelReason: "routine",
  capacityLitersAtEntry: 51,
  tankSchemaVersion: 1,
});

describe("the maximal fill-up plus a version stamp (expression budget)", () => {
  it("is accepted on create (version 1) and on update (version 2)", async () => {
    await assertSucceeds(setDoc(fillupRef(alice()), { ...maximal(), version: 1 }));
    await assertSucceeds(updateDoc(fillupRef(alice()), { ...maximal(), version: 2 }));
  });

  it("still refuses a stale stamp on the maximal record", async () => {
    await assertSucceeds(setDoc(fillupRef(alice()), { ...maximal(), version: 1 }));
    await assertFails(updateDoc(fillupRef(alice()), { ...maximal(), version: 1 }));
  });
});
