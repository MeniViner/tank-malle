import { test, expect } from "@playwright/test";
import { signedInWithData } from "./helpers/app";
import type { SeedFillup } from "./helpers/emulator";

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
    const station = dialog.getByRole("button", { name: /סונול שפיה/ });
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

test("home renders a continuous area in light and dark themes", async ({ page }, testInfo) => {
  await signedInWithData(page, { fillups: RECORDS });
  const hero = page.locator("section.bg-hero");
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
