import { test, expect, type Page } from "@playwright/test";
import { listDocuments, resetEmulators, seedFillups } from "./helpers/emulator";
import {
  ALICE,
  addFillup,
  createVehicle,
  firstVehicleId,
  signIn,
  signedInWithData,
  uidOf,
} from "./helpers/app";

/**
 * The touched surfaces, in the real app.
 *
 * The maths is unit-tested in `src/lib/tank/tank.test.ts`. What can only be
 * established here is that the SCREEN behaves: the gauge tracks a finger and
 * hands scrolling back afterwards, History opens the editor directly, and the
 * share fallback puts the public URL — and nothing else — on the clipboard.
 */

test.describe.configure({ mode: "serial" });

/**
 * Read a collection back, allowing for the write to still be in flight.
 *
 * The form returns once the LOCAL cache has the record — which is the point of
 * the offline-first design — so a REST read immediately afterwards can
 * legitimately see nothing yet. Polling keeps the test honest about that
 * distinction instead of racing it.
 */
async function waitForDocuments(
  path: string,
  count: number,
  timeoutMs = 15_000,
): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const deadline = Date.now() + timeoutMs;
  let documents = await listDocuments(path);
  while (documents.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    documents = await listDocuments(path);
  }
  return documents;
}

async function freshVehicle(page: Page): Promise<{ uid: string; vehicleId: string }> {
  await resetEmulators();
  await signIn(page, ALICE);
  await createVehicle(page, { make: "מאזדה", model: "3" });
  const uid = await uidOf(ALICE);
  return { uid, vehicleId: await firstVehicleId(uid) };
}

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

