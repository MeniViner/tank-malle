import { expect, type Locator, type Page } from "@playwright/test";
import { signedInWithData, type ReadyAccount } from "./app";
import { BROWSER_TIME_ZONE, getDocument, listDocuments } from "./emulator";
import { HOME_CAR } from "./design-v2-home";
import { journalRawFields, replaceJournalRawFields, type RawFields } from "./design-v2-journal";
import { outboxCount } from "./pwa";

export const VEHICLE_COVERAGE = "הנתונים חלקיים או ממתינים לאישור מהשרת. הסכום כולל רק עלויות ידועות.";
export const DOC_TITLES = { test: "טסט שנתי", mandatory: "ביטוח חובה", coverage: "ביטוח רכב" } as const;
export type DocKey = keyof typeof DOC_TITLES;
export interface VehicleFixture extends ReadyAccount { base: string; original: RawFields; today: string }

/** Civil dates follow the same real browser zone; no Firebase clock is mocked. */
export function vehicleDayOffset(offset = 0): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: BROWSER_TIME_ZONE }).format(new Date());
  return new Date(new Date(`${today}T12:00:00Z`).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}
export const displayDay = (day: string) => day.split("-").reverse().join("/");

/** JSON fixture fields only. Existing Firestore fields remain byte-for-byte raw. */
export function fixtureField(value: unknown): Record<string, unknown> {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(fixtureField) } };
  if (value && typeof value === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, fixtureField(child)])) } };
  throw new Error("Unsupported JSON fixture value");
}

/** Observe the changed parent before opening any immutable document editor. */
export async function replaceVehicleFixture(page: Page, scope: ReadyAccount, patch: Record<string, unknown>, marker: string) {
  const base = `users/${scope.uid}/vehicles/${scope.vehicleId}`;
  const original = (await journalRawFields(base))!;
  const fields = { ...original, ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, fixtureField(value)])), nickname: fixtureField(marker) };
  await replaceJournalRawFields(base, fields);
  await page.goto("/");
  await expect(page.getByTestId("open-car-switch")).toContainText(marker);
  await page.getByTestId("tab-vehicle").click();
  await expect(page.getByRole("region", { name: "הרכב שלי", exact: true })).toBeVisible();
  await expect(page.getByText(VEHICLE_COVERAGE, { exact: true })).toHaveCount(0);
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  return fields;
}

export async function vehicleFixture(page: Page, docs?: unknown, history = true): Promise<VehicleFixture> {
  const today = vehicleDayOffset();
  const scope = await signedInWithData(page, { vehicle: HOME_CAR,
    fillups: history ? [
      { id: "vehicle-start", date: new Date(`${vehicleDayOffset(-14)}T10:00:00Z`), odometer: 100000, liters: 40, totalCost: 287.4001234567, pricePerLiter: 7.185 },
      { id: "vehicle-last", date: new Date(`${vehicleDayOffset(-1)}T10:00:00Z`), odometer: 100500, liters: 40, totalCost: 280, pricePerLiter: 7 },
    ] : [] });
  const original = await replaceVehicleFixture(page, scope, {
    plateNumber: "7248078", declaredSource: "user", ...(docs !== undefined ? { docs } : {}),
  }, "מסמכי בדיקה");
  return { ...scope, base: `users/${scope.uid}/vehicles/${scope.vehicleId}`, original, today };
}

export async function openVehicleDoc(page: Page, key: DocKey) {
  await page.getByTestId(`vehicle-doc-${key}`).click();
  const dialog = page.getByRole("dialog", { name: DOC_TITLES[key], exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("vehicle-doc-form")).toHaveAttribute("data-doc-key", key);
  return dialog;
}

export async function documentSaved(page: Page, scope: VehicleFixture, expected: unknown) {
  await page.getByTestId("vehicle-doc-save").click();
  await expect(page.getByTestId("vehicle-doc-form")).toHaveCount(0);
  await expect.poll(async () => (await getDocument(scope.base))?.docs).toEqual(expected);
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
}

export async function assertNoDocumentExpenses(scope: VehicleFixture, fillups = 2) {
  expect(await listDocuments(`${scope.base}/fillups`)).toHaveLength(fillups);
  expect(await listDocuments(`${scope.base}/serviceEvents`)).toHaveLength(0);
  expect(await listDocuments(`${scope.base}/vehicleExpenses`)).toHaveLength(0);
}

/** Wait for finite sheet motion without scrolling, focusing or relaxing 44px. */
export async function vehicleTarget(target: Locator) {
  await target.evaluate(async element => {
    const finite: Animation[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      finite.push(...node.getAnimations().filter(animation => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))));
    }
    await Promise.allSettled(finite.map(animation => animation.finished));
  });
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  return box!;
}

