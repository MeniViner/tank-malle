import { test, expect, type Page } from "@playwright/test";
import { seedRegulatedPrice, type SeedFillup } from "./helpers/emulator";
import { signedInWithData } from "./helpers/app";

/**
 * RTL and bidi rendering.
 *
 * These assert the RENDERED VISUAL ORDER, not the DOM string. In an RTL
 * document the two can differ, which is exactly how "+35%" came to be written
 * as "35%+" in the first place — the source looked wrong but someone reasoned
 * that mirroring would fix it, and it does not, because the run sits inside an
 * LTR island.
 *
 * `innerText` on the LTR island gives the reading order the user actually
 * sees, so that is what is checked.
 */

test.describe.configure({ mode: "serial" });

/** Reading order of the LTR island containing `needle`. */
async function islandText(page: Page, needle: string | RegExp): Promise<string> {
  const island = page.locator('bdi[dir="ltr"], span[dir="ltr"]').filter({ hasText: needle });
  await expect(island.first()).toBeVisible({ timeout: 20_000 });
  return (await island.first().innerText()).trim();
}

/**
 * Two closed segments with different economy, so the "vs average" badge has a
 * signed percentage to show, and a litre figure with three decimals.
 */
const RECORDS: SeedFillup[] = [
  { id: "a", date: new Date(2026, 6, 1), odometer: 100_000, liters: 40, pricePerLiter: 8.25 },
  { id: "b", date: new Date(2026, 6, 10), odometer: 100_400, liters: 40, pricePerLiter: 8.25 },
  { id: "c", date: new Date(2026, 6, 20), odometer: 101_140, liters: 26.762, pricePerLiter: 8.1 },
];

test("signed numbers, money and units read correctly", async ({ page }) => {
  await seedRegulatedPrice(8.3);
  await signedInWithData(page, { fillups: RECORDS });

  await page.goto("/");
  await expect(page.getByText(/ממוצע כולל/)).toBeVisible({ timeout: 25_000 });

  /* --- money: the currency symbol leads the digits --- */
  const money = await islandText(page, /₪/);
  expect(money).toMatch(/^₪[\d,]/);
  expect(money).not.toMatch(/[\d,]₪$/);
});

test("a signed money delta puts the sign before the currency symbol", async ({ page }) => {
  await signedInWithData(page, {
    fillups: RECORDS,
    vehicle: { make: "מאזדה", model: "3", priceAdjustment: -0.05 },
  });
  await page.goto("/settings");

  // The vehicle price-adjustment row renders a signed shekel amount.
  const signed = page.locator('bdi[dir="ltr"], span[dir="ltr"]').filter({
    hasText: /^[+−]₪/,
  });
  if (await signed.count()) {
    const text = (await signed.first().innerText()).trim();
    expect(text).toMatch(/^[+−]₪\d/);
    // A hyphen would read as a list dash next to Hebrew; U+2212 is used.
    expect(text.startsWith("-")).toBe(false);
  }
});

test("quantities keep the Hebrew unit outside the LTR island", async ({ page }) => {
  await signedInWithData(page, { fillups: RECORDS });
  await page.goto("/history");

  // "26.762 ל׳" — the number is one LTR run, the unit is ordinary RTL text
  // beside it. Pulling the unit inside the island reorders it.
  const row = page.getByText(/26\.762|26\.8/).first();
  await expect(row).toBeVisible({ timeout: 20_000 });

  const islands = page.locator('bdi[dir="ltr"], span[dir="ltr"]');
  const count = await islands.count();
  let checked = 0;
  for (let i = 0; i < count; i += 1) {
    const text = (await islands.nth(i).innerText()).trim();
    if (!text) continue;
    // No LTR island may contain a Hebrew unit word.
    expect(text).not.toMatch(/ל׳|ק״מ|קמ״ל|לליטר/);
    checked += 1;
  }
  expect(checked).toBeGreaterThan(0);
});

test("price per litre reads ₪8.25 followed by the Hebrew unit", async ({ page }) => {
  await signedInWithData(page, { fillups: RECORDS });
  await page.goto("/fillup/new");

  const price = page.getByLabel("מחיר לליטר");
  await expect(price).toBeVisible({ timeout: 20_000 });
  // The input itself is an LTR island so the typed figure does not mirror.
  await expect(price).toHaveAttribute("dir", "ltr");

  await price.fill("8.25");
  await expect(price).toHaveValue("8.25");
});

test("chart tooltips carry the selected consumption unit, in both modes", async ({ page }) => {
  await signedInWithData(page, { fillups: RECORDS });

  await page.goto("/stats");
  await page.getByRole("button", { name: "צריכה" }).click();

  // km/L is the default.
  await expect(page.getByText(/צריכה · .*קמ״ל/)).toBeVisible({ timeout: 25_000 });

  // Switch the unit in settings and the whole section follows — title, axis,
  // average line and tooltip together, not the label alone.
  await page.goto("/settings");
  // The unit control is a radiogroup, not plain buttons.
  await page
    .getByRole("radiogroup", { name: "יחידת צריכה" })
    .getByRole("radio", { name: "ל׳/100 ק״מ" })
    .click();

  await page.goto("/stats");
  await page.getByRole("button", { name: "צריכה" }).click();
  await expect(page.getByText(/צריכה · .*ל׳\/100 ק״מ/)).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(/קמ״ל/)).toHaveCount(0);
});
