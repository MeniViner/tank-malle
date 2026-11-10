import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { ALICE, signIn, signedInWithData } from "./helpers/app";
import {
  DENY_ALL_RULES, getDocument, installRules, listDocuments, monthKeyInBrowserTimeZone, restoreRules, setDocument,
} from "./helpers/emulator";
import {
  HOME_AVERAGE, HOME_CAR, homeAlternative, homeAppearance, homeFixture,
  homeKmReminder, homeMixedRecent, homePriceChange, homeSwitchVehicle, homeUnknownCost,
} from "./helpers/design-v2-home";
import { outboxCount } from "./helpers/pwa";
import { openFillupMore } from "./helpers/fillup";

const stage = process.env.DESIGN_V2_STAGE;
const evidence = resolve(stage ? `design/v2/evidence/stage-${stage}` : "test-results/design-v2");
test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", hasTouch: true });

const cards = (page: Page) => page.getByTestId("spotlight-card");
const cardOf = (page: Page, type: string) => page.locator(`[data-testid="spotlight-card"][data-spotlight-type="${type}"]`);
const points = (page: Page) => page.getByTestId("consumption-chart").locator('button[data-testid^="consumption-point-"]');

async function size44(target: Locator) {
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
}

async function fieldAccessibility(input: Locator) {
  await size44(input);
  await input.focus();
  const measurement = await input.evaluate(element => {
    const box = element.getBoundingClientRect();
    const placeholder = getComputedStyle(element, "::placeholder");
    const field = getComputedStyle(element.parentElement!);
    return { label: element.getAttribute("id"), width: box.width, height: box.height,
      placeholderColor: placeholder.color, placeholderOpacity: placeholder.opacity,
      background: field.backgroundColor, focusOutline: field.outlineStyle,
      focusOutlineColor: field.outlineColor, focusShadow: field.boxShadow };
  });
  expect(measurement.placeholderOpacity).toBe("1");
  expect(measurement.placeholderColor).not.toMatch(/rgba\([^)]*,\s*0\./);
  expect(measurement.focusOutline).toBe("none");
  expect(measurement.focusShadow).toBe("none");
  return measurement;
}

async function capture(page: Page, name: string, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, `${name}.png`), animations: "disabled" });
  if (fullPage) await page.screenshot({ path: resolve(evidence, `${name}-full.png`), animations: "disabled", fullPage: true });
}

async function dismiss(page: Page, item: Locator) {
  const id = await item.getAttribute("data-spotlight-id");
  expect(id).toBeTruthy();
  await item.getByTestId(`spotlight-dismiss-${id}`).click();
  await expect(page.locator(`[data-spotlight-id="${id}"]`)).toHaveCount(0);
  return id!;
}

async function dismissAll(page: Page) {
  for (let index = 0; index < 8 && await cards(page).count(); index++) await dismiss(page, cards(page).first());
  await expect(page.getByTestId("home-spotlight")).toHaveCount(0);
}

async function threeSpotlights(page: Page) {
  const scope = await homeFixture(page, { personalBest: true });
  await homeKmReminder(scope);
  await homePriceChange(scope.now);
  await page.goto("/");
  await expect(cardOf(page, "reminder")).toBeVisible();
  await expect(cardOf(page, "best")).toHaveCount(1);
  await expect(cardOf(page, "price")).toHaveCount(1);
  // The independent monthly-summary test covers the calendar gate. Remove
  // that optional fourth card here so this fixture is stable throughout a month.
  if (await cardOf(page, "month").count()) await dismiss(page, cardOf(page, "month"));
  await expect(cards(page)).toHaveCount(3);
  expect(await cards(page).evaluateAll(elements => elements.map(element => element.getAttribute("data-spotlight-type"))))
    .toEqual(["reminder", "best", "price"]);
  return scope;
}

async function openTank(page: Page) {
  await page.getByTestId("tank-hero").click();
  await expect(page.getByTestId("tank-sheet")).toBeVisible();
  return page.getByRole("dialog", { name: "מה יש במיכל", exact: true });
}

async function focusedIn(dialog: Locator) {
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
}