/** Actual numeric control geometry: RTL columns at 390px, ordered stack at 320px. */
export async function vehicleFieldPair(first: Locator, second: Locator, stacked = false) {
  const measure = (target: Locator) => target.evaluate(element => {
    const box = element.closest(".tm-field-control")!.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
  });
  const [one, two] = await Promise.all([measure(first), measure(second)]);
  if (stacked) {
    expect(two.y).toBeGreaterThanOrEqual(one.bottom);
    expect(Math.abs(one.x - two.x)).toBeLessThanOrEqual(1);
  } else {
    expect(Math.abs(one.y - two.y)).toBeLessThanOrEqual(1);
    expect(one.x - two.right).toBeGreaterThanOrEqual(8);
    expect(Math.abs(one.width - two.width)).toBeLessThanOrEqual(1);
  }
  return { stacked, first: one, second: two };
}

/** Plate height and painted digits must fit; shrinking the container alone is insufficient. */
export async function vehiclePlateGeometry(plate: Locator, height: number) {
  const sample = await plate.evaluate(element => {
    const number = element.querySelector(".tm-plate-number")!;
    const range = document.createRange(); range.selectNodeContents(number);
    const box = element.getBoundingClientRect(), text = range.getBoundingClientRect(), style = getComputedStyle(number);
    return { height: box.height, width: box.width, textFits: text.left >= box.left && text.right <= box.right
      && text.top >= box.top && text.bottom <= box.bottom, fontSize: style.fontSize,
      fontFamily: style.fontFamily, fontWeight: style.fontWeight, textAlign: style.textAlign,
      plateBounds: box.toJSON(), textBounds: text.toJSON() };
  });
  expect(sample.height).toBeCloseTo(height, 2);
  expect(sample.textFits, JSON.stringify(sample)).toBe(true);
  return sample;
}

/** Exercise the real Tab cycle, including summaries and inherited disabled state. */
export async function vehicleKeyboardLoop(page: Page, dialog: Locator) {
  const controls = dialog.locator(':is(button, a[href], input, select, textarea, summary, [tabindex="0"]):not(:disabled):not([tabindex="-1"]):visible');
  const first = controls.first(), last = controls.last();
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
}

/** Measured styles and geometry for independent screenshot contrast review. */
export async function vehicleStyle(target: Locator) {
  return target.evaluate(element => {
    const style = getComputedStyle(element), box = element.getBoundingClientRect();
    const layers = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const current = getComputedStyle(node);
      layers.push({ tag: node.tagName, class: node.getAttribute("class"), color: current.backgroundColor,
        image: current.backgroundImage, opacity: current.opacity, outline: current.outlineStyle,
        outlineWidth: current.outlineWidth, outlineColor: current.outlineColor, shadow: current.boxShadow });
    }
    return { text: element.textContent?.trim(), tag: element.tagName, color: style.color,
      fontSize: style.fontSize, fontWeight: style.fontWeight, fontFamily: style.fontFamily,
      textAlign: style.textAlign, borderColor: style.borderColor, borderWidth: style.borderWidth, borderRadius: style.borderRadius,
      textShadow: style.textShadow, opacity: style.opacity, outline: style.outlineStyle,
      outlineWidth: style.outlineWidth, outlineColor: style.outlineColor, outlineOffset: style.outlineOffset,
      animationName: style.animationName, animationDuration: style.animationDuration, transitionDuration: style.transitionDuration,
      box: { x: box.x, y: box.y, width: box.width, height: box.height }, scrollY,
      focused: document.activeElement === element, focusVisible: element.matches(":focus-visible"),
      theme: document.documentElement.dataset.theme, accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
      atmosphere: document.querySelector('[data-testid="app-atmosphere"]')?.getAttribute("data-variant"), layers };
  });
}

export async function manualWizard(page: Page, options: { make?: string; model?: string; year?: string } = {}) {
  await page.getByTestId("wizard-manual").click();
  await page.getByTestId("wizard-make").fill(options.make ?? "מאזדה");
  await page.getByTestId("wizard-model").fill(options.model ?? "3");
  if (options.year) await page.getByTestId("wizard-year").fill(options.year);
  await page.getByTestId("wizard-confirm-next").click();
  await expect(page.getByTestId("vehicle-wizard")).toHaveAttribute("data-step", "extras");
}
