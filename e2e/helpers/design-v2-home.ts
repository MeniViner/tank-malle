import { expect, type Page } from "@playwright/test";
import { signedInWithData, type ReadyAccount } from "./app";
import {
  getDocument, monthKeyInBrowserTimeZone, seedFillups, seedVehicle, setDocument,
  type SeedFillup, type SeedVehicle,
} from "./emulator";
import { israelMidnight } from "../../src/lib/prices/publicSource";
import { outboxCount } from "./pwa";

export const DAY = 86_400_000;
export const HOME_EFFICIENCIES = [13, 12, 13.5, 11, 12.5, 14, 10.5] as const;
// stats.ts exposes canonical averages rounded to three decimals.
export const HOME_AVERAGE = 12.357;
export const HOME_CAR: SeedVehicle = {
  make: "מאזדה", model: "3", year: 2020,
  tankLiters: 50, tankLitersSource: "user", declaredKmPerLiter: 15,
};

export interface HomeFixture extends ReadyAccount {
  now: number;
  base: string;
  fillups: SeedFillup[];
}
export type HomeKind = "history" | "one-full" | "no-fillups" | "unknown" | "low" | "partial-only";

/** Seven real closed intervals; the opening tank never contributes its litres. */
export function homeFillups(now: number, personalBest = false): SeedFillup[] {
  const efficiencies: number[] = [...HOME_EFFICIENCIES];
  if (personalBest) efficiencies[6] = 16;
  let odometer = 170000;
  return Array.from({ length: 8 }, (_, index) => {
    if (index) odometer += efficiencies[index - 1] * 30;
    return {
      id: `home-${index}`,
      date: new Date(now - (7 - index) * 7 * DAY - 60 * 60 * 1000),
      odometer, liters: 30, pricePerLiter: 7.52, totalCost: 225.6,
      stationName: index % 2 ? "דלק תחנה 95" : "סונול שפיה",
    };
  });
}

/** Preserve explicit full-tank provenance; these fixtures are not legacy assumptions. */
async function confirmFulls(scope: HomeFixture) {
  for (const row of scope.fillups) {
    const path = `${scope.base}/fillups/${row.id}`;
    await setDocument(path, {
      ...await getDocument(path), tankSchemaVersion: 2,
      fillEndState: row.isFullTank === false ? "partial" : "full",
      fillEndStateSource: "user-confirmed",
      preFillLevel: .4, preFillLevelSource: "direct-gauge",
      refuelReason: "low-fuel", capacityLitersAtEntry: 50,
    });
  }
}

export async function homeFixture(page: Page, options: {
  kind?: HomeKind;
  personalBest?: boolean;
  vehicle?: SeedVehicle;
} = {}): Promise<HomeFixture> {
  const now = Date.now();
  const kind = options.kind ?? "history";
  const history = homeFillups(kind === "unknown" ? now - 120 * DAY : now, options.personalBest);
  const fillups = kind === "no-fillups" ? []
    : kind === "one-full" ? [history.at(-1)!]
    : kind === "partial-only" ? [{ ...history.at(-1)!, isFullTank: false }]
    : history;
  const account = await signedInWithData(page, {
    vehicle: options.vehicle ?? HOME_CAR, regulatedPrice: 7.77, fillups,
  });
  const scope = { ...account, now, base: `users/${account.uid}/vehicles/${account.vehicleId}`, fillups };
  await setDocument(scope.base, { ...await getDocument(scope.base), nickname: "המשפחתית", plateNumber: "7248078" });
  await confirmFulls(scope);
  if (kind === "low") await setDocument(`${scope.base}/observations/low`, {
    observedAt: new Date(now), recordedAt: new Date(now), kind: "level",
    level: .05, levelSource: "direct-gauge", confirmed: true,
  });
  await page.goto("/");
  await expect(page.getByTestId("open-car-switch")).toContainText("המשפחתית");
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  return scope;
}

/** Additional real cars allow each appearance gallery to switch through all states. */
export async function homeAlternative(scope: HomeFixture, vehicleId: string, kind: HomeKind): Promise<HomeFixture> {
  await seedVehicle(scope.uid, vehicleId, HOME_CAR);
  const base = `users/${scope.uid}/vehicles/${vehicleId}`;
  await setDocument(base, { ...await getDocument(base), nickname: `מצב ${kind}`, plateNumber: "12345678" });
  const history = homeFillups(kind === "unknown" ? scope.now - 120 * DAY : scope.now);
  const fillups = kind === "no-fillups" ? []
    : kind === "one-full" ? [history.at(-1)!]
    : kind === "partial-only" ? [{ ...history.at(-1)!, isFullTank: false }]
    : history;
  const next = { ...scope, base, vehicleId, fillups };
  await seedFillups(scope.uid, vehicleId, fillups);
  await confirmFulls(next);
  if (kind === "low") await setDocument(`${base}/observations/low`, {
    observedAt: new Date(scope.now), recordedAt: new Date(scope.now), kind: "level",
    level: .05, levelSource: "direct-gauge", confirmed: true,
  });
  return next;
}

