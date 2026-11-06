import { expect, test, type Page } from "@playwright/test";
import { homeFixture } from "./helpers/design-v2-home";
import { vehicleDayOffset } from "./helpers/design-v2-vehicle";
import { getDocument, monthKeyInBrowserTimeZone, seedFillups, setDocument, type SeedFillup } from "./helpers/emulator";

const DAY = 86_400_000;
test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", reducedMotion: "reduce" });

const card = (page: Page, type: string) => page.locator(`[data-testid="spotlight-card"][data-spotlight-type="${type}"]`);

test("the paid-price comparison opens the exact receipt and keeps owner and vehicle scope", async ({ page }) => {
  const scope = await homeFixture(page, { kind: "no-fillups" });
  const at = new Date(scope.now - 60_000);
  const fillup: SeedFillup = { id: "insight-receipt", date: at, odometer: 100000, liters: 40,
    pricePerLiter: 7.5, totalCost: 300, stationName: "תחנת תל אביב" };
  await seedFillups(scope.uid, scope.vehicleId, [fillup]);
  const path = `${scope.base}/fillups/${fillup.id}`;
  await setDocument(path, { ...await getDocument(path),
    station: { name: "תחנת תל אביב", lat: 32.08, lng: 34.78 },
    tankSchemaVersion: 2, fillEndState: "full", fillEndStateSource: "user-confirmed" });
  const history = { [monthKeyInBrowserTimeZone(at)]: 8, [monthKeyInBrowserTimeZone(new Date(scope.now))]: 8 };
  await setDocument("appConfig/fuelPrices", {
    byFuelType: { "95": { self: { history, scheduledHistory: history, source: "scheduled",
      current: { pricePerLiter: 8, updatedAt: new Date(scope.now) } } } },
    history, current: { pricePerLiter: 8, updatedAt: new Date(scope.now) }, source: "gov.il",
  });
  await page.goto("/");
  const paid = card(page, "paid");
  await expect(paid).toContainText("שילמת כ-₪20 פחות בתדלוק האחרון");
  await expect(paid).toContainText("המחיר המרבי לבנזין 95 בשירות עצמי מחוץ לאילת ביום התדלוק");
  await paid.locator(".tm-spotlight-open").click();
  await expect(page.getByTestId("journal-entry-sheet")).toHaveAttribute("data-entry-key", `fillups/${fillup.id}`);
  const query = new URL(page.url()).searchParams;
  expect(query.get("owner")).toBe(scope.uid);
  expect(query.get("vehicle")).toBe(scope.vehicleId);
  expect(query.get("entry")).toBe(`fillups/${fillup.id}`);
  for (const mismatch of [{ owner: "other-owner", vehicle: scope.vehicleId }, { owner: scope.uid, vehicle: "other-vehicle" }]) {
    const invalid = new URLSearchParams({ entry: `fillups/${fillup.id}`, ...mismatch });
    await page.goto(`/history?${invalid}`);
    await expect(page.getByTestId(`journal-entry-fillups/${fillup.id}`)).toBeVisible();
    await expect(page.getByTestId("journal-entry-sheet")).toHaveCount(0);
  }
});

