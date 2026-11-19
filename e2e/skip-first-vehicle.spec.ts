import { expect, test } from "@playwright/test";
import { listDocuments, resetEmulators } from "./helpers/emulator";
import { ALICE, signIn, uidOf } from "./helpers/app";

/**
 * Someone without a car can skip the first-run vehicle wizard and still move around the app.
 * The skip is per account, on this device.
 */
test.use({ serviceWorkers: "block" });

test("the first-run wizard can be skipped; every tab still works without a vehicle", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await resetEmulators();
  await signIn(page, ALICE);
  await expect(page.getByTestId("vehicle-wizard")).toBeVisible();
  await page.getByTestId("wizard-skip").click();

  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("home-no-vehicle")).toBeVisible();
  for (const [tab, path] of [["יומן", "/history"], ["תובנות", "/stats"], ["רכב", "/vehicle"]] as const) {
    await page.getByTestId("tab-bar").getByRole("link", { name: tab, exact: true }).click();
    await expect(page).toHaveURL(path);
    await expect(page.getByTestId("vehicle-wizard")).toHaveCount(0);
    await expect(page.locator("main")).toBeVisible();
  }
  // A reload keeps the skip.
  await page.reload();
  await expect(page.getByTestId("vehicle-wizard")).toHaveCount(0);

  // Adding a car later goes through the normal wizard, which can be left again.
  await page.goto("/");
  await page.getByTestId("home-no-vehicle").getByRole("button", { name: "הוספת רכב" }).click();
  await expect(page.getByTestId("vehicle-wizard")).toBeVisible();
  await expect(page.getByTestId("wizard-skip")).toHaveCount(0);
  expect(await listDocuments(`users/${await uidOf(ALICE)}/vehicles`)).toHaveLength(0);

  expect(errors).toEqual([]);
});
