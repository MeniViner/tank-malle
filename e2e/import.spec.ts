import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";
import { listDocuments, resetEmulators } from "./helpers/emulator";
import { signedInWithData } from "./helpers/app";

/**
 * Import, preview, report and rollback.
 *
 * The parsing itself is unit-tested; what these establish is that nothing is
 * written before the user has seen what will happen, that the report is
 * honest about what did happen, and that an import stays reversible long after
 * the toast has gone.
 */

test.describe.configure({ mode: "serial" });

const FIXTURES = fileURLToPath(new URL("../src/lib/import/__fixtures__/", import.meta.url));
const LEGACY_CSV = `${FIXTURES}legacy-fuel-tracker.csv`;
const LEGACY_XLSX = `${FIXTURES}legacy-fuel-tracker.xlsx`;

/** Tank Maleh's own v2 export, written to a temp file per test. */
const OWN_CSV_NAME = "tank-maleh-export.csv";
const OWN_CSV = [
  "schema_version,record_id,vehicle_id,vehicle_label,date,time,odometer_km,liters," +
    "paid_price_per_liter,posted_station_price_per_liter,personal_discount_per_liter," +
    "total_cost,filled_to_full,continuity_break_before,station_id,station_name_snapshot," +
    "latitude,longitude,fuel_type,notes,import_source,import_batch_id,import_row_hash",
  "2,r1,v1,מאזדה 3,2026-02-01,08:30,100000,40,7.31,,,292.4,1,0,,פז חגור,,,95,,,,",
  "2,r2,v1,מאזדה 3,2026-02-14,18:47,100400,38,7.31,,,277.78,1,0,,פז חגור,,,95,,,,",
  "2,r3,v1,מאזדה 3,2026-03-02,09:15,100800,20,7.31,,,146.2,0,0,,פז חגור,,,95,,,,",
].join("\r\n");

async function chooseFile(page: Page, path: string): Promise<void> {
  await page.goto("/settings/import");
  await page.locator('input[type="file"]').setInputFiles(path);
}

async function chooseInlineCsv(page: Page, content: string): Promise<void> {
  await page.goto("/settings/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: OWN_CSV_NAME,
    mimeType: "text/csv",
    buffer: Buffer.from(`﻿${content}\r\n`, "utf8"),
  });
}

test("Tank Maleh's own CSV round-trips back in", async ({ page }) => {
  const { uid, vehicleId } = await signedInWithData(page);

  await chooseInlineCsv(page, OWN_CSV);

  await expect(page.getByText("זוהה כייצוא של טנק מלא", { exact: false })).toBeVisible({
    timeout: 25_000,
  });
  await expect(page.getByText("שורות בקובץ").locator("..")).toContainText("3");

  await page.getByRole("button", { name: /ייבוא 3 רשומות/ }).click();
  await expect(page.getByText("הייבוא הסתיים")).toBeVisible({ timeout: 25_000 });

  const records = await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`);
  expect(records).toHaveLength(3);
  // The full/partial flag survives the round trip.
  expect(records.filter((entry) => entry.data.isFullTank === false)).toHaveLength(1);
});

test("the synthetic legacy XLSX imports, with its assumptions stated", async ({ page }) => {
  const { uid, vehicleId } = await signedInWithData(page);

  await chooseFile(page, LEGACY_XLSX);

  await expect(page.getByText("זוהה כיומן תדלוקים ישן", { exact: false })).toBeVisible({
    timeout: 25_000,
  });
  // The assumptions are still stated — behind "פרטים נוספים", so the happy
  // path is a decision rather than a wall of provenance.
  await page.getByRole("button", { name: "פרטים נוספים" }).click();
  await expect(page.getByText(/אין שדה “מילאתי טנק מלא”/)).toBeVisible();
  await expect(page.getByText(/עמודות החישוב מהקובץ הישן/)).toBeVisible();
  // The legacy "start calculating again" marker was recognised.
  await expect(page.getByText("נקודות התחלת תקופה חדשה").locator("..")).toContainText("1");

  await page.getByRole("button", { name: /ייבוא 7 רשומות/ }).click();
  await expect(page.getByText("הייבוא הסתיים")).toBeVisible({ timeout: 25_000 });

  const records = await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`);
  expect(records).toHaveLength(7);
  expect(
    records.filter((entry) => entry.data.continuityBreakBefore === true),
  ).toHaveLength(1);
  // Provenance is preserved rather than the assumption being passed off as a
  // user statement.
  expect(
    records.every((entry) => entry.data.fullTankSource === "legacy-assumption"),
  ).toBe(true);
});