test("a sustained consumption trend opens its measured segment and dismissal survives reload", async ({ page }) => {
  const scope = await homeFixture(page, { kind: "no-fillups" });
  let odometer = 100000;
  const source: SeedFillup[] = Array.from({ length: 7 }, (_, index) => {
    if (index) odometer += index <= 3 ? 480 : 400;
    return { id: `trend-${index}`, date: new Date(scope.now - (6 - index) * 7 * DAY - 60_000),
      odometer, liters: 40, pricePerLiter: 7.77, totalCost: 310.8 };
  });
  await seedFillups(scope.uid, scope.vehicleId, source);
  for (const fillup of source) {
    const path = `${scope.base}/fillups/${fillup.id}`;
    await setDocument(path, { ...await getDocument(path), tankSchemaVersion: 2,
      fillEndState: "full", fillEndStateSource: "user-confirmed" });
  }
  await page.goto("/");
  const trend = card(page, "consumption-trend");
  await expect(trend).toContainText("20% יותר דלק לק״מ לאורך 3 מקטעים");
  await expect(trend).toContainText("ב־3 המקטעים האחרונים");
  await expect(trend).toContainText("ב־3 הקודמים");
  await trend.locator(".tm-spotlight-open").click();
  await expect(page.getByTestId("segment-sheet")).toBeVisible();
  await expect(page.getByTestId("segment-sheet")).toContainText("10.0");
  await page.keyboard.press("Escape");
  const id = await trend.getAttribute("data-spotlight-id");
  expect(id).toBeTruthy();
  await trend.getByTestId(`spotlight-dismiss-${id}`).click();
  await expect(trend).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("consumption-summary")).toBeVisible();
  await expect(trend).toHaveCount(0);
  // Correcting the actual measurement creates new evidence, not a timed repeat.
  const path = `${scope.base}/fillups/trend-6`;
  await setDocument(path, { ...await getDocument(path), liters: 41, totalCost: 318.57 });
  await expect(trend).toHaveCount(1);
  expect(await trend.getAttribute("data-spotlight-id")).not.toBe(id);
});

test("upcoming reminders group without duplicates and an urgent document survives the earlier dismissal", async ({ page }) => {
  const scope = await homeFixture(page, { kind: "one-full" });
  const docs = {
    test: { due: vehicleDayOffset(15), cost: 1500 },
    mandatory: { due: vehicleDayOffset(20), insurer: "הראל", cost: 1200 },
  };
  await setDocument(scope.base, { ...await getDocument(scope.base), docs });
  await setDocument(`${scope.base}/maintenancePlans/insight-oil`, {
    schemaVersion: 1, version: 1, title: "החלפת שמן מתוכננת", job: "oil",
    dueDay: vehicleDayOffset(12), dueOdometer: null, intervalMonths: null, intervalKm: null,
    basis: "manual", source: "owner", notes: "", active: true,
  });
  await page.goto("/");
  const group = card(page, "upcoming");
  await expect(group).toHaveCount(1);
  await expect(group).toContainText("טסט שנתי");
  await expect(group).toContainText("ביטוח חובה");
  await expect(group).toContainText("החלפת שמן מתוכננת");
  // Recorded annual costs are not promised renewal quotes.
  await expect(group).not.toContainText("₪");
  await expect(card(page, "doc")).toHaveCount(0);
  await expect(card(page, "reminder")).toHaveCount(0);
  await group.locator(".tm-spotlight-open").click();
  await expect(page).toHaveURL(/\/vehicle\?tab=due$/);
  await expect(page.getByTestId("vehicle-doc-test")).toBeVisible();
  await expect(page.getByTestId("vehicle-doc-mandatory")).toBeVisible();
  await expect(page.getByRole("link", { name: /החלפת שמן מתוכננת/ })).toBeVisible();
  await page.goto("/");
  await expect(group).toHaveCount(1);
  // A fresh navigation can load the vehicle documents before maintenance.
  // Wait for the complete group again before capturing its member-based ID.
  await expect(group).toContainText("טסט שנתי");
  await expect(group).toContainText("ביטוח חובה");
  await expect(group).toContainText("החלפת שמן מתוכננת");
  const id = await group.getAttribute("data-spotlight-id");
  await group.getByTestId(`spotlight-dismiss-${id}`).click();
  await page.reload();
  await expect(page.getByTestId("consumption-summary")).toBeVisible();
  await expect(group).toHaveCount(0);
  await expect(card(page, "doc")).toHaveCount(0);
  await expect(card(page, "reminder")).toHaveCount(0);
  const urgentDue = vehicleDayOffset(2);
  await setDocument(scope.base, { ...await getDocument(scope.base),
    docs: { ...docs, mandatory: { ...docs.mandatory, due: urgentDue } } });
  const urgent = page.locator(`[data-testid="spotlight-card"][data-spotlight-id="doc:mandatory:${urgentDue}:week"]`);
  await expect(urgent).toContainText("ביטוח חובה");
  await expect(urgent.locator('[data-testid^="spotlight-dismiss-"]')).toHaveCount(0);
});
