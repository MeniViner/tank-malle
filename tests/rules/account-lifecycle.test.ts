import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp, type Firestore } from "firebase/firestore";
vi.mock("../../src/lib/firebase", () => ({ db: {} }));
import { accountDataDeletionSteps } from "../../src/lib/accountDeletion";
import { withdrawBenchmark } from "../../src/lib/benchmarks";
let env: RulesTestEnvironment;
beforeAll(async () => { env = await initializeTestEnvironment({ projectId: "tank-lifecycle-rules-test", firestore: {
  host: "127.0.0.1", port: 8080, rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") } }); }, 60000);
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });
const owner = () => env.authenticatedContext("alice").firestore() as unknown as Firestore;
const summary = { modelKey: "test", fuelType: "95", year: 2020, avgKmPerLiter: 12, segments: 3, avgPricePerLiter: 7 };

describe("privacy lifecycle server readback", () => {
  it("withdraws legacy, archived and orphaned contributions without touching a peer", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (const id of ["alice", "alice__active", "alice__archived", "alice__deleted", "bob__active"]) await setDoc(doc(db, "benchmarks", id), summary);
      await setDoc(doc(db, "users/alice"), { settings: { shareBenchmarks: false } });
    });
    const db = owner(); await withdrawBenchmark("alice", [], db);
    expect((await getDocs(collection(db, "benchmarks"))).docs.map((d) => d.id)).toEqual(["bob__active"]);
    await assertFails(setDoc(doc(db, "benchmarks/alice__active"), summary));
  });
  it("erases every personal collection and refuses concurrent new writes during deletion", async () => {
    const paths = ["users/alice/vehicles/v1", "users/alice/vehicles/v1/fillups/f1", "users/alice/vehicles/v1/observations/o1", "users/alice/vehicles/v1/tankPlans/p1", "users/alice/personalPriceRules/r1", "users/alice/importBatches/i1", "users/alice/stationPriceReports/s1", "benchmarks/alice__orphan", "benchmarks/alice", "userSummaries/alice", "feedback/f1"];
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/alice"), { settings: {} });
      for (const path of paths) await setDoc(doc(context.firestore(), path), { uid: "alice", ...summary });
      await setDoc(doc(context.firestore(), "feedback/foreign"), { uid: "bob", message: "private" });
    });
    const db = owner();
    const steps = accountDataDeletionSteps(db, "alice");
    await steps[0].run();
    await assertFails(setDoc(doc(db, "feedback/new"), { uid: "alice", message: "new" }));
    await assertFails(setDoc(doc(db, "users/alice/vehicles/new"), { make: "x", model: "y", fuelType: "95", archived: false, priceAdjustment: 0 }));
    await assertFails(setDoc(doc(db, "users/alice/vehicles/v1/observations/new"), { observedAt: Timestamp.now(), kind: "odometer", confirmed: true, odometer: 123456 }));
    for (const step of steps) await step.run();
    await env.withSecurityRulesDisabled(async (context) => {
      for (const path of paths) expect((await getDoc(doc(context.firestore(), path))).exists(), path).toBe(false);
      expect((await getDoc(doc(context.firestore(), "feedback/foreign"))).exists()).toBe(true);
    });
    await assertFails(deleteDoc(doc(db, "feedback/foreign")));
    await assertSucceeds(deleteDoc(doc(db, "users/alice")));
  });
});
