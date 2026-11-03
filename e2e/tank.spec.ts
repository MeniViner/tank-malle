import { finishFillupSave, openFillupMore, openFillupTankAdvanced, setFillupEndState } from "./helpers/fillup";
import { test, expect, type Page } from "@playwright/test";
import { getDocument, listDocuments, resetEmulators, seedFillups } from "./helpers/emulator";
import { outboxCount } from './helpers/pwa';
import { journalOperations } from './helpers/journal';
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
  await createVehicle(page, { account: ALICE, make: "מאזדה", model: "3" });
  const uid = await uidOf(ALICE);
  const vehicleId = await firstVehicleId(uid);
  // These tests inspect the tank UI, after online fixture creation. The
  // vehicle can be acknowledged before its active-vehicle settings write,
  // with a briefly empty journal between the two. Confirm the actual server
  // selection, then wait for both setup receipts before a full navigation.
  // Intentional queued-write reloads live in the separate offline PWA rig.
  await expect.poll(async () => {
    const profile = await getDocument(`users/${uid}`);
    return (profile?.settings as Record<string, unknown> | undefined)?.activeVehicleId;
  }, { timeout: 20_000 }).toBe(vehicleId);
  await expect.poll(() => outboxCount(page, uid), { timeout: 20_000 }).toBe(0);
  return { uid, vehicleId };
}

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

test("§15.20 a fill-up entry sheet opens its original editor with the odometer readable", async ({
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

  const row = page.getByTestId("journal-entry-fillups/f1");
  await expect(row).toContainText("40.0");
  await row.click();

  await expect(page.getByTestId("journal-entry-sheet")).toHaveAttribute("data-entry-key", "fillups/f1");
  await expect(page.getByTestId("entry-odometer")).toContainText("169,994");
  await page.getByTestId("journal-entry-edit").click();
  await expect(page).toHaveURL(/\/fillup\/f1$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "עריכת תדלוק" })).toBeVisible();
  await expect(page.getByLabel(/^קילומטראז׳/)).toHaveValue("169994");
  // The original direct editor keeps its own deletion action too.
  await expect(page.getByTestId("fillup-delete")).toBeVisible();
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
  }, { uid, vehicleId });

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
  await openFillupMore(page);

  const gauge = page.getByRole("slider", { name: "כמה דלק נשאר לפני התדלוק" });
  await expect(gauge).toBeVisible();
  // More expands below the fold. Center the real horizontal range before raw
  // pointer input so its target is not behind the fixed Save footer.
  await gauge.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
  const box = (await gauge.boundingBox())!;
  expect(await gauge.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width * .25, box.y + box.height / 2);
    return hit === element || !!hit && element.contains(hit);
  })).toBe(true);
  // The v2 range is horizontal and physically LTR: a quarter from the left
  // retains the same 25% observation as the previous vertical control.
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.mouse.down();
  expect((await gauge.boundingBox())!.y).toBeCloseTo(box.y, 0);
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();

  await expect(gauge).toHaveValue("0.25");
  await expect(gauge).toHaveAttribute("aria-valuetext", "25%");

  // Nothing must be left holding the pointer once the finger lifts.
  expect(
    await gauge.evaluate((element) =>
      // A released capture leaves no captured pointer of any id.
      [0, 1, 2].some((id) => element.hasPointerCapture(id)),
    ),
  ).toBe(false);

  // The native range must not leave the surrounding form locked.
  const scroller = page.getByTestId("fillup-form");
  expect(
    await scroller.evaluate((element) => getComputedStyle(element).touchAction),
  ).not.toBe("none");

  // And the body scroll lock the sheets use is not engaged: this is an inline
  // expansion, not a modal.
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.move(12, 400);
  await page.mouse.wheel(0, scrollBefore > 50 ? -300 : 300);
  await expect.poll(() => page.evaluate(() => window.scrollY)).not.toBe(scrollBefore);
});

