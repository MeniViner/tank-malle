import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { getDocument, listDocuments, seedRegulatedPrice, seedVehicle, setDocument } from "./helpers/emulator";
import { chooseNamedStation, fillupFixture, FILLUP_CAR, FILLUP_DAY, newServerFillup, setFillupDay, typeFillup } from "./helpers/design-v2-fillup";
import { finishFillupSave, openFillupMore, openFillupTankAdvanced, setFillupEndState } from "./helpers/fillup";
import { homeAppearance, homeSwitchVehicle } from "./helpers/design-v2-home";
import { outboxCount } from "./helpers/pwa";
import { fillupDraftKey } from "../src/lib/fillupDraft";
import { shekel } from "../src/lib/format";

const stage = process.env.DESIGN_V2_STAGE;
const evidence = resolve(stage ? `design/v2/evidence/stage-${stage}` : "test-results/design-v2");
test.use({ viewport: { width: 390, height: 844 } });

async function capture(page: Page, name: string, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, `${name}.png`), animations: "disabled" });
  if (fullPage) await page.screenshot({ path: resolve(evidence, `${name}-full.png`), animations: "disabled", fullPage: true });
}

async function target44(target: Locator) {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

async function focusState(page: Page, state: string) {
  return page.evaluate(state => {
    const active = document.activeElement;
    const saved = document.querySelector('[data-testid="fillup-saved"]');
    return { kind: "focus", state, tag: active?.tagName, id: active?.id,
      testId: active?.getAttribute("data-testid"), name: active?.getAttribute("aria-label"),
      text: active?.textContent?.slice(0, 160),
      insideSaved: !!saved && !!active && saved.contains(active) };
  }, state);
}

async function keyboardVisibility(page: Page, state: string) {
  return page.evaluate(state => {
    const active = document.activeElement!;
    const box = active.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { kind: "keyboard-visibility", state, tag: active.tagName, text: active.textContent?.slice(0, 100),
      testId: active.getAttribute("data-testid"), x: box.x, y: box.y, width: box.width, height: box.height,
      hitTag: hit?.tagName, hitTestId: hit?.getAttribute("data-testid"), hitClass: hit?.className,
      unobscured: hit === active || !!hit && active.contains(hit),
      hiddenByFooter: !!hit?.closest(".fillup-bottom-bar"), viewportHeight: innerHeight };
  }, state);
}

async function controlMeasurement(target: Locator, label: string) {
  await target44(target);
  await target.focus();
  if (await target.evaluate(element => element.tagName === "BUTTON")) {
    // Programmatic focus inherits pointer modality. Exercise actual keyboard
    // navigation before asserting a button's :focus-visible indicator.
    await target.page().keyboard.press("Tab");
    await target.page().keyboard.press("Shift+Tab");
    await expect(target).toBeFocused();
  }
  return target.evaluate((element, label) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const pickerOverlay = element.tagName === "BUTTON" && hit instanceof HTMLInputElement
      && ["date", "time"].includes(hit.type) && hit.parentElement === element.parentElement;
    const own = getComputedStyle(element);
    const parent = getComputedStyle(element.parentElement!);
    let ancestor = element.parentElement;
    let outlinedAncestor = null;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) {
        outlinedAncestor = { tag: ancestor.tagName, className: ancestor.className,
          dateField: ancestor.getAttribute("data-datetime-field"), outline: style.outlineStyle,
          outlineColor: style.outlineColor, outlineWidth: style.outlineWidth };
        break;
      }
      ancestor = ancestor.parentElement;
    }
    return { kind: "control", label, tag: element.tagName, width: box.width, height: box.height,
      unobscured: hit === element || !!hit && element.contains(hit) || pickerOverlay,
      outline: own.outlineStyle, outlineColor: own.outlineColor, outlineWidth: own.outlineWidth,
      inputBoxShadow: own.boxShadow, outlinedAncestor,
      parentOutline: parent.outlineStyle, parentOutlineColor: parent.outlineColor,
      parentOutlineWidth: parent.outlineWidth, parentBoxShadow: parent.boxShadow, borderColor: parent.borderColor };
  }, label);
}

