import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "node:http";
import express from "express";

// This suite must never resolve a real project or application credentials.
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
assert.equal(process.env.GCLOUD_PROJECT, "demo-tankmaleh-functions-audit");
const { parsePrice, updateFuelPrice, vehicleLookup } = await import("../lib/index.js");
const { getFirestore } = await import("firebase-admin/firestore");
const { getApps, deleteApp } = await import("firebase-admin/app");
const db = getFirestore();
const nativeFetch = globalThis.fetch;
let vehicleRows = [];
globalThis.fetch = async (input, options) => {
  const url = String(input);
  if (url.startsWith("http://127.0.0.1:")) return nativeFetch(input, { ...options, signal: AbortSignal.timeout(5000) });
  if (url.startsWith("https://www.gov.il/")) return new Response("בנזין 95 אוקטן 7.31 שקלים");
  if (url.startsWith("https://data.gov.il/")) return Response.json({ result: { records: vehicleRows } });
  throw new Error(`Unexpected network destination: ${new URL(url).host}`);
};
const app = express();
app.use(vehicleLookup);
const server = createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  await db.doc("appConfig/fuelPrices").delete();
  globalThis.fetch = nativeFetch;
  await new Promise((resolve) => server.close(resolve));
  await Promise.all(getApps().map(deleteApp));
});

test("the price parser rejects unrelated or implausible values", () => {
  assert.equal(parsePrice("בנזין 95 אוקטן 7.31 שקלים"), 7.31);
  assert.equal(parsePrice("בנזין 95 אוקטן 99.99 שקלים"), null);
  assert.equal(parsePrice("no published price"), null);
});

test("the upgraded scheduler SDK writes a price to the emulator and is idempotent", async () => {
  const ref = db.doc("appConfig/fuelPrices");
  await ref.delete();
  await updateFuelPrice.run({ scheduleTime: new Date().toISOString() });
  const first = await ref.get();
  assert.equal(first.data().current.pricePerLiter, 7.31);
  await updateFuelPrice.run({ scheduleTime: new Date().toISOString() });
  assert.ok((await ref.get()).updateTime.isEqual(first.updateTime));
});

test("the HTTPS wrapper rejects an invalid plate without an upstream request", async () => {
  const response = await fetch(`${url}?plate=123`);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).found, false);
});

test("the HTTPS wrapper returns normalized vehicle data", async () => {
  vehicleRows = [{ tozeret_nm: "מאזדה", kinuy_mishari: "3", shnat_yitzur: 2020, sug_delek_nm: "סולר" }];
  const response = await fetch(`${url}?plate=1234567`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.found, true);
  assert.equal(body.model, "3");
  assert.equal(body.fuelType, "diesel");
  assert.equal(body.year, 2020);
});

test("a missing vehicle returns an explicit not-found result", async () => {
  vehicleRows = [];
  const response = await fetch(`${url}?plate=7654321`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).found, false);
});