export async function homeAppearance(page: Page, uid: string, theme: "light" | "dark", accent: "plate" | "mint") {
  await page.goto("/account");
  await page.getByRole("button", { name: /^מראה/ }).click();
  await page.getByRole("radio", { name: theme === "light" ? "בהיר" : "כהה", exact: true }).click();
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ theme });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^צבע/ }).click();
  await page.getByTestId(`accent-${accent}`).click();
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ accentColor: accent });
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect.poll(() => outboxCount(page, uid)).toBe(0);
  await page.goto("/");
}

export async function homeSwitchVehicle(page: Page, uid: string, vehicleId: string) {
  await page.getByTestId("open-car-switch").click();
  await page.getByTestId(`car-switch-${vehicleId}`).click();
  await expect(page.locator("[data-toast-title]").filter({ hasText: "הרכב הפעיל הוחלף" })).toBeVisible();
  await page.getByRole("button", { name: "סגירת ההודעה", exact: true }).click();
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ activeVehicleId: vehicleId });
  await expect.poll(() => outboxCount(page, uid)).toBe(0);
}

export async function homePriceChange(now: number) {
  const currentKey = monthKeyInBrowserTimeZone(new Date(now));
  const [year, month] = currentKey.split("-").map(Number);
  const previousKey = monthKeyInBrowserTimeZone(new Date(Date.UTC(year, month - 2, 15, 12)));
  const current = { pricePerLiter: 7.77, effectiveFrom: new Date(israelMidnight(year, month, 1)!), updatedAt: new Date(now) };
  const history = { [previousKey]: 7.52, [currentKey]: 7.77 };
  await setDocument("appConfig/fuelPrices", {
    byFuelType: { "95": { self: { current, history, scheduledHistory: history, source: "scheduled", retrievedAt: new Date(now) } } },
    current, history, source: "gov.il",
  });
}

export async function homeKmReminder(scope: HomeFixture, remaining = 300) {
  const last = scope.fillups.at(-1)!;
  await setDocument(`${scope.base}/maintenancePlans/home-oil`, {
    schemaVersion: 1, version: 1, title: "שמן ומסננים", job: "oil",
    dueDay: null, dueOdometer: last.odometer + remaining,
    intervalMonths: null, intervalKm: null,
    basis: "manual", source: "owner", notes: "", active: true,
  });
}

/** A known full baseline followed by a missing-cost partial and known close. */
export async function homeUnknownCost(page: Page): Promise<HomeFixture> {
  const scope = await homeFixture(page, { kind: "no-fillups" });
  const fillups: SeedFillup[] = [
    { id: "cost-base", date: new Date(scope.now - 14 * DAY), odometer: 100000, liters: 40, totalCost: 280 },
    { id: "cost-partial", date: new Date(scope.now - 7 * DAY), odometer: 100300, liters: 20, isFullTank: false },
    { id: "cost-close", date: new Date(scope.now - 60000), odometer: 100600, liters: 25, totalCost: 175 },
  ];
  await seedFillups(scope.uid, scope.vehicleId, fillups);
  await confirmFulls({ ...scope, fillups });
  const path = `${scope.base}/fillups/cost-partial`;
  await setDocument(path, { ...await getDocument(path), totalCost: null, pricePerLiter: null });
  await page.goto("/");
  return { ...scope, fillups };
}

/** The details action replaces the old Home explanation/count paragraphs. */
export async function expectConsumptionCounts(page: Page, segments: number, fillups: number) {
  await page.getByTestId("consumption-details-open").click();
  await expect(page.getByTestId("consumption-details-sheet")).toBeVisible();
  await expect(page.getByTestId("consumption-segment-count").locator("bdi")).toHaveText(String(segments));
  await expect(page.getByTestId("consumption-fillup-count").locator("bdi")).toHaveText(String(fillups));
  await page.keyboard.press("Escape");
}

export async function expectOpenConsumption(page: Page, liters: string, count: number) {
  await page.getByTestId("consumption-details-open").click();
  await expect(page.getByTestId("consumption-details-sheet")).toBeVisible();
  await expect(page.getByTestId("consumption-open-liters")).toContainText(liters);
  await expect(page.getByTestId("consumption-open-count").locator("bdi")).toHaveText(String(count));
  await page.keyboard.press("Escape");
}

export async function homeMixedRecent(scope: HomeFixture) {
  const day = (offset: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(scope.now - offset * DAY));
  const latest = `${scope.base}/fillups/${scope.fillups.at(-1)!.id}`;
  await setDocument(latest, { ...await getDocument(latest), date: new Date(scope.now - 3 * DAY) });
  await setDocument(`${scope.base}/serviceEvents/mixed-service`, {
    schemaVersion: 1, version: 1, day: day(2), title: "טיפול 120,000",
    jobs: ["oil", "brakes"], odometer: 172595, costAgorot: null,
    garage: "מוסך 24", notes: "החשבונית טרם התקבלה", completedPlanIds: [],
  });
  await setDocument(`${scope.base}/vehicleExpenses/mixed-refund`, {
    schemaVersion: 1, version: 1, day: day(1), title: "החזר חניה 5",
    category: "refund", costAgorot: 1050, notes: "",
  });
  await setDocument(`${scope.base}/observations/mixed-odometer`, {
    observedAt: new Date(scope.now), recordedAt: new Date(scope.now), kind: "odometer",
    odometer: Math.max(172600, scope.fillups.at(-1)!.odometer + 5), confirmed: true, phase: "standalone",
  });
}
