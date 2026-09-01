import { test, expect } from "@playwright/test";
import { listDocuments, waitForDocument } from "./helpers/emulator";
import { signedInWithData } from "./helpers/app";

/**
 * Review of pre-upgrade pricing settings.
 *
 * `vehicle.priceAdjustment` and `vehicle.manualPricePerLiter` were vehicle-wide,
 * permanent and invisible. Nothing here discards a value — it stops being
 * silent.
 */

test.describe.configure({ mode: "serial" });

const LEGACY_VEHICLE = {
  make: "מאזדה",
  model: "3",
  fuelType: "95" as const,
  priceAdjustment: -0.05,
  manualPricePerLiter: 6.8,
};

test("a legacy setting is surfaced, explained and quantified", async ({ page }) => {
  await signedInWithData(page, { vehicle: LEGACY_VEHICLE, regulatedPrice: 7.31 });
  await page.goto("/settings");

  // Scoped to the review card: the same figures also appear in the rows above,
  // which is precisely the point — the card explains what those rows do.
  const card = page
    .locator("div")
    .filter({ hasText: /^הגדרת תמחור ישנה · מאזדה 3/ })
    .last();
  await expect(card).toBeVisible({ timeout: 25_000 });

  // Its scope is spelt out, because that is what nobody could see before.
  await expect(card).toContainText("כל תדלוק ברכב הזה, בכל תחנה, ללא תאריך סיום");
  // And the actual values, so nothing is being asked about in the abstract.
  await expect(card).toContainText("−₪0.05");
  await expect(card).toContainText("₪6.80");

  // All three choices are offered.
  await expect(page.getByRole("button", { name: "המרה לכלל מפורש" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ביטול ההגדרה" })).toBeVisible();
  await expect(page.getByRole("button", { name: "להשאיר בינתיים" })).toBeVisible();
});

test("it can be left alone for now", async ({ page }) => {
  const { uid, vehicleId } = await signedInWithData(page, { vehicle: LEGACY_VEHICLE });
  await page.goto("/settings");

  await page.getByRole("button", { name: "להשאיר בינתיים" }).click();
  await expect(page.getByText(/הגדרת תמחור ישנה/)).toHaveCount(0);

  // Nothing was changed — the value is exactly where it was.
  const vehicles = await listDocuments(`users/${uid}/vehicles`);
  const vehicle = vehicles.find((entry) => entry.id === vehicleId);
  expect(vehicle?.data.priceAdjustment).toBeCloseTo(-0.05, 3);
  expect(vehicle?.data.manualPricePerLiter).toBeCloseTo(6.8, 2);
});

test("converting it produces an explicit, scoped, reviewed rule", async ({ page }) => {
  const { uid, vehicleId } = await signedInWithData(page, { vehicle: LEGACY_VEHICLE });
  await page.goto("/settings");

  await page.getByRole("button", { name: "המרה לכלל מפורש" }).click();
  await expect(page.getByText("ההגדרה הומרה לכלל מפורש")).toBeVisible({ timeout: 25_000 });

  const rule = await waitForDocument(
    `users/${uid}/personalPriceRules`,
    (data) => data.vehicleId === vehicleId,
  );
  // Scoped to the vehicle and its fuel type, and already reviewed — the
  // conversion IS the review.
  expect(rule.fuelType).toBe("95");
  expect(rule.discountPerLiter).toBeCloseTo(0.05, 3);
  expect(rule.fixedPricePerLiter).toBeCloseTo(6.8, 2);
  expect(rule.reviewed).toBe(true);

  // And the invisible vehicle-wide setting is gone, so nothing applies twice.
  await expect
    .poll(async () => {
      const vehicles = await listDocuments(`users/${uid}/vehicles`);
      const vehicle = vehicles.find((entry) => entry.id === vehicleId);
      return [vehicle?.data.priceAdjustment, vehicle?.data.manualPricePerLiter ?? null];
    }, { timeout: 15_000 })
    .toEqual([0, null]);
});

test("it can be turned off, and the prompt then stays gone", async ({ page }) => {
  const { uid, vehicleId } = await signedInWithData(page, { vehicle: LEGACY_VEHICLE });
  await page.goto("/settings");

  await page.getByRole("button", { name: "ביטול ההגדרה" }).click();
  await expect(page.getByText("ההגדרה בוטלה")).toBeVisible({ timeout: 25_000 });

  // Polled: the toast means the local cache applied it, which is not the same
  // as the server having acknowledged it — a distinction the app itself makes.
  await expect
    .poll(async () => {
      const vehicles = await listDocuments(`users/${uid}/vehicles`);
      return vehicles.find((entry) => entry.id === vehicleId)?.data.priceAdjustment;
    }, { timeout: 15_000 })
    .toBe(0);

  await page.reload();
  await expect(page.getByText(/הגדרת תמחור ישנה/)).toHaveCount(0);
});

test("a migrated rule awaiting review says it is not in force", async ({ page }) => {
  const { uid } = await signedInWithData(page, {
    vehicle: { make: "מאזדה", model: "3", fuelType: "95" },
  });

  // As the migration script writes it: preserved, but not applied.
  const { setDocument } = await import("./helpers/emulator");
  await setDocument(`users/${uid}/personalPriceRules/legacy_v1`, {
    vehicleId: "v1",
    stationId: null,
    stationName: null,
    fuelType: "95",
    discountPerLiter: 0.05,
    fixedPricePerLiter: 6.8,
    label: "הועבר מהגדרה ישנה",
    expiresAt: null,
    legacy: true,
    reviewed: false,
  });

  await page.goto("/settings");
  await expect(page.getByText("כלל תמחור שהועבר וממתין לאישור")).toBeVisible({
    timeout: 25_000,
  });
  await expect(page.getByText(/הוא לא מופעל/)).toBeVisible();
  await expect(page.getByText("כל התחנות · רכב אחד")).toBeVisible();

  // Confirming puts it in force; the prompt goes.
  await page.getByRole("button", { name: "אישור והפעלה" }).click();
  await expect(page.getByText("כלל תמחור שהועבר וממתין לאישור")).toHaveCount(0, {
    timeout: 25_000,
  });

  const rule = await waitForDocument(
    `users/${uid}/personalPriceRules`,
    (data) => data.legacy === true,
  );
  expect(rule.reviewed).toBe(true);
  // The value itself was never altered.
  expect(rule.fixedPricePerLiter).toBeCloseTo(6.8, 2);
});

test("a migrated rule can be deleted instead", async ({ page }) => {
  const { uid } = await signedInWithData(page, {
    vehicle: { make: "מאזדה", model: "3", fuelType: "95" },
  });

  const { setDocument } = await import("./helpers/emulator");
  await setDocument(`users/${uid}/personalPriceRules/legacy_v1`, {
    vehicleId: "v1",
    stationId: null,
    stationName: null,
    fuelType: "95",
    discountPerLiter: 0.05,
    fixedPricePerLiter: null,
    label: "הועבר מהגדרה ישנה",
    expiresAt: null,
    legacy: true,
    reviewed: false,
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "מחיקה" }).first().click();
  await expect(page.getByText("כלל תמחור שהועבר וממתין לאישור")).toHaveCount(0, {
    timeout: 25_000,
  });

  await expect
    .poll(async () => (await listDocuments(`users/${uid}/personalPriceRules`)).length, {
      timeout: 15_000,
    })
    .toBe(0);
});
