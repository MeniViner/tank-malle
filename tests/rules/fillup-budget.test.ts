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
 * Fill-up rules vs the 1,000-expression evaluation budget.
 *
 * Firestore evaluates at most 1,000 expressions per request. `validFillup`
 * used to reach that ceiling on an ordinary, fully-populated record — a
 * station map plus a before-level plus one more optional field — and the
 * write came back PERMISSION_DENIED. The client SDK then rolled back its
 * optimistic local write and the record vanished: data loss with no error the
 * user could act on.
 *
 * This file is the regression guard. The matrix below enumerates the shapes
 * a real client produces and insists every one of them is accepted, on both
 * create and update (the edit flow). The negative cases insist the rewrite
 * did not buy the budget by relaxing anything.
 *
 * OBSERVED BASELINE (this file run against the rules at commit d8672c2, i.e.
 * BEFORE the rewrite of validTankFields and its helpers, Firestore emulator
 * via firebase-tools, 2026-09-30):
 *
 *   8 of 70 tests failed: the maximal record, plus 7 of the 27 matrix cases —
 *   every "station present + before-level given" record (all four extras,
 *   including none) and all three "imported record edited with a
 *   before-level" flows. The other 20 matrix cases passed.
 *
 *   Every failure was expression-budget exhaustion, not an ordinary denial.
 *   The client received, verbatim:
 *
 *     FirebaseError: 7 PERMISSION_DENIED:
 *     Unable to evaluate the expression as the maximum of 1000 expressions
 *     to evaluate has been reached. for 'create' @ L384, ... for 'update' @ L384
 *
 *   and firestore-debug.log named the spot the budget ran out:
 *
 *     EvaluationException: Error:  line [128], column [22]. Unable to
 *     evaluate the expression as the maximum of 1000 expressions to
 *     evaluate has been reached.
 *
 *   L128:22 was `isNumber(data[field])` inside the old optionalLevel(). An
 *   ordinary denial reads "false for 'create' @ L384" instead; none of the
 *   failures did.
 *
 *   After the rewrite: 0 failures, and the maximal record still passes with
 *   ~26 extra `&& (1 == 1)` terms padded onto validTankFields (measured by
 *   binary search), so a handful of future optional fields fit before this
 *   guard trips again.
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

const fillupRef = (db: ReturnType<typeof alice>, uid = ALICE, id = "f1") =>
  doc(db, "users", uid, "vehicles", "v1", "fillups", id);

const observationRef = (db: ReturnType<typeof alice>, uid = ALICE, id = "o1") =>
  doc(db, "users", uid, "vehicles", "v1", "observations", id);

/* ------------------------------------------------------------------ *
 * Building blocks
 * ------------------------------------------------------------------ */

/** The minimum a fill-up needs; totalCost reconciles with liters x price. */
const base = () => ({
  date: Timestamp.fromMillis(Date.UTC(2026, 0, 5, 8, 0)),
  odometer: 100_000,
  liters: 40,
  pricePerLiter: 7.31,
  totalCost: 292.4,
  isFullTank: true,
  createdAt: Timestamp.fromMillis(Date.UTC(2026, 0, 5, 8, 1)),
});

/** A station reference carrying every whitelisted key. */
const STATION = {
  name: "פז חגור — כביש 6 צומת עירון",
  lat: 32.4321,
  lng: 35.0123,
  stationId: "st-42",
  brand: "פז",
};

/** The six fields a before-level observation attaches to the record. */
const BEFORE_LEVEL = {
  preFillLevel: 0.2,
  preFillLevelSource: "direct-gauge",
  preFillLevelUncertainty: 0.05,
  postFillLevel: 1,
  postFillLevelSource: "derived-from-full-and-liters",
  postFillLevelUncertainty: 0.02,
};

/** A user-confirmed full tank. */
const CONFIRMED_FULL = {
  fillEndState: "full",
  fillEndStateSource: "user-confirmed",
};

