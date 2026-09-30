/**
 * Admin seed for the global fuel price — a MANUAL entry, and recorded as one.
 *
 * The daily GitHub Actions job (scripts/updateFuelPrices.mjs) is the normal
 * source. This is for a first seed, a backfill, or a correction when the
 * ministry's page cannot be read. It writes the 95 self-service series in the
 * same shape the app reads, tagged `source: "manual"` with a `manualOverride`
 * for the seeded month — so the app never labels it "מחיר מרבי מפוקח", and the
 * job leaves it in force for that month (see
 * docs/PRICE-SOURCE-AND-CONFIDENCE-MODEL.md §9).
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

const current = {
  pricePerLiter: price,
  effectiveFrom,
  updatedAt: FieldValue.serverTimestamp(),
};

const payload = {
  // Legacy top-level fields, for the adapter.
  history: { [month]: price },
  source: "manual-seed",
  // The per-fuel series every screen actually reads.
  byFuelType: {
    95: {
      self: {
        history: { [month]: price },
        source: "manual",
        manualOverride: {
          pricePerLiter: price,
          month,
          setAt: FieldValue.serverTimestamp(),
          note: "seed",
        },
        ...(isCurrentOrNewer ? { current } : {}),
      },
    },
  },
};

if (isCurrentOrNewer) {
  payload.current = current;
}

await ref.set(payload, { merge: true });

console.log(
  `Wrote ₪${price.toFixed(2)}/L for ${month}${
    isCurrentOrNewer ? " (also set as the current price)" : " (history only)"
  }`,
);
console.log(`  project: ${serviceAccount.project_id}`);
process.exit(0);
