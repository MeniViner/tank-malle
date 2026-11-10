import { expect, test, type Locator, type Page } from "@playwright/test";
import { signedInWithData } from "./helpers/app";
import { lowContrast } from "./helpers/contrast";
import { homeAppearance } from "./helpers/design-v2-home";
import { journalFixture } from "./helpers/design-v2-journal";
import { getDocument, setDocument } from "./helpers/emulator";
import { selectInsight } from "./helpers/insights";

/**
 * Design v3 Stage 3 — facts strips on Insights, Vehicle, year screen and
 * Account (DESIGN-V3 §3/§6). Values and behaviours stay covered by the v2
 * specs; this spec checks the v3 markup, targets, number formats, EV display
 * and contrast in both themes.
 */

test.use({ viewport: { width: 390, height: 844 } });

async function size44(target: Locator) {
  const box = await target.boundingBox();
  expect(box!.height, "target height").toBeGreaterThanOrEqual(44);
}
/** Every row of a facts strip: value at the inline end (physical left in RTL) of its label. */
async function receiptRows(strip: Locator) {
  const rows = strip.locator(":scope > .fact");
  await expect(rows.first()).toBeVisible();
  for (const row of await rows.all()) {
    const [label, value] = await Promise.all([row.locator(".fl").boundingBox(), row.locator(".fv").boundingBox()]);
    expect(value!.x + value!.width).toBeLessThanOrEqual(label!.x + 1);
  }
}
const STRIPS = ["insights-consumption-facts"];

async function contrastBothThemes(page: Page, uid: string, check: () => Promise<void>) {
  await check();
  await homeAppearance(page, uid, "dark", "plate");
  await check();
  await homeAppearance(page, uid, "light", "plate");
}