test("Home sparkline uses the last six canonical intervals, correct usual band and fuel-per-km comparison in either unit", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { uid } = await homeFixture(page);
  const chart = page.getByTestId("consumption-chart");
  const summary = page.getByTestId("consumption-summary");
  await expect(points(page)).toHaveCount(6);
  expect(await points(page).evaluateAll(elements => elements.map(element => element.getAttribute("data-testid"))))
    .toEqual([2, 3, 4, 5, 6, 7].map(index => `consumption-point-home-${index}`));
  await expect(page.getByTestId("consumption-point-home-1")).toHaveCount(0);
  await expect(summary.getByText("10.5", { exact: true }).first()).toBeVisible();
  await expect(summary.getByRole("button", { name: /פרטי המקטע האחרון.*10\.5.*ק״מ לליטר/ })).toBeVisible();
  await expect(chart.locator("figcaption")).toContainText("הטווח הרגיל שלך, סביב 12.4");
  await expect(page.getByTestId("consumption-comparison")).toContainText("18%");
  await expect(page.getByTestId("consumption-comparison")).toContainText("יותר דלק לק״מ");
  await expect(chart).toHaveAttribute("data-tone", "worse");
  await expect(chart.locator("rect[data-segment]")).toHaveCount(0);
  await expect(chart.locator("[stroke-dasharray]")).toHaveCount(0);
  await expect(chart.getByTestId("consumption-island")).toHaveCount(1);
  expect(await chart.getByTestId("consumption-island").getAttribute("d")).toContain(" C ");
  const band = page.getByTestId("consumption-usual-band");
  expect(Number(await band.getAttribute("data-low"))).toBeCloseTo(HOME_AVERAGE * .93, 7);
  expect(Number(await band.getAttribute("data-high"))).toBeCloseTo(HOME_AVERAGE * 1.07, 7);
  const positions: number[] = [];
  for (const point of await points(page).all()) {
    await size44(point);
    positions.push((await point.boundingBox())!.x);
    await expect(point).toHaveAccessibleName(/פרטי המקטע/);
  }
  expect(positions).toEqual([...positions].sort((a, b) => b - a));
  await expect(chart.locator('[data-last="true"] circle')).toHaveAttribute("r", "6.5");
  await page.getByTestId("consumption-point-home-7").focus();
  await page.keyboard.press("Enter");
  const segment = page.getByTestId("segment-sheet");
  await expect(segment).toBeVisible();
  await expect(page.getByTestId("segment-distance")).toContainText("315");
  await expect(page.getByTestId("segment-liters")).toContainText("30.0");
  await expect(page.getByTestId("segment-cost")).toContainText("226\u202F₪");
  await expect(page.getByTestId("segment-closing-fillup")).toContainText("דלק תחנה 95");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("consumption-point-home-7")).toBeFocused();
  await page.getByTestId("consumption-point-home-7").click();
  await page.getByTestId("segment-closing-fillup").click();
  await expect(page).toHaveURL(/\/fillup\/home-7$/);
  await expect(page.getByLabel(/^קילומטראז׳/)).toHaveValue("172595");

  await page.goto("/account");
  await page.getByTestId("account-units").click();
  await page.getByRole("radio", { name: "ליטר ל-100 ק״מ", exact: true }).click();
  await expect.poll(() => outboxCount(page, uid)).toBe(0);
  await page.goto("/");
  await expect(summary.getByText("9.5", { exact: true }).first()).toBeVisible();
  await expect(summary.getByRole("button", { name: /פרטי המקטע האחרון.*9\.5.*100.*ק״מ/ })).toBeVisible();
  await expect(chart.locator("figcaption")).toContainText("הטווח הרגיל שלך, סביב 8.1");
  await expect(chart).toHaveAttribute("data-tone", "worse");
  await expect(page.getByTestId("consumption-comparison")).toContainText("18%");
  expect(Number(await band.getAttribute("data-low"))).toBeCloseTo(100 / (HOME_AVERAGE * 1.07), 7);
  expect(Number(await band.getAttribute("data-high"))).toBeCloseTo(100 / (HOME_AVERAGE * .93), 7);
  await expect(points(page).last()).toHaveAccessibleName(/9.5.*100.*פרטי המקטע/);
});