test("the legacy CSV imports identically to the XLSX", async ({ page }) => {
  const { uid, vehicleId } = await signedInWithData(page);

  await chooseFile(page, LEGACY_CSV);
  await page.getByRole("button", { name: /ייבוא 7 רשומות/ }).click();
  await expect(page.getByText("הייבוא הסתיים")).toBeVisible({ timeout: 25_000 });

  const records = await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`);
  expect(records).toHaveLength(7);
});

test("re-importing the same file adds nothing", async ({ page }) => {
  const { uid, vehicleId } = await signedInWithData(page);

  await chooseFile(page, LEGACY_CSV);
  await page.getByRole("button", { name: /ייבוא 7 רשומות/ }).click();
  await expect(page.getByText("הייבוא הסתיים")).toBeVisible({ timeout: 25_000 });
  await page.getByRole("button", { name: "סיום" }).click();

  // The very same file again.
  await chooseFile(page, LEGACY_CSV);
  await expect(page.getByText("כבר קיימות — יידלגו").locator("..")).toContainText("7", {
    timeout: 25_000,
  });
  // There is nothing left to import, and the button says so.
  await expect(page.getByRole("button", { name: "אין מה לייבא" })).toBeDisabled();

  const records = await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`);
  expect(records).toHaveLength(7);
});

