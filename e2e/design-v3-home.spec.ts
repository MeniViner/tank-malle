import { expect, test, type Locator } from "@playwright/test";
import { signedInWithData } from "./helpers/app";
import { getDocument, setDocument } from "./helpers/emulator";
import { HOME_CAR, homeAppearance, homeFixture } from "./helpers/design-v2-home";
import { outboxCount } from "./helpers/pwa";
import { lowContrast } from "./helpers/contrast";

/**
 * Design v3 Stage 2 — Home (DESIGN-V3 §2/§3/§4). Behavioural coverage of the
 * existing Home stays in design-v2-home / home-cost-insights / tco / tank specs.
 */

test.use({ viewport: { width: 390, height: 844 } });

async function fontSize(target: Locator) {
  return target.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
}
async function size44(target: Locator) {
  const box = await target.boundingBox();
  expect(box?.height, "target height").toBeGreaterThanOrEqual(44);
  expect(box?.width, "target width").toBeGreaterThanOrEqual(44);
}
const shekels = (text: string) => Number(text.replace(/[^\d.]/g, ""));


test("v3 Home: order, 64 > 56 > 44 size hierarchy, facts strip, avatar ring, TCO toggle and legend", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const scope = await homeFixture(page);

  await expect(page.getByTestId("tco-card")).toBeVisible();
  await expect(page.getByTestId("recent-fillups-timeline")).toBeVisible();
  // Order (§2): status → spotlight → facts → cost → consumption → next refuel → recent.
  const order = await page.getByTestId("home-page").evaluate(root => ["home-status", "home-facts", "tco-card", "consumption-summary", "tank-hero", "recent-fillups-timeline"]
    .map(id => root.querySelector(`[data-testid="${id}"]`)).map((element, index, all) => !!element && (index === 0 || !!(all[index - 1]!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))));
  expect(order).toEqual([true, true, true, true, true, true]);

  // Size hierarchy is a rule: cost 64 > consumption 56 > next refuel 44 > everything else.
  const cost = page.getByTestId("tco-card").locator(".tm-tco-value");
  const consumption = page.locator(".home-consumption-value > .tm-number");
  const next = page.getByTestId("tank-headline");
  await expect(next).not.toHaveClass(/tm-tank-headline-small/);
  expect(await fontSize(cost)).toBe(64);
  expect(await fontSize(consumption)).toBe(56);
  expect(await fontSize(next)).toBe(44);
  const largestOther = await page.getByTestId("home-page").evaluate(root => {
    const heroes = [root.querySelector("[data-testid=tco-card] .tm-tco-value"), root.querySelector(".home-consumption-value > .tm-number"), root.querySelector("[data-testid=tank-headline]")];
    let max = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement!;
      if (!node.textContent?.trim() || heroes.some(hero => hero?.contains(element)) || element.closest(".sr-only")) continue;
      max = Math.max(max, Number.parseFloat(getComputedStyle(element).fontSize));
    }
    return max;
  });
  expect(largestOther).toBeLessThan(44);

  // Header avatar: 2.5px accent ring open at about half past ten (rotate 252deg reads back as -108).
  const ring = page.getByTestId("avatar-ring");
  await expect(ring.locator("circle")).toHaveAttribute("stroke-dasharray", "112 132");
  const ringStyle = await ring.evaluate(svg => ({ transform: getComputedStyle(svg).transform, stroke: getComputedStyle(svg.querySelector("circle")!).strokeWidth,
    color: getComputedStyle(svg.querySelector("circle")!).stroke, accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() }));
  const angle = Math.round(Math.atan2(Number(ringStyle.transform.split(/[(,]/)[2]), Number(ringStyle.transform.split(/[(,]/)[1])) * 180 / Math.PI);
  expect(angle).toBe(-108);
  expect(ringStyle.stroke).toBe("2.5px");
  await size44(page.getByTestId("open-account"));

  // Status line: no cards → "all fine" (the refuel variant is covered by the trip test).
  await expect(page.getByTestId("home-spotlight")).toHaveCount(0);
  await expect(page.getByTestId("home-status")).toHaveText(/^הכל תקין/);
  expect(await fontSize(page.getByTestId("home-status"))).toBe(15);

  // Facts strip (§3): three receipt rows, buttons ≥44px, Plex Mono 22 values with 12px units.
  const facts = page.getByTestId("home-facts");
  await expect(facts.locator(":scope > .fact")).toHaveCount(3);
  await expect(facts.locator(":scope > button.fact")).toHaveCount(3);
  await expect(facts.locator(".fl").nth(0)).toContainText("נוסע ביום");
  await expect(facts.locator(".fl").nth(1)).toContainText(/^דלק ב/);
  await expect(facts.locator(".fl").nth(2)).toContainText("בנזין 95 היום");
  await expect(page.getByTestId("home-fuel-price")).toContainText("7.77 ₪");
  await expect(page.getByTestId("home-fuel-price")).toContainText("לליטר");
  for (const row of await facts.locator(":scope > .fact").all()) {
    await size44(row);
    const value = row.locator(".fv > .n");
    expect(await value.evaluate(element => getComputedStyle(element).fontFamily)).toContain("IBM Plex Mono");
    expect(await fontSize(value)).toBe(22);
  }
  expect(await fontSize(facts.locator(".fv > u").first())).toBe(12);
  expect(await facts.evaluate(element => [getComputedStyle(element).borderTopStyle, getComputedStyle(element).borderBottomStyle])).toEqual(["solid", "solid"]);
  expect(await facts.locator(":scope > .fact").nth(1).evaluate(element => getComputedStyle(element).borderTopStyle)).toBe("dashed");

  // TCO: chip flips number, legend and sub-line; card opens the sheet on the chosen period.
  const card = page.getByTestId("tco-card");
  const legend = card.getByTestId("tco-legend").locator("[data-tco-legend]");
  const bar = card.getByTestId("tco-bar").locator("i");
  await expect(legend).toHaveCount(await bar.count());
  const monthAmounts = (await legend.locator("strong").allInnerTexts()).map(shekels);
  expect(monthAmounts).toEqual([...monthAmounts].sort((a, b) => b - a));
  const monthValue = await cost.innerText();
  const yearInSub = shekels((await card.getByTestId("tco-sub").innerText()).split("·")[0]);
  const chip = card.getByTestId("tco-period");
  await size44(chip);
  await expect(chip).toHaveAccessibleName(/בחודש/);
  await chip.click();
  await expect(card).toHaveAttribute("data-period", "year");
  await expect(chip).toHaveAccessibleName(/בשנה/);
  expect(shekels(await cost.innerText())).toBe(yearInSub);
  await expect(card.getByTestId("tco-sub")).toContainText("בחודש");
  expect(shekels((await card.getByTestId("tco-sub").innerText()).split("·")[0])).toBe(shekels(monthValue));
  const yearAmounts = (await legend.locator("strong").allInnerTexts()).map(shekels);
  yearAmounts.forEach((amount, index) => expect(Math.abs(amount - monthAmounts[index] * 12)).toBeLessThanOrEqual(12));
  await card.click({ position: { x: 30, y: 20 } });
  await expect(page.getByTestId("tco-sheet")).toBeVisible();
  await expect(page.getByRole("radio", { name: "בשנה", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(card.getByRole("button", { name: "כמה הרכב עולה לך", exact: true })).toBeFocused();
  await chip.click();
  await expect(card).toHaveAttribute("data-period", "month");

  // Consumption: ⓘ beside the label, coloured comparison text (no pill), quiet chart.
  const info = page.getByTestId("consumption-details-open");
  await size44(info);
  const label = page.getByTestId("consumption-summary").locator(".home-consumption-heading .home-label");
  const [labelBox, infoBox] = [await label.boundingBox(), await info.boundingBox()];
  expect(labelBox!.x - (infoBox!.x + infoBox!.width)).toBeLessThan(12);
  const comparison = page.getByTestId("consumption-comparison");
  await expect(comparison.locator(".tm-pill")).toHaveCount(0);
  expect(await comparison.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  const chart = page.getByTestId("consumption-chart");
  await expect(chart.locator(".tm-sparkline-value")).toHaveCount(6);
  await expect(chart.locator(".tm-sparkline-date")).toHaveCount(2);
  await expect(chart.locator(".tm-sparkline-legend")).toHaveCount(0);
  await expect(chart.locator("figcaption > span").first()).toHaveText("6 תדלוקים אחרונים");
  await expect(chart.locator("figcaption > span").last()).toContainText("הרגיל שלך 12.4");
  await info.click();
  await expect(page.getByTestId("consumption-details-sheet")).toBeVisible();
  await page.keyboard.press("Escape");

  // Next refuel: a light card (no ink slab), caption "במיכל כ־…", footer basis + "עדכון ›".
  const hero = page.getByTestId("tank-hero");
  const colors = await hero.evaluate(element => ({ bg: getComputedStyle(element).backgroundColor,
    surface: getComputedStyle(document.body).getPropertyValue("--surface") }));
  expect(colors.bg).toBe("rgb(255, 255, 255)");
  await expect(hero.locator(".tm-tank-gauge-caption")).toContainText(/^במיכל כ־\d+%/);
  await expect(page.getByTestId("tank-hero-update")).toHaveText("עדכון ›");
  await size44(page.getByTestId("tank-hero-update"));
  // "עדכון" opens the odometer sheet directly, without the tank sheet behind it.
  await page.getByTestId("tank-hero-update").click();
  await expect(page.getByTestId("tank-odometer-sheet")).toBeVisible();
  await expect(page.getByTestId("tank-sheet")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tank-odometer-sheet")).toHaveCount(0);
  const habit = hero.locator(".tm-gauge-habit-labelled em");
  if (await habit.count()) {
    await expect(habit).toHaveText(/כאן (בד״כ מתדלקים|לפי ההעדפה שלך)/);
    const used = await hero.locator(".tm-gauge-tick-use").count();
    const filled = await hero.locator(".tm-gauge-tick-filled").count();
    expect(used).toBeLessThanOrEqual(filled);
  }

  // Recent: two rows and "היומן המלא ›".
  const recent = page.getByTestId("recent-fillups-timeline");
  await expect(recent.locator(".ledger-row")).toHaveCount(2);
  await recent.getByRole("link", { name: "היומן המלא ›" }).click();
  await expect(page).toHaveURL(/\/history$/);

  // Contrast ≥ 4.5:1 for Home text, light then dark.
  await page.goto("/");
  await expect(page.getByTestId("tco-card")).toBeVisible();
  expect(await lowContrast(page, "[data-testid=home-page]")).toEqual([]);
  await homeAppearance(page, scope.uid, "dark", "plate");
  await expect(page.getByTestId("tco-card")).toBeVisible();
  expect(await lowContrast(page, "[data-testid=home-page]")).toEqual([]);
  expect(await page.getByTestId("tank-hero").evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe("rgb(21, 19, 15)");
});

test("v3 facts: a month without fill-ups shows the previous month with data, never 0 ₪", async ({ page }) => {
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 12, 12);
  const earlier = new Date(now.getFullYear(), now.getMonth() - 1, 3, 12);
  await signedInWithData(page, { vehicle: HOME_CAR, regulatedPrice: 7.77, fillups: [
    { id: "a", date: earlier, odometer: 100000, liters: 40, pricePerLiter: 7.5, totalCost: 300 },
    { id: "b", date: previous, odometer: 100500, liters: 40, pricePerLiter: 7.5, totalCost: 310.4 },
  ] });
  await page.goto("/");
  const month = page.getByTestId("home-fuel-month");
  const name = new Intl.DateTimeFormat("he-IL", { month: "long" }).format(previous);
  await expect(month).toContainText(`דלק ב${name}`);
  await expect(month).toContainText("610 ₪");
  await expect(month).not.toContainText(/(?<![\d,.])0\s₪/);
  await month.click();
  await expect(page).toHaveURL(/\/stats\?tab=spend/);
});

test("v3 spotlight: a planned trip that pulls the refuel forward asks to refuel before it and opens the tank sheet", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const scope = await homeFixture(page);
  await expect(page.locator('[data-spotlight-type="trip"]')).toHaveCount(0);
  await page.getByTestId("tank-hero").click();
  await page.getByTestId("tank-open-trip").click();
  await page.getByTestId("tank-trip-distance").fill("900");
  await page.getByRole("radio", { name: "מחר", exact: true }).click();
  await page.getByTestId("tank-save-trip").click();
  await expect(page.getByTestId("tank-trip-sheet")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  const trip = page.locator('[data-spotlight-type="trip"]');
  await expect(trip).toHaveCount(1);
  await expect(trip).toContainText("כדאי לתדלק לפני הנסיעה");
  await expect(trip).toContainText("900 ק״מ");
  // Cards present → the status line carries the refuel timing and tank level instead of "all fine".
  await expect(page.getByTestId("home-status")).toHaveAttribute("data-status", "refuel");
  await expect(page.getByTestId("home-status")).toContainText(/תדלוק (היום|מחר|בעוד \d+ ימים) · במיכל כ־\d+%/);
  await trip.locator(".tm-spotlight-open").click();
  await expect(page.getByTestId("tank-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  const id = await trip.getAttribute("data-spotlight-id");
  await trip.getByTestId(`spotlight-dismiss-${id}`).click();
  await expect(page.locator('[data-spotlight-type="trip"]')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("tco-card")).toBeVisible();
  await expect(page.locator('[data-spotlight-type="trip"]')).toHaveCount(0);
});

test("v3 facts on an EV: electricity month and per-100 km, no fuel price row", async ({ page }) => {
  const scope = await homeFixture(page);
  await setDocument(scope.base, { ...await getDocument(scope.base), powertrain: "ev", battery: { kwh: 64, wltp: 450 } });
  const facts = page.getByTestId("home-facts");
  await expect(facts.locator(".fl").nth(1)).toContainText(/^חשמל ב/);
  await expect(page.getByTestId("home-energy-100")).toContainText("חשמל ל-100 ק״מ");
  await expect(page.getByTestId("home-energy-100").locator(".fv > .n")).toHaveText(/^\d[\d,]*\s₪$/);
  await expect(page.getByTestId("home-fuel-price")).toHaveCount(0);
});