test("a missing partial cost never becomes a complete segment or monthly fuel total", async ({ page }) => {
  const scope = await homeUnknownCost(page);
  await expect(page.getByTestId("consumption-summary").getByText("13.3", { exact: true }).first()).toBeVisible();
  await page.getByTestId("consumption-point-cost-close").click();
  await expect(page.getByTestId("segment-distance")).toContainText("600");
  await expect(page.getByTestId("segment-liters")).toContainText("45.0");
  await expect(page.getByTestId("segment-fillup-count")).toContainText("2");
  await expect(page.getByTestId("segment-cost")).toContainText("—");
  await expect(page.getByTestId("segment-cost-per-km")).toContainText("—");
  await expect(page.getByTestId("segment-cost-unknown")).toBeVisible();
  await page.keyboard.press("Escape");
  // The tile now shows the actual current month; an unknown prior-month receipt
  // still prevents a complete historical average, without hiding a known month.
  const partial = scope.fillups.find(fillup => fillup.id === "cost-partial")!;
  const currentMonthUnknown = monthKeyInBrowserTimeZone(new Date(partial.date)) === monthKeyInBrowserTimeZone(new Date(scope.now));
  await expect(page.getByTestId("home-fuel-month")).toContainText(currentMonthUnknown ? "—" : "175\u202F₪");
  await expect(page.getByTestId("home-fuel-month")).toContainText("אין ממוצע מלא");
  const path = `${scope.base}/fillups/cost-partial`;
  expect((await getDocument(path))?.totalCost).toBeNull();
  // An explicitly entered zero is different from missing cost, and the
  // opening full tank remains outside the segment's counted cost.
  await setDocument(path, { ...await getDocument(path), totalCost: 0, pricePerLiter: 0 });
  await page.getByTestId("consumption-point-cost-close").click();
  await expect(page.getByTestId("segment-cost")).toContainText("175\u202F₪");
  await expect(page.getByTestId("segment-cost-unknown")).toHaveCount(0);
  const basePath = `${scope.base}/fillups/cost-base`;
  await setDocument(basePath, { ...await getDocument(basePath), totalCost: null, pricePerLiter: null });
  await expect(page.getByTestId("segment-cost")).toContainText("175\u202F₪");
  expect((await getDocument(basePath))?.totalCost).toBeNull();
});

test("the three recent records and Journal share refund, unknown cost and quiet odometer rows", async ({ page }) => {
  const scope = await homeFixture(page);
  await expect(page.getByTestId("tank-hero")).toHaveAccessibleDescription(/100\s*%/);
  await expect(page.getByTestId("tank-hero")).toHaveAccessibleDescription(/הערכה מהטנק המלא האחרון/);
  await homeMixedRecent(scope);
  await page.goto("/");
  const recent = page.getByTestId("recent-fillups-timeline");
  await expect(recent.locator(".ledger-row")).toHaveCount(3);
  const ids = ["observations/mixed-odometer", "vehicleExpenses/mixed-refund", "serviceEvents/mixed-service"];
  const text = new Map<string, string>();
  for (const id of ids) {
    const row = recent.getByTestId(`journal-entry-${id}`);
    await expect(row).toBeVisible();
    await size44(row);
    text.set(id, await row.innerText());
  }
  await expect(recent.getByTestId("journal-entry-vehicleExpenses/mixed-refund")).toContainText("+11\u202F₪");
  await expect(recent.getByTestId("journal-entry-serviceEvents/mixed-service")).toContainText("—");
  await expect(recent.getByTestId("journal-entry-observations/mixed-odometer")).toContainText("172,600");
  await expect(recent.getByTestId("journal-entry-observations/mixed-odometer")).not.toContainText("₪");
  await recent.getByTestId("journal-entry-observations/mixed-odometer").click();
  await expect(page).toHaveURL(/\/history\?.*entry=observations%2Fmixed-odometer/);
  await expect(page.getByTestId("journal-entry-sheet")).toContainText("172,600");
  await page.keyboard.press("Escape");
  for (const id of ids) await expect(page.getByTestId(`journal-entry-${id}`)).toHaveText(text.get(id)!, { useInnerText: true });
  expect((await getDocument(`${scope.base}/vehicleExpenses/mixed-refund`))?.costAgorot).toBe(1050);
  expect((await getDocument(`${scope.base}/serviceEvents/mixed-service`))?.costAgorot).toBeNull();
  expect(await listDocuments(`${scope.base}/fillups`)).toHaveLength(8);

  await setDocument(`${scope.base}/observations/mixed-level`, {
    observedAt: new Date(scope.now + 1000), recordedAt: new Date(scope.now + 1000),
    kind: "level", level: .25, levelSource: "direct-gauge", confirmed: true,
  });
  await page.goto("/");
  await recent.getByTestId("journal-entry-observations/mixed-level").click();
  await expect(page.getByTestId("journal-entry-sheet")).toContainText("25%");
  expect((await getDocument(`${scope.base}/observations/mixed-level`))?.level).toBe(.25);
});

