import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { ALICE, signIn } from "./helpers/app";
import { captureJournal, journalEvidence, journalFixture, removeJournalDocument } from "./helpers/design-v2-journal";
import { homeAppearance } from "./helpers/design-v2-home";
import { getDocument, installRules, restoreRules, seedBenchmark, setDocument, waitForDocument } from "./helpers/emulator";
import { openInsightFuelDetail, selectInsight, selectInsightRange } from "./helpers/insights";
import { outboxCount } from "./helpers/pwa";

test.use({ viewport: { width: 390, height: 844 } });

async function units(page: Page, uid: string, value: "kmPerLiter" | "litersPer100") {
  await page.goto("/account");
  await page.getByRole("button", { name: /^יחידת צריכה/ }).click();
  await page.getByRole("radio", { name: value === "litersPer100" ? "ליטר ל-100 ק״מ" : "ק״מ לליטר", exact: true }).click();
  await expect.poll(() => outboxCount(page, uid)).toBe(0);
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ units: value });
}

async function peer(index: number) {
  // Two summaries deliberately share an owner: the count must be described
  // as vehicle summaries, never as a count of distinct human drivers.
  const id = index < 2 ? `shared-owner__vehicle-${index}` : `peer-${index}__vehicle-1`;
  await seedBenchmark(id, { modelKey: "מאזדה 3", fuelType: "95", avgKmPerLiter: [9, 10, 13, 14][index], avgPricePerLiter: 7.2 });
}