test("Insights: facts strips replace the KPI grids; price extremes keep two decimals; totals stay whole shekels", async ({ page }) => {
  const scope = await journalFixture(page);
  await page.goto("/stats?period=all");
  const consumption = page.getByTestId("insights-consumption-facts");
  await expect(consumption).toBeVisible();
  await expect(page.locator(".insights-kpi")).toHaveCount(0);
  await receiptRows(consumption);
  const best = page.getByTestId("insights-best-segment");
  await expect(best).toHaveJSProperty("tagName", "BUTTON");
  await size44(best);
  await expect(best).toHaveAccessibleName(/^המקטע הטוב, [\d.]+ קמ״ל, עד .+, פתיחת פרטים$/);
  await best.focus();
  expect(await best.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");

  await selectInsight(page, "price");
  const extremes = page.getByTestId("insights-price-facts");
  await receiptRows(extremes);
  for (const id of ["insights-price-dearest", "insights-price-cheapest"]) {
    await expect(page.getByTestId(id).locator(".fv")).toHaveText(/^\d+\.\d{2} ₪$/);
    await size44(page.getByTestId(id));
  }
  await expect(page.getByTestId("insights-price-known-liters")).toContainText("תדלוקים");
  await page.getByTestId("insights-price-dearest").click();
  await expect(page).toHaveURL(/\/fillup\/journal-/);
  await page.goBack();

  await selectInsight(page, "spend");
  const spend = page.getByTestId("insights-spend-facts");
  await receiptRows(spend);
  for (const id of ["insights-spend-month-avg", "insights-spend-week-avg", "insights-spend-ytd"]) {
    await expect(page.getByTestId(id)).toHaveText(/^(—|[\d,]+ ₪)$/);
  }
  await expect(page.getByTestId("insights-ownership-per-km")).toHaveText(/^(—|\d+אג׳)$/);

  // Contrast ≥ 4.5:1 inside every Stage 3 strip, light and dark.
  await contrastBothThemes(page, scope.uid, async () => {
    for (const [tab, strips] of [["cons", STRIPS], ["price", ["insights-price-facts"]], ["spend", ["insights-spend-facts"]]] as const) {
      await page.goto(`/stats?period=all&tab=${tab}`);
      for (const strip of strips) {
        await expect(page.getByTestId(strip)).toBeVisible();
        expect(await lowContrast(page, `[data-testid=${strip}]`), `${tab} ${strip}`).toEqual([]);
      }
    }
  });
});

test("Vehicle: 'כמה עלה' facts with an excluded line, year rows open the year screen, details as facts", async ({ page }) => {
  const scope = await signedInWithData(page, {
    vehicle: { make: "מאזדה", model: "3", year: 2021, tankLiters: 50, tankLitersSource: "estimate", declaredKmPerLiter: 15 },
    fillups: [
      { id: "a", date: new Date("2025-06-01T10:00:00+03:00"), odometer: 10_000, liters: 40, pricePerLiter: 7, totalCost: 280 },
      { id: "b", date: new Date("2026-03-01T10:00:00+03:00"), odometer: 18_000, liters: 40, pricePerLiter: 7, totalCost: 280 },
    ],
  });
  const base = `users/${scope.uid}/vehicles/${scope.vehicleId}`;
  await setDocument(`${base}/vehicleExpenses/gift`, { schemaVersion: 1, version: 1, day: "2026-03-05", title: "מתנה", category: "other", costAgorot: 9_900, notes: "", excluded: true });
  await page.goto("/vehicle?tab=costs");
  const facts = page.getByTestId("running-facts");
  await receiptRows(facts);
  await expect(page.getByTestId("running-total")).toHaveText("560 ₪");
  await expect(page.getByTestId("running-excluded")).toHaveText("99 ₪");
  await expect(facts).toContainText("מחוץ לסה״כ");
  const year = page.getByRole("link", { name: /2025.*280/ });
  await size44(year);
  await year.click();
  await expect(page).toHaveURL(/\/vehicle\/years\/2025$/);
  await expect(page.getByTestId("running-total")).toHaveText("280 ₪");
  await receiptRows(page.getByTestId("running-facts"));

  await page.goto("/vehicle?tab=details");
  const details = page.getByTestId("vehicle-details-facts");
  await receiptRows(details);
  await expect(page.getByTestId("vehicle-tank")).toContainText("הערכה לפי סוג הרכב");
  await expect(page.getByTestId("vehicle-declared")).toContainText("15.0");

  await contrastBothThemes(page, scope.uid, async () => {
    await page.goto("/vehicle?tab=costs");
    await expect(page.getByTestId("running-facts")).toBeVisible();
    expect(await lowContrast(page, ".v-costs")).toEqual([]);
    expect(await lowContrast(page, ".v-years")).toEqual([]);
  });
});

test("an EV shows battery, range and motor — never a tank, fuel type or km/L", async ({ page }) => {
  const scope = await signedInWithData(page, { vehicle: { make: "BYD", model: "Atto 3", fuelType: "other", year: 2024 } });
  const base = `users/${scope.uid}/vehicles/${scope.vehicleId}`;
  const vehicle = (await getDocument(base))!;
  await setDocument(base, { ...vehicle, createdAt: new Date(Number(vehicle.createdAt)), powertrain: "ev", battery: { kwh: 60.5, wltp: 420 }, motorKw: 150 });
  await page.goto("/vehicle");
  const overview = page.getByRole("region", { name: "הרכב שלי", exact: true });
  await expect(overview).toContainText("חשמלי · סוללה 60.5 kWh · טווח 420 ק״מ · 150 kW");
  await expect(overview).not.toContainText("מיכל");
  await page.goto("/vehicle?tab=details");
  await expect(page.getByTestId("vehicle-battery")).toContainText("60.5");
  await expect(page.getByTestId("vehicle-wltp")).toContainText("420");
  await expect(page.getByTestId("vehicle-motor")).toContainText("150");
  const details = page.getByTestId("vehicle-details-facts");
  for (const text of ["נפח מיכל", "סוג דלק", "צריכה מוצהרת"]) await expect(details).not.toContainText(text);
});

test("Account: identity and activity sheets are facts strips with text values", async ({ page }) => {
  const scope = await signedInWithData(page, { fillups: [
    { id: "a", date: new Date(Date.now() - 20 * 86_400_000), odometer: 1_000, liters: 40, pricePerLiter: 7, totalCost: 280 },
  ] });
  await page.goto("/account");
  await page.getByTestId("account-identity").click();
  const identity = page.getByTestId("account-identity-facts");
  await receiptRows(identity);
  await expect(identity.locator(".fv .t").first()).toHaveText("חשבון Google");
  await expect(identity.locator("bdi")).toHaveCount(0);
  const activity = page.getByTestId("account-activity-facts");
  await receiptRows(activity);
  await expect(activity).toContainText("40 ליטר בסך הכול");
  await expect(page.locator(".account-metric")).toHaveCount(0);
  expect(await lowContrast(page, "[data-testid=account-summary]")).toEqual([]);
  await page.keyboard.press("Escape");
  await contrastBothThemes(page, scope.uid, async () => {
    await page.goto("/account");
    await page.getByTestId("account-identity").click();
    await expect(page.getByTestId("account-activity-facts")).toBeVisible();
    expect(await lowContrast(page, "[data-testid=account-summary]")).toEqual([]);
    await page.keyboard.press("Escape");
  });
});