test("§16.15.9 the gauge is operable from the keyboard", async ({ page }) => {
  await freshVehicle(page);
  await page.goto("/fillup/new");
  await openFillupMore(page);

  const gauge = page.getByRole("slider", { name: "כמה דלק נשאר לפני התדלוק" });
  await gauge.focus();
  await gauge.press("Home");
  await expect(gauge).toHaveValue("0");
  await gauge.press("ArrowUp");
  await expect(gauge).toHaveValue("0.05");
  await gauge.press("PageUp");
  await expect(gauge).toHaveValue("0.25");
  await gauge.press("End");
  await expect(gauge).toHaveValue("1");
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
  await openFillupMore(page);

  const before = page.getByRole("slider", { name: "כמה דלק נשאר לפני התדלוק" });
  await before.focus();
  await before.press("Home");
  await before.press("PageUp"); // 0 → 20%
  await before.press("ArrowUp"); // 20% → 25%
  await expect(before).toHaveValue("0.25");

  // 10 L before + 20 L added = 30 L of 40 = 75%. Disclosure never supplies
  // a new reading or changes the source of this derived result.
  await openFillupTankAdvanced(page);
  await expect(page.getByRole("meter", { name: "מצב המיכל אחרי התדלוק" })).toHaveAttribute("aria-valuenow", "75");

  await page.getByRole("button", { name: "שמירת תדלוק" }).click();
  await finishFillupSave(page);

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
  await setFillupEndState(page, "full");

  // 40 L − 30 L ⇒ about a quarter was left, shown as an estimate.
  await openFillupMore(page);
  await expect(page.getByText(/משוער לפי הכמות/)).toBeVisible();

  await page.getByRole("button", { name: "שמירת תדלוק" }).click();
  await finishFillupSave(page);

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

test("a new Home has one starting block, honest unknown metrics and a direct gauge action", async ({ page }) => {
  await freshVehicle(page);
  await page.goto("/");
  await expect(page.getByText("מתחילים מהתדלוק הבא", { exact: true })).toBeVisible();
  await expect(page.getByTestId("home-km-day")).toContainText("—");
  await expect(page.getByTestId("home-fuel-month")).toContainText("—");
  await expect(page.getByTestId("home-fuel-price")).toContainText("—");
  await expect(page.getByText("טווח נסיעה משוער בתדלוק עד הסוף")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "עדכון המחוון", exact: true }).click();
  await expect(page.getByTestId("tank-sheet")).toBeVisible();
  await expect(page.getByRole("slider", { name: "כמה דלק יש עכשיו במיכל" })).toHaveAttribute("aria-valuetext", "עדיין לא סומן");
  await expect(page.getByTestId("tank-save-gauge")).toBeDisabled();
});

test("an odometer update is a reading, not a fill-up", async ({ page }, testInfo) => {
  const { uid, vehicleId } = await freshVehicle(page);

  await page.goto("/");
  // A gauge reading first, so the card has something to show and offers the
  // odometer action; the point of the test is that the odometer update is a
  // reading and not a fill-up.
  await page.getByRole("button", { name: "עדכון המחוון", exact: true }).click();
  const gauge = page.getByRole("slider", { name: "כמה דלק יש עכשיו במיכל" });
  await gauge.focus();
  await gauge.press("Home");
  await gauge.press("PageUp");
  await page.getByTestId("tank-save-gauge").click();
  await expect(page.getByText("עדכון המחוון נשמר במכשיר")).toBeVisible({
    timeout: 20_000,
  });

  await page.getByTestId("tank-hero").click();
  await page.getByTestId("tank-open-odometer").click();
  await page.getByLabel("קילומטראז׳ נוכחי").fill("123456");
  await testInfo.attach("tank-journal-before-odometer-save", {
    body: Buffer.from(JSON.stringify(await journalOperations(page, uid), null, 2)),
    contentType: "application/json",
  });
  await page.getByTestId("tank-odometer-sheet").getByRole("button", { name: "שמירה", exact: true }).click();

  await expect(page.getByText("עדכון הקילומטראז׳ נשמר במכשיר")).toBeVisible({ timeout: 20_000 });

  const observations = await waitForDocuments(
    `users/${uid}/vehicles/${vehicleId}/observations`,
    2,
  );
  const odometerReading = observations
    .map((entry) => entry.data as Record<string, unknown>)
    .find((data) => data.kind === "odometer");
  expect(odometerReading).toBeDefined();
  expect(odometerReading!.confirmed).toBe(true);

  // No spending and no litres were invented.
  const fillups = await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`);
  expect(fillups).toHaveLength(0);
  await testInfo.attach("tank-journal-after-server-readings", {
    body: Buffer.from(JSON.stringify(await journalOperations(page, uid), null, 2)),
    contentType: "application/json",
  });
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

test("unknown endpoint preserves before evidence through server read and reopening", async ({ page }) => {
  const { uid, vehicleId } = await freshVehicle(page);
  await page.goto("/fillup/new");
  await page.getByLabel(/^קילומטראז׳/).fill("100000");
  await page.getByLabel("ליטרים", { exact: true }).fill("12");
  await page.getByLabel("מחיר לליטר").fill("7");
  await setFillupEndState(page, "unknown");
  const before = page.getByRole("slider", { name: "כמה דלק נשאר לפני התדלוק" });
  await before.press("Home");
  await before.press("PageUp");
  await before.press("ArrowUp");
  await page.getByRole("button", { name: "שמירת תדלוק" }).click();
  await finishFillupSave(page);
  const [record] = await waitForDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`, 1);
  expect(record.data).toMatchObject({ fillEndState: "unknown", preFillLevel: 0.25, preFillLevelSource: "direct-gauge", postFillLevel: null });
  await page.goto(`/fillup/${record.id}`);
  await openFillupTankAdvanced(page);
  await expect(page.getByTestId("fillup-end-unknown")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("slider", { name: "כמה דלק נשאר לפני התדלוק" })).toHaveValue("0.25");
});