async function importedEditFixture(page: Page, overrides: Record<string, unknown> = {}) {
  const scope = await fillupFixture(page, { history: "baseline" });
  const path = `${scope.collection}/fillup-baseline`;
  const original: Record<string, unknown> = { ...await getDocument(path), pricePerLiter: 7.185, totalCost: 287.4001234567,
    fuelType: "95", postedPricePerLiter: 7.77, station: { name: "תחנה היסטורית", stationId: "historic-station", brand: "פז" },
    importSource: "legacy-xlsx", importBatchId: "original-batch", importRowHash: "original-row",
    preFillLevel: .2, preFillLevelSource: "imported-legacy", preFillLevelUncertainty: .12,
    postFillLevel: .8, postFillLevelSource: "imported-legacy", postFillLevelUncertainty: .18,
    fillEndState: "unknown", fillEndStateSource: "legacy-assumption", fullTankSource: "legacy-assumption",
    capacityLitersAtEntry: 50, refuelReason: "routine", tankSchemaVersion: 2, isFullTank: false,
    notes: "שומרים את המקור בדיוק", ...overrides };
  await setDocument(path, { ...original, date: new Date(Number(original.date)), createdAt: new Date(Number(original.createdAt)) });
  // The editor deliberately keeps its immutable opening snapshot. Observe
  // this external fixture update in the live Home row before opening it.
  const row = page.getByTestId("journal-entry-fillups/fillup-baseline");
  await expect(row.locator(".tm-journal-title")).toHaveText("תחנה היסטורית");
  await expect(row.locator(".tm-journal-money")).toHaveText(shekel(Number(original.totalCost)));
  await page.goto("/fillup/fillup-baseline");
  await expect(page.getByTestId("fillup-total")).toHaveValue(String(original.totalCost));
  return { scope, path, original };
}

async function savedEdit(page: Page, uid: string, path: string) {
  await page.getByTestId("fillup-save").click();
  await expect(page).toHaveURL("/");
  await expect.poll(() => outboxCount(page, uid)).toBe(0);
  return (await getDocument(path))!;
}

async function draftTank(page: Page, key: string) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null")?.data?.tankDraft, key);
}

test("Save exposes invalid input and the real inclusive odometer range without discarding the draft", async ({ page }) => {
  const scope = await fillupFixture(page, { history: "closed" });
  await page.goto("/fillup/new");
  await expect(page.getByTestId("fillup-total")).toBeFocused();
  const save = page.getByTestId("fillup-save");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByTestId("fillup-liters")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("fillup-odometer")).toHaveAttribute("aria-invalid", "true");
  expect(await listDocuments(scope.collection)).toHaveLength(2);

  await setFillupDay(page, scope.now - 10 * FILLUP_DAY);
  await typeFillup(page, { odometer: 99999, liters: 25, price: 7, total: 175, end: "full" });
  await save.click();
  const caption = page.locator("#fillup-odometer-caption");
  await expect(caption).toContainText("הזינו בין");
  await expect(caption.locator("bdi")).toHaveText(["100,000", "100,300"]);
  await expect(page.getByTestId("fillup-total")).toHaveValue("175");
  expect(await listDocuments(scope.collection)).toHaveLength(2);
  await page.getByTestId("fillup-odometer").fill("100301");
  await save.click();
  await expect(caption).toContainText("100,300");
  // Both endpoints are inclusive. The final saved middle value is also in
  // range; neither a soft consumption warning nor the prior error may block it.
  for (const boundary of ["100000", "100300"]) {
    await page.getByTestId("fillup-odometer").fill(boundary);
    await expect(page.getByTestId("fillup-odometer")).not.toHaveAttribute("aria-invalid", "true");
  }
  await page.getByTestId("fillup-odometer").fill("100150");
  await save.click();
  await finishFillupSave(page);
  expect((await newServerFillup(scope, 100150)).data).toMatchObject({ liters: 25, pricePerLiter: 7, totalCost: 175 });
  expect(await listDocuments(scope.collection)).toHaveLength(3);
});

