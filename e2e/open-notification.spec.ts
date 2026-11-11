import { expect, test } from "@playwright/test";
import { getDocument, seedVehicle, setDocument } from "./helpers/emulator";
import { vehicleDayOffset, vehicleFixture } from "./helpers/design-v2-vehicle";
import { notificationLink } from "../src/lib/push/link";

test.use({ viewport: { width: 390, height: 844 } });

const plan = (title: string) => ({ schemaVersion: 1, version: 1, title, job: "oil", dueDay: vehicleDayOffset(2), dueOdometer: null,
  intervalMonths: null, intervalKm: null, basis: "manual", source: "owner", notes: "", active: true });

test("a phone notification about another vehicle selects that vehicle and opens its reminder", async ({ page }) => {
  const scope = await vehicleFixture(page);
  await seedVehicle(scope.uid, "second-car", { make: "רכב", model: "שני", year: 2021 });
  await setDocument(`users/${scope.uid}/vehicles/second-car/maintenancePlans/second-plan`, plan("טיפול לרכב השני"));
  await page.goto("/settings/vehicles");
  await expect(page.locator('[data-managed-vehicle="second-car"]')).toBeVisible();

  await page.goto(notificationLink("second-car", "/vehicle/reminders/second-plan"));
  await expect(page.getByRole("heading", { name: "טיפול לרכב השני" })).toBeVisible();
  await expect(page).toHaveURL(/\/vehicle\/reminders\/second-plan$/);
  await expect.poll(async () => (await getDocument(`users/${scope.uid}`))?.settings).toMatchObject({ activeVehicleId: "second-car" });
});

test("a notification link for a vehicle that is gone, or one that leaves the app, ends at the notifications list", async ({ page }) => {
  const scope = await vehicleFixture(page);
  for (const link of [notificationLink("no-such-car", "/vehicle/reminders/x"), "/open?vehicle=" + scope.vehicleId + "&to=%2F%2Fevil.test"]) {
    await page.goto(link);
    await expect(page).toHaveURL(/\/notifications$/);
  }
  expect((await getDocument(`users/${scope.uid}`))?.settings?.activeVehicleId ?? scope.vehicleId).toBe(scope.vehicleId);
});
