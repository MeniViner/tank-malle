import { test, expect } from "@playwright/test";
import { seedBenchmark, type SeedFillup } from "./helpers/emulator";
import { signedInWithData } from "./helpers/app";

/**
 * Statistics information architecture.
 *
 * The old screen had one control doing two jobs — choosing which records were
 * in scope AND how they were grouped — with no label saying which numbers it
 * had changed. These tests hold the redesign to the separation.
 */

test.describe.configure({ mode: "serial" });

/** Fourteen months of records, so a year range has something to group. */
function history(): SeedFillup[] {
  const records: SeedFillup[] = [];
  let odometer = 100_000;
  for (let i = 0; i < 14; i += 1) {
    const date = new Date(2025, 6 + i, 10);
    odometer += 400;
    records.push({
      id: `f${i}`,
      date,
      odometer,
      liters: 40,
      pricePerLiter: 7 + (i % 3) * 0.1,
    });
  }
  return records;
}

test("the five sections are navigable", async ({ page }) => {
  await signedInWithData(page, { fillups: history() });
  await page.goto("/stats");

  for (const section of ["סקירה", "הוצאות", "צריכה", "מחירים", "קהילה"]) {
    await expect(page.getByRole("button", { name: section, exact: true })).toBeVisible({
      timeout: 25_000,
    });
  }

  await page.getByRole("button", { name: "הוצאות", exact: true }).click();
  await expect(page.getByText(/ממוצע שבועי/)).toBeVisible();

  await page.getByRole("button", { name: "צריכה", exact: true }).click();
  await expect(page.getByText(/מקטעים סגורים/)).toBeVisible();

  await page.getByRole("button", { name: "מחירים", exact: true }).click();
  await expect(page.getByText(/מחיר ממוצע ששולם/)).toBeVisible();
});

