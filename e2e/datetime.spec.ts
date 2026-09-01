import { test, expect } from "@playwright/test";
import { resetEmulators } from "./helpers/emulator";
import { ALICE, createVehicle, signIn } from "./helpers/app";

/**
 * Date and time entry.
 *
 * The old picker paged month by month and stepped minutes in fives, so a
 * record from two years ago took two dozen taps and 18:47 was not expressible
 * at all.
 */

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await resetEmulators();
});

async function openDateSheet(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/fillup/new");
  await page.getByRole("button", { name: /תאריך ושעה/ }).first().click();
  await expect(page.getByLabel("שעה — הקלדה ידנית")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await signIn(page, ALICE);
  const header = page.getByText("מאזדה 3", { exact: false }).first();
  if (!(await header.count())) {
    await createVehicle(page, { make: "מאזדה", model: "3" });
  }
});

test("an exact minute can be typed", async ({ page }) => {
  await openDateSheet(page);

  const time = page.getByLabel("שעה — הקלדה ידנית");
  await time.fill("18:47");
  await time.press("Enter");

  // 47 is not a multiple of five; the old stepper could not reach it.
  await expect(time).toHaveValue("18:47");
  await page.getByRole("button", { name: "אישור", exact: true }).click();
  await expect(page.getByText("18:47")).toBeVisible();
});

test("a nonsense time is refused and the typing is not thrown away", async ({ page }) => {
  await openDateSheet(page);

  const time = page.getByLabel("שעה — הקלדה ידנית");
  await time.fill("25:99");
  await time.press("Enter");

  await expect(page.getByText(/שעה לא תקינה/)).toBeVisible();
  // What the user typed is still there to correct, not silently reverted.
  await expect(time).toHaveValue("25:99");
});

test("an old date is reached by typing, with no month-by-month paging", async ({ page }) => {
  await openDateSheet(page);

  const date = page.getByLabel("תאריך — הקלדה ידנית");
  await date.fill("15/06/2024");
  await date.press("Enter");

  // Day-first, as an Israeli user writes it: June, not the 6th of the 15th.
  await expect(page.getByRole("combobox", { name: "שנה" })).toHaveValue("2024");
  await expect(page.getByRole("combobox", { name: "חודש" })).toHaveValue("5");
});

test("the ISO form is accepted too", async ({ page }) => {
  await openDateSheet(page);

  const date = page.getByLabel("תאריך — הקלדה ידנית");
  await date.fill("2024-06-15");
  await date.press("Enter");

  await expect(page.getByRole("combobox", { name: "שנה" })).toHaveValue("2024");
  await expect(page.getByRole("combobox", { name: "חודש" })).toHaveValue("5");
});

test("month and year can be jumped to directly", async ({ page }) => {
  await openDateSheet(page);

  await page.getByRole("combobox", { name: "שנה" }).selectOption("2023");
  await page.getByRole("combobox", { name: "חודש" }).selectOption("2");

  // The grid header follows, without a single chevron tap. Asserted on the
  // heading rather than on the text, because the month name also appears in
  // every <option> of the select itself.
  await expect(page.getByRole("combobox", { name: "חודש" })).toHaveValue("2");
  await expect(
    page.locator("span", { hasText: /^מרץ\s/ }).first(),
  ).toBeVisible();
});

test("a future date is refused", async ({ page }) => {
  await openDateSheet(page);

  const nextYear = new Date().getFullYear() + 1;
  const date = page.getByLabel("תאריך — הקלדה ידנית");
  await date.fill(`01/01/${nextYear}`);
  await date.press("Enter");

  await expect(page.getByText("לא ניתן להזין תאריך עתידי")).toBeVisible();
});

test("the system pickers are offered and are the right kind", async ({ page }) => {
  await openDateSheet(page);

  // Native inputs, so the OS picker is a real option rather than an
  // approximation of one.
  const nativeDate = page.getByLabel("בחירת תאריך מהמכשיר");
  const nativeTime = page.getByLabel("בחירת שעה מהמכשיר");

  await expect(nativeDate).toHaveAttribute("type", "date");
  await expect(nativeTime).toHaveAttribute("type", "time");
  // step=60 is one-minute precision; without it browsers offer whole minutes
  // only by accident.
  await expect(nativeTime).toHaveAttribute("step", "60");

  // Setting them through the native control feeds the same commit path.
  await nativeTime.fill("06:03");
  await expect(page.getByLabel("שעה — הקלדה ידנית")).toHaveValue("06:03");
});

test("changing the date keeps the time that was already chosen", async ({ page }) => {
  await openDateSheet(page);

  const time = page.getByLabel("שעה — הקלדה ידנית");
  await time.fill("18:47");
  await time.press("Enter");

  const date = page.getByLabel("תאריך — הקלדה ידנית");
  await date.fill("2024-06-15");
  await date.press("Enter");

  await expect(time).toHaveValue("18:47");
});