test("manual receipt figures survive live price changes, soft conflict, reload and exact server storage", async ({ page }) => {
  const scope = await fillupFixture(page, { history: "none" });
  await page.goto("/fillup/new");
  await page.getByTestId("fillup-liters").fill("40");
  await page.getByTestId("fillup-total").fill("300.00497");
  await expect(page.getByTestId("fillup-price")).toHaveValue("7.5");
  await seedRegulatedPrice(8.31);
  await expect(page.getByTestId("fillup-total")).toHaveValue("300.00497");
  await expect(page.getByTestId("fillup-liters")).toHaveValue("40");
  await expect(page.getByTestId("fillup-price")).toHaveValue("7.5");
  await page.getByTestId("fillup-price").fill("7.4");
  await expect(page.getByTestId("fillup-receipt-conflict")).toBeVisible();
  await page.getByTestId("fillup-odometer").fill("100000");
  await setFillupEndState(page, "full");
  await page.getByTestId("fillup-total").fill("500");
  await page.getByTestId("fillup-save").click();
  await expect(page.getByTestId("fillup-total")).toHaveAttribute("aria-invalid", "true");
  expect(await listDocuments(scope.collection)).toHaveLength(0);
  await page.getByTestId("fillup-total").fill("300.00497");
  await page.reload();
  await expect(page.getByTestId("fillup-total")).toHaveValue("300.00497");
  await expect(page.getByTestId("fillup-liters")).toHaveValue("40");
  await expect(page.getByTestId("fillup-price")).toHaveValue("7.4");
  await expect(page.getByTestId("fillup-receipt-conflict")).toBeVisible();
  await page.getByTestId("fillup-save").click();
  await finishFillupSave(page);
  const saved = await newServerFillup(scope, 100000);
  expect(saved.data).toMatchObject({ liters: 40, pricePerLiter: 7.4, totalCost: 300.00497 });
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
});

for (const amount of [
  { name: "high precision", price: 7.185, total: 287.4001234567 },
  { name: "known zero total", price: 7.185, total: 0 },
  { name: "known zero price and total", price: 0, total: 0 },
]) test(`an unchanged ${amount.name} edit preserves every original receipt and tank field`, async ({ page }) => {
  const scope = await fillupFixture(page, { history: "baseline" });
  const path = `${scope.collection}/fillup-baseline`;
  const original = { ...await getDocument(path), pricePerLiter: amount.price, totalCost: amount.total,
    fuelType: "95", postedPricePerLiter: 7.77, station: { name: "תחנה היסטורית", stationId: "historic-station", brand: "פז" },
    importSource: "legacy-xlsx", importBatchId: "original-batch", importRowHash: "original-row",
    preFillLevel: .2, preFillLevelSource: "imported-legacy", postFillLevel: .8,
    postFillLevelSource: "imported-legacy", fillEndState: "unknown", fillEndStateSource: "legacy-assumption",
    tankSchemaVersion: 2, isFullTank: false, notes: "שומרים את המקור בדיוק" };
  await setDocument(path, { ...original, date: new Date(Number(original.date)), createdAt: new Date(Number(original.createdAt)) });
  const row = page.getByTestId("journal-entry-fillups/fillup-baseline");
  await expect(row.locator(".tm-journal-title")).toHaveText("תחנה היסטורית");
  await expect(row.locator(".tm-journal-money")).toHaveText(shekel(amount.total));
  await page.goto("/fillup/fillup-baseline");
  await expect(page.getByTestId("fillup-total")).toHaveValue(String(amount.total));
  await expect(page.getByTestId("fillup-price")).toHaveValue(String(amount.price));
  await expect(page.getByTestId("fillup-liters")).toHaveValue("40");
  await openFillupTankAdvanced(page);
  await expect(page.getByRole("slider", { name: "כמה דלק נשאר לפני התדלוק" })).toHaveValue("0.2");
  await expect(page.getByRole("meter", { name: "מצב המיכל אחרי התדלוק" })).toHaveAttribute("aria-valuetext", "80%");
  await page.getByTestId("fillup-save").click();
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("fillup-saved")).toHaveCount(0);
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  const after = (await getDocument(path))!;
  for (const [key, value] of Object.entries(original)) expect(after[key], key).toEqual(value);
  expect(after.version).toBe(1);
  expect(after.writeId).toMatch(/\.1$/);
  expect(await listDocuments(scope.collection)).toHaveLength(1);
});

test("editing a note preserves the historical refuel reason and all original physical tank evidence", async ({ page }) => {
  const { scope, path, original } = await importedEditFixture(page);
  await openFillupMore(page);
  await page.getByTestId("fillup-notes").fill("הערה מעודכנת בלבד");
  const after = await savedEdit(page, scope.uid, path);
  for (const [key, value] of Object.entries({ ...original, notes: "הערה מעודכנת בלבד" })) expect(after[key], key).toEqual(value);
  expect(await listDocuments(scope.collection)).toHaveLength(1);
});