test("a Home journal delete confirmation closes on external vehicle switch without touching either ledger", async ({ page }) => {
  const scope = await homeFixture(page);
  await homeMixedRecent(scope);
  const other = await homeAlternative(scope, "journal-other", "one-full");
  const firstPath = `${scope.base}/vehicleExpenses/mixed-refund`;
  const secondPath = `${other.base}/vehicleExpenses/mixed-refund`;
  const first = await getDocument(firstPath);
  const second = { ...first, title: "החזר של הרכב השני", costAgorot: 2200 };
  await setDocument(secondPath, second);
  await page.goto("/");
  await page.getByTestId("recent-fillups-timeline").getByTestId("journal-entry-vehicleExpenses/mixed-refund").click();
  await page.getByTestId("journal-entry-delete").click();
  await expect(page.getByRole("alertdialog", { name: "מחיקת הרשומה?", exact: true })).toBeVisible();

  // Simulate another signed-in device selecting a car while this confirmation
  // is open. The same collection/id exists in both cars to catch retargeting.
  const userPath = `users/${scope.uid}`;
  const user = await getDocument(userPath);
  await setDocument(userPath, { ...user, settings: {
    ...(user?.settings as Record<string, unknown>), activeVehicleId: other.vehicleId,
  } });
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("journal-entry-vehicleExpenses/mixed-refund")).toContainText("החזר של הרכב השני");
  expect(await getDocument(firstPath)).toEqual(first);
  expect(await getDocument(secondPath)).toEqual(second);
  expect(await listDocuments(`${scope.base}/fillups`)).toHaveLength(8);
  expect(await listDocuments(`${other.base}/fillups`)).toHaveLength(1);
  expect(await outboxCount(page, scope.uid)).toBe(0);

  await setDocument(userPath, user!);
  await expect(page.getByTestId("journal-entry-vehicleExpenses/mixed-refund")).toContainText("החזר חניה 5");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await getDocument(firstPath)).toEqual(first);
});

