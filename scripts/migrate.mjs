#!/usr/bin/env node
/**
 * Backward-compatible data migration.
 *
 * DRY RUN BY DEFAULT. Nothing is written unless --apply is passed explicitly.
 *
 * What it does, and why each step is safe:
 *
 *  1. appConfig/fuelPrices → the fuel-type-aware shape.
 *     The legacy document has one price and one history with no fuel
 *     dimension. It is filed under 95/self, because that is the only product
 *     the Israeli regulated maximum covers and the only thing the admin editor
 *     and seed script were ever entering. It is NEVER copied to 98 or diesel.
 *     The legacy top-level fields are LEFT IN PLACE so an older client build
 *     keeps working.
 *
 *  2. vehicle.priceAdjustment / manualPricePerLiter → a legacy personal price
 *     rule, written with legacy: true and reviewed: false. The original
 *     vehicle fields are left untouched. An unreviewed legacy rule is not
 *     applied by the resolver, so a forgotten override stops silently setting
 *     prices — but the value is preserved for the user to confirm.
 *
 *  3. fill-up station → stationId, matched against the public catalog by
 *     coordinates and normalised name. Only a HIGH-confidence match is
 *     proposed; anything else is reported as unresolved rather than guessed.
 *
 *  4. schemaVersion stamping on fill-ups that predate it.
 *
 * Idempotent: re-running proposes nothing once applied. No document is ever
 * rewritten from the client during normal app startup.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=… node scripts/migrate.mjs            # dry run
 *   GOOGLE_APPLICATION_CREDENTIALS=… node scripts/migrate.mjs --apply    # write
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrate.mjs --project demo
 *
 * Options:
 *   --apply          actually write (default is dry run)
 *   --project <id>   project id (required with the emulator)
 *   --uid <uid>      restrict to one user, for a rehearsal
 *   --samples <n>    before/after samples to print (default 3)
 */