test("Insights keeps complete-history segments, exact paid rankings and net spending while a month selects only its closures", async ({ page }) => {
  const scope = await journalFixture(page);
  await page.goto("/stats?period=all");
  await expect(page.getByTestId("insights-consumption-average")).toContainText("11.9");
  await expect(page.getByTestId("insights-measured-km")).toContainText("1,840");
  await expect(page.getByTestId("insights-measured-liters")).toContainText("155.0");
  await expect(page.getByTestId("insights-best-segment")).toHaveAttribute("data-segment-end-id", "journal-best");
  await expect(page.getByTestId("insights-worst-segment")).toHaveAttribute("data-segment-end-id", "journal-last");
  await expect(page.getByTestId("insights-source-status")).toHaveCount(0);
  const points = page.getByTestId("insights-consumption-chart").getByRole("button");
  await expect(points).toHaveCount(4);
  // Read all targets in one layout snapshot; a Recharts render between
  // individual protocol box reads can detach an earlier transient element.
  const targets = await points.evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { x: box.x, width: box.width, height: box.height, centerHit: !!hit && element.contains(hit) };
  }));
  expect(targets[0].x).toBeGreaterThan(targets[3].x);
  for (const target of targets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.centerHit).toBe(true);
  }
  await points.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("segment-distance")).toContainText("600");
  await expect(page.getByTestId("segment-liters")).toContainText("45.0");
  await expect(page.getByTestId("segment-cost")).toContainText("328\u202F₪");
  await page.keyboard.press("Escape");
  await expect(points.first()).toBeFocused();
  const pointer = await points.last().evaluate(element => {
    const box = element.getBoundingClientRect();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, centerHit: !!hit && element.contains(hit) };
  });
  expect(pointer.centerHit).toBe(true);
  await page.mouse.click(pointer.x, pointer.y);
  await expect(page.getByTestId("segment-distance")).toContainText("360");
  await expect(page.getByTestId("segment-liters")).toContainText("40.0");
  await page.keyboard.press("Escape");
  await expect(points.last()).toBeFocused();
  // Openings from ordinary controls must not retain the preceding chart's
  // logical focus target; each returns to the actual control the user chose.
  const best = page.getByTestId("insights-best-segment");
  await best.click();
  await expect(page.getByTestId("segment-distance")).toContainText("480");
  await expect(page.getByTestId("segment-liters")).toContainText("30.0");
  await expect(page.getByTestId("segment-cost")).toContainText("240\u202F₪");
  await page.keyboard.press("Escape");
  await expect(best).toBeFocused();
  const table = page.getByTestId("insights-consumption-table");
  await table.locator("summary").click();
  const tableEntry = table.locator('tr[data-segment-end-id="journal-low"] button');
  await tableEntry.click();
  await expect(page.getByTestId("segment-distance")).toContainText("400");
  await expect(page.getByTestId("segment-liters")).toContainText("40.0");
  await expect(page.getByTestId("segment-cost")).toContainText("288\u202F₪");
  await page.keyboard.press("Escape");
  await expect(tableEntry).toBeFocused();
  await selectInsight(page, "price");
  // Stage 7 D6: the v3 quiet chart has no value axis; the first and last paid prices are printed at their points with the same format.
  const priceTicks = page.getByTestId("insights-price-chart").locator(".insights-price-point-label");
  await expect(priceTicks.first()).toBeVisible();
  const tickGeometry = await priceTicks.evaluateAll(ticks => ticks.map(tick => {
    const pieces = Array.from(tick.querySelectorAll("tspan"));
    const symbol = pieces.find(piece => piece.textContent === "₪")!;
    const digits = pieces.find(piece => /\d/.test(piece.textContent ?? ""))!;
    return { label: tick.textContent, smaller: parseFloat(getComputedStyle(symbol).fontSize) < parseFloat(getComputedStyle(digits).fontSize),
      // v3 §5: the symbol trails the digits ("7.35 ₪").
      right: symbol.getBoundingClientRect().left >= digits.getBoundingClientRect().right - .5 };
  }));
  for (const tick of tickGeometry) {
    expect(tick.label).toMatch(/^[\d,]+\.\d{2}\u202F₪$/);
    expect(tick).toMatchObject({ smaller: true, right: true });
  }

  await expect(page.getByTestId("insights-paid-average")).toContainText("7.36\u202F₪");
  await expect(page.getByTestId("insights-price-difference")).toContainText("0.41\u202F₪");
  await expect(page.getByTestId("insights-price-difference")).toContainText("פחות");
  const ranks = page.getByTestId("insights-station-ranking").locator("li");
  await expect(ranks).toHaveCount(3);
  await expect(ranks.first()).toHaveAttribute("data-station-key", "id:journal-paz");
  await expect(ranks.first()).toContainText("7.20\u202F₪");
  await expect(ranks.nth(1)).toContainText("7.33\u202F₪");
  await expect(ranks.last()).toContainText("7.54\u202F₪");
  await expect(page.getByTestId("insights-price-spread")).toContainText("0.34\u202F₪");
  await expect(page.getByTestId("insights-price-spread")).toContainText("17\u202F₪");
  await selectInsight(page, "spend");
  await expect(page.getByTestId("running-total")).toHaveText("1,567\u202F₪");
  await expect(page.getByTestId("insights-spend-coverage")).toContainText("1 רשומה ללא עלות מלאה");
  await expect(page.getByTestId("insights-fuel-cost-per-km")).toContainText("62 אג׳");
  await page.getByTestId("insights-spend-table").locator("summary").click();
  const previous = page.getByTestId("insights-spend-table").locator(`tr[data-month="${scope.firstMonth}"]`);
  const recent = page.getByTestId("insights-spend-table").locator(`tr[data-month="${scope.lastMonth}"]`);
  await expect(previous.locator("td")).toHaveText(["628\u202F₪", "123\u202F₪", "0\u202F₪", "0\u202F₪", "751\u202F₪"]);
  await expect(recent.locator("td")).toHaveText(["808\u202F₪", "0\u202F₪", "19\u202F₪", "−11\u202F₪", "816\u202F₪"]);
  await page.getByTestId("insights-journal-expense").click();
  await expect(page.getByTestId("journal-filter-expense")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ledger-total")).toHaveText("8\u202F₪");
  await expect(page.locator(".ledger-row")).toHaveCount(2);

  // The month of the first closing fill still includes the earlier opening
  // tank and partial in its canonical 600 / 45 segment.
  await page.goto(`/stats?tab=cons&month=${scope.firstMonth}`);
  await expect(page.getByTestId("insights-consumption-average")).toContainText("13.3");
  await expect(page.getByTestId("insights-measured-km")).toContainText("600");
  await expect(page.getByTestId("insights-measured-liters")).toContainText("45.0");
  await units(page, scope.uid, "litersPer100");
  await page.goto(`/stats?tab=cons&month=${scope.firstMonth}`);
  await expect(page.getByTestId("insights-consumption-average")).toContainText("7.5");
  await expect(page.getByTestId("insights-consumption-chart")).toHaveAccessibleName(/ל׳\/100 ק״מ/);
  await expect(page.getByTestId("insights-best-segment")).toContainText("7.5");
});

