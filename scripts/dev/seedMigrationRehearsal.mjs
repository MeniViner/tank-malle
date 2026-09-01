/**
 * Seed the EMULATOR with pre-upgrade shaped data, so the migration can be
 * rehearsed end to end without touching production.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     node scripts/dev/seedMigrationRehearsal.mjs
 *
 * Emulator only. It hard-codes a demo project id and a stub credential, both
 * of which are meaningless against a real project.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

// With FIRESTORE_EMULATOR_HOST set, the SDK talks to the emulator and never
// checks credentials, so none are supplied.
initializeApp({ projectId: "demo-migrate" });
const db = getFirestore();

const catalog = JSON.parse(
  readFileSync(new URL("../../public/fuel-stations.json", import.meta.url), "utf8"),
);
const list = Array.isArray(catalog) ? catalog : (catalog.stations ?? []);
const real = list.slice(0, 2);
console.log("catalog sample:", JSON.stringify(real[0]));

await db.doc("appConfig/fuelPrices").set({
  current: { pricePerLiter: 7.31, updatedAt: Timestamp.now() },
  history: { "2026-07": 7.12, "2026-08": 7.31 },
});

for (const uid of ["u1", "u2"]) {
  await db.doc(`users/${uid}`).set({ email: `${uid}@example.com`, settings: {} });

  // u1: a vehicle with BOTH legacy price fields; u2: neither.
  await db.doc(`users/${uid}/vehicles/v1`).set({
    make: "מאזדה",
    model: "3",
    fuelType: "95",
    archived: false,
    priceAdjustment: uid === "u1" ? -0.05 : 0,
    manualPricePerLiter: uid === "u1" ? 6.8 : null,
  });

  for (let i = 0; i < 4; i += 1) {
    await db.doc(`users/${uid}/vehicles/v1/fillups/f${i}`).set({
      date: Timestamp.fromMillis(Date.UTC(2026, 0, 5 + i * 7)),
      odometer: 100000 + i * 400,
      liters: 40,
      pricePerLiter: 7.31,
      totalCost: 292.4,
      isFullTank: true,
      // Alternate: an exact catalog station, and one with no coordinates.
      station:
        i % 2 === 0 && real[0]
          ? { name: real[0].n, lat: real[0].lat, lng: real[0].lng }
          : { name: "תחנה פרטית" },
    });
  }
}
console.log("seeded");