import { readFileSync, existsSync } from "node:fs";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/* ---------------- arguments ---------------- */

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag, fallback = null) => {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const APPLY = has("--apply");
const ONLY_UID = valueOf("--uid");
const SAMPLES = Number(valueOf("--samples", "3"));
const PROJECT_ID =
  valueOf("--project") ?? process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT;

/* ---------------- firestore ---------------- */

const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

// Against the emulator the SDK never checks credentials, so none are
// supplied. Against a real project, application-default credentials are
// required and the script will refuse to start without them.
initializeApp(
  usingEmulator
    ? { projectId: PROJECT_ID ?? "demo" }
    : { projectId: PROJECT_ID ?? undefined, credential: applicationDefault() },
);

const db = getFirestore();

/* ---------------- station catalog ---------------- */

const CATALOG_PATH = new URL("../public/fuel-stations.json", import.meta.url);

function loadCatalog() {
  if (!existsSync(CATALOG_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
    const list = Array.isArray(raw) ? raw : (raw.stations ?? []);
    // The catalog uses compact keys: i = government station number, n = label.
    return list
      .filter((entry) => entry && entry.lat != null && entry.lng != null)
      .map((entry) => ({
        id: entry.i ?? entry.id ?? null,
        name: entry.n ?? entry.name ?? "",
        lat: entry.lat,
        lng: entry.lng,
      }))
      .filter((entry) => entry.id);
  } catch {
    return [];
  }
}

const CATALOG = loadCatalog();

function normaliseName(value) {
  return String(value ?? "")
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .replace(/["'׳״]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function metresBetween(a, b) {
  const R = 6_371_000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Match a stored station to the catalog.
 *
 * Deliberately strict. A wrong stationId is worse than none: it would attach
 * this fill-up's price to somebody else's station in the aggregate. Only an
 * exact-name match within 250 m, or a unique catalog entry within 60 m,
 * counts as high confidence.
 */
function matchStation(station) {
  if (!station || typeof station !== "object") return { status: "no-station" };
  if (station.stationId) return { status: "already-resolved" };
  if (station.lat == null || station.lng == null) {
    return { status: "unresolved", reason: "no coordinates" };
  }
  if (CATALOG.length === 0) {
    return {
      status: "unresolved",
      reason: "catalog has no station ids — rebuild with scripts/buildStationCatalog.mjs",
    };
  }

  const name = normaliseName(station.name);
  const near = CATALOG.map((entry) => ({
    entry,
    metres: metresBetween(station, entry),
  }))
    .filter((candidate) => candidate.metres <= 250)
    .sort((a, b) => a.metres - b.metres);

  if (near.length === 0) return { status: "unresolved", reason: "no catalog entry nearby" };

  const byName = near.filter((candidate) => normaliseName(candidate.entry.name) === name);
  if (byName.length === 1) {
    return { status: "resolved", id: String(byName[0].entry.id ?? ""), metres: byName[0].metres };
  }

  const veryClose = near.filter((candidate) => candidate.metres <= 60);
  if (veryClose.length === 1) {
    return {
      status: "resolved",
      id: String(veryClose[0].entry.id ?? ""),
      metres: veryClose[0].metres,
    };
  }

  return {
    status: "unresolved",
    reason: `${near.length} candidates within 250 m, none unambiguous`,
  };
}

/* ---------------- report ---------------- */

const report = {
  fuelPrices: { adapted: false, note: "" },
  vehicles: { scanned: 0, legacyRulesCreated: 0, alreadyMigrated: 0 },
  fillups: { scanned: 0, stationResolved: 0, stationUnresolved: 0, versionStamped: 0 },
  unresolvedStations: new Map(),
  samples: [],
};

function sample(label, before, after) {
  if (report.samples.length >= SAMPLES) return;
  report.samples.push({ label, before, after });
}

const writes = [];
function planWrite(ref, data, options = {}) {
  writes.push({ ref, data, options });
}

/* ---------------- step 1: fuel prices ---------------- */

async function migrateFuelPrices() {
  const ref = db.doc("appConfig/fuelPrices");
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    report.fuelPrices.note = "no appConfig/fuelPrices document";
    return;
  }

  const data = snapshot.data();
  const existing = data.byFuelType?.["95"]?.self;

  if (existing && existing.current) {
    report.fuelPrices.note = "already fuel-type-aware; nothing to do";
    return;
  }

  const hasLegacy = data.current != null || Object.keys(data.history ?? {}).length > 0;
  if (!hasLegacy) {
    report.fuelPrices.note = "no legacy fields to adapt";
    return;
  }

  const next = {
    byFuelType: {
      "95": {
        self: {
          // An existing fuel-type-aware entry always wins; the legacy fields
          // only fill gaps, so a migration cannot lose newer data.
          history: { ...(data.history ?? {}), ...(existing?.history ?? {}) },
          current: existing?.current ?? data.current ?? null,
          source: existing?.source ?? "manual",
        },
      },
    },
  };

  report.fuelPrices.adapted = true;
  report.fuelPrices.note =
    "legacy price filed under 95/self; top-level fields left in place for older clients";

  sample(
    "appConfig/fuelPrices",
    { current: data.current, historyKeys: Object.keys(data.history ?? {}).length },
    { byFuelType95Self: next.byFuelType["95"].self.current },
  );

  planWrite(ref, next, { merge: true });
}

/* ---------------- steps 2-4: per user ---------------- */

async function migrateUser(userDoc) {
  const vehicles = await userDoc.ref.collection("vehicles").get();

  for (const vehicleDoc of vehicles.docs) {
    report.vehicles.scanned += 1;
    const vehicle = vehicleDoc.data();

    /* --- legacy personal price rules --- */
    const adjustment = Number(vehicle.priceAdjustment ?? 0);
    const manual = Number(vehicle.manualPricePerLiter ?? 0);
    const hasLegacyPricing =
      (Number.isFinite(adjustment) && adjustment !== 0) ||
      (Number.isFinite(manual) && manual > 0);

    if (hasLegacyPricing) {
      const ruleRef = userDoc.ref
        .collection("personalPriceRules")
        .doc(`legacy_${vehicleDoc.id}`);
      const already = await ruleRef.get();

      if (already.exists) {
        report.vehicles.alreadyMigrated += 1;
      } else {
        const rule = {
          vehicleId: vehicleDoc.id,
          stationId: null,
          fuelType: vehicle.fuelType ?? null,
          discountPerLiter: adjustment !== 0 ? -adjustment : 0,
          fixedPricePerLiter: manual > 0 ? manual : null,
          // Preserved and visible, but NOT applied until confirmed.
          legacy: true,
          reviewed: false,
          migratedAt: FieldValue.serverTimestamp(),
        };
        report.vehicles.legacyRulesCreated += 1;
        sample(
          `vehicle ${vehicleDoc.id} pricing`,
          { priceAdjustment: adjustment, manualPricePerLiter: manual || null },
          rule,
        );
        planWrite(ruleRef, rule);
      }
    }

    /* --- fill-ups --- */
    const fillups = await vehicleDoc.ref.collection("fillups").get();

    for (const fillupDoc of fillups.docs) {
      report.fillups.scanned += 1;
      const fillup = fillupDoc.data();
      const patch = {};

      if (typeof fillup.schemaVersion !== "number") {
        patch.schemaVersion = 1;
        report.fillups.versionStamped += 1;
      }

      const match = matchStation(fillup.station);
      if (match.status === "resolved" && match.id) {
        patch.station = { ...fillup.station, stationId: match.id };
        report.fillups.stationResolved += 1;
        sample(
          `fillup ${fillupDoc.id} station`,
          { name: fillup.station.name, stationId: null },
          { name: fillup.station.name, stationId: match.id, metres: Math.round(match.metres) },
        );
      } else if (match.status === "unresolved") {
        report.fillups.stationUnresolved += 1;
        const key = `${fillup.station?.name ?? "?"} — ${match.reason}`;
        report.unresolvedStations.set(key, (report.unresolvedStations.get(key) ?? 0) + 1);
      }

      if (Object.keys(patch).length > 0) planWrite(fillupDoc.ref, patch, { merge: true });
    }
  }
}

/* ---------------- run ---------------- */

async function main() {
  console.log(`\nTank Maleh migration — ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`project: ${PROJECT_ID ?? "(default credentials)"}`);
  console.log(`station catalog: ${CATALOG.length} entries`);
  if (ONLY_UID) console.log(`restricted to uid: ${ONLY_UID}`);
  console.log("");

  await migrateFuelPrices();

  const users = ONLY_UID
    ? { docs: [await db.doc(`users/${ONLY_UID}`).get()].filter((d) => d.exists) }
    : await db.collection("users").get();

  for (const userDoc of users.docs) await migrateUser(userDoc);

  /* ---- report ---- */

  console.log("appConfig/fuelPrices");
  console.log(`  ${report.fuelPrices.note}`);
  console.log("");

  console.log("vehicles");
  console.log(`  scanned:               ${report.vehicles.scanned}`);
  console.log(`  legacy rules to write: ${report.vehicles.legacyRulesCreated}`);
  console.log(`  already migrated:      ${report.vehicles.alreadyMigrated}`);
  console.log("");

  console.log("fill-ups");
  console.log(`  scanned:               ${report.fillups.scanned}`);
  console.log(`  station id resolved:   ${report.fillups.stationResolved}`);
  console.log(`  station unresolved:    ${report.fillups.stationUnresolved}`);
  console.log(`  schemaVersion stamped: ${report.fillups.versionStamped}`);
  console.log("");

  if (report.unresolvedStations.size > 0) {
    console.log("unresolved stations (left as legacy, never force-matched)");
    for (const [key, count] of [...report.unresolvedStations].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(5)} × ${key}`);
    }
    console.log("");
  }

  if (report.samples.length > 0) {
    console.log("before / after samples");
    for (const entry of report.samples) {
      console.log(`  ${entry.label}`);
      console.log(`    before: ${JSON.stringify(entry.before)}`);
      console.log(`    after:  ${JSON.stringify(entry.after)}`);
    }
    console.log("");
  }

  console.log(`documents to write: ${writes.length}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing was written. Re-run with --apply to commit.");
    console.log("Rollback: this migration only ADDS fields and documents. To undo,");
    console.log("delete users/*/personalPriceRules/legacy_* and appConfig/fuelPrices");
    console.log("byFuelType; every original field is left untouched.\n");
    return;
  }

  let written = 0;
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const write of writes.slice(i, i + 400)) {
      batch.set(write.ref, write.data, write.options);
    }
    await batch.commit();
    written += Math.min(400, writes.length - i);
    console.log(`  committed ${written}/${writes.length}`);
  }
  console.log("\nDone.\n");
}

main().catch((error) => {
  console.error("\nMigration failed:", error.message);
  process.exitCode = 1;
});