test("§15.20 tapping a fill-up opens its editor directly, with the odometer readable", async ({
  page,
}) => {
  const { uid, vehicleId } = await freshVehicle(page);
  await seedFillups(uid, vehicleId, [
    {
      id: "f1",
      date: new Date(Date.UTC(2026, 0, 5, 8, 0)),
      odometer: 169_994,
      liters: 40,
      pricePerLiter: 7,
    },
  ]);

  await page.goto("/history");

  // The mileage is its own small metric on the row, separate from economy.
  await expect(page.getByText("169,994", { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("button", { name: /169,994/ }).click();

  // Straight to the record's own editor — no intermediate action sheet.
  await expect(page).toHaveURL(/\/fillup\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "עריכת תדלוק" })).toBeVisible();
  // Deletion still lives here, which is why the sheet had nothing left to do.
  await expect(page.getByRole("button", { name: "מחיקת רשומה" })).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * The interactive gauge
 * ------------------------------------------------------------------ */

test("§16.16 the tank section is optional and a fill-up saves without it", async ({ page }) => {
  const { uid, vehicleId } = await freshVehicle(page);

  const toast = await addFillup(page, {
    odometer: 100_000,
    liters: 40,
    pricePerLiter: 7,
    fillEndState: "unknown",
  });

  // Saved, and honest about what it can and cannot compute.
  expect(toast).toContain("התדלוק נשמר");

  const records = await waitForDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`, 1);
  expect(records).toHaveLength(1);
  const data = records[0].data as Record<string, unknown>;
  expect(data.fillEndState).toBe("unknown");
  // Case E: no interaction, so no observation and no training label.
  expect(data.preFillLevel ?? null).toBeNull();
  expect(data.postFillLevel ?? null).toBeNull();
  expect(data.isFullTank).toBe(false);
});

test("§16.15.10 dragging the gauge sets a level and leaves the page scrollable", async ({
  page,
}) => {
  await freshVehicle(page);
  await page.goto("/fillup/new");

  await page.getByLabel(/^קילומטראז׳/).fill("100000");
  await page.getByLabel("ליטרים", { exact: true }).fill("20");
  await page.getByRole("button", { name: "פתיחת מצב המיכל" }).click();

  const gauge = page.getByRole("slider", { name: "כמה דלק נשאר לפני התדלוק" });
  await expect(gauge).toBeVisible();

  const box = (await gauge.boundingBox())!;
  // Three quarters of the way DOWN the track is a quarter of a tank.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75, { steps: 4 });
  await page.mouse.up();

  await expect(gauge).toHaveAttribute("aria-valuenow", "25");

  // Nothing must be left holding the pointer once the finger lifts.
  expect(
    await gauge.evaluate((element) =>
      // A released capture leaves no captured pointer of any id.
      [0, 1, 2].some((id) => element.hasPointerCapture(id)),
    ),
  ).toBe(false);

  // `touch-action: none` is scoped to the gauge itself, so panning anywhere
  // else on the form was never disabled and needs no restoring.
  expect(await gauge.evaluate((element) => getComputedStyle(element).touchAction)).toBe(
    "none",
  );
  const scroller = page.locator("main div.overflow-y-auto").first();
  expect(
    await scroller.evaluate((element) => getComputedStyle(element).touchAction),
  ).not.toBe("none");
  expect(await scroller.evaluate((element) => getComputedStyle(element).overflowY)).toBe(
    "auto",
  );

  // And the body scroll lock the sheets use is not engaged: this is an inline
  // expansion, not a modal.
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("§16.15.9 the gauge is operable from the keyboard", async ({ page }) => {
  await freshVehicle(page);
  await page.goto("/fillup/new");
  await page.getByRole("button", { name: "פתיחת מצב המיכל" }).click();

  const gauge = page.getByRole("slider", { name: "כמה דלק נשאר לפני התדלוק" });
  await gauge.focus();
  await gauge.press("Home");
  await expect(gauge).toHaveAttribute("aria-valuenow", "0");
  await gauge.press("ArrowUp");
  await expect(gauge).toHaveAttribute("aria-valuenow", "5");
  await gauge.press("PageUp");
  await expect(gauge).toHaveAttribute("aria-valuenow", "25");
  await gauge.press("End");
  await expect(gauge).toHaveAttribute("aria-valuenow", "100");
});

test("§16.15.1 a before level plus a partial fill produces the after level", async ({
  page,
}) => {
  // A capacity the user confirmed, seeded directly — the vehicle editor is not
  // what this test is about, and a guessed capacity would correctly be refused.
  const { uid, vehicleId } = await signedInWithData(page, {
    vehicle: { make: "מאזדה", model: "3", tankLiters: 40, tankLitersSource: "user" },
  });

  await page.goto("/fillup/new");
  await page.getByLabel(/^קילומטראז׳/).fill("100000");
  await page.getByLabel("ליטרים", { exact: true }).fill("20");
  // No regulated price is seeded, so the price is typed the way a user would.
  await page.getByLabel("מחיר לליטר").fill("7");
  await page.getByRole("button", { name: "פתיחת מצב המיכל" }).click();

  const before = page.getByRole("slider", { name: "כמה דלק נשאר לפני התדלוק" });
  await before.focus();
  await before.press("Home");
  await before.press("PageUp"); // 0 → 20%
  await before.press("ArrowUp"); // 20% → 25%
  await expect(before).toHaveAttribute("aria-valuenow", "25");

  // 10 L before + 20 L added = 30 L of 40 = 75%, on the left gauge and echoed
  // in the collapsed row's summary.
  await expect(page.getByText("כ־75%", { exact: true })).toBeVisible();
  await expect(page.getByText("לפני כ־25% · אחרי כ־75%")).toBeVisible();

  await page.getByRole("button", { name: "שמירת תדלוק" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/(\?.*)?$/, { timeout: 20_000 });

  const records = await waitForDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`, 1);
  const data = records[0].data as Record<string, number | string>;
  expect(Number(data.preFillLevel)).toBeCloseTo(0.25, 5);
  expect(data.preFillLevelSource).toBe("direct-gauge");
  // The derived after-value is stored as derived, never as a reported reading.
  expect(data.postFillLevelSource).toBe("derived-after-partial");
  expect(data.fillEndState).toBe("partial");
});

test("§16.15.3 confirming a full tank derives the pre-fill level from the litres", async ({
  page,
}) => {
  const { uid, vehicleId } = await signedInWithData(page, {
    vehicle: { make: "מאזדה", model: "3", tankLiters: 40, tankLitersSource: "user" },
  });

  await page.goto("/fillup/new");
  await page.getByLabel(/^קילומטראז׳/).fill("100000");
  await page.getByLabel("ליטרים", { exact: true }).fill("30");
  await page.getByLabel("מחיר לליטר").fill("7");
  await page.getByRole("button", { name: "פתיחת מצב המיכל" }).click();
  await page.getByRole("button", { name: "מילאתי עד מלא" }).click();

  // 40 L − 30 L ⇒ about a quarter was left, shown as an estimate.
  await expect(page.getByText("משוער לפי הכמות")).toBeVisible();

  await page.getByRole("button", { name: "שמירת תדלוק" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/(\?.*)?$/, { timeout: 20_000 });

  const records = await waitForDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`, 1);
  const data = records[0].data as Record<string, unknown>;
  expect(data.fillEndState).toBe("full");
  expect(data.fillEndStateSource).toBe("user-confirmed");
  expect(data.isFullTank).toBe(true);
  // The derivation is made by the engine at read time, not frozen into the
  // record as though the user had reported it.
  expect(data.preFillLevel ?? null).toBeNull();
});

/* ------------------------------------------------------------------ *
 * Home
 * ------------------------------------------------------------------ */

test("Home shows the tank card in place of the fuel price", async ({ page }) => {
  await freshVehicle(page);
  await page.goto("/");

  await expect(page.getByText("המיכל שלי")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("מחיר דלק נוכחי")).toHaveCount(0);
  // The full-tank range strip is gone with it.
  await expect(page.getByText("טווח נסיעה משוער במיכל מלא")).toHaveCount(0);

  await expect(page.getByRole("button", { name: "עדכון קילומטראז׳" })).toBeVisible();
  await expect(page.getByRole("button", { name: "עדכון מד הדלק" })).toBeVisible();
});

test("an odometer update is a reading, not a fill-up", async ({ page }) => {
  const { uid, vehicleId } = await freshVehicle(page);

  await page.goto("/");
  await page.getByRole("button", { name: "עדכון קילומטראז׳" }).click();
  await page.getByLabel("קילומטראז׳ נוכחי").fill("123456");
  await page.getByRole("button", { name: "שמירה" }).click();

  await expect(page.getByText("הקילומטראז׳ עודכן")).toBeVisible({ timeout: 20_000 });

  const observations = await waitForDocuments(
    `users/${uid}/vehicles/${vehicleId}/observations`,
    1,
  );
  expect(observations).toHaveLength(1);
  expect((observations[0].data as Record<string, unknown>).kind).toBe("odometer");
  expect((observations[0].data as Record<string, unknown>).confirmed).toBe(true);

  // No spending and no litres were invented.
  const fillups = await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`);
  expect(fillups).toHaveLength(0);
});

/* ------------------------------------------------------------------ *
 * Sharing
 * ------------------------------------------------------------------ */

test("§16.15.14 sharing falls back to copying only the public URL", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await freshVehicle(page);

  // No native share sheet in this browser, so the clipboard path is the one
  // that runs — which is exactly the fallback under test.
  await page.addInitScript(() => {
    // @ts-expect-error deleting an optional platform API for the test
    delete Navigator.prototype.share;
  });
  await page.goto("/settings");

  await page.getByRole("button", { name: /שיתוף האפליקציה/ }).click();
  await expect(page.getByText("הקישור הועתק")).toBeVisible({ timeout: 20_000 });

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe("https://tank-malle.web.app");
  // Nothing about the account, the vehicle or the current route travelled with it.
  expect(copied).not.toContain("fillup");
  expect(copied).not.toContain("alice");
});

test("§16.15.12 sharing uses the native sheet when the platform offers one", async ({
  page,
}) => {
  await freshVehicle(page);

  await page.addInitScript(() => {
    (window as unknown as { __shared: unknown[] }).__shared = [];
    Object.defineProperty(Navigator.prototype, "share", {
      configurable: true,
      value: (data: unknown) => {
        (window as unknown as { __shared: unknown[] }).__shared.push(data);
        return Promise.resolve();
      },
    });
  });
  await page.goto("/settings");
  await page.getByRole("button", { name: /שיתוף האפליקציה/ }).click();

  const shared = await page.evaluate(
    () => (window as unknown as { __shared: Record<string, string>[] }).__shared,
  );
  expect(shared).toHaveLength(1);
  expect(shared[0].url).toBe("https://tank-malle.web.app");
  expect(Object.keys(shared[0]).sort()).toEqual(["text", "title", "url"]);
  // The native sheet already gave feedback; the app must not add a toast.
  await expect(page.getByText("הקישור הועתק")).toHaveCount(0);
});