test("changing the range changes the figures and says which range they are", async ({
  page,
}) => {
  await signedInWithData(page, { fillups: history() });
  await page.goto("/stats");
  await page.getByRole("button", { name: "הוצאות", exact: true }).click();

  // Every heading names its range, so no metric can look lifetime-based.
  await page.getByRole("radio", { name: "3 חודשים", exact: true }).click();
  await expect(page.getByText(/סה״כ · 3 החודשים האחרונים/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("radio", { name: "הכול", exact: true }).click();
  await expect(page.getByText(/סה״כ · כל התקופה/)).toBeVisible();
});

test("grouping is a separate control from the range", async ({ page }) => {
  await signedInWithData(page, { fillups: history() });
  await page.goto("/stats");
  await page.getByRole("button", { name: "הוצאות", exact: true }).click();

  // A one-month range grouped WEEKLY.
  await page.getByRole("radio", { name: "החודש", exact: true }).click();
  await page.getByRole("radio", { name: "שבועי", exact: true }).click();
  await expect(page.getByText(/הוצאה · החודש הנוכחי · שבועי/)).toBeVisible({
    timeout: 20_000,
  });

  // A one-year range grouped MONTHLY — same range control, different grouping.
  await page.getByRole("radio", { name: "שנה", exact: true }).click();
  await page.getByRole("radio", { name: "חודשי", exact: true }).click();
  await expect(page.getByText(/הוצאה · 12 החודשים האחרונים · חודשי/)).toBeVisible();

  // And yearly, over everything.
  await page.getByRole("radio", { name: "הכול", exact: true }).click();
  await page.getByRole("radio", { name: "שנתי", exact: true }).click();
  await expect(page.getByText(/הוצאה · כל התקופה · שנתי/)).toBeVisible();
});

test("weekly, monthly and year-to-date spending are all available", async ({ page }) => {
  await signedInWithData(page, { fillups: history() });
  await page.goto("/stats");
  await page.getByRole("button", { name: "הוצאות", exact: true }).click();
  await page.getByRole("radio", { name: "הכול", exact: true }).click();

  await expect(page.getByText("ממוצע שבועי")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("ממוצע חודשי")).toBeVisible();
  // Two matches on purpose: one is the range chip, the other is the
  // year-to-date figure, which is reported regardless of the selected range.
  await expect(page.getByText("מתחילת השנה")).toHaveCount(2);
});

test("a continuity break does not corrupt the range metrics", async ({ page }) => {
  const records = history();
  // Declare a break in the middle, with a large undocumented jump.
  records[7] = { ...records[7], odometer: records[7].odometer + 5_000, continuityBreakBefore: true };
  for (let i = 8; i < records.length; i += 1) {
    records[i] = { ...records[i], odometer: records[i].odometer + 5_000 };
  }

  await signedInWithData(page, { fillups: records });
  await page.goto("/stats");
  await page.getByRole("radio", { name: "הכול", exact: true }).click();

  // The 5,000 km jump belongs to nobody: tracked distance is the sum of the
  // island spans, and the basis card says a break exists.
  await expect(page.getByText(/נקודת התחלה מחדש אחת/)).toBeVisible({ timeout: 25_000 });

  await page.getByRole("button", { name: "צריכה", exact: true }).click();
  await expect(page.getByText(/הקו נקטע שם בכוונה/)).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * Community
 * ------------------------------------------------------------------ */

test("the Community section is discoverable and shows the insufficient state", async ({
  page,
}) => {
  await signedInWithData(page, { fillups: history() });

  await page.goto("/stats");
  await page.getByRole("button", { name: "קהילה", exact: true }).click();

  // It does not vanish for want of peers — the old behaviour made a working
  // feature look like one that did not exist.
  await expect(page.getByText("השוואה לנהגים דומים")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("עדיין אין מספיק נהגים להשוואה")).toBeVisible();
  await expect(page.getByText(/מתוך 4 נהגים נדרשים/)).toBeVisible();
});

test("with enough peers the comparison appears", async ({ page }) => {
  await signedInWithData(page, { fillups: history() });

  // Five comparable drivers of the same model and fuel type.
  for (let i = 0; i < 5; i += 1) {
    await seedBenchmark(`peer${i}__v1`, {
      modelKey: "מאזדה 3",
      fuelType: "95",
      avgKmPerLiter: 9 + i,
    });
  }

  await page.goto("/stats");
  await page.getByRole("button", { name: "קהילה", exact: true }).click();
  await expect(page.getByText(/נהגים|נהגי/).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("עדיין אין מספיק נהגים להשוואה")).toHaveCount(0);
});

test("the Statistics range does not move the canonical community benchmark", async ({
  page,
}) => {
  const { uid } = await signedInWithData(page, { fillups: history() });

  for (let i = 0; i < 5; i += 1) {
    await seedBenchmark(`peer${i}__v1`, {
      modelKey: "מאזדה 3",
      fuelType: "95",
      avgKmPerLiter: 9 + i,
    });
  }

  await page.goto("/stats");
  await page.getByRole("button", { name: "קהילה", exact: true }).click();
  await expect(page.getByText(/נהגים|נהגי/).first()).toBeVisible({ timeout: 25_000 });

  const { waitForDocument } = await import("./helpers/emulator");
  const published = await waitForDocument("benchmarks", (data) => data.vehicleId === "v1");
  const lifetimeFigure = published.avgKmPerLiter as number;
  expect(typeof lifetimeFigure).toBe("number");

  // Now narrow the chart range hard, and come back.
  await page.getByRole("button", { name: "צריכה", exact: true }).click();
  await page.getByRole("radio", { name: "3 חודשים", exact: true }).click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "קהילה", exact: true }).click();
  await page.waitForTimeout(2500);

  // The published figure is built from the vehicle's COMPLETE closed-segment
  // history; tapping "3 months" changes what the charts show and nothing else.
  const after = await waitForDocument("benchmarks", (data) => data.vehicleId === "v1");
  expect(after.avgKmPerLiter).toBe(lifetimeFigure);
  void uid;
});