test("new and partial-only vehicles show truthful empty states and never invent zero metrics", async ({ page }) => {
  await homeFixture(page, { kind: "no-fillups" });
  await expect(page.getByText("מתחילים מהתדלוק הבא", { exact: true })).toBeVisible();
  await expect(page.getByTestId("consumption-chart")).toHaveCount(0);
  await expect(page.getByText(/(?<![\d,.])0\s₪/)).toHaveCount(0);
  await expect(page.getByTestId("home-km-day")).toContainText("—");
  await expect(page.getByTestId("home-fuel-month")).toContainText("—");
  await homeFixture(page, { kind: "one-full" });
  await expect(page.getByText("עוד תדלוק מלא אחד ונדע", { exact: true })).toBeVisible();
  await expect(page.getByTestId("consumption-chart")).toHaveCount(0);
  await homeFixture(page, { kind: "partial-only" });
  await expect(page.getByText("מתחילים בתדלוק עד הסוף", { exact: true })).toBeVisible();
  await expect(page.getByText("עוד תדלוק מלא אחד ונדע", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("consumption-chart")).toHaveCount(0);
});

test("Home price sheets stay fuel-specific and distinguish manual prices from regulated 95", async ({ page }) => {
  await page.route(/https:\/\/(?:delek\.co\.il|r\.jina\.ai\/https:\/\/delek\.co\.il)\//, route => route.abort());
  for (const fuelType of ["diesel", "98", "other"] as const) {
    const scope = await homeFixture(page, { vehicle: { ...HOME_CAR, fuelType } });
    const price = page.getByTestId("home-fuel-price");
    await expect(price).toContainText("—");
    await expect(price).not.toContainText("7.77");
    await expect(price).not.toContainText("מחיר מרבי");
    await price.click();
    const sheet = page.getByTestId("price-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).not.toContainText("7.77");
    await expect(sheet).not.toContainText("מחיר מרבי");
    await expect(cardOf(page, "price")).toHaveCount(0);
    await page.keyboard.press("Escape");
    const config = await getDocument("appConfig/fuelPrices");
    const current = { pricePerLiter: 8.16, updatedAt: new Date(scope.now) };
    await setDocument("appConfig/fuelPrices", {
      ...config,
      byFuelType: {
        ...(config?.byFuelType as Record<string, unknown>),
        [fuelType]: { self: { current, history: { [monthKeyInBrowserTimeZone(new Date(scope.now))]: 8.16 }, source: "manual" } },
      },
    });
    await expect(price).toContainText("8.16\u202F₪");
    await price.click();
    await expect(sheet).toContainText("הוזן ידנית");
    await expect(sheet).toContainText("8.16\u202F₪");
    await expect(sheet).not.toContainText("מחיר מרבי");
    expect((await getDocument(scope.base))?.fuelType).toBe(fuelType);
    await page.keyboard.press("Escape");
    // A dated import/scheduled series for another fuel is still not a
    // government-regulated 95 ceiling, even though it has a known price.
    const manual = await getDocument("appConfig/fuelPrices");
    await setDocument("appConfig/fuelPrices", {
      ...manual,
      byFuelType: {
        ...(manual?.byFuelType as Record<string, unknown>),
        [fuelType]: { self: { current, history: { [monthKeyInBrowserTimeZone(new Date(scope.now))]: 8.16 }, source: "import" } },
      },
    });
    await expect(price).toContainText("8.16\u202F₪");
    await expect(price).not.toContainText("מחיר מרבי");
    await price.click();
    await expect(sheet).not.toContainText("מפוקח");
    await expect(sheet).not.toContainText("מחיר מרבי");
  }
});

test("malformed-only and denied history never claim the vehicle has no records", async ({ page, browser, baseURL }) => {
  const scope = await homeFixture(page, { kind: "no-fillups" });
  const path = `${scope.base}/fillups/unreadable`;
  const malformed = { date: "broken-date", odometer: 100000, liters: 30, totalCost: 210, pricePerLiter: 7 };
  await setDocument(path, malformed);
  await page.reload();
  await expect(page.getByTestId("home-history-incomplete")).toBeVisible();
  await expect(page.getByTestId("home-first-fillup")).toHaveCount(0);
  await expect(cardOf(page, "best")).toHaveCount(0);
  await expect(cardOf(page, "month")).toHaveCount(0);
  expect(await getDocument(path)).toEqual(malformed);

  const originalRules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  let replaced = 0;
  const denied = originalRules.replace(/(match \/fillups\/\{fillupId\}\s*\{\s*)allow read: if isOwner\(uid\);/, (_match, prefix: string) => {
    replaced += 1; return `${prefix}allow read: if false;`;
  });
  expect(replaced).toBe(1);
  await installRules(denied);
  // A fresh browser context has no Firestore cache to hide the denied read.
  const context = await browser.newContext({ baseURL, locale: "he-IL", timezoneId: "Asia/Jerusalem", viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  try {
    const isolated = await context.newPage();
    await signIn(isolated, ALICE);
    await isolated.goto("/");
    await expect(isolated.getByTestId("home-history-incomplete")).toBeVisible();
    await expect(isolated.getByTestId("home-first-fillup")).toHaveCount(0);
    await expect(isolated.getByTestId("consumption-chart")).toHaveCount(0);
    await expect(cardOf(isolated, "best")).toHaveCount(0);
    await expect(cardOf(isolated, "month")).toHaveCount(0);
    expect(await getDocument(path)).toEqual(malformed);
  } finally { await context.close(); await restoreRules(); }
});

test("spotlight priority and item-scoped dismissal survive reload while a new occurrence reappears", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const scope = await threeSpotlights(page);
  expect(await cards(page).evaluateAll(elements => elements.map(element => element.getAttribute("data-spotlight-type"))))
    .toEqual(["reminder", "best", "price"]);
  const oldId = await dismiss(page, cardOf(page, "reminder"));
  await page.reload();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator(`[data-spotlight-id="${oldId}"]`)).toHaveCount(0);
  await homeKmReminder(scope, 250);
  await expect(cardOf(page, "reminder")).toHaveCount(1);
  expect(await cardOf(page, "reminder").getAttribute("data-spotlight-id")).not.toBe(oldId);
  await dismissAll(page);
  await page.reload();
  await expect(page.getByTestId("home-spotlight")).toHaveCount(0);
  const other = await homeAlternative(scope, "spotlight-other", "one-full");
  await homeSwitchVehicle(page, scope.uid, other.vehicleId);
  await expect(cardOf(page, "price")).toHaveCount(1);
  await homeSwitchVehicle(page, scope.uid, scope.vehicleId);
  await expect(page.getByTestId("home-spotlight")).toHaveCount(0);
});

test("spotlight auto-advances at seven seconds, then touch stops it; reduced motion never advances", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await threeSpotlights(page);
  // Reset any interaction from dismissing the optional month card. Keep the
  // real clock: moving Date behind a live emulator also affects its snapshots.
  await page.reload();
  await expect(cards(page)).toHaveCount(3);
  const dots = page.getByTestId("spotlight-dots");
  const active = () => dots.locator("i").evaluateAll(elements => elements.findIndex(element => element.getAttribute("data-active") === "true"));
  const first = await active();
  await expect.poll(active, { timeout: 12000, intervals: [100] }).not.toBe(first);
  // Measure a complete interval between two rendered transitions, after all
  // asynchronous fixture listeners have settled, including smooth scrolling.
  const next = await active();
  const transitionAt = Date.now();
  await expect.poll(active, { timeout: 12000, intervals: [100] }).not.toBe(next);
  expect(Date.now() - transitionAt).toBeGreaterThanOrEqual(6000);
  expect(Date.now() - transitionAt).toBeLessThan(9500);
  const track = page.getByTestId("spotlight-track");
  const bounds = (await track.boundingBox())!;
  // Tap the track's padding, outside the card action, on a touch-enabled context.
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + 1);
  const stopped = await active();
  // Each negative check spans more than the real seven-second interval.
  await page.waitForTimeout(8000);
  expect(await active()).toBe(stopped);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(cards(page)).toHaveCount(3);
  const reduced = await active();
  await page.waitForTimeout(8000);
  expect(await active()).toBe(reduced);
  expect(await track.evaluate(element => getComputedStyle(element).scrollBehavior)).toBe("auto");
});

test("a server-rejected write has the first sticky spotlight and retries without losing the operation", async ({ page }) => {
  const scope = await threeSpotlights(page);
  const path = `${scope.base}/fillups/home-7`;
  const before = await getDocument(path);
  try {
    await installRules(DENY_ALL_RULES);
    // A fill-up edit has a captured base, so a refused write is an actual
    // rejection. Settings patches intentionally use conservative conflicts.
    await page.goto("/fillup/home-7");
    await openFillupMore(page);
    await page.getByLabel("הערה").fill("כרטיס שגיאת שמירה");
    await page.getByRole("button", { name: "שמירת שינויים", exact: true }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/settings/unsynced");
    await expect(page.locator('[data-outbox-status="failed"]')).toHaveCount(1);
    expect(await getDocument(path)).toEqual(before);
    await page.goto("/");
    // A vehicle-scoped rejected edit makes the history incomplete until ACK,
    // so personal-best/month claims are deliberately withheld while it exists.
    await expect(cards(page)).toHaveCount(3);
    await expect(cardOf(page, "best")).toHaveCount(0);
    await expect(cardOf(page, "month")).toHaveCount(0);
    await expect(cards(page).first()).toHaveAttribute("data-spotlight-type", "write");
    await expect(cards(page).first().locator('[data-testid^="spotlight-dismiss-"]')).toHaveCount(0);
    await cards(page).first().getByRole("button").click();
    await expect(page).toHaveURL(/\/settings\/unsynced$/);
    await expect(page.locator('[data-outbox-status="failed"]')).toHaveCount(1);
    await restoreRules();
    await page.getByRole("button", { name: "ניסיון חוזר", exact: true }).click();
    await expect(page.locator("[data-outbox-op]")).toHaveCount(0);
    expect(await getDocument(path)).toMatchObject({ notes: "כרטיס שגיאת שמירה", odometer: before!.odometer,
      liters: before!.liters, totalCost: before!.totalCost, pricePerLiter: before!.pricePerLiter });
    await page.goto("/");
    await expect(cardOf(page, "write")).toHaveCount(0);
    await expect(cardOf(page, "best")).toHaveCount(1);
    expect(await listDocuments(`${scope.base}/fillups`)).toHaveLength(8);
  } finally { await restoreRules(); }
});

test("the monthly spotlight uses actual previous-month spending and appears only during the first seven days", async ({ page }) => {
  const today = new Date();
  const firstWeek = new Date(today.getFullYear(), today.getMonth(), 3, 12);
  await signedInWithData(page, { vehicle: HOME_CAR, fillups: [
    { id: "month-a", date: new Date(today.getFullYear(), today.getMonth() - 1, 5, 12), odometer: 100000, liters: 40, totalCost: 280 },
    { id: "month-b", date: new Date(today.getFullYear(), today.getMonth() - 1, 20, 12), odometer: 100500, liters: 40, totalCost: 280 },
  ] });
  await page.clock.setFixedTime(firstWeek);
  await page.reload();
  await expect(cardOf(page, "month")).toHaveCount(1);
  await expect(cardOf(page, "month")).toContainText("560\u202F₪");
  await cardOf(page, "month").getByRole("button").first().click();
  await expect(page).toHaveURL(/\/stats/);
  await page.clock.setFixedTime(new Date(today.getFullYear(), today.getMonth(), 8, 12));
  await page.goto("/");
  await expect(cardOf(page, "month")).toHaveCount(0);
});

for (const [theme, accent] of [["light", "plate"], ["light", "mint"], ["dark", "plate"], ["dark", "mint"]] as const) {
  test(`Home and every changed sheet match the v2 states at 390×844: ${theme}/${accent}`, async ({ page }) => {
    test.setTimeout(240000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const scope = await threeSpotlights(page);
    await homeAppearance(page, scope.uid, theme, accent);
    const suffix = `${theme}-${accent}`;
    const fieldMeasurements: Awaited<ReturnType<typeof fieldAccessibility>>[] = [];
    await expect(page.getByTestId("consumption-summary")).toBeVisible();
    await expect(cards(page)).toHaveCount(3);
    await capture(page, `home-history-${suffix}`, true);
    await capture(page, `home-spotlight-three-${suffix}`);
    await dismiss(page, cardOf(page, "reminder"));
    await dismiss(page, cardOf(page, "best"));
    await expect(cards(page)).toHaveCount(1);
    await capture(page, `home-spotlight-one-${suffix}`);
    await dismiss(page, cardOf(page, "price"));
    await expect(page.getByTestId("home-spotlight")).toHaveCount(0);
    await capture(page, `home-spotlight-zero-${suffix}`);

    const tank = await openTank(page);
    await focusedIn(tank);
    await expect(page.getByTestId("tank-expected")).toBeVisible();
    await expect(page.getByTestId("tank-recommended")).toBeVisible();
    await expect(page.getByTestId("tank-range")).toBeVisible();
    await size44(page.getByTestId("tank-save-gauge"));
    fieldMeasurements.push(await fieldAccessibility(tank.getByLabel("קילומטראז׳ (לא חובה)")));
    await capture(page, `home-tank-sheet-${suffix}`, true);
    for (let index = 0; index < 8; index++) { await page.keyboard.press("Tab"); await focusedIn(tank); }
    for (const [id, name] of [["tank-open-odometer", "odometer"], ["tank-open-trip", "trip"], ["tank-open-reserve", "reserve"], ["tank-open-habit", "habit"]]) {
      await page.getByTestId(id).click();
      const nested = page.getByRole("dialog").last();
      await focusedIn(nested);
      if (name === "odometer") fieldMeasurements.push(await fieldAccessibility(nested.getByLabel("קילומטראז׳ נוכחי")));
      if (name === "trip") fieldMeasurements.push(await fieldAccessibility(nested.getByLabel("מרווח ביטחון (לא חובה)")));
      await capture(page, `home-${name}-sheet-${suffix}`);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId(id)).toBeFocused();
    }
    await tank.getByRole("button", { name: /^איפוס פרופיל ההרגלים/ }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await capture(page, `home-habit-reset-${suffix}`);
    await page.keyboard.press("Escape");
    await tank.getByText("על מה מבוססת ההערכה", { exact: true }).click();
    await tank.getByText("על מה מבוססת ההערכה", { exact: true }).scrollIntoViewIfNeeded();
    await capture(page, `home-tank-assumptions-${suffix}`);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tank-hero")).toBeFocused();
    await page.getByTestId("consumption-point-home-7").click();
    await capture(page, `home-segment-sheet-${suffix}`);
    await page.keyboard.press("Escape");
    await page.getByTestId("consumption-details-open").click();
    await capture(page, `home-consumption-details-${suffix}`);
    await page.keyboard.press("Escape");
    await page.getByTestId("home-fuel-price").click();
    await expect(page.getByTestId("price-sheet")).toBeVisible();
    await capture(page, `home-price-sheet-${suffix}`);
    await page.getByRole("button", { name: "יש לך הנחה בתדלוק?", exact: true }).click();
    await capture(page, `home-price-discount-${suffix}`);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.getByTestId("recent-fillups-timeline").scrollIntoViewIfNeeded();
    await capture(page, `home-recent-${suffix}`);
    await page.goto("/history");
    await expect(page.locator('.ledger-row[data-collection="fillups"]')).toHaveCount(8);
    await capture(page, `home-shared-journal-${suffix}`, true);

    for (const kind of ["one-full", "no-fillups", "unknown", "low", "partial-only"] as const) {
      const state = await homeAlternative(scope, `state-${kind}`, kind);
      await page.goto("/");
      await homeSwitchVehicle(page, scope.uid, state.vehicleId);
      await expect(page.getByTestId("open-car-switch")).toContainText(`מצב ${kind}`);
      if (kind === "one-full") await expect(page.getByText("עוד תדלוק מלא אחד ונדע", { exact: true })).toBeVisible();
      if (kind === "no-fillups") {
        await expect(page.getByText("מתחילים מהתדלוק הבא", { exact: true })).toBeVisible();
        await dismissAll(page);
      }
      if (kind === "unknown") await expect(page.getByTestId("tank-headline")).toHaveText("כמה דלק יש עכשיו?");
      if (kind === "low") await expect(page.getByTestId("tank-hero")).toContainText("הדלק עומד להיגמר");
      if (kind === "partial-only") await expect(page.getByText("מתחילים בתדלוק עד הסוף", { exact: true })).toBeVisible();
      await capture(page, `home-${kind}-${suffix}`, kind === "no-fillups");
      if (kind === "unknown" || kind === "low") {
        await openTank(page);
        await capture(page, `home-tank-${kind}-sheet-${suffix}`);
        await page.keyboard.press("Escape");
      }
    }
    await homeSwitchVehicle(page, scope.uid, scope.vehicleId);
    await homeMixedRecent(scope);
    await page.goto("/");
    await page.getByTestId("recent-fillups-timeline").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("recent-fillups-timeline").getByTestId("journal-entry-observations/mixed-odometer")).toBeVisible();
    await expect(page.getByTestId("recent-fillups-timeline").getByTestId("journal-entry-serviceEvents/mixed-service")).toBeVisible();
    await expect(page.getByTestId("journal-entry-vehicleExpenses/mixed-refund")).toContainText("+11\u202F₪");
    await capture(page, `home-recent-mixed-${suffix}`);
    await page.goto("/history");
    await expect(page.getByTestId("journal-entry-serviceEvents/mixed-service")).toContainText("—");
    await capture(page, `home-journal-mixed-${suffix}`, true);

    const estimate = await homeAlternative(scope, "state-estimate", "one-full");
    await setDocument(estimate.base, { ...await getDocument(estimate.base), tankLitersSource: "estimate" });
    await page.goto("/");
    await homeSwitchVehicle(page, scope.uid, estimate.vehicleId);
    await openTank(page);
    await page.getByTestId("tank-capacity-prompt").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("tank-capacity-confirm")).toBeVisible();
    await capture(page, `home-capacity-sheet-${suffix}`);
    await page.keyboard.press("Escape");

    const incomplete = await homeAlternative(scope, "state-incomplete", "no-fillups");
    await setDocument(`${incomplete.base}/fillups/broken`, { date: "invalid", odometer: 100000, liters: 30, pricePerLiter: 7, totalCost: 210 });
    await homeSwitchVehicle(page, scope.uid, incomplete.vehicleId);
    await expect(page.getByTestId("home-history-incomplete")).toBeVisible();
    await expect(page.getByTestId("home-first-fillup")).toHaveCount(0);
    await dismissAll(page);
    await capture(page, `home-history-incomplete-${suffix}`);

    const unknownCost = await homeUnknownCost(page);
    await homeAppearance(page, unknownCost.uid, theme, accent);
    await page.getByTestId("consumption-point-cost-close").click();
    await expect(page.getByTestId("segment-cost-unknown")).toBeVisible();
    await capture(page, `home-segment-unknown-cost-${suffix}`);
    await writeFile(resolve(evidence, `home-field-accessibility-${suffix}.json`), JSON.stringify(fieldMeasurements, null, 2) + "\n");
  });
}
