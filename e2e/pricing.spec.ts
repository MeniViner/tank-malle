import { test, expect } from "@playwright/test";
import { waitForDocument, type SeedFillup } from "./helpers/emulator";
import { signedInWithData } from "./helpers/app";

/**
 * Fuel-type-aware pricing.
 *
 * The regulated maximum published in Israel covers exactly one product —
 * 95-octane petrol, self-service, mainland. Handing that figure to a diesel or
 * 98-octane vehicle is a fabrication, and it is what the old single-price
 * model did everywhere.
 */

test.describe.configure({ mode: "serial" });

const RECORDS: SeedFillup[] = [
  { id: "a", date: new Date(2026, 7, 1), odometer: 100_000, liters: 40, pricePerLiter: 7.1 },
  { id: "b", date: new Date(2026, 7, 12), odometer: 100_500, liters: 40, pricePerLiter: 7.1 },
];

test("a 95 vehicle is offered the regulated maximum, named as such", async ({ page }) => {
  await signedInWithData(page, {
    regulatedPrice: 7.31,
    vehicle: { make: "מאזדה", model: "3", fuelType: "95" },
    fillups: RECORDS,
  });

  await page.goto("/fillup/new");
  await expect(page.getByLabel("מחיר לליטר")).toHaveValue("7.31", { timeout: 25_000 });
  // The figure is attributed, every time, rather than appearing unexplained.
  await expect(page.getByText(/מחיר מרבי מפוקח לבנזין 95/)).toBeVisible();
});

test("a diesel vehicle is never given the 95 figure", async ({ page }) => {
  await signedInWithData(page, {
    regulatedPrice: 7.31,
    vehicle: { make: "פורד", model: "טרנזיט", fuelType: "diesel" },
    fillups: RECORDS,
  });

  await page.goto("/fillup/new");
  await expect(page.getByText(/אין מחיר מרבי מפוקח לסולר/)).toBeVisible({ timeout: 25_000 });
  // The field is left for the driver to fill, not pre-filled with a lie.
  await expect(page.getByLabel("מחיר לליטר")).toHaveValue("");
  await expect(page.getByText("7.31")).toHaveCount(0);
});

test("a 98 vehicle is never given the 95 figure", async ({ page }) => {
  await signedInWithData(page, {
    regulatedPrice: 7.31,
    vehicle: { make: "ב.מ.וו", model: "320", fuelType: "98" },
    fillups: RECORDS,
  });

  await page.goto("/fillup/new");
  await expect(page.getByText(/אין מחיר מרבי מפוקח לבנזין 98/)).toBeVisible({ timeout: 25_000 });
  await expect(page.getByLabel("מחיר לליטר")).toHaveValue("");
  await expect(page.getByText("7.31")).toHaveCount(0);
});

test("station rows show a price with its source, and none at all for diesel", async ({
  page,
}) => {
  // A 95 vehicle sees the regulated ceiling, rendered AS a ceiling.
  await signedInWithData(page, {
    regulatedPrice: 7.31,
    vehicle: { make: "מאזדה", model: "3", fuelType: "95" },
    fillups: RECORDS,
  });
  await page.goto("/fillup/new");
  await page.getByRole("button", { name: /תחנה|ללא מיקום|שינוי/ }).first().click();

  await page.locator('input[placeholder*="חיפוש"], input[placeholder*="תחנה"]').first().fill("פז");

  // "עד ₪7.31" — an upper bound, never presented as the pump price.
  await expect(page.getByText(/עד ₪7\.31/).first()).toBeVisible({ timeout: 20_000 });
  // And the provenance travels with it.
  await expect(page.getByText(/מחיר מרבי מפוקח · אין דיווח עדכני מהתחנה/).first()).toBeVisible();
});

test("the diesel station list says the price is unknown", async ({ page }) => {
  await signedInWithData(page, {
    regulatedPrice: 7.31,
    vehicle: { make: "פורד", model: "טרנזיט", fuelType: "diesel" },
    fillups: RECORDS,
  });

  await page.goto("/fillup/new");
  await page.getByRole("button", { name: /תחנה|ללא מיקום|שינוי/ }).first().click();

  await page.locator('input[placeholder*="חיפוש"], input[placeholder*="תחנה"]').first().fill("פז");

  await expect(page.getByText(/מחיר סולר לא ידוע/).first()).toBeVisible({ timeout: 20_000 });
  // Not one 95 price anywhere in the list.
  await expect(page.getByText(/₪7\.31/)).toHaveCount(0);
});

test("a personal discount is not published as the station's price", async ({ page }) => {
  const { uid, vehicleId } = await signedInWithData(page, {
    regulatedPrice: 7.31,
    vehicle: { make: "מאזדה", model: "3", fuelType: "95" },
    fillups: RECORDS,
  });

  await page.goto("/fillup/new");
  await page.getByLabel(/^קילומטראז׳/).fill("101000");
  await page.getByLabel("ליטרים", { exact: true }).fill("40");
  await page.getByLabel("מחיר לליטר").fill("6.90");

  // A station must be named before the question is worth asking.
  await page.getByRole("button", { name: /תחנה|ללא מיקום|שינוי/ }).first().click();
  await page.locator('input[placeholder*="חיפוש"], input[placeholder*="תחנה"]').first().fill("פז");
  await page.getByRole("button", { name: /^פז/ }).first().click();

  await expect(page.getByText("האם זה גם המחיר שהופיע במשאבה?")).toBeVisible({
    timeout: 20_000,
  });

  // "I had a discount" — so the paid price is explicitly NOT the pump price.
  await page.getByRole("button", { name: "לא, הייתה לי הנחה" }).click();
  await expect(page.getByText("לא ידווח כמחיר התחנה")).toBeVisible();

  await page.getByRole("button", { name: "שמירת תדלוק" }).click();
  await expect(page.locator("[data-toast-title]").first()).toBeVisible({ timeout: 20_000 });

  // Nothing was stored as a posted station price.
  const saved = await waitForDocument(
    `users/${uid}/vehicles/${vehicleId}/fillups`,
    (data) => data.odometer === 101_000,
  );
  expect(saved.postedPricePerLiter ?? null).toBeNull();
  expect(saved.pricePerLiter).toBeCloseTo(6.9, 2);
});

test("confirming the pump price does record it as the station's posted price", async ({
  page,
}) => {
  const { uid, vehicleId } = await signedInWithData(page, {
    regulatedPrice: 7.31,
    vehicle: { make: "מאזדה", model: "3", fuelType: "95" },
    fillups: RECORDS,
  });

  await page.goto("/fillup/new");
  await page.getByLabel(/^קילומטראז׳/).fill("101000");
  await page.getByLabel("ליטרים", { exact: true }).fill("40");
  await page.getByLabel("מחיר לליטר").fill("7.20");

  await page.getByRole("button", { name: /תחנה|ללא מיקום|שינוי/ }).first().click();
  await page.locator('input[placeholder*="חיפוש"], input[placeholder*="תחנה"]').first().fill("פז");
  await page.getByRole("button", { name: /^פז/ }).first().click();

  await page.getByRole("button", { name: "כן", exact: true }).click();
  await page.getByRole("button", { name: "שמירת תדלוק" }).click();
  await expect(page.locator("[data-toast-title]").first()).toBeVisible({ timeout: 20_000 });

  const saved = await waitForDocument(
    `users/${uid}/vehicles/${vehicleId}/fillups`,
    (data) => data.odometer === 101_000,
  );
  expect(saved.postedPricePerLiter).toBeCloseTo(7.2, 2);
});