const IMPORT = {
  importSource: "fuelio-csv",
  importBatchId: "batch-2026-01-05-0001",
  importRowHash: "a3f1c9e2b7d4085f6e1a2c3b4d5e6f70",
};

/** A 500-character Hebrew note — the maximum the rules accept. */
const LONG_NOTE = (() => {
  const s = "תדלקתי מלא בפז חגור אחרי נסיעה ארוכה מהצפון, המחיר היה טוב יחסית לשבוע שעבר. ";
  let out = "";
  while (out.length < 500) out += s;
  return out.slice(0, 500);
})();
if (LONG_NOTE.length !== 500) throw new Error("LONG_NOTE must be exactly 500 chars");

/**
 * Every whitelisted key, present and non-null. This is the most expensive
 * document the rules can be asked to evaluate, so it doubles as the
 * budget probe: if this passes, nothing smaller can run out.
 */
const maximal = () => ({
  ...base(),
  continuityBreakBefore: false,
  fullTankSource: "user",
  postedPricePerLiter: 7.45,
  fuelType: "95",
  ...IMPORT,
  schemaVersion: 3,
  notes: LONG_NOTE,
  station: STATION,
  ...CONFIRMED_FULL,
  ...BEFORE_LEVEL,
  refuelReason: "routine",
  capacityLitersAtEntry: 51,
  tankSchemaVersion: 1,
});

/** Create as the owner, then apply the same patch as an update — the edit flow. */
async function createAndEdit(data: Record<string, unknown>) {
  await assertSucceeds(setDoc(fillupRef(alice()), data));
  await assertSucceeds(updateDoc(fillupRef(alice()), data));
}

/* ------------------------------------------------------------------ *
 * The maximal record
 * ------------------------------------------------------------------ */

describe("a maximal fill-up (every whitelisted key present)", () => {
  it("is accepted on create and on update", async () => {
    await createAndEdit(maximal());
  });
});

/* ------------------------------------------------------------------ *
 * The 27-case matrix — the shapes FillupForm.save() really writes
 * ------------------------------------------------------------------ */

/**
 * `FillupForm.save()` never omits a key it knows about: unanswered fields are
 * written as null (station, notes, postedPricePerLiter), and once the tank
 * section has been touched ALL eleven tank keys are written, the unobserved
 * levels as null. The matrix therefore models the record the way the client
 * builds it, not a hand-picked subset.
 *
 *   station : null | present (all 5 keys)                      (2)
 *   tank    : untouched (no tank keys — a legacy or untouched record)
 *           | touched, no before-level (11 keys, 6 of them null)
 *           | touched, before-level given (6 non-null level fields)  (3)
 *   extra   : none | notes | postedPricePerLiter | confirmedFull  (4)
 *
 * 2 x 3 x 4 = 24, plus 3 "imported record edited with a before-level"
 * flows = 27.
 */
type TankMode = "untouched" | "touched" | "before-level";

/** buildTankFields() in FillupForm: every key present, null where unobserved. */
function tankBlock(mode: TankMode, confirmedFull: boolean): Record<string, unknown> {
  if (mode === "untouched") return {};
  const endState = confirmedFull
    ? CONFIRMED_FULL
    : mode === "before-level"
      ? { fillEndState: "partial", fillEndStateSource: "gauge-estimate" }
      : { fillEndState: "unknown", fillEndStateSource: "unknown" };
  return {
    ...endState,
    refuelReason: "routine",
    capacityLitersAtEntry: 51,
    tankSchemaVersion: 2,
    preFillLevel: null,
    preFillLevelSource: null,
    preFillLevelUncertainty: null,
    postFillLevel: null,
    postFillLevelSource: null,
    postFillLevelUncertainty: null,
    ...(mode === "before-level" ? BEFORE_LEVEL : {}),
  };
}