test("a missing fuel amount stays unknown in cost per km and charts; a different fuel never inherits the 95 reference", async ({ page }) => {
  const scope = await journalFixture(page);
  const missingPath = `${scope.base}/fillups/journal-last`;
  const original = (await getDocument(missingPath))!;
  await setDocument(missingPath, { ...original, date: new Date(Number(original.date)), createdAt: new Date(Number(original.createdAt)), totalCost: null, pricePerLiter: null });
  await page.goto("/stats?tab=spend&period=all");
  await expect(page.getByTestId("running-total")).toHaveText("1,287\u202F₪");
  await expect(page.getByTestId("insights-fuel-cost-per-km")).toContainText("—");
  await expect(page.getByTestId("insights-spend-coverage")).toContainText("2 רשומות ללא עלות מלאה");
  await selectInsight(page, "price");
  await expect(page.getByTestId("insights-paid-average")).toContainText("7.46\u202F₪");
  await page.getByTestId("insights-price-table").locator("summary").click();
  await expect(page.getByTestId("insights-price-table").locator('tr[data-fillup-id="journal-last"] td').first()).toHaveText("—");
  const vehicle = (await getDocument(scope.base))!;
  await setDocument(scope.base, { ...vehicle, createdAt: new Date(Number(vehicle.createdAt)), fuelType: "98", manualPricePerLiter: null });
  const otherPath = `${scope.base}/fillups/journal-best`, other = (await getDocument(otherPath))!;
  await setDocument(otherPath, { ...other, date: new Date(Number(other.date)), createdAt: new Date(Number(other.createdAt)), fuelType: "98", pricePerLiter: 7.11, totalCost: 213.3 });
  await page.reload();
  await expect(page.getByTestId("insights-paid-average")).toContainText("7.11\u202F₪");
  await expect(page.getByTestId("insights-price-difference")).toHaveCount(0);
  await expect(page.getByTestId("insights-panel-price")).toContainText("אין מחיר להשוואה מתועד לסוג הדלק");
  await expect(page.getByTestId("insights-station-ranking").locator("li")).toHaveCount(1);
  expect((await getDocument(missingPath))?.totalCost).toBeNull();
});

test("comparison waits for four vehicle summaries, states percentile direction truthfully and removes own sharing on opt-out", async ({ page }) => {
  const scope = await journalFixture(page, false);
  for (let index = 0; index < 3; index++) await peer(index);
  await page.goto("/stats?tab=community");
  await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "insufficient");
  await expect(page.getByTestId("insights-community-progress")).toHaveAttribute("aria-valuenow", "3");
  await expect(page.getByTestId("insights-community-status")).toContainText("עוד סיכום רכב אחד ונשווה");
  await peer(3);
  await page.reload();
  await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "ready");
  await expect(page.getByTestId("insights-community-status")).toContainText("4 סיכומי רכבים");
  await expect(page.getByTestId("insights-community-status")).toContainText("50% מהסיכומים מצביעים על צריכת דלק גבוהה משלך לק״מ");
  await page.getByRole("button", { name: "מה כולל סיכום ההשוואה", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "מה כולל סיכום ההשוואה", exact: true })).toContainText("אינו אנונימי");
  await page.keyboard.press("Escape");
  const published = await waitForDocument("benchmarks", data => data.vehicleId === scope.vehicleId);
  expect(await getDocument(`benchmarks/${scope.uid}__${scope.vehicleId}`)).toEqual(published);
  expect(published).not.toHaveProperty("plateNumber");
  expect(published).not.toHaveProperty("station");
  expect(published).not.toHaveProperty("odometer");
  await units(page, scope.uid, "litersPer100");
  await page.goto("/stats?tab=community");
  await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "ready");
  await expect(page.getByTestId("insights-community-status")).toContainText("50% מהסיכומים מצביעים על צריכת דלק גבוהה משלך לק״מ");
  await page.goto("/account");
  await page.getByRole("switch", { name: "שיתוף סיכום דלק להשוואה", exact: true }).click();
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  await page.goto("/stats?tab=community");
  await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "off");
  await expect(page.getByTestId("insights-community-distribution")).toHaveCount(0);
  expect((await getDocument(`users/${scope.uid}`))?.settings).toMatchObject({ shareBenchmarks: false });
  await expect.poll(() => getDocument(`benchmarks/${scope.uid}__${scope.vehicleId}`)).toBeNull();
});