test("clearing gauges preserves the hidden historical refuel reason and exact receipt", async ({ page }) => {
  const { scope, path, original } = await importedEditFixture(page);
  await openFillupTankAdvanced(page);
  await page.getByRole("button", { name: "ניקוי המדים", exact: true }).click();
  const after = await savedEdit(page, scope.uid, path);
  expect(after.preFillLevel).toBeNull();
  for (const key of ["refuelReason", "pricePerLiter", "totalCost", "liters", "postedPricePerLiter", "notes"]) {
    expect(after[key], key).toEqual(original[key]);
  }
  expect(await listDocuments(scope.collection)).toHaveLength(1);
});

test("returning tank answers to their opening values survives draft reload without replacing imported provenance", async ({ page }) => {
  const { scope, path, original } = await importedEditFixture(page);
  await openFillupTankAdvanced(page);
  const before = page.getByRole("slider", { name: "כמה דלק נשאר לפני התדלוק" });
  await before.press("Home");
  await before.press("ArrowUp");
  await expect(before).toHaveValue("0.05");
  await before.press("Home");
  await before.press("PageUp");
  await expect(before).toHaveValue("0.2");
  const full = page.getByRole("radio", { name: "מילאתי עד הסוף", exact: true });
  await full.click();
  await expect(full).toHaveAttribute("aria-checked", "true");
  await full.click();
  await expect(full).toHaveAttribute("aria-checked", "false");
  const key = fillupDraftKey(scope.uid, scope.vehicleId, "fillup-baseline");
  // A complete return to the opening values correctly clears a pristine
  // draft. Keep an unrelated note change so the physical reset also crosses
  // a genuine draft restoration boundary.
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  await page.getByTestId("fillup-notes").fill("טיוטה עם מצב המיכל המקורי");
  await expect.poll(() => draftTank(page, key))
    .toMatchObject({ beforeLevel: .2, afterLevelOverride: null, endChoice: null, confirmedFull: false, reason: "routine" });
  await page.reload();
  await openFillupTankAdvanced(page);
  await expect(before).toHaveValue("0.2");
  await expect(full).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("fillup-notes")).toHaveValue("טיוטה עם מצב המיכל המקורי");
  await page.getByTestId("fillup-notes").fill(String(original.notes));
  const after = await savedEdit(page, scope.uid, path);
  for (const [key, value] of Object.entries(original)) expect(after[key], key).toEqual(value);
});

test("a deliberately changed physical tank answer survives draft reload and becomes direct evidence", async ({ page }) => {
  const { scope, path, original } = await importedEditFixture(page);
  await openFillupMore(page);
  const before = page.getByRole("slider", { name: "כמה דלק נשאר לפני התדלוק" });
  await before.press("Home");
  await before.press("ArrowUp");
  await before.press("ArrowUp");
  await expect(before).toHaveValue("0.1");
  await expect.poll(() => draftTank(page, fillupDraftKey(scope.uid, scope.vehicleId, "fillup-baseline")))
    .toMatchObject({ beforeLevel: .1, reason: "routine" });
  await page.reload();
  await openFillupTankAdvanced(page);
  await expect(before).toHaveValue("0.1");
  const after = await savedEdit(page, scope.uid, path);
  expect(after).toMatchObject({ preFillLevel: .1, preFillLevelSource: "direct-gauge", postFillLevelSource: "derived-after-partial",
    fillEndState: "partial", fillEndStateSource: "gauge-estimate", capacityLitersAtEntry: 50, refuelReason: "routine" });
  expect(after.postFillLevel).toBeCloseTo(.9, 10);
  for (const key of ["date", "createdAt", "odometer", "liters", "pricePerLiter", "totalCost", "station", "fuelType",
    "postedPricePerLiter", "importSource", "importBatchId", "importRowHash", "notes"]) expect(after[key], key).toEqual(original[key]);
});