/** The payload FillupForm.save() hands to addFillup / updateFillup. */
function clientRecord(opts: {
  station: boolean;
  tank: TankMode;
  notes?: boolean;
  postedPrice?: boolean;
  confirmedFull?: boolean;
}): Record<string, unknown> {
  const confirmedFull = opts.confirmedFull === true;
  return {
    ...base(),
    fullTankSource: confirmedFull ? "user" : "legacy-assumption",
    continuityBreakBefore: false,
    ...tankBlock(opts.tank, confirmedFull),
    postedPricePerLiter: opts.postedPrice ? 7.45 : null,
    fuelType: "95",
    station: opts.station ? STATION : null,
    notes: opts.notes ? "מלא, מחיר טוב" : null,
  };
}

const EXTRAS: Record<string, { notes?: boolean; postedPrice?: boolean; confirmedFull?: boolean }> = {
  none: {},
  notes: { notes: true },
  postedPricePerLiter: { postedPrice: true },
  confirmedFull: { confirmedFull: true },
};

type Case = { name: string; data: Record<string, unknown> };

const MATRIX: Case[] = [];
for (const station of [false, true]) {
  for (const tank of ["untouched", "touched", "before-level"] as TankMode[]) {
    for (const [extraName, extra] of Object.entries(EXTRAS)) {
      MATRIX.push({
        name: `station=${station ? "yes" : "no "} tank=${tank.padEnd(12)} extra=${extraName}`,
        data: clientRecord({ station, tank, ...extra }),
      });
    }
  }
}