test("malformed and denied fill-up history cannot publish a partial benchmark or imply a new vehicle and zero annual fuel spend", async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  const scope = await journalFixture(page, false);
  const malformedPath = `${scope.base}/fillups/unreadable`;
  const malformed = { date: "broken-date", odometer: 101850, liters: 30, totalCost: 210, pricePerLiter: 7 };
  const benchmarkPath = `benchmarks/${scope.uid}__${scope.vehicleId}`;
  await setDocument(malformedPath, malformed);
  await page.goto("/stats?tab=community&period=all");
  await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "history-unavailable");
  await expect(page.getByTestId("insights-community-status")).toContainText("חלק מהתדלוקים אינם זמינים לקריאה");
  expect(await getDocument(benchmarkPath)).toBeNull();
  await selectInsight(page, "cons");
  await expect(page.getByTestId("insights-source-status")).toBeVisible();
  await expect(page.getByTestId("insights-panel-cons")).toContainText("צריכה בתדלוקים הזמינים");
  await expect(page.getByTestId("insights-open-segment")).toHaveCount(0);
  await selectInsight(page, "spend");
  await expect(page.getByTestId("insights-spend-ytd")).toHaveText("—"); // v3: facts strip (was a KPI tile in the fuel detail)
  expect(await getDocument(benchmarkPath)).toBeNull();
  expect(await getDocument(malformedPath)).toEqual(malformed);
  await captureJournal(page, "insights-malformed-history-light-plate");

  const originalRules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  let replaced = 0;
  const denied = originalRules.replace(/(match \/fillups\/\{fillupId\}\s*\{\s*)allow read: if isOwner\(uid\);/, (_match, prefix: string) => {
    replaced += 1; return `${prefix}allow read: if false;`;
  });
  expect(replaced).toBe(1);
  await installRules(denied);
  const isolatedContext = await browser.newContext({ baseURL, locale: "he-IL", timezoneId: "Asia/Jerusalem", viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  try {
    const isolated = await isolatedContext.newPage();
    await signIn(isolated, ALICE);
    await isolated.goto("/stats?tab=community&period=all");
    await expect(isolated.getByTestId("insights-community-status")).toHaveAttribute("data-state", "history-unavailable");
    await expect(isolated.getByTestId("insights-community-status")).not.toContainText("עוד קצת מדידה");
    await selectInsight(isolated, "cons");
    await expect(isolated.getByTestId("insights-panel-cons")).toContainText("נתוני הצריכה עדיין אינם זמינים");
    await expect(isolated.getByTestId("insights-panel-cons").getByRole("link", { name: /תדלוק/ })).toHaveCount(0);
    await selectInsight(isolated, "price");
    await expect(isolated.getByTestId("insights-panel-price")).toContainText("נתוני המחירים עדיין אינם זמינים");
    await selectInsight(isolated, "spend");
    await expect(isolated.getByTestId("insights-spend-ytd")).toHaveText("—"); // v3: facts strip
    await captureJournal(isolated, "insights-denied-history-light-plate");
    expect(await getDocument(benchmarkPath)).toBeNull();
    expect(await getDocument(malformedPath)).toEqual(malformed);
  } finally { await isolatedContext.close(); await restoreRules(); }
  await removeJournalDocument(malformedPath);
  await page.goto("/stats?period=all");
  await expect(page.getByTestId("insights-source-status")).toHaveCount(0);
  await expect(page.getByTestId("insights-consumption-average")).toContainText("11.9");
  await expect.poll(() => getDocument(benchmarkPath)).toMatchObject({ avgKmPerLiter: 11.87, segments: 4 });
  const firstPublication = (await getDocument(benchmarkPath))!;
  // Keep this Statistics session mounted. An Account round trip would reset
  // the hook and hide an incorrect last-published cache during unavailable data.
  await setDocument(malformedPath, malformed);
  await expect(page.getByTestId("insights-source-status")).toBeVisible();
  await selectInsight(page, "community");
  await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "history-unavailable");
  const ownerPath = `users/${scope.uid}`, owner = (await getDocument(ownerPath))!;
  const settings = owner.settings as Record<string, unknown>;
  await setDocument(ownerPath, { ...owner, settings: { ...settings, shareBenchmarks: false } });
  await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "off");
  await expect.poll(() => getDocument(benchmarkPath)).toBeNull();
  await setDocument(ownerPath, { ...owner, settings: { ...settings, shareBenchmarks: true } });
  await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "history-unavailable");
  expect(await getDocument(benchmarkPath)).toBeNull();
  expect(await getDocument(malformedPath)).toEqual(malformed);
  await removeJournalDocument(malformedPath);
  await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "insufficient");
  await expect.poll(() => getDocument(benchmarkPath)).toMatchObject({ avgKmPerLiter: 11.87, segments: 4 });
  expect(Number((await getDocument(benchmarkPath))!.updatedAt)).toBeGreaterThan(Number(firstPublication.updatedAt));
});

