import { expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { signedInWithData, type ReadyAccount } from "./app";
import { FIRESTORE_HOST, PROJECT_ID, getDocument, monthKeyInBrowserTimeZone, setDocument, type SeedFillup } from "./emulator";
import { HOME_CAR } from "./design-v2-home";
import { outboxCount } from "./pwa";

export interface JournalFixture extends ReadyAccount {
  base: string;
  firstMonth: string;
  lastMonth: string;
  day: (monthOffset: number, day: number) => string;
  fills: SeedFillup[];
  records: Record<string, Record<string, unknown>>;
}

/** Two completed calendar months, exact receipts, one partial and four closed segments. */
export async function journalFixture(page: Page, mixed = true): Promise<JournalFixture> {
  const [year, month] = monthKeyInBrowserTimeZone().split("-").map(Number);
  const date = (offset: number, day: number) => new Date(Date.UTC(year, month - 1 + offset, day, 10));
  const day = (offset: number, value: number) => date(offset, value).toISOString().slice(0, 10);
  const fills: SeedFillup[] = [
    { id: "journal-base", date: date(-2, 5), odometer: 100000, liters: 40, pricePerLiter: 7.5, totalCost: 300, stationName: "סונול שפיה" },
    { id: "journal-partial", date: date(-2, 15), odometer: 100300, liters: 20, pricePerLiter: 7, totalCost: 140, isFullTank: false, stationName: "סונול שפיה" },
    { id: "journal-close", date: date(-2, 25), odometer: 100600, liters: 25, pricePerLiter: 7.52, totalCost: 188, stationName: "פז מרכז 5" },
    { id: "journal-low", date: date(-1, 5), odometer: 101000, liters: 40, pricePerLiter: 7.2, totalCost: 288, stationName: "דלק דרך 8" },
    { id: "journal-best", date: date(-1, 15), odometer: 101480, liters: 30, pricePerLiter: 8, totalCost: 240, stationName: "דלק דרך 8" },
    { id: "journal-last", date: date(-1, 25), odometer: 101840, liters: 40, pricePerLiter: 7, totalCost: 280, stationName: "פז מרכז 5" },
  ];
  const scope = await signedInWithData(page, { vehicle: HOME_CAR, regulatedPrice: 7.77, fillups: fills });
  const base = `users/${scope.uid}/vehicles/${scope.vehicleId}`;
  const history = { [monthKeyInBrowserTimeZone()]: 7.77, [day(-2, 1).slice(0, 7)]: 7.77, [day(-1, 1).slice(0, 7)]: 7.77 };
  const current = { pricePerLiter: 7.77, updatedAt: new Date() };
  await setDocument("appConfig/fuelPrices", {
    current, history, source: "gov.il", byFuelType: { "95": { self: {
      current, history, scheduledHistory: history, source: "scheduled", retrievedAt: new Date(),
    } } },
  });
  for (const fill of fills) {
    const path = `${base}/fillups/${fill.id}`;
    await setDocument(path, { ...await getDocument(path),
      date: fill.date, createdAt: fill.date,
      tankSchemaVersion: 2, fillEndState: fill.isFullTank === false ? "partial" : "full",
      fillEndStateSource: "user-confirmed", fuelType: "95", version: 1,
      notes: fill.id === "journal-partial" ? "קבלה חלקית 42" : "",
      station: { name: fill.stationName, stationId: fill.stationName?.startsWith("פז") ? "journal-paz"
        : fill.stationName?.startsWith("דלק") ? "journal-delek" : "journal-sonol" },
    });
  }
  const records: Record<string, Record<string, unknown>> = {
    "serviceEvents/journal-service": { schemaVersion: 1, version: 7, day: day(-2, 20), title: "שמן ובלמים 42",
      jobs: ["oil", "brakes"], odometer: 100450, costAgorot: 12345, garage: "מוסך מרכז 12", notes: "חשבונית אחת, שתי עבודות", completedPlanIds: [] },
    "serviceEvents/journal-unknown": { schemaVersion: 1, version: 3, day: day(-1, 10), title: "בדיקה ללא סכום",
      jobs: ["repair"], odometer: 90000, costAgorot: null, garage: "", notes: "קריאה חשודה מהייבוא", completedPlanIds: [] },
    "serviceEvents/journal-zero": { schemaVersion: 1, version: 1, day: day(-1, 26), title: "בדיקה באחריות",
      jobs: ["periodic"], odometer: 101900, costAgorot: 0, garage: "", notes: "אפס ששולם במפורש", completedPlanIds: [] },
    "vehicleExpenses/journal-parking": { schemaVersion: 1, version: 1, day: day(-1, 12), category: "parking", title: "חניה ליד המוסך", costAgorot: 1850, notes: "קבלה 18.50" },
    "vehicleExpenses/journal-refund": { schemaVersion: 1, version: 2, day: day(-1, 20), category: "refund", title: "החזר חניה", costAgorot: 1050, notes: "הוחזרו 10.50" },
    "odometerReadings/journal-odometer": { schemaVersion: 1, version: 4, day: day(-1, 27), odometer: 102000, notes: "הקריאה בלוח הקילומטרים" },
    "observations/journal-gauge": { observedAt: date(-1, 28), recordedAt: date(-1, 29), kind: "level", confirmed: false,
      level: .25, levelSource: "imported-legacy", levelUncertainty: null, odometer: null, fillupId: null },
  };
  if (mixed) for (const [key, record] of Object.entries(records)) await setDocument(`${base}/${key}`, record);
  await page.goto("/history");
  await expect(page.getByTestId("journal-entry-fillups/journal-last")).toBeVisible();
  if (mixed) await expect(page.getByTestId("journal-entry-observations/journal-gauge")).toBeVisible();
  await expect(page.getByTestId("journal-coverage")).toHaveCount(0);
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  return { ...scope, base, fills, records, day, firstMonth: day(-2, 1).slice(0, 7), lastMonth: day(-1, 1).slice(0, 7) };
}

export async function openJournalEntry(page: Page, key: string) {
  await page.getByTestId(`journal-entry-${key}`).click();
  const sheet = page.getByTestId("journal-entry-sheet");
  await expect(sheet).toHaveAttribute("data-entry-key", key);
  return sheet;
}

export async function journalAdd(page: Page, kind: "fuel" | "service" | "expense" | "odometer") {
  await page.getByTestId("journal-add").click();
  await expect(page.getByTestId("journal-add-menu")).toBeVisible();
  await page.getByTestId(`journal-add-${kind}`).click();
  if (kind !== "fuel") await expect(page.getByTestId("care-entry")).toBeVisible();
}

const stage = process.env.DESIGN_V2_STAGE;
export const journalEvidence = resolve(stage ? `design/v2/evidence/stage-${stage}` : "test-results/design-v2");
export async function captureJournal(page: Page, name: string, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
  await mkdir(journalEvidence, { recursive: true });
  await page.screenshot({ path: resolve(journalEvidence, `${name}.png`), animations: "disabled" });
  if (fullPage) await page.screenshot({ path: resolve(journalEvidence, `${name}-full.png`), animations: "disabled", fullPage: true });
}

export type RawFields = Record<string, Record<string, unknown>>;
const rawUrl = (path: string) => `${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
/** Firestore REST fields retain absent/null and microsecond Timestamp distinctions. */
export async function journalRawFields(path: string): Promise<RawFields | null> {
  const response = await fetch(rawUrl(path), { headers: { Authorization: "Bearer owner" } });
  if (response.status === 404) return null;
  expect(response.ok).toBe(true);
  return (await response.json()).fields;
}
export async function replaceJournalRawFields(path: string, fields: RawFields) {
  const response = await fetch(rawUrl(path), { method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
  expect(response.ok).toBe(true);
}
export async function removeJournalDocument(path: string) {
  const response = await fetch(rawUrl(path), { method: "DELETE", headers: { Authorization: "Bearer owner" } });
  expect(response.ok).toBe(true);
}
