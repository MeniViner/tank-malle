import { test, expect } from "@playwright/test";
import { resetEmulators, seedFillups, setActiveVehicle } from "./helpers/emulator";
import {
  ALICE,
  addFillup,
  createVehicle,
  firstVehicleId,
  signIn,
  uidOf,
} from "./helpers/app";

/**
 * The consumption domain, end to end.
 *
 * The arithmetic is unit-tested in `src/lib/continuity.test.ts`. What these
 * tests establish is that the SCREEN says the same thing the engine computes —
 * the exact gap the old post-save toast fell into, where it re-derived
 * consumption with its own wrong formula.
 */

test.describe.configure({ mode: "serial" });

async function freshVehicle(page: import("@playwright/test").Page): Promise<{
  uid: string;
  vehicleId: string;
}> {
  await resetEmulators();
  await signIn(page, ALICE);
  await createVehicle(page, { make: "מאזדה", model: "3" });
  const uid = await uidOf(ALICE);
  return { uid, vehicleId: await firstVehicleId(uid) };
}

test("the first filled-to-full record creates a baseline and shows no consumption", async ({
  page,
}) => {
  await freshVehicle(page);

  const toast = await addFillup(page, { odometer: 100_000, liters: 40, pricePerLiter: 7 });
  expect(toast).toContain("נקודת התחלה נוצרה");
  expect(toast).not.toMatch(/קמ״ל|ל׳\/100/);

  await page.goto("/");
  await expect(page.getByText("הצריכה תחושב אחרי שני תדלוקים")).toBeVisible();
});

test("a partial fill-up retains its liters and shows no consumption figure", async ({
  page,
}) => {
  await freshVehicle(page);
  await addFillup(page, { odometer: 100_000, liters: 40, pricePerLiter: 7 });

  const toast = await addFillup(page, {
    odometer: 100_300,
    liters: 20,
    pricePerLiter: 7,
    fullToTheTop: false,
  });

  // The old formula would have produced 300 / 20 = 15 km/L here.
  expect(toast).toContain("הליטרים ייכללו בחישוב במילוי הבא עד מלא");
  expect(toast).not.toContain("15");
  expect(toast).not.toMatch(/קמ״ל/);

  // And the retained liters are stated, not silently absorbed.
  await page.goto("/");
  await expect(page.getByText(/במקטע הפתוח נשמרו/)).toBeVisible();
  await expect(page.getByText(/20/).first()).toBeVisible();
});

test("multiple partials accumulate into the open segment", async ({ page }) => {
  await freshVehicle(page);
  await addFillup(page, { odometer: 100_000, liters: 40, pricePerLiter: 7 });
  await addFillup(page, { odometer: 100_150, liters: 12, pricePerLiter: 7, fullToTheTop: false });
  await addFillup(page, { odometer: 100_300, liters: 14.8, pricePerLiter: 7, fullToTheTop: false });

  await page.goto("/");
  // 12 + 14.8 = 26.8 L pending across two partial fill-ups.
  await expect(page.getByText(/26\.8/)).toBeVisible();
  await expect(page.getByText(/2\s*תדלוקים חלקיים|תדלוקים חלקיים/)).toBeVisible();
});

test("the closing full fill-up produces the canonical segment result", async ({ page }) => {
  await freshVehicle(page);

  await addFillup(page, { odometer: 100_000, liters: 40, pricePerLiter: 7 });
  await addFillup(page, { odometer: 100_300, liters: 20, pricePerLiter: 7, fullToTheTop: false });
  const toast = await addFillup(page, { odometer: 100_600, liters: 25, pricePerLiter: 7 });

  // 600 km / (20 + 25) L = 13.33 km/L — NOT 300 / 25 = 12, which is what the
  // pre-upgrade toast computed.
  expect(toast).toContain("13.3");
  expect(toast).toContain("מאז המילוי הקודם עד מלא");
  expect(toast).not.toContain("12.0");

  // The dashboard agrees with the toast, because both come from one engine.
  await page.goto("/");
  await expect(
    page.getByText(/ממוצע הרכב: 13\.3 קמ״ל · מבוסס על 1 מקטע צריכה · 3 תדלוקים/),
  ).toBeVisible();
});

