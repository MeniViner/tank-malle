import { test, expect } from "@playwright/test";
import { signedInWithData } from "./helpers/app";
import { getDocument, listDocuments, setDocument, waitForDocument, type SeedFillup } from "./helpers/emulator";

const RECORDS: SeedFillup[] = [
  { id: "a", date: new Date(2026, 9, 1), odometer: 100_000, liters: 40 },
  { id: "b", date: new Date(2026, 9, 4), odometer: 100_400, liters: 40, stationName: "סונול שפיה" },
  { id: "c", date: new Date(2026, 9, 10), odometer: 101_000, liters: 40 },
];

test.describe.configure({ mode: "serial" });

for (const width of [360, 430]) {
  test(`station typing retains focus and history stays searchable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await signedInWithData(page, { fillups: RECORDS });
    // A failed registry fetch must never hide an existing personal station.
    await page.route("**/fuel-stations.json", (route) => route.abort());
    await page.goto("/fillup/new");
    const trigger = page.getByRole("button", { name: /^תחנה / });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    const input = dialog.getByPlaceholder("חיפוש תחנה…");
    await input.click();
    // fill() alone misses the original bug: the first React render stole
    // focus, causing later physical keystrokes to land on the close button.
    for (const character of "סונול שפיה") {
      await page.keyboard.insertText(character);
      await expect(input).toBeFocused();
    }
    await expect(input).toHaveValue("סונול שפיה");
    // Editing in the middle must keep both focus and the caret through the
    // result-list rerender, not merely leave the final string looking right.
    await input.evaluate((field: HTMLInputElement) => field.setSelectionRange(6, 6));
    await page.keyboard.insertText("ו");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("סונול ושפיה");
    expect(await input.evaluate((field: HTMLInputElement) => field.selectionStart)).toBe(7);
    await page.keyboard.press("Backspace");
    await expect(input).toHaveValue("סונול שפיה");
    expect(await input.evaluate((field: HTMLInputElement) => field.selectionStart)).toBe(6);
    const station = dialog.getByRole("button", { name: /סונול שפיה.*תחנה מהיסטוריית התדלוקים/ });
    await expect(station).toBeVisible();
    await expect(dialog.getByText("לא נמצאה תחנה בשם הזה")).toHaveCount(0);
    await station.click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toContainText("סונול שפיה");
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(input).toHaveValue("");
    await input.fill("תחנה שאינה קיימת");
    await expect(input).toBeFocused();
    await expect(dialog.getByText(/קטלוג התחנות אינו זמין כרגע/)).toBeVisible();
    await input.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

for (const identified of [false, true]) {
  test(`historical selection preserves ${identified ? "the station ID" : "an unresolved station"} on save`, async ({ page }) => {
    const { uid, vehicleId } = await signedInWithData(page, { fillups: RECORDS });
    const collection = `users/${uid}/vehicles/${vehicleId}/fillups`;
    const historical = await getDocument(`${collection}/b`);
    const station = identified
      ? { name: "סונול שפיה", stationId: "historical-42", brand: "סונול", lat: 32.5, lng: 34.9 }
      : { name: "סונול שפיה" };
    await setDocument(`${collection}/b`, { ...historical, date: RECORDS[1].date, createdAt: RECORDS[1].date, station });
    await page.goto("/fillup/new");
    await page.getByRole("button", { name: /^תחנה / }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("חיפוש תחנה…").fill("שפיה סונול");
    await dialog.getByRole("button", { name: /סונול שפיה.*תחנה מהיסטוריית התדלוקים/ }).click();
    await page.getByLabel(/^קילומטראז׳/).fill("101400");
    await page.getByLabel("ליטרים", { exact: true }).fill("40");
    await page.getByLabel("מחיר לליטר").fill("7");
    await page.getByRole("button", { name: "מילאתי מיכל מלא", exact: true }).click();
    await page.getByRole("button", { name: "שמירת תדלוק" }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/(\?.*)?$/);
    const saved = await waitForDocument(collection, (record) => record.odometer === 101400);
    expect(saved.station).toEqual(station);
    expect(saved.pricePerLiter).toBe(7);
    expect(await getDocument(`${collection}/b`)).toEqual({ ...historical, station });
    expect(await listDocuments(collection)).toHaveLength(RECORDS.length + 1);
    await page.reload();
    await page.goto("/history");
    await expect(page.getByText("סונול שפיה", { exact: true }).first()).toBeVisible();
  });
}

for (const oldCache of [false, true]) {
  test(`Sonol Shfeya is available without history with ${oldCache ? "an old cached registry" : "no registry network"}`, async ({ page }, testInfo) => {
    const { uid, vehicleId } = await signedInWithData(page);
    if (oldCache) {
      await page.evaluate(() => localStorage.setItem("tm.stations.v1", JSON.stringify({
        count: 1, companies: ["פז"],
        stations: [{ i: "1234", n: "פז בדיקה", c: "פז", a: "בדיקה", lat: 32, lng: 34.9 }],
      })));
    }
    await page.route("**/fuel-stations.json", (route) => route.abort());
    await page.goto("/fillup/new");
    const trigger = page.getByRole("button", { name: /^תחנה / });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    const search = dialog.getByPlaceholder("חיפוש תחנה…");
    await search.click();
    for (const character of "סונול שפיה") {
      await page.keyboard.insertText(character);
      await expect(search).toBeFocused();
    }
    const station = dialog.getByRole("button", { name: /סונול שפיה.*מאיר שפיה/ });
    await expect(station).toBeVisible();
    if (oldCache) await testInfo.attach("sonol-shfeya-global-cached", { body: await dialog.screenshot(), contentType: "image/png" });
    await station.click();
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText("סונול שפיה");
    await page.getByLabel(/^קילומטראז׳/).fill("100000");
    await page.getByLabel("ליטרים", { exact: true }).fill("40");
    await page.getByLabel("מחיר לליטר").fill("7");
    await page.getByRole("button", { name: "שמירת תדלוק" }).click();
    const saved = await waitForDocument(`users/${uid}/vehicles/${vehicleId}/fillups`, (record) => record.odometer === 100000);
    // The serializer omits unresolved IDs and coordinates, as for legacy stations.
    expect(saved.station).toEqual({ name: "סונול שפיה", brand: "סונול" });
    expect(saved.pricePerLiter).toBe(7);
  });
}

test("home renders a continuous area in light and dark themes", async ({ page }, testInfo) => {
  await signedInWithData(page, { fillups: RECORDS });
  const hero = page.getByTestId("consumption-summary");
  const svg = hero.locator("svg[viewBox='0 0 100 40']");
  await expect(svg).toBeVisible();
  const curve = await svg.locator("path").nth(2).getAttribute("d");
  await expect(svg.locator("path").nth(0)).toHaveAttribute("d", `${curve} L 100 40 L 0 40 Z`);
  await expect(svg.locator("path").nth(1)).toHaveAttribute("d", `${curve} L 100 40 L 0 40 Z`);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await testInfo.attach(`home-consumption-${colorScheme}`, { body: await hero.screenshot(), contentType: "image/png" });
  }
});
