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

test("design surfaces retain real fixture values and fit mobile layouts", async ({ page }, testInfo) => {
  const dates = ["2026-08-01", "2026-08-15", "2026-08-29", "2026-09-12", "2026-09-26", "2026-10-04", "2026-10-15"];
  await signedInWithData(page, { vehicle: { make: "מבחן", model: "עיצוב", tankLiters: 50, tankLitersSource: "user", declaredKmPerLiter: 14 }, regulatedPrice: 7.77,
    fillups: dates.map((date, i) => ({ id: `design-${i}`, date: new Date(`${date}T09:00:00Z`), odometer: 100000 + i * 450, liters: [40, 34, 45, 39, 35, 38, 41][i], pricePerLiter: 7.77, stationName: i === 5 ? "סונול שפיה" : "תחנת בדיקה" })),
  });
  async function capture(name: string) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${name}.jpg`), type: "jpeg", quality: 75, fullPage: true, animations: "disabled" });
  }
  for (const [mode, label] of [["light", "בהיר"], ["dark", "כהה"]]) {
    await page.goto("/settings");
    await page.getByRole("button", { name: /^ערכת נושא/ }).click();
    await page.getByRole("radio", { name: label, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "סגירה", exact: true }).click();
    await page.goto("/");
    await expect(page.getByTestId("consumption-summary").getByText("11.0", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("consumption-summary").locator("svg[viewBox='0 0 100 40']")).toBeVisible();
    await expect(page.getByText("המיכל שלי", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "פעולות שממתינות לסנכרון", exact: true })).toHaveCount(0);
    await capture(`home-${mode}`);
  }
  await page.goto("/settings");
  await page.getByRole("button", { name: /^ערכת נושא/ }).click();
  await page.getByRole("radio", { name: "בהיר", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "סגירה", exact: true }).click();
  await capture("settings");
  for (const [route, title] of [["/history", "היסטוריה"], ["/settings/profile", "פרופיל וחשבון"], ["/settings/vehicles", "ניהול רכבים"], ["/settings/import", "ייבוא נתונים"], ["/settings/unsynced", "לא סונכרן"], ["/feedback", "משוב"]]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeInViewport();
    if (route === "/settings/profile") await expect(page.getByText("272 ליטר בסך הכול", { exact: true })).toBeVisible();
    await capture(route.split("/").pop()!);
  }
  await page.goto("/stats");
  for (const label of ["הוצאות", "צריכה", "מחירים", "קהילה"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { name: "סטטיסטיקות", exact: true })).toBeInViewport();
    await capture(`stats-${label}`);
  }
  await page.goto("/fillup/new");
  await expect(page.getByLabel("ליטרים", { exact: true })).toBeVisible();
  await capture("fillup");
});