test("a continuity break stops every calculation from crossing the gap", async ({ page }) => {
  const { uid, vehicleId } = await freshVehicle(page);

  // Two fill-ups, then a long undocumented gap.
  await seedFillups(uid, vehicleId, [
    { id: "a", date: new Date(2026, 0, 5), odometer: 100_000, liters: 40 },
    { id: "b", date: new Date(2026, 0, 15), odometer: 100_400, liters: 40 },
  ]);
  await setActiveVehicle(uid, vehicleId);
  await page.reload();

  // The break record opens a new period.
  const toast = await addFillup(page, {
    odometer: 103_000,
    liters: 40,
    pricePerLiter: 7,
    continuityBreak: true,
  });
  expect(toast).toContain("התחילה תקופת חישוב חדשה");
  // The 100,400 → 103,000 stretch must not be attributed to anyone.
  expect(toast).not.toMatch(/קמ״ל/);

  await addFillup(page, { odometer: 103_400, liters: 40, pricePerLiter: 7 });

  await page.goto("/");
  // Tracked distance is 400 + 400, never 3,400.
  await expect(page.getByText(/מבוסס על 2 מקטעי צריכה/)).toBeVisible();

  await page.goto("/history");
  await expect(page.getByText("התחלת תקופה חדשה")).toBeVisible();

  // Records from BEFORE the break are still listed — a break hides nothing,
  // it only stops calculations crossing it. Two seeded plus two added.
  await expect(page.getByText(/ל׳ · ₪/)).toHaveCount(4);
});

test("editing, deleting and backdating recompute the result", async ({ page }) => {
  const { uid, vehicleId } = await freshVehicle(page);

  await seedFillups(uid, vehicleId, [
    { id: "a", date: new Date(2026, 0, 5), odometer: 100_000, liters: 40 },
    { id: "c", date: new Date(2026, 0, 25), odometer: 100_600, liters: 50 },
  ]);
  await setActiveVehicle(uid, vehicleId);
  await page.goto("/");
  // 600 km / 50 L = 12.0 km/L
  await expect(
    page.getByText(/ממוצע הרכב: 12\.0 קמ״ל · מבוסס על 1 מקטע צריכה · 2 תדלוקים/),
  ).toBeVisible({ timeout: 25_000 });

  // A BACKDATED partial lands between them and changes the answer: the same
  // 600 km is now covered by 50 + 10 L.
  await addFillup(page, {
    odometer: 100_300,
    liters: 10,
    pricePerLiter: 7,
    fullToTheTop: false,
    date: "2026-01-15",
    time: "12:00",
  });

  await page.goto("/");
  // 600 / 60 = 10.0 — the same distance, now covered by 50 + 10 litres. The
  // fill-up count is asserted in the same string so the check cannot pass
  // against a list that has not finished loading the third record.
  await expect(
    page.getByText(/ממוצע הרכב: 10\.0 קמ״ל · מבוסס על 1 מקטע צריכה · 3 תדלוקים/),
  ).toBeVisible({ timeout: 25_000 });

  // Delete the backdated record; the figure returns to 12.0. History rows are
  // identified by their litres — the odometer is not shown in the list.
  await page.goto("/history");
  await page.getByText(/10\.0 ל׳/).first().click();
  await page.getByRole("button", { name: "מחיקת רשומה" }).click();
  const confirm = page.getByRole("button", { name: /^מחיקה$/ });
  if (await confirm.count()) await confirm.first().click();

  await page.goto("/");
  await expect(
    page.getByText(/ממוצע הרכב: 12\.0 קמ״ל · מבוסס על 1 מקטע צריכה · 2 תדלוקים/),
  ).toBeVisible({ timeout: 25_000 });
});