test("a quantity-only edit refreshes derived after-level using its stored capacity revision", async ({ page }) => {
  const { scope, path, original } = await importedEditFixture(page, {
    liters: 20, pricePerLiter: 7, totalCost: 140, capacityLitersAtEntry: 40,
    fillEndState: "partial", fillEndStateSource: "user-confirmed", fullTankSource: "user",
    preFillLevel: .2, preFillLevelSource: "direct-gauge", preFillLevelUncertainty: .12,
    postFillLevel: .7, postFillLevelSource: "derived-after-partial", postFillLevelUncertainty: .08,
  });
  await page.getByTestId("fillup-liters").fill("24");
  await page.getByTestId("fillup-total").fill("168");
  await openFillupTankAdvanced(page);
  await expect(page.getByRole("meter", { name: "מצב המיכל אחרי התדלוק" })).toHaveAttribute("aria-valuetext", "80%");
  const after = await savedEdit(page, scope.uid, path);
  expect(after).toMatchObject({ liters: 24, pricePerLiter: 7, totalCost: 168, capacityLitersAtEntry: 40,
    preFillLevel: .2, preFillLevelSource: "direct-gauge", preFillLevelUncertainty: .12,
    fillEndState: "partial", fillEndStateSource: "user-confirmed", fullTankSource: "user",
    postFillLevelSource: "derived-after-partial", refuelReason: "routine" });
  expect(after.postFillLevel).toBeCloseTo(.8, 10);
  expect(Number(after.postFillLevelUncertainty)).toBeGreaterThan(.12);
  for (const key of ["date", "createdAt", "odometer", "station", "fuelType", "postedPricePerLiter", "importSource",
    "importBatchId", "importRowHash", "notes"]) expect(after[key], key).toEqual(original[key]);
});

test("missing and null legacy prices stay unknown on edit instead of becoming authored zero", async ({ page }) => {
  const scope = await fillupFixture(page, { history: "baseline" });
  const original = (await getDocument(`${scope.collection}/fillup-baseline`))!;
  for (const missing of ["absent", "null"] as const) {
    const id = `legacy-price-${missing}`;
    const path = `${scope.collection}/${id}`;
    const raw: Record<string, unknown> = { ...original, date: scope.now - (missing === "absent" ? 2 : 1) * FILLUP_DAY,
      notes: "מחיר שלא נרשם ברשומה הישנה" };
    if (missing === "absent") delete raw.pricePerLiter;
    else raw.pricePerLiter = null;
    await setDocument(path, { ...raw, date: new Date(Number(raw.date)), createdAt: new Date(Number(raw.createdAt)) });
    await page.goto("/");
    await expect(page.getByTestId(`journal-entry-fillups/${id}`)).toBeVisible();
    await page.goto(`/fillup/${id}`);
    await expect(page.getByTestId("fillup-price")).toHaveValue("");
    await openFillupMore(page);
    await expect(page.getByTestId("fillup-price")).toHaveValue("");
    await page.getByTestId("fillup-save").click();
    await expect(page.getByTestId("fillup-price")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("fillup-form")).toBeVisible();
    expect(await getDocument(path)).toEqual(raw);
    await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  }
});

test("Saved uses the closed canonical partial-inclusive segment and responds to the account unit", async ({ page }) => {
  const scope = await fillupFixture(page);
  await page.goto("/fillup/new");
  await typeFillup(page, { end: "full" });
  await expect(page.getByTestId("fillup-live-preview")).toContainText("13.3");
  await page.getByTestId("fillup-save").click();
  const saved = page.getByTestId("fillup-saved");
  await expect(saved.getByTestId("fillup-saved-segment")).toContainText("13.3");
  await expect(saved.getByText("המקטע", { exact: true }).locator("..")).toContainText("600");
  await expect(saved.getByText("המקטע", { exact: true }).locator("..")).toContainText("45.0");
  await expect(saved.getByText("עלות לק״מ", { exact: true }).locator("..")).toContainText("53");
  await expect(saved.getByText("עלות לק״מ", { exact: true }).locator("..")).toContainText("אג׳");
  const user = (await getDocument(`users/${scope.uid}`))!;
  await setDocument(`users/${scope.uid}`, { ...user, settings: { ...user.settings as Record<string, unknown>, units: "litersPer100" } });
  await expect(saved.getByTestId("fillup-saved-segment")).toContainText("7.5");
  await expect(saved.getByTestId("fillup-saved-segment")).toContainText("ל׳ ל-100 ק״מ");
  await expect(saved.getByTestId("fillup-saved-segment").locator("bdi").first()).toHaveCSS("text-align", "right");
  expect((await newServerFillup(scope, 100600)).data).toMatchObject({ liters: 25, totalCost: 175 });
});

test("edit deletion Undo restores the same document, immutable receipt and creation identity", async ({ page }) => {
  const scope = await fillupFixture(page, { history: "baseline" });
  const path = `${scope.collection}/fillup-baseline`;
  const original = (await getDocument(path))!;
  await page.goto("/fillup/fillup-baseline");
  await page.getByTestId("fillup-delete").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "מחיקה", exact: true }).click();
  await expect(page.getByText("התדלוק נמחק", { exact: true })).toBeVisible();
  expect(await getDocument(path)).toBeNull();
  await page.getByRole("button", { name: "שחזור", exact: true }).click();
  await expect.poll(() => getDocument(path)).toMatchObject(original);
  expect(await listDocuments(scope.collection)).toHaveLength(1);
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
});