test("cached history withholds comparison and annual totals until a fresh server snapshot can update the complete benchmark", async ({ page, context }) => {
  test.setTimeout(90_000);
  const scope = await journalFixture(page, false);
  await homeAppearance(page, scope.uid, "dark", "mint");
  await page.goto("/stats?period=all");
  await expect(page.getByTestId("insights-consumption-average")).toContainText("11.9");
  const benchmarkPath = `benchmarks/${scope.uid}__${scope.vehicleId}`;
  await expect.poll(() => getDocument(benchmarkPath)).toMatchObject({ avgKmPerLiter: 11.87, segments: 4 });
  const published = await getDocument(benchmarkPath);
  await context.setOffline(true);
  try {
    await selectInsight(page, "community");
    await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "history-unavailable", { timeout: 20_000 });
    await expect(page.getByTestId("insights-community-status")).toContainText("נתוני התדלוקים עוד לא אומתו בענן");
    await expect(page.getByTestId("insights-community-distribution")).toHaveCount(0);
    await captureJournal(page, "insights-cached-comparison-dark-mint");
    const lastPath = `${scope.base}/fillups/journal-last`, last = (await getDocument(lastPath))!;
    await setDocument(lastPath, { ...last, date: new Date(Number(last.date)), createdAt: new Date(Number(last.createdAt)), liters: 20, totalCost: 140 });
    await selectInsight(page, "spend");
    await selectInsightRange(page, "מתחילת השנה");
    await expect(page.getByTestId("insights-spend-ytd")).toHaveText("—"); // v3: facts strip
    expect(await getDocument(benchmarkPath)).toEqual(published);
  } finally { await context.setOffline(false); }
  await expect(page.getByTestId("insights-source-status")).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(() => getDocument(benchmarkPath)).toMatchObject({ avgKmPerLiter: 13.63, segments: 4 });
  await selectInsight(page, "cons");
  await expect(page.getByTestId("insights-consumption-average")).toContainText("13.6");
});

