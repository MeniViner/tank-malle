import { test, expect } from "@playwright/test";
import { signedInWithData } from "./helpers/app";
import { getDocument } from "./helpers/emulator";

test("display choices persist through the new settings sheets and convert consumption", async ({ page }) => {
  const { uid } = await signedInWithData(page, { fillups: [
    { id: "start", date: new Date("2026-09-01T09:00:00Z"), odometer: 100000, liters: 40 },
    { id: "end", date: new Date("2026-09-10T09:00:00Z"), odometer: 100500, liters: 40 },
  ] });
  await page.goto("/settings");
  await page.getByRole("button", { name: /^ערכת נושא/ }).click();
  await page.getByRole("radio", { name: "כהה", exact: true }).click();
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ theme: "dark" });
  await page.getByRole("dialog").getByRole("button", { name: "סגירה", exact: true }).click();
  await page.getByRole("button", { name: /^יחידת צריכה/ }).click();
  await page.getByRole("radio", { name: "ל׳/100 ק״מ", exact: true }).click();
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ units: "litersPer100" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/");
  const consumption = page.getByTestId("consumption-summary");
  await expect(consumption.getByText("8.0", { exact: true }).first()).toBeVisible();
  await expect(consumption.getByText("ל׳/100 ק״מ", { exact: true }).first()).toBeVisible();
});

test("settings and account data remain reachable on narrow screens without overflow", async ({ page }) => {
  await signedInWithData(page);
  for (const width of [320, 360, 430]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "הגדרות", exact: true })).toBeInViewport();
    await page.getByRole("button", { name: /אליס.*alice@example.com/ }).click();
    await expect(page.getByRole("heading", { name: "פרופיל וחשבון", exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: /^ייצוא תדלוקים/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^פעולות שלא סונכרנו/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