test("a delayed geolocation result cannot overwrite the station manually chosen while it was pending", async ({ page }) => {
  const scope = await fillupFixture(page, { history: "none" });
  await page.addInitScript(() => {
    const callbacks: PositionCallback[] = [];
    Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
      configurable: true, value: (success: PositionCallback) => { callbacks.push(success); },
    });
    (window as Window & { pendingLocations?: PositionCallback[] }).pendingLocations = callbacks;
  });
  await page.route("**/fuel-stations.json", route => route.fulfill({ json: {
    count: 1, companies: ["פז"], stations: [{ i: "automatic-geolocation", n: "תחנה אוטומטית מאוחרת", c: "פז", a: "בדיקה", lat: 32, lng: 34.8 }],
  } }));
  await page.goto("/fillup/new");
  await expect.poll(() => page.evaluate(() => (window as Window & { pendingLocations?: PositionCallback[] }).pendingLocations?.length)).toBe(1);
  const chosen = "תחנה שבחרתי בעצמי";
  await chooseNamedStation(page, chosen);
  await page.evaluate(async () => {
    const callback = (window as Window & { pendingLocations?: PositionCallback[] }).pendingLocations![0];
    await callback({ coords: { latitude: 32, longitude: 34.8, accuracy: 1, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition);
  });
  await expect(page.getByTestId("fillup-station")).toContainText(chosen);
  await expect(page.getByTestId("fillup-station")).not.toContainText("לפי מיקום");
  await typeFillup(page, { odometer: 100000 });
  await page.getByTestId("fillup-save").click();
  await finishFillupSave(page);
  expect((await newServerFillup(scope, 100000)).data.station).toEqual({ name: chosen });
});

