import { expect, type Page } from "@playwright/test";
import { signedInWithData, type ReadyAccount } from "./app";
import { listDocuments, type SeedFillup, type SeedVehicle } from "./emulator";
import { setFillupEndState } from "./fillup";
import { outboxCount } from "./pwa";

export const FILLUP_DAY = 86_400_000;
export const FILLUP_CAR: SeedVehicle = {
  make: "מאזדה", model: "3", year: 2020,
  tankLiters: 50, tankLitersSource: "user", declaredKmPerLiter: 15,
};

export interface FillupFixture extends ReadyAccount {
  now: number;
  base: string;
  collection: string;
  fillups: SeedFillup[];
}

export async function fillupFixture(page: Page, options: {
  history?: "none" | "baseline" | "partial" | "closed";
  vehicle?: SeedVehicle;
  price?: number;
} = {}): Promise<FillupFixture> {
  const now = Date.now();
  const first: SeedFillup = { id: "fillup-baseline", date: new Date(now - 14 * FILLUP_DAY),
    odometer: 100000, liters: 40, pricePerLiter: 7, totalCost: 280 };
  const second: SeedFillup = { id: "fillup-partial", date: new Date(now - 7 * FILLUP_DAY),
    odometer: 100300, liters: 20, pricePerLiter: 7, totalCost: 140, isFullTank: false };
  const history = options.history ?? "partial";
  const fillups = history === "none" ? [] : history === "baseline" ? [first]
    : history === "closed" ? [first, { ...second, id: "fillup-closed", isFullTank: true, liters: 30, totalCost: 210 }]
      : [first, second];
  const scope = await signedInWithData(page, { vehicle: options.vehicle ?? FILLUP_CAR,
    fillups, regulatedPrice: options.price ?? 7.77 });
  if (fillups.length) await expect(page.getByTestId(`journal-entry-fillups/${fillups.at(-1)!.id}`)).toBeVisible();
  else await expect(page.getByTestId("home-first-fillup")).toBeVisible();
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  const base = `users/${scope.uid}/vehicles/${scope.vehicleId}`;
  return { ...scope, now, base, collection: `${base}/fillups`, fillups };
}

export async function typeFillup(page: Page, input: {
  odometer?: string | number;
  liters?: string | number;
  price?: string | number;
  total?: string | number;
  end?: "full" | "partial" | "unknown";
} = {}): Promise<void> {
  await page.getByTestId("fillup-odometer").fill(String(input.odometer ?? 100600));
  await page.getByTestId("fillup-liters").fill(String(input.liters ?? 25));
  await page.getByTestId("fillup-price").fill(String(input.price ?? 7));
  if (input.total !== undefined) await page.getByTestId("fillup-total").fill(String(input.total));
  if (input.end) await setFillupEndState(page, input.end);
}

/** Choose genuine free text through the visible station sheet. */
export async function chooseNamedStation(page: Page, name = "תחנה פרטית לבדיקת קבלה"): Promise<void> {
  await page.getByTestId("fillup-station").click();
  const dialog = page.getByRole("dialog", { name: "תחנת דלק", exact: true });
  await dialog.getByRole("textbox", { name: "חיפוש תחנה", exact: true }).fill(name);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await dialog.getByRole("button", { name: new RegExp(`^(?:${escaped}.*|שמירה בשם.*${escaped})`) }).first().click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("fillup-station")).toContainText(name);
}

/** Dates are chosen through the same input parser a driver uses. */
export async function setFillupDay(page: Page, epochMs: number): Promise<void> {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(epochMs);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  await page.getByTestId("fillup-date").click();
  const dialog = page.getByRole("dialog", { name: "תאריך ושעה", exact: true });
  const date = dialog.getByLabel("תאריך — הקלדה ידנית");
  await date.fill(`${value("year")}-${value("month")}-${value("day")}`);
  await date.press("Enter");
  const time = dialog.getByLabel("שעה — הקלדה ידנית");
  await time.fill("12:00");
  await time.press("Enter");
  await dialog.getByRole("button", { name: "אישור", exact: true }).click();
}

export async function newServerFillup(scope: FillupFixture, odometer: number) {
  let saved: { id: string; data: Record<string, unknown> } | undefined;
  const originals = new Set(scope.fillups.map(row => row.id));
  await expect(async () => {
    saved = (await listDocuments(scope.collection)).find(row => !originals.has(row.id) && row.data.odometer === odometer);
    expect(saved).toBeDefined();
  }).toPass({ timeout: 20_000 });
  return saved!;
}