for (const theme of ["light", "dark"] as const) for (const accent of ["plate", "mint"] as const) {
  test(`Insights cards, sheets and charts evidence: ${theme}/${accent}`, async ({ page }) => {
    test.setTimeout(150_000);
    const scope = await journalFixture(page);
    for (let index = 0; index < 3; index++) await peer(index);
    await homeAppearance(page, scope.uid, theme, accent);
    await page.goto("/stats?period=all");
    const capture = (name: string, full = false) => captureJournal(page, `${name}-${theme}-${accent}`, full);
    const typography: Record<string, unknown>[] = [];
    const displayNumber = async (id: string) => {
      const style = await page.getByTestId(id).locator("bdi").first().evaluate(element => {
        const computed = getComputedStyle(element);
        return { fontFamily: computed.fontFamily, fontWeight: computed.fontWeight, fontSize: computed.fontSize, direction: computed.direction, isolation: computed.unicodeBidi };
      });
      expect(style.fontFamily, id).toContain("Karantina");
      expect(style.fontWeight, id).toBe("400"); // v3 §1: Karantina 400
      typography.push({ id, ...style });
    };
    await expect(page.getByTestId("insights-consumption-average")).toContainText("11.9");
    await expect(page.getByTestId("insights-source-status")).toHaveCount(0);
    await displayNumber("insights-consumption-average");
    await capture("insights-consumption", true);
    await page.getByTestId("insights-consumption-table").locator("summary").click();
    await capture("insights-consumption-table");
    await page.getByTestId("insights-best-segment").click();
    await expect(page.getByTestId("segment-distance")).toContainText("480");
    await capture("insights-segment");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "בסיס החישוב", exact: true }).click();
    await capture("insights-basis");
    await page.keyboard.press("Escape");
    await selectInsight(page, "price");
    await expect(page.getByTestId("insights-paid-average")).toContainText("7.36\u202F₪");
    await displayNumber("insights-paid-average");
    const priceDots = page.getByTestId("insights-price-chart").locator(".recharts-line-dots circle");
    await expect(priceDots).toHaveCount(scope.fills.length);
    const pricePaint = await priceDots.evaluateAll(elements => elements.map(element => {
      const circle = element as SVGCircleElement;
      const svg = circle.ownerSVGElement!;
      const box = circle.getBoundingClientRect(), viewport = svg.getBoundingClientRect();
      const matrix = circle.getScreenCTM()!;
      const halfStroke = parseFloat(getComputedStyle(circle).strokeWidth) / 2;
      // getBoundingClientRect excludes the painted stroke. Include its actual
      // transformed extent so an enlarged endpoint cannot be clipped by the SVG.
      const strokeX = halfStroke * Math.hypot(matrix.a, matrix.c);
      const strokeY = halfStroke * Math.hypot(matrix.b, matrix.d);
      return {
        left: box.left - strokeX, right: box.right + strokeX,
        top: box.top - strokeY, bottom: box.bottom + strokeY,
        viewport: { left: viewport.left, right: viewport.right, top: viewport.top, bottom: viewport.bottom },
      };
    }));
    for (const painted of pricePaint) {
      expect(painted.left - painted.viewport.left).toBeGreaterThanOrEqual(-0.1);
      expect(painted.viewport.right - painted.right).toBeGreaterThanOrEqual(-0.1);
      expect(painted.top - painted.viewport.top).toBeGreaterThanOrEqual(-0.1);
      expect(painted.viewport.bottom - painted.bottom).toBeGreaterThanOrEqual(-0.1);
    }
    await capture("insights-prices", true);
    await page.getByTestId("insights-price-table").locator("summary").click();
    await capture("insights-price-table");
    await selectInsight(page, "spend");
    await expect(page.getByTestId("running-total")).toContainText("1,567\u202F₪");
    await displayNumber("running-total");
    await displayNumber("insights-fuel-cost-per-km");
    await capture("insights-spend", true);
    await page.getByTestId("insights-spend-table").locator("summary").click();
    await capture("insights-spend-table");
    const detail = await openInsightFuelDetail(page);
    await detail.getByRole("radio", { name: "שבועי", exact: true }).click();
    await capture("insights-spend-detail", true);
    await selectInsight(page, "community");
    await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "insufficient");
    await capture("insights-community-waiting");
    await peer(3);
    await page.reload();
    await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "ready");
    await capture("insights-community-ready", true);
    await page.getByRole("button", { name: "מה כולל סיכום ההשוואה", exact: true }).click();
    await capture("insights-community-privacy");
    await page.keyboard.press("Escape");
    await units(page, scope.uid, "litersPer100");
    await page.goto("/stats?period=all");
    await expect(page.getByTestId("insights-consumption-average")).toContainText("8.4");
    await expect(page.getByTestId("insights-source-status")).toHaveCount(0);
    await capture("insights-liters-per-100");
    await page.goto("/account");
    await page.getByRole("switch", { name: "שיתוף סיכום דלק להשוואה", exact: true }).click();
    await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
    await page.goto("/stats?tab=community");
    await expect(page.getByTestId("insights-community-status")).toHaveAttribute("data-state", "off");
    await capture("insights-community-off");
    writeFileSync(`${journalEvidence}/insights-typography-${theme}-${accent}.json`, JSON.stringify(typography, null, 2));
    writeFileSync(`${journalEvidence}/insights-price-paint-${theme}-${accent}.json`, JSON.stringify(pricePaint, null, 2));
  });
}