test("a file with unusable rows never reports a clean success", async ({ page }) => {
  await signedInWithData(page);

  await chooseInlineCsv(
    page,
    [
      "date,time,odometer_km,liters,total_cost",
      "2026-01-01,10:00,100000,40,292.40",
      "not a date,10:00,100400,40,292.40",
      "2026-01-20,10:00,-,40,292.40",
    ].join("\r\n"),
  );

  await expect(page.getByText("לא תקינות").first().locator("..")).toContainText("2", {
    timeout: 25_000,
  });
  await expect(page.getByText(/שורה 3: תאריך לא תקין/)).toBeVisible();

  await page.getByRole("button", { name: /ייבוא 1 רשומות/ }).click();
  // "Partially" — not "finished".
  await expect(page.getByText("הייבוא הסתיים חלקית")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("הייבוא הסתיים", { exact: true })).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * Rollback
 * ------------------------------------------------------------------ */

test("an import can be rolled back by batch, long after the fact", async ({ page }) => {
  const { uid, vehicleId } = await signedInWithData(page, {
    fillups: [
      // A hand-entered record that must survive the rollback.
      { id: "manual", date: new Date(2026, 2, 20), odometer: 124_500, liters: 33 },
    ],
  });

  await chooseFile(page, LEGACY_CSV);
  await page.getByRole("button", { name: /ייבוא 7 רשומות/ }).click();
  await expect(page.getByText("הייבוא הסתיים")).toBeVisible({ timeout: 25_000 });
  await page.getByRole("button", { name: "סיום" }).click();

  expect(await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`)).toHaveLength(8);

  // The batch is listed with what it did and where it went.
  await page.goto("/settings/import");
  await expect(page.getByText("ייבואים קודמים")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("legacy-fuel-tracker.csv")).toBeVisible();
  await expect(page.getByText(/7 רשומות · מאזדה 3/)).toBeVisible();

  // Rolling back takes a confirmation, not a single tap.
  await page.getByRole("button", { name: "ביטול הייבוא" }).first().click();
  await expect(page.getByText("לבטל את הייבוא?")).toBeVisible();
  await expect(page.getByText(/רשומות שהזנתם ידנית יישארו/)).toBeVisible();
  await page.getByRole("button", { name: "ביטול הייבוא" }).last().click();

  await expect(page.getByText(/הייבוא בוטל|רשומות הוסרו במכשיר/)).toBeVisible({
    timeout: 25_000,
  });

  // Exactly the imported rows are gone; the hand-entered one is untouched.
  const remaining = await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`);
  expect(remaining).toHaveLength(1);
  expect(remaining[0].data.odometer).toBe(124_500);

  // And the batch itself is gone from the history.
  await page.reload();
  await expect(page.getByText(/אחרי ייבוא הוא יופיע כאן/)).toBeVisible({ timeout: 25_000 });
});

test("re-importing after a rollback behaves deterministically", async ({ page }) => {
  const { uid, vehicleId } = await signedInWithData(page);

  await chooseFile(page, LEGACY_CSV);
  await page.getByRole("button", { name: /ייבוא 7 רשומות/ }).click();
  await expect(page.getByText("הייבוא הסתיים")).toBeVisible({ timeout: 25_000 });
  await page.getByRole("button", { name: "סיום" }).click();

  await page.goto("/settings/import");
  await page.getByRole("button", { name: "ביטול הייבוא" }).first().click();
  await page.getByRole("button", { name: "ביטול הייבוא" }).last().click();
  await expect(page.getByText(/הייבוא בוטל|רשומות הוסרו במכשיר/)).toBeVisible({
    timeout: 25_000,
  });

  // The identity hash is a pure function of the row, so the rows are simply
  // new again — no duplicates, no permanent tombstones.
  await chooseFile(page, LEGACY_CSV);
  await expect(page.getByRole("button", { name: /ייבוא 7 רשומות/ })).toBeVisible({
    timeout: 25_000,
  });
  await page.getByRole("button", { name: /ייבוא 7 רשומות/ }).click();
  await expect(page.getByText("הייבוא הסתיים")).toBeVisible({ timeout: 25_000 });

  expect(await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`)).toHaveLength(7);
});

/* ------------------------------------------------------------------ *
 * The real attached workbook — local only, never committed.
 *
 *   TANK_MALEH_LEGACY_XLSX=~/Downloads/fuel-tracker-2026-09-01.xlsx npm run test:e2e
 * ------------------------------------------------------------------ */

const realWorkbook = process.env.TANK_MALEH_LEGACY_XLSX;
const hasRealWorkbook = Boolean(realWorkbook && existsSync(realWorkbook));

test.describe(() => {
  test.skip(!hasRealWorkbook, "set TANK_MALEH_LEGACY_XLSX to run this");

  test("the attached legacy workbook imports its 25 rows", async ({ page }) => {
    const { uid, vehicleId } = await signedInWithData(page);

    await chooseFile(page, realWorkbook as string);

    await expect(page.getByText("זוהה כיומן תדלוקים ישן", { exact: false })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByText("שורות בקובץ").locator("..")).toContainText("25");
    await page.getByRole("button", { name: "פרטים נוספים" }).click();
    await expect(page.getByText("נקודות התחלת תקופה חדשה").locator("..")).toContainText("1");

    await page.getByRole("button", { name: /ייבוא 25 רשומות/ }).click();
    await expect(page.getByText("הייבוא הסתיים")).toBeVisible({ timeout: 30_000 });

    const records = await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`);
    expect(records).toHaveLength(25);

    // One declared break splits 25 records into two islands, giving 23 closed
    // segments rather than the 24 a straight run would produce — the missing
    // one is the stretch across the undocumented fill-ups, which belongs to
    // nobody.
    await page.goto("/");
    await expect(
      page.getByText(/23 מקטעים · 25 תדלוקים/),
    ).toBeVisible({ timeout: 25_000 });

    await page.goto("/history");
    await expect(page.getByText("התחלת תקופה חדשה")).toBeVisible({ timeout: 25_000 });
  });

  test("re-importing the attached workbook adds nothing", async ({ page }) => {
    const { uid, vehicleId } = await signedInWithData(page);

    await chooseFile(page, realWorkbook as string);
    await page.getByRole("button", { name: /ייבוא 25 רשומות/ }).click();
    await expect(page.getByText("הייבוא הסתיים")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "סיום" }).click();

    await chooseFile(page, realWorkbook as string);
    await expect(page.getByText("כבר קיימות — יידלגו").locator("..")).toContainText("25", {
      timeout: 25_000,
    });

    expect(await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`)).toHaveLength(25);
  });
});

// Referenced so the reset helper import is not stripped.
void resetEmulators;