test("after-only entry without capacity survives editor close and server reload", async ({ page }) => {
  const { uid, vehicleId } = await freshVehicle(page);
  await page.goto("/fillup/new");
  await page.getByLabel(/^קילומטראז׳/).fill("100000");
  await page.getByLabel("ליטרים", { exact: true }).fill("12");
  await page.getByLabel("מחיר לליטר").fill("7");
  await openFillupTankAdvanced(page);
  await page.getByRole("button", { name: "לא נראה נכון?", exact: true }).click();
  const after = page.getByRole("slider", { name: "מצב המיכל אחרי התדלוק" });
  await after.press("Home");
  await after.press("PageUp");
  await after.press("PageUp");
  await after.press("PageUp");
  await expect(after).toHaveValue("0.6");
  await page.getByRole("button", { name: "סיום תיקון המד", exact: true }).click();
  await page.getByRole("button", { name: "תיקון המד אחרי", exact: true }).click();
  await page.getByRole("button", { name: "סיום תיקון המד", exact: true }).click();
  await page.getByRole("button", { name: "שמירת תדלוק" }).click();
  await finishFillupSave(page);
  const [record] = await waitForDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`, 1);
  expect(record.data).toMatchObject({ fillEndState: "partial", preFillLevel: null, postFillLevelSource: "user-correction" });
  expect(record.data.postFillLevel).toBeCloseTo(0.6, 10);
  await page.goto(`/fillup/${record.id}`);
  await openFillupTankAdvanced(page);
  await expect(page.getByRole("slider", { name: "כמה דלק נשאר לפני התדלוק" })).toHaveAttribute("aria-valuetext", "עדיין לא סומן");
  const meter = page.getByRole("meter", { name: "מצב המיכל אחרי התדלוק" });
  await expect(meter).toHaveAttribute("aria-valuetext", "60%");
  expect(Number(await meter.getAttribute("aria-valuenow"))).toBeCloseTo(60, 10);
});
