/**
 * Admin seed for the global fuel price.
 *
 * The scheduled Cloud Function needs the Blaze plan. Until then (and any time
 * the official source changes shape), this writes appConfig/fuelPrices
 * directly so the app always has a price to auto-fill.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/tank-malle-…json \
 *     node scripts/seedFuelPrice.mjs 7.31
 *
 *   # backfill a past month
 *   … node scripts/seedFuelPrice.mjs 7.12 2026-07
 *
 * The service-account key is read from the environment only — it is never
 * committed, bundled, or referenced by path in this repo.
 */

import { readFile } from "node:fs/promises";
import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const [, , priceArg, monthArg] = process.argv;

if (!priceArg) {
  console.error(
    "usage: GOOGLE_APPLICATION_CREDENTIALS=<key.json> node scripts/seedFuelPrice.mjs <price> [YYYY-MM]",
  );
  process.exit(1);
}

const price = Number.parseFloat(priceArg);
if (!Number.isFinite(price) || price <= 0 || price > 20) {
  console.error(`"${priceArg}" is not a plausible price per liter.`);
  process.exit(1);
}

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  console.error(
    "GOOGLE_APPLICATION_CREDENTIALS must point at a service-account key JSON file.",
  );
  process.exit(1);
}

const serviceAccount = JSON.parse(await readFile(keyPath, "utf8"));
initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });

const db = getFirestore();

const now = new Date();
const month =
  monthArg ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

if (!/^\d{4}-\d{2}$/.test(month)) {
  console.error(`"${month}" is not a valid month key (expected YYYY-MM).`);
  process.exit(1);
}

const [year, monthNumber] = month.split("-").map(Number);
const effectiveFrom = new Date(year, monthNumber - 1, 1);

// Merge so backfilling an old month never clobbers the current price, and
// only advance `current` when seeding the present month or later.
const ref = db.doc("appConfig/fuelPrices");
const snapshot = await ref.get();
const existing = snapshot.exists ? snapshot.data() : undefined;

const existingEffective = existing?.current?.effectiveFrom?.toDate?.() ?? new Date(0);
const isCurrentOrNewer = effectiveFrom >= existingEffective;

const payload = {
  history: { [month]: price },
  source: "manual-seed",
};

if (isCurrentOrNewer) {
  payload.current = {
    pricePerLiter: price,
    effectiveFrom,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

await ref.set(payload, { merge: true });

console.log(
  `Wrote ₪${price.toFixed(2)}/L for ${month}${
    isCurrentOrNewer ? " (also set as the current price)" : " (history only)"
  }`,
);
console.log(`  project: ${serviceAccount.project_id}`);
process.exit(0);
