import { test, expect } from "@playwright/test";
import { seedBenchmark, type SeedFillup } from "./helpers/emulator";
import { signedInWithData } from "./helpers/app";
import { openInsightFuelDetail, selectInsight, selectInsightRange as selectRange } from "./helpers/insights";

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

/**
 * Pick a date range.
 *
 * The six-pill segmented control is gone — at 360px "6 חודשים" broke onto two
 * lines and the row doubled in height. It is now one chip that opens a sheet.
 */
test("the four sections are navigable", async ({ page }) => {
  await signedInWithData(page, { fillups: history() });
  await page.goto("/stats");

  for (const section of ["הוצאות", "צריכה", "מחירים", "השוואה"]) {
    await expect(page.getByRole("button", { name: section, exact: true })).toBeVisible({
      timeout: 25_000,
    });
  }

  await selectInsight(page, "spend");
  // v3 §3: the averages are a top-level facts strip (no longer inside the fuel detail disclosure).
  await expect(page.getByTestId("insights-spend-facts").getByText("ממוצע שבועי", { exact: true })).toBeVisible();

  await selectInsight(page, "cons");
  await expect(page.getByTestId("insights-measured-km")).toContainText("מקטעים סגורים");

  await selectInsight(page, "price");
  await expect(page.getByTestId("insights-paid-average")).toBeVisible();
});

test("changing the range changes the figures and says which range they are", async ({
  page,
}) => {
  await signedInWithData(page, { fillups: history() });
  await page.goto("/stats");
  await selectInsight(page, "spend");

  // The card names the range it is showing; the ₪ sign already says it is
  // money spent, so the label no longer carries "סה״כ ·" as well.
  await selectRange(page, "3 חודשים אחרונים");
  await expect(page.getByText("3 חודשים אחרונים").first()).toBeVisible({ timeout: 20_000 });

  await selectRange(page, "כל התקופה");
  await expect(page.getByText("כל התקופה").first()).toBeVisible();
  await expect(page.getByTestId("running-total")).toContainText("3,972");
  await expect(page.getByTestId("insights-period-summary")).toContainText("14 תדלוקים");
});

test("grouping is a separate control from the range", async ({ page }) => {
  await signedInWithData(page, { fillups: history() });
  await page.goto("/stats");
  await selectInsight(page, "spend");
  await openInsightFuelDetail(page);

  // A one-month range grouped WEEKLY.
  await selectRange(page, "החודש");
  await page.getByRole("radio", { name: "שבועי", exact: true }).click();
  await expect(page.getByText("הוצאה · שבועי")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("החודש").first()).toBeVisible();

  // A one-year range grouped MONTHLY — same range control, different grouping.
  await selectRange(page, "12 חודשים אחרונים");
  await page.getByRole("radio", { name: "חודשי", exact: true }).click();
  await expect(page.getByText("הוצאה · חודשי")).toBeVisible();

  // And yearly, over everything.
  await selectRange(page, "כל התקופה");
  await page.getByRole("radio", { name: "שנתי", exact: true }).click();
  await expect(page.getByText("הוצאה · שנתי")).toBeVisible();
});

test("weekly, monthly and year-to-date spending are all available", async ({ page }) => {
  await signedInWithData(page, { fillups: history() });
  await page.goto("/stats");
  await selectInsight(page, "spend");
  await selectRange(page, "כל התקופה");
  await openInsightFuelDetail(page);

  await expect(page.getByTestId("insights-source-status")).toHaveCount(0, { timeout: 20_000 });
  // v3 §3: the averages moved from the fuel detail's KPI tiles to the spending facts strip.
  const details = page.getByTestId("insights-spend-facts");
  await expect(details.getByText("ממוצע שבועי", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(details.getByText("ממוצע חודשי", { exact: true })).toBeVisible();
  // Reported regardless of the selected range.
  await expect(details.getByText("מתחילת השנה", { exact: true })).toBeVisible();
  for (const id of ["insights-spend-week-avg", "insights-spend-month-avg", "insights-spend-ytd"]) {
    await expect(page.getByTestId(id)).toHaveText(/^[\d,]+\s₪$/);
  }
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
  await selectRange(page, "כל התקופה");

  // The 5,000 km jump belongs to nobody: tracked distance is the sum of the
  // island spans, and the calculation-basis sheet says a break exists.
  await page.getByRole("button", { name: "בסיס החישוב" }).click();
  await expect(page.getByText(/נקודת התחלה מחדש/)).toBeVisible({ timeout: 25_000 });
  await page.getByRole("button", { name: "סגירה" }).click();
  await expect(page.getByTestId("insights-measured-km")).toContainText("4,800");
  await expect(page.getByTestId("insights-consumption-average")).toContainText("10.0");

  // Cumulative mileage and its discontinuity explanation belong to Costs.
  await selectInsight(page, "spend");
  await openInsightFuelDetail(page);
  await expect(page.getByText("קילומטראז׳ מצטבר", { exact: true })).toBeVisible();
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
  await selectInsight(page, "community");

  // It does not vanish for want of peers — the old behaviour made a working
  // feature look like one that did not exist.
  await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "insufficient", { timeout: 25_000 });
  await expect(page.getByTestId("insights-community-progress")).toHaveAttribute("aria-valuemax", "4");
  await expect(page.getByTestId("insights-community-progress")).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByTestId("insights-community-status")).toContainText("0 מתוך 4 סיכומי רכבים");
});

test("with enough peers the comparison appears", async ({ page }) => {
  await signedInWithData(page, { fillups: history() });

  // Five comparable vehicle summaries of the same model and fuel type.
  for (let i = 0; i < 5; i += 1) {
    await seedBenchmark(`peer${i}__v1`, {
      modelKey: "מאזדה 3",
      fuelType: "95",
      avgKmPerLiter: 9 + i,
    });
  }

  await page.goto("/stats");
  await selectInsight(page, "community");
  await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "ready", { timeout: 25_000 });
  await expect(page.getByTestId("insights-community-status")).toContainText("5 סיכומי רכבים");
  await expect(page.getByTestId("insights-community-progress")).toHaveCount(0);
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
  await selectInsight(page, "community");
  await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "ready", { timeout: 25_000 });

  const { waitForDocument } = await import("./helpers/emulator");
  const published = await waitForDocument("benchmarks", (data) => data.vehicleId === "v1");
  const lifetimeFigure = published.avgKmPerLiter as number;
  expect(typeof lifetimeFigure).toBe("number");

  // Now narrow the chart range hard, and come back.
  await selectInsight(page, "cons");
  await selectRange(page, "3 חודשים אחרונים");
  await expect(page.getByTestId("insights-period-summary")).not.toContainText("14 תדלוקים");
  await selectInsight(page, "community");
  await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "ready");

  // The published figure is built from the vehicle's COMPLETE closed-segment
  // history; tapping "3 months" changes what the charts show and nothing else.
  const after = await waitForDocument("benchmarks", (data) => data.vehicleId === "v1");
  expect(after.avgKmPerLiter).toBe(lifetimeFigure);
  void uid;
});