describe("fill-up shape matrix — every case must be accepted", () => {
  it.each(MATRIX)("$name", async ({ data }) => {
    await createAndEdit(data);
  });

  /**
   * An imported record carries the import stamps and no tank keys. Editing
   * it and stating a before-level sends the FULL form payload as an update,
   * so the merged document has the stamps AND the whole tank block.
   */
  const IMPORTED_EDITS: Case[] = [
    {
      name: "imported record, edited with a before-level",
      data: { ...base(), ...IMPORT, fullTankSource: "legacy-assumption", schemaVersion: 2 },
    },
    {
      name: "imported record with a station, edited with a before-level",
      data: {
        ...base(),
        ...IMPORT,
        fullTankSource: "legacy-assumption",
        schemaVersion: 2,
        station: STATION,
      },
    },
    {
      name: "imported record with a station and a note, edited with a before-level",
      data: {
        ...base(),
        ...IMPORT,
        fullTankSource: "legacy-assumption",
        schemaVersion: 2,
        station: STATION,
        notes: "יובא מקובץ",
      },
    },
  ];

  it.each(IMPORTED_EDITS)("$name", async ({ data }) => {
    await assertSucceeds(setDoc(fillupRef(alice()), data));
    await assertSucceeds(
      updateDoc(
        fillupRef(alice()),
        clientRecord({ station: true, tank: "before-level", notes: true, postedPrice: true }),
      ),
    );
  });

  it("the matrix has 27 cases", () => {
    if (MATRIX.length + IMPORTED_EDITS.length !== 27) {
      throw new Error(`expected 27 cases, got ${MATRIX.length + IMPORTED_EDITS.length}`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Nothing was relaxed — negatives on the MAXIMAL document
 * ------------------------------------------------------------------ */

describe("the maximal fill-up still rejects", () => {
  const rejects = (name: string, over: Record<string, unknown>) =>
    it(name, async () => {
      await assertFails(setDoc(fillupRef(alice()), { ...maximal(), ...over }));
    });

  rejects("a level above 1", { preFillLevel: 1.5 });
  rejects("a level below 0", { postFillLevel: -0.1 });
  rejects("a level uncertainty above 1", { preFillLevelUncertainty: 2 });
  rejects("a level uncertainty below 0", { postFillLevelUncertainty: -0.5 });
  rejects("a level that is NaN", { preFillLevel: NaN });
  rejects("a level that is Infinity", { postFillLevel: Infinity });
  rejects("a level uncertainty that is NaN", { preFillLevelUncertainty: NaN });
  rejects("a level given as a string", { preFillLevel: "0.5" });

  rejects("an invalid fillEndState", { fillEndState: "brimming" });
  rejects("an invalid fillEndStateSource", { fillEndStateSource: "psychic" });
  rejects("an invalid preFillLevelSource", { preFillLevelSource: "guess" });
  rejects("an invalid postFillLevelSource", { postFillLevelSource: "guess" });
  rejects("an invalid refuelReason", { refuelReason: "boredom" });

  rejects("tankSchemaVersion 0", { tankSchemaVersion: 0 });
  rejects("tankSchemaVersion Infinity", { tankSchemaVersion: Infinity });
  rejects("tankSchemaVersion NaN", { tankSchemaVersion: NaN });
  rejects("tankSchemaVersion as a string", { tankSchemaVersion: "1" });

  rejects("capacityLitersAtEntry 0", { capacityLitersAtEntry: 0 });
  rejects("capacityLitersAtEntry 501", { capacityLitersAtEntry: 501 });
  rejects("capacityLitersAtEntry Infinity", { capacityLitersAtEntry: Infinity });
  rejects("capacityLitersAtEntry NaN", { capacityLitersAtEntry: NaN });

  rejects("an unknown root key", { id: "f1" });
  rejects("an unknown nested station key", { station: { ...STATION, tracking: { a: 1 } } });
  rejects("a total that does not reconcile with liters x price", { totalCost: 999 });

  rejects("odometer NaN", { odometer: NaN });
  rejects("odometer Infinity", { odometer: Infinity });
  rejects("liters NaN", { liters: NaN });
  rejects("liters Infinity", { liters: Infinity });
  rejects("pricePerLiter NaN", { pricePerLiter: NaN });
  rejects("pricePerLiter Infinity", { pricePerLiter: Infinity });
  rejects("totalCost NaN", { totalCost: NaN });
  rejects("totalCost Infinity", { totalCost: Infinity });

  it("another signed-in user writing it", async () => {
    await assertFails(setDoc(fillupRef(bob(), ALICE), maximal()));
  });

  it("an unauthenticated write", async () => {
    await assertFails(setDoc(fillupRef(anon(), ALICE), maximal()));
  });

  it("an admin writing it", async () => {
    await assertFails(setDoc(fillupRef(admin(), ALICE), maximal()));
  });
});

/* ------------------------------------------------------------------ *
 * Observations share the level helpers — they must stay strict
 * ------------------------------------------------------------------ */

describe("observations (shared level helpers)", () => {
  const observation = (over: Record<string, unknown> = {}) => ({
    observedAt: Timestamp.fromMillis(Date.UTC(2026, 0, 5, 8, 0)),
    recordedAt: Timestamp.fromMillis(Date.UTC(2026, 0, 5, 8, 1)),
    kind: "both",
    odometer: 100_500,
    level: 0.25,
    levelUncertainty: 0.05,
    levelSource: "direct-gauge",
    confirmed: true,
    fillupId: "f1",
    phase: "before_refuel",
    schemaVersion: 1,
    ...over,
  });

  it("accepts a maximal observation on create and update", async () => {
    await assertSucceeds(setDoc(observationRef(alice()), observation()));
    await assertSucceeds(updateDoc(observationRef(alice()), observation()));
  });

  it("rejects level 25 (a percentage, not a fraction)", async () => {
    await assertFails(setDoc(observationRef(alice()), observation({ level: 25 })));
  });

  it("rejects level NaN", async () => {
    await assertFails(setDoc(observationRef(alice()), observation({ level: NaN })));
  });

  it("rejects level Infinity", async () => {
    await assertFails(setDoc(observationRef(alice()), observation({ level: Infinity })));
  });

  it("rejects levelUncertainty 2", async () => {
    await assertFails(
      setDoc(observationRef(alice()), observation({ levelUncertainty: 2 })),
    );
  });

  it("rejects an invalid levelSource", async () => {
    await assertFails(
      setDoc(observationRef(alice()), observation({ levelSource: "psychic" })),
    );
  });
});
