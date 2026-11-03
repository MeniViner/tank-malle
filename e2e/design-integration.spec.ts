import { test, expect } from "@playwright/test";
import { signedInWithData } from "./helpers/app";
import { getDocument } from "./helpers/emulator";

test("display choices persist through the new settings sheets and convert consumption", async ({ page }) => {
  const { uid } = await signedInWithData(page, { fillups: [
    { id: "start", date: new Date("2026-09-01T09:00:00Z"), odometer: 100000, liters: 40 },
    { id: "end", date: new Date("2026-09-10T09:00:00Z"), odometer: 100500, liters: 40 },
  ] });
  await page.goto("/settings");
  await page.getByRole("button", { name: /^מראה/ }).click();
  await page.getByRole("radio", { name: "כהה", exact: true }).click();
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ theme: "dark" });
  await page.getByRole("dialog").getByRole("button", { name: "סגירה", exact: true }).click();
  await page.getByRole("button", { name: /^יחידת צריכה/ }).click();
  await page.getByRole("radio", { name: "ליטר ל-100 ק״מ", exact: true }).click();
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ units: "litersPer100" });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("account-units").locator('bdi[dir="ltr"]')).toHaveText("100");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/");
  const consumption = page.getByTestId("consumption-summary");
  await expect(consumption.getByText("8.0", { exact: true }).first()).toBeVisible();
  await expect(consumption.getByText("ל׳ ל-100 ק״מ", { exact: true }).first()).toBeVisible();
});

test("legacy settings reaches Account and its data sheets without narrow-screen overflow", async ({ page }) => {
  await signedInWithData(page);
  for (const width of [320, 360, 430]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { name: "חשבון", exact: true })).toBeInViewport();
    await expect(page.getByTestId("account-identity")).toContainText("alice@example.com");
    await page.getByTestId("account-identity").click();
    const identity = page.getByRole("dialog", { name: "פרטי החשבון", exact: true });
    await expect(identity.getByTestId("account-summary")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press("Escape");
    // A healthy account has no pending-writes action; reliability specs cover
    // the conditional row with actual durable pending and rejected records.
    await expect(page.getByTestId("account-unsynced")).toHaveCount(0);
    await page.getByTestId("account-export").click();
    await expect(page.getByTestId("account-export-fillups")).toBeVisible();
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
    await page.getByRole("button", { name: /^מראה/ }).click();
    await page.getByRole("radio", { name: label, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "סגירה", exact: true }).click();
    await page.goto("/");
    await expect(page.getByTestId("consumption-summary").getByText("11.0", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("consumption-summary").getByTestId("consumption-chart").getByRole("img")).toBeVisible();
    await expect(page.getByTestId("tank-hero")).toBeVisible();
    await expect(page.getByTestId("home-header").getByRole("button", { name: /סנכרון|ענן/ })).toHaveCount(0);
    await capture(`home-${mode}`);
  }
  await page.goto("/settings");
  await page.getByRole("button", { name: /^מראה/ }).click();
  await page.getByRole("radio", { name: "בהיר", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "סגירה", exact: true }).click();
  await capture("settings");
  for (const [route, title] of [["/history", "יומן"], ["/settings/profile", "חשבון"], ["/settings/vehicles", "הרכבים שלי"], ["/settings/import", "ייבוא נתונים"], ["/settings/unsynced", "סנכרון"], ["/feedback", "משוב"]]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeInViewport();
    if (route === "/settings/unsynced") await expect(page.getByRole("heading", { name: "הכל מעודכן", exact: true })).toBeVisible();
    if (route === "/settings/profile") {
      await expect(page).toHaveURL(/\/account$/);
      await page.getByTestId("account-identity").click();
      await expect(page.getByTestId("account-summary")).toContainText("272 ליטר בסך הכול");
    }
    await capture(route.split("/").pop()!);
  }
  await page.goto("/stats");
  for (const label of ["הוצאות", "צריכה", "מחירים", "השוואה"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { name: "תובנות", exact: true })).toBeInViewport();
    await capture(`stats-${label}`);
  }
  await page.goto("/fillup/new");
  await expect(page.getByLabel("ליטרים", { exact: true })).toBeVisible();
  await capture("fillup");
});
