import { expect, test } from "@playwright/test";
import { listDocuments, resetEmulators } from "./helpers/emulator";
import { ALICE, createVehicle, signIn, uidOf } from "./helpers/app";
import { finishFillupSave, setFillupEndState } from "./helpers/fillup";

/**
 * Demo mode: someone without a car can open the app with sample data (a fuel car or an
 * electric one). The sample lives only in this device's localStorage; nothing reaches the
 * account, and leaving the demo removes it.
 */
test.use({ serviceWorkers: "block" });

test("the first-run wizard offers sample data; changes stay on the device and exit removes them", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await resetEmulators();
  await signIn(page, ALICE);
  const uid = await uidOf(ALICE);
  await expect(page.getByTestId("vehicle-wizard")).toBeVisible();
  await page.getByTestId("demo-start").click();
  await page.getByTestId("demo-start-fuel").click();

  const banner = page.getByTestId("demo-banner");
  await expect(banner).toContainText("מוצגים נתוני דוגמה");
  await expect(banner).toContainText("לא נשמר בחשבון");
  await expect(page.getByTestId("vehicle-wizard")).toHaveCount(0);
  await expect(page.getByTestId("home-facts")).toBeVisible();
  await expect(page.getByText(/קורולה/).first()).toBeVisible();

  // The journal shows a year of sample fill-ups, and every tab works with the banner on top.
  await page.getByTestId("tab-bar").getByRole("link", { name: "יומן", exact: true }).click();
  await expect(page.locator('.ledger-row[data-collection=fillups]').first()).toBeVisible();
  await expect(banner).toBeVisible();
  for (const [tab, path] of [["תובנות", "/stats"], ["רכב", "/vehicle"], ["בית", "/"]] as const) {
    await page.getByTestId("tab-bar").getByRole("link", { name: tab, exact: true }).click();
    await expect(page).toHaveURL(path);
    await expect(page.locator("main")).toBeVisible();
  }

  // A fill-up made in the demo is kept on the device only.
  await page.goto("/fillup/new");
  await page.getByTestId("fillup-odometer").fill("60500");
  await page.getByTestId("fillup-liters").fill("38");
  await page.getByTestId("fillup-price").fill("7.4");
  await setFillupEndState(page, "full");
  await page.getByTestId("fillup-save").click();
  await finishFillupSave(page);
  await expect(banner).toBeVisible();
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null"), `tm.demo.${uid}`);
  expect(stored.fillups["demo-fuel"].some((row: { odometer: number }) => row.odometer === 60500)).toBe(true);
  expect(await listDocuments(`users/${uid}/vehicles`)).toHaveLength(0);

  // A reload keeps the demo; exit removes it and returns to adding a car.
  await page.reload();
  await expect(banner).toBeVisible();
  await page.getByTestId("demo-exit").click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId("vehicle-wizard")).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), `tm.demo.${uid}`)).toBeNull();
  expect(await listDocuments(`users/${uid}/vehicles`)).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("Home without a car offers the electric sample too", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await resetEmulators();
  await signIn(page, ALICE);
  await page.getByTestId("wizard-skip-vehicle").click();
  const empty = page.getByTestId("home-no-vehicle");
  await expect(empty).toContainText("עדיין לא הוספת רכב");
  await empty.getByTestId("demo-start-ev").click();
  await expect(page.getByTestId("demo-banner")).toBeVisible();
  await expect(page.getByTestId("home-energy-100")).toContainText("חשמל ל-100 ק״מ");
  await page.getByTestId("tab-bar").getByRole("link", { name: "תובנות", exact: true }).click();
  await expect(page.locator("main")).toBeVisible();

  // Vehicle details are saved into the sample too (this device only).
  const uid = await uidOf(ALICE);
  await page.goto("/vehicle");
  await page.getByRole("button", { name: /הוספה/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("DD/MM/YYYY").fill("15/03/2027");
  await dialog.getByRole("button", { name: "שמירת הפרטים" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(key => JSON.stringify(JSON.parse(localStorage.getItem(key) ?? "{}").vehicles?.find((v: { id: string }) => v.id === "demo-ev")?.docs ?? null), `tm.demo.${uid}`))
    .toContain("2027");
  expect(await listDocuments(`users/${uid}/vehicles`)).toHaveLength(0);
  await page.getByTestId("demo-exit").click();
  await expect(page.getByTestId("home-no-vehicle")).toBeVisible();
  expect(errors).toEqual([]);
});

test("adding a real car from the demo leaves the demo and saves the car to the account", async ({ page }) => {
  await resetEmulators();
  await signIn(page, ALICE);
  const uid = await uidOf(ALICE);
  await page.getByTestId("demo-start").click();
  await page.getByTestId("demo-start-fuel").click();
  await expect(page.getByTestId("demo-banner")).toBeVisible();
  await createVehicle(page, { account: ALICE, make: "מאזדה", model: "3" });
  await expect(page.getByTestId("demo-banner")).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), `tm.demo.${uid}`)).toBeNull();
  const vehicles = await listDocuments(`users/${uid}/vehicles`);
  expect(vehicles.map(vehicle => vehicle.data.make)).toEqual(["מאזדה"]);
  expect(await listDocuments(`users/${uid}/vehicles/${vehicles[0].id}/fillups`)).toHaveLength(0);
});