for (const theme of ["light", "dark"] as const) for (const accent of ["plate", "mint"] as const) {
  test(`fill-up and Saved evidence at 390×844 ${theme}/${accent}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const scope = await fillupFixture(page);
    await homeAppearance(page, scope.uid, theme, accent);
    const suffix = `${theme}-${accent}`;
    await page.goto("/fillup/new");
    await expect(page.getByTestId("fillup-price")).toHaveValue("7.77");
    await capture(page, `fillup-empty-${suffix}`);
    const measurements = [];
    const saveMeasurements = () => writeFile(resolve(evidence, `fillup-input-accessibility-${suffix}.json`), JSON.stringify(measurements, null, 2));
    for (const id of ["fillup-total", "fillup-liters", "fillup-price", "fillup-odometer"]) {
      const field = page.getByTestId(id);
      await target44(field);
      await field.evaluate(input => input.blur());
      const borders = await field.evaluate(input => [input, input.closest(".tm-pump-value")!, input.closest(".tm-pump-row")!]
        .map(element => getComputedStyle(element).border));
      await field.focus();
      const measurement = await field.evaluate(input => {
        const box = input.getBoundingClientRect();
        const row = input.closest(".tm-pump-row")!;
        const value = input.closest(".tm-pump-value")!;
        const unit = value.querySelector(".tm-pump-unit")!;
        const unitBox = unit.getBoundingClientRect();
        const placeholder = getComputedStyle(input, "::placeholder");
        return { id: input.id, width: box.width, height: box.height, textAlign: getComputedStyle(input).textAlign,
          dir: input.getAttribute("dir"), placeholder: placeholder.color, placeholderOpacity: placeholder.opacity,
          focusOutline: getComputedStyle(row).outlineStyle, focusShadow: getComputedStyle(row).boxShadow,
          inputOutline: getComputedStyle(input).outlineStyle, inputOutlineWidth: getComputedStyle(input).outlineWidth,
          inputOutlineColor: getComputedStyle(input).outlineColor, inputOutlineOffset: getComputedStyle(input).outlineOffset,
          inputBoxShadow: getComputedStyle(input).boxShadow,
          frames: [input, value, row].map(element => ({ border: getComputedStyle(element).border,
            outline: getComputedStyle(element).outlineStyle, shadow: getComputedStyle(element).boxShadow })),
          unitCount: value.querySelectorAll(".tm-pump-unit").length,
          unit: unit.textContent, unitLeft: unitBox.right <= box.left + .5 };
      });
      measurements.push(measurement);
      expect(measurement.unitCount, id).toBe(1);
      expect(measurement.unitLeft, id).toBe(true);
      expect(measurement.unit, id).toBe(({ "fillup-total": "₪", "fillup-liters": "ל׳", "fillup-price": "₪", "fillup-odometer": "ק״מ" })[id]);
      expect(measurement.frames.map(frame => frame.border), id).toEqual(borders);
      for (const frame of measurement.frames) expect(frame, id).toMatchObject({ outline: "none", shadow: "none" });
      await expect(field).toHaveAttribute("dir", "ltr");
      const original = await field.inputValue();
      await field.pressSequentially("מילים");
      await expect(field).toHaveValue(original);
      await field.fill("123שלום");
      await expect(field).toHaveValue(original);
    }
    await page.getByTestId("fillup-save").click();
    await expect(page.getByTestId("fillup-odometer")).toHaveAttribute("aria-invalid", "true");
    await capture(page, `fillup-error-${suffix}`);
    await typeFillup(page, { end: "full" });
    await expect(page.getByTestId("fillup-live-preview")).toContainText("13.3");
    await capture(page, `fillup-typed-${suffix}`);
    await typeFillup(page, { odometer: 102000, liters: 60, price: 7, end: "full" });
    await expect(page.getByTestId("fillup-soft-warning").first()).toBeVisible();
    await capture(page, `fillup-soft-warning-${suffix}`);
    await typeFillup(page, { end: "full" });
    await openFillupMore(page);
    const before = page.getByRole("slider", { name: "כמה דלק נשאר לפני התדלוק" });
    await target44(before);
    await before.press("Home"); await before.press("PageUp"); await before.press("ArrowUp");
    await page.getByTestId("fillup-notes").fill("הנתונים מהקבלה, לפני הנסיעה");
    await capture(page, `fillup-more-${suffix}`, true);
    await page.keyboard.press("Tab");
    const advancedVisibility = await keyboardVisibility(page, "notes-to-advanced");
    measurements.push(advancedVisibility);
    await saveMeasurements();
    await expect(page.getByTestId("fillup-tank-advanced").locator("summary")).toBeFocused();
    expect(advancedVisibility).toMatchObject({ unobscured: true, hiddenByFooter: false });
    await page.keyboard.press("Tab");
    const importVisibility = await keyboardVisibility(page, "advanced-to-import");
    measurements.push(importVisibility);
    await saveMeasurements();
    await expect(page.getByTestId("fillup-import-receipt")).toBeFocused();
    expect(importVisibility).toMatchObject({ unobscured: true, hiddenByFooter: false });
    await openFillupTankAdvanced(page);
    await capture(page, `fillup-advanced-${suffix}`, true);
    await page.getByTestId("fillup-date").click();
    const dateDialog = page.getByRole("dialog", { name: "תאריך ושעה", exact: true });
    for (const label of ["תאריך — הקלדה ידנית", "שעה — הקלדה ידנית", "בחירת תאריך מהמכשיר", "בחירת שעה מהמכשיר", "פתיחת לוח השנה", "פתיחת בורר השעה"]) {
      const measurement = await controlMeasurement(dateDialog.getByLabel(label, { exact: true }), label);
      measurements.push(measurement);
      expect(measurement.unobscured, label).toBe(true);
      if (label.includes("הקלדה ידנית") || label.includes("בחירת תאריך") || label.includes("בחירת שעה")) {
        expect(measurement, label).toMatchObject({ outline: "none", inputBoxShadow: "none", parentOutline: "none", parentBoxShadow: "none" });
        expect(measurement.outlinedAncestor, label).toBeNull();
      } else {
        const outline = measurement.outline === "solid" ? measurement : measurement.outlinedAncestor;
        expect(outline?.outline, label).toBe("solid");
        expect(parseFloat(outline?.outlineWidth ?? "0"), label).toBeGreaterThanOrEqual(2);
      }
    }
    measurements.push(await page.evaluate(() => ({ kind: "reduced-motion", reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      elements: [".tm-sheet-panel", ".fillup-disclosure", ".fillup-chevron-open", '[data-testid="fillup-save"]'].map(selector => {
        const node = document.querySelector(selector)!;
        const style = getComputedStyle(node);
        return { selector, animation: style.animationDuration, transition: style.transitionDuration };
      }) })));
    await capture(page, `fillup-date-${suffix}`);
    await page.keyboard.press("Tab");
    expect(await dateDialog.evaluate(dialog => dialog.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("fillup-date")).toBeFocused();
    await page.getByTestId("fillup-station").click();
    const stationDialog = page.getByRole("dialog", { name: "תחנת דלק", exact: true });
    await stationDialog.getByRole("textbox", { name: "חיפוש תחנה", exact: true }).fill("פז");
    measurements.push(await controlMeasurement(stationDialog.getByRole("textbox", { name: "חיפוש תחנה", exact: true }), "חיפוש תחנה"));
    await expect(stationDialog.getByRole("button", { name: /^פז/ }).first()).toBeVisible();
    await capture(page, `fillup-station-${suffix}`);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("fillup-station")).toBeFocused();
    await saveMeasurements();
    await page.getByTestId("fillup-save").click();
    await expect(page.getByTestId("fillup-saved-segment")).toContainText("13.3");
    await expect(page.getByRole("heading", { name: "נשמר", exact: true })).toBeFocused();
    await expect(page.locator(".fillup-saved-number")).toHaveCSS("font-family", /Karantina/);
    await expect(page.locator(".fillup-saved-number")).toHaveCSS("font-weight", "700");
    measurements.push(await focusState(page, "saved-entry"));
    await capture(page, `fillup-saved-segment-${suffix}`, true);
    await page.getByTestId("fillup-saved-undo").focus();
    measurements.push(await focusState(page, "undo-focused"));
    await expect(page.getByTestId("fillup-pump-no")).toBeEnabled();
    await expect(page.getByTestId("fillup-saved-done")).toBeFocused();
    measurements.push(await focusState(page, "undo-expired"));
    await page.getByTestId("fillup-pump-no").click();
    await expect(page.getByTestId("fillup-pump-price")).toBeFocused();
    measurements.push(await focusState(page, "different-price-opened"));
    await page.getByTestId("fillup-pump-price").fill("7.77");
    const pumpPrice = await controlMeasurement(page.getByTestId("fillup-pump-price"), "המחיר במשאבה");
    measurements.push(pumpPrice);
    expect(pumpPrice).toMatchObject({ outline: "none", inputBoxShadow: "none", parentOutline: "none", parentBoxShadow: "none", unobscured: true });
    expect(pumpPrice.outlinedAncestor).toBeNull();
    await target44(page.getByTestId("fillup-pump-confirm"));
    await capture(page, `fillup-pump-different-${suffix}`);
    await page.getByTestId("fillup-pump-confirm").click();
    await expect(page.getByTestId("fillup-pump-confirmed")).toBeVisible();
    await expect(page.getByTestId("fillup-pump-confirmed")).toBeFocused();
    measurements.push(await focusState(page, "different-price-accepted"));
    await capture(page, `fillup-pump-confirmed-${suffix}`);
    await saveMeasurements();
    await finishFillupSave(page);
    const saved = await newServerFillup(scope, 100600);
    await page.goto(`/fillup/${saved.id}`);
    await expect(page.getByTestId("fillup-total")).toHaveValue("175");
    await capture(page, `fillup-edit-${suffix}`, true);
    await page.getByTestId("fillup-delete").click();
    await capture(page, `fillup-delete-${suffix}`);
    await page.getByRole("alertdialog").getByRole("button", { name: "ביטול", exact: true }).click();
    await page.goto("/");
    await seedVehicle(scope.uid, "first-full", { ...FILLUP_CAR, model: "רכב חדש" });
    await homeSwitchVehicle(page, scope.uid, "first-full");
    await page.goto("/fillup/new");
    await typeFillup(page, { odometer: 200000, liters: 40, end: "full" });
    await page.getByTestId("fillup-save").click();
    await expect(page.getByTestId("fillup-saved-open")).toHaveAttribute("data-outcome", "baseline");
    await capture(page, `fillup-saved-first-full-${suffix}`, true);
    await finishFillupSave(page);
    await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
    await page.goto("/fillup/new");
    await typeFillup(page, { odometer: 200300, liters: 20, end: "partial" });
    await page.getByTestId("fillup-save").click();
    await expect(page.getByTestId("fillup-saved-open")).toHaveAttribute("data-outcome", "partialRetained");
    await capture(page, `fillup-saved-partial-${suffix}`, true);
    await finishFillupSave(page);
    await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
    await saveMeasurements();
  });
}
