/**
 * READ-ONLY inventory of one user's fill-ups on the SERVER, across every
 * vehicle including archived ones.
 *
 * For the data-preservation incident: the app hides archived vehicles and
 * shows one vehicle at a time, so "the records are gone" needs to be checked
 * against what Firestore actually holds before anything is concluded.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=~/keys/tank-malle-adminsdk.json \
 *     node scripts/dev/inspectUserFillups.mjs --uid <uid> [--since 2026-09-01]
 *
 * Writes nothing. Prints a per-vehicle table (id, archived, count, newest,
 * oldest) and, with --since, every fill-up on or after that date with its
 * create time and the fields the incident matrix cares about. Output holds
 * private data: keep it out of Git and public logs.
 */

import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
};
const uid = flag("--uid");
const since = flag("--since") ? new Date(flag("--since")) : null;

if (!uid) {
  console.error("usage: node scripts/dev/inspectUserFillups.mjs --uid <uid> [--since YYYY-MM-DD]");
  process.exit(2);
}

const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!path && !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("set GOOGLE_APPLICATION_CREDENTIALS to a service-account key (read access is enough)");
  process.exit(2);
}

const { cert, initializeApp } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");

const account = path ? JSON.parse(await readFile(path, "utf8")) : null;
initializeApp(
  account
    ? { credential: cert(account), projectId: account.project_id }
    : { projectId: process.env.GCLOUD_PROJECT ?? "demo-tankmaleh" },
);
const db = getFirestore();

const millis = (value) =>
  value && typeof value.toMillis === "function" ? value.toMillis() : typeof value === "number" ? value : null;
const iso = (ms) => (ms === null ? "—" : new Date(ms).toISOString());

console.log(`project: ${account?.project_id ?? process.env.GCLOUD_PROJECT ?? "(emulator)"}`);
console.log(`uid: ${uid}`);

const user = await db.doc(`users/${uid}`).get();
console.log(`profile exists: ${user.exists}; activeVehicleId: ${user.data()?.settings?.activeVehicleId ?? "—"}`);

const vehicles = await db.collection(`users/${uid}/vehicles`).get();
console.log(`vehicles: ${vehicles.size}`);

for (const vehicle of vehicles.docs) {
  const data = vehicle.data();
  const fillups = await db.collection(`users/${uid}/vehicles/${vehicle.id}/fillups`).get();
  const dates = fillups.docs.map((entry) => millis(entry.data().date)).filter((v) => v !== null);
  console.log(
    `\n[${vehicle.id}] ${data.make ?? ""} ${data.model ?? ""} · archived=${Boolean(data.archived)} · fillups=${fillups.size}` +
      ` · oldest=${iso(dates.length ? Math.min(...dates) : null)} · newest=${iso(dates.length ? Math.max(...dates) : null)}`,
  );

  if (!since) continue;
  const rows = fillups.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }))
    .filter((row) => (millis(row.date) ?? 0) >= since.getTime())
    .sort((a, b) => (millis(a.date) ?? 0) - (millis(b.date) ?? 0));
  for (const row of rows) {
    console.log(
      `  ${row.id} date=${iso(millis(row.date))} created=${iso(millis(row.createdAt))} odo=${row.odometer} L=${row.liters}` +
        ` ₪/L=${row.pricePerLiter} total=${row.totalCost} end=${row.fillEndState ?? "—"}/${row.fillEndStateSource ?? "—"}` +
        ` pre=${row.preFillLevel ?? "—"} post=${row.postFillLevel ?? "—"} station=${row.station?.name ?? "—"} tankSchema=${row.tankSchemaVersion ?? "—"}`,
    );
  }
}
