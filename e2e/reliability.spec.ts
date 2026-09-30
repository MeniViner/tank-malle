import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  DENY_ALL_RULES,
  installRules,
  listDocuments,
  resetEmulators,
  restoreRules,
  seedFillups,
} from "./helpers/emulator";
import {
  ALICE,
  BOB,
  createVehicle,
  firstVehicleId,
  signIn,
  signOut,
  signedInWithData,
  uidOf,
} from "./helpers/app";
import { outboxCount } from "./helpers/pwa";

/**
 * Data preservation, end to end.
 *
 * The incident: a fill-up the SERVER rejected was rolled back by the SDK and
 * vanished from every screen, with nothing to retry or export. These tests
 * put the real client in front of the real emulator and prove the contract:
 * a record the server has not acknowledged is never lost — it survives a
 * reload, a rejection, a sign-out and an account switch, and it can be
 * retried without a duplicate.
 *
 * Server state is read through the emulator's REST admin path, never through
 * the client's own cache, so "synced" here means synced.
 */

test.describe.configure({ mode: "serial" });

async function waitForDocuments(
  path: string,
  count: number,
  timeoutMs = 20_000,
): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const deadline = Date.now() + timeoutMs;
  let documents = await listDocuments(path);
  while (documents.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    documents = await listDocuments(path);
  }
  return documents;
}

/** Type a record into the real form. Does NOT wait for the home screen. */
async function fillForm(
  page: Page,
  input: { odometer: number; liters: number; price: number; note?: string; full?: boolean },
): Promise<void> {
  await page.goto("/fillup/new");
  await page.getByLabel(/^קילומטראז׳/).fill(String(input.odometer));
  await page.getByLabel("ליטרים", { exact: true }).fill(String(input.liters));
  await page.getByLabel("מחיר לליטר").fill(String(input.price));
  if (input.full !== false) {
    await page.getByRole("button", { name: "מילאתי מיכל מלא", exact: true }).click();
  }
  if (input.note) await page.getByLabel("הערה").fill(input.note);
  await page.getByRole("button", { name: "שמירת תדלוק" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/(\?.*)?$/, { timeout: 20_000 });
}

/**
 * "Offline" for these tests means the FIRESTORE server is unreachable, which
 * is the condition under test. Playwright's `setOffline` would also cut the
 * Vite dev server, and a reload could then not load the app at all — a
 * limitation of the test rig, not of the app (a real install has a service
 * worker). Blocking only the emulator port keeps the app loadable while every
 * Firestore request fails, exactly like a phone with no signal at the pump.
 */
const FIRESTORE_ROUTE = /127\.0\.0\.1:8080\//;
const serverUnreachable = (context: BrowserContext) =>
  context.route(FIRESTORE_ROUTE, (route) => route.abort("connectionfailed"));
const serverReachable = (context: BrowserContext) => context.unroute(FIRESTORE_ROUTE);

test.afterEach(async () => {
  // A test that swapped the rules must never leave the next one running
  // against deny-all.
  await restoreRules();
});

/* ------------------------------------------------------------------ *
 * The full form reaches the server
 * ------------------------------------------------------------------ */

test("a fill-up with station, before-level, reason, note and pump price is acknowledged by the server", async ({
  page,
}) => {
  const { uid, vehicleId } = await signedInWithData(page, {
    vehicle: { make: "מאזדה", model: "3", tankLiters: 45, tankLitersSource: "user" },
  });

  await page.goto("/fillup/new");
  await page.getByLabel(/^קילומטראז׳/).fill("120000");
  await page.getByLabel("ליטרים", { exact: true }).fill("30");
  await page.getByLabel("מחיר לליטר").fill("7.19");

  // A station, typed by name — the same five-key map geolocation would add.
  await page.getByRole("button", { name: /תחנה/ }).first().click();
  await page.getByPlaceholder("חיפוש תחנה…").fill("פז חגור");
  // The catalog loads asynchronously: until it does, the sheet offers to save
  // the typed name; once it has, a matching register entry replaces that
  // offer. Either is a five-key station map, which is what this test needs.
  const candidate = page.getByRole("button", { name: /פז חגור/ }).first();
  await expect(candidate).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /פז חגור/ }).first().click();

  // The pump-price question appears once a station is named.
  await page.getByRole("button", { name: "כן", exact: true }).click();

  // Before-level on the gauge, plus a reason.
  await page.getByRole("button", { name: "פתיחת מצב המיכל" }).click();
  const before = page.getByRole("slider", { name: "כמה דלק נשאר לפני התדלוק" });
  await before.focus();
  await before.press("Home");
  await before.press("PageUp");
  await before.press("ArrowUp");
  await expect(before).toHaveAttribute("aria-valuenow", "25");
  await page.getByText("למה תדלקת עכשיו?").click();
  await page.getByRole("button", { name: "הדלק נמוך" }).click();

  await page.getByLabel("הערה").fill("הערה ארוכה למדי על התדלוק הזה");

  await page.getByRole("button", { name: "שמירת תדלוק" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/(\?.*)?$/, { timeout: 20_000 });

  // Server-confirmed, not an optimistic toast.
  const records = await waitForDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`, 1);
  expect(records).toHaveLength(1);
  const data = records[0].data;
  expect((data.station as { name: string }).name).toContain("פז");
  expect(data.postedPricePerLiter).toBe(7.19);
  expect(data.refuelReason).toBe("low-fuel");
  expect(data.notes).toBe("הערה ארוכה למדי על התדלוק הזה");
  expect(Number(data.preFillLevel)).toBeCloseTo(0.25, 5);
  expect(data.fillEndState).toBe("partial");
  expect(data.fillEndStateSource).toBe("gauge-estimate");

  // And once acknowledged, nothing is left in the outbox.
  await expect.poll(() => outboxCount(page, uid), { timeout: 15_000 }).toBe(0);
});

/* ------------------------------------------------------------------ *
 * Offline: three records survive a reload and sync without duplicates
 * ------------------------------------------------------------------ */

test("three fill-ups saved offline survive a reload and reach the server exactly once", async ({
  page,
  context,
}) => {
  const { uid, vehicleId } = await signedInWithData(page, {});

  await serverUnreachable(context);
  await fillForm(page, { odometer: 100_000, liters: 30, price: 7 });
  await fillForm(page, { odometer: 100_400, liters: 32, price: 7 });
  await fillForm(page, { odometer: 100_800, liters: 31, price: 7 });

  // Locally saved, honestly labelled, and durably recorded.
  await expect(page.getByRole("button", { name: /נשמר במכשיר|ממתין לסנכרון/ })).toBeVisible();
  expect(await outboxCount(page, uid)).toBe(3);
  expect(await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`)).toHaveLength(0);

  await page.reload();
  await page.goto("/settings/unsynced");
  await expect(page.locator("[data-outbox-op]")).toHaveCount(3, { timeout: 20_000 });
  await expect(page.locator('[data-outbox-status="pending"]')).toHaveCount(3);

  await serverReachable(context);
  const records = await waitForDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`, 3, 30_000);
  expect(records).toHaveLength(3);
  expect(new Set(records.map((r) => r.data.odometer)).size).toBe(3);

  // Acknowledged → gone from the outbox; no second copy anywhere.
  await expect.poll(() => outboxCount(page, uid), { timeout: 20_000 }).toBe(0);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`)).toHaveLength(3);
});

/* ------------------------------------------------------------------ *
 * Rejection: the record stays, is shown, and is retried without a duplicate
 * ------------------------------------------------------------------ */

test("a fill-up the server rejects is kept with its input, and a retry after the fix syncs it once", async ({
  page,
}) => {
  const { uid, vehicleId } = await signedInWithData(page, {});

  await installRules(DENY_ALL_RULES);
  await fillForm(page, { odometer: 100_000, liters: 40, price: 7, note: "נדחה" });

  // The header says so, and the unsynced screen has the record and the error.
  await expect(page.getByRole("button", { name: "פעולות שלא סונכרנו" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "פעולות שלא סונכרנו" }).click();
  await expect(page.locator('[data-outbox-status="failed"]')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByText("permission-denied")).toBeVisible();
  await expect(page.getByText("40.00", { exact: false }).first()).toBeVisible();

  // Nothing reached the server, and the rollback did not erase the input.
  expect(await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`)).toHaveLength(0);

  // The record also shows in History, as unsynced, rather than vanishing.
  await page.goto("/history");
  await expect(page.locator("[data-history-unsynced]")).toBeVisible({ timeout: 20_000 });

  // It survives a reload.
  await page.reload();
  await page.goto("/settings/unsynced");
  await expect(page.locator('[data-outbox-status="failed"]')).toHaveCount(1, { timeout: 20_000 });

  await restoreRules();
  await page.getByRole("button", { name: "ניסיון חוזר" }).click();

  const records = await waitForDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`, 1);
  expect(records).toHaveLength(1);
  expect(records[0].data.notes).toBe("נדחה");
  await expect(page.locator("[data-outbox-op]")).toHaveCount(0, { timeout: 20_000 });

  // A second retry cannot happen (the entry is gone), and the server holds one record.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`)).toHaveLength(1);
});

test("a rejected record can be edited and re-sent under the same document id", async ({ page }) => {
  const { uid, vehicleId } = await signedInWithData(page, {});

  await installRules(DENY_ALL_RULES);
  await fillForm(page, { odometer: 100_000, liters: 40, price: 7 });
  await page.goto("/settings/unsynced");
  await expect(page.locator('[data-outbox-status="failed"]')).toHaveCount(1, { timeout: 20_000 });
  const opId = await page.locator("[data-outbox-op]").getAttribute("data-outbox-op");

  await restoreRules();
  await page.getByRole("button", { name: "עריכה", exact: true }).click();
  await expect(page.getByRole("heading", { name: "תיקון תדלוק שלא סונכרן" })).toBeVisible();
  // The input is exactly what was typed.
  await expect(page.getByLabel("ליטרים", { exact: true })).toHaveValue("40");
  await page.getByLabel("ליטרים", { exact: true }).fill("41");
  await page.getByRole("button", { name: "שמירה ושליחה מחדש" }).click();

  const records = await waitForDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`, 1);
  expect(records).toHaveLength(1);
  expect(records[0].data.liters).toBe(41);
  await expect(page.locator(`[data-outbox-op="${opId}"]`)).toHaveCount(0, { timeout: 20_000 });
});

/* ------------------------------------------------------------------ *
 * Undo after an edit reaches the server (no `id` in the patch)
 * ------------------------------------------------------------------ */

test("Undo after an edit restores the previous record on the server", async ({ page }) => {
  const { uid, vehicleId } = await signedInWithData(page, {
    fillups: [
      { id: "f1", date: new Date(Date.UTC(2026, 0, 5, 8, 0)), odometer: 100_000, liters: 40, pricePerLiter: 7 },
    ],
  });

  await page.goto("/fillup/f1");
  await expect(page.getByRole("heading", { name: "עריכת תדלוק" })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("ליטרים", { exact: true }).fill("35");
  await page.getByRole("button", { name: "שמירת שינויים" }).click();

  await expect(page.getByText("התדלוק עודכן")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => (await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`))[0]?.data.liters, {
      timeout: 15_000,
    })
    .toBe(35);

  await page.getByRole("button", { name: "ביטול", exact: true }).click();
  await expect
    .poll(async () => (await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`))[0]?.data.liters, {
      timeout: 15_000,
    })
    .toBe(40);
  await expect.poll(() => outboxCount(page, uid), { timeout: 15_000 }).toBe(0);
});

/* ------------------------------------------------------------------ *
 * Sign-out with pending writes: kept for A, invisible to B
 * ------------------------------------------------------------------ */

test("a pending record survives sign-out A → B → A and never shows up for B", async ({
  page,
  context,
}) => {
  await resetEmulators();
  await signIn(page, ALICE);
  await createVehicle(page, { make: "מאזדה", model: "3" });
  const aliceUid = await uidOf(ALICE);
  const aliceVehicle = await firstVehicleId(aliceUid);

  // The vehicle creation and the settings write are journaled too; let the
  // server acknowledge them before it becomes unreachable, so the one
  // pending entry below is the fill-up.
  await expect.poll(() => outboxCount(page, aliceUid), { timeout: 20_000 }).toBe(0);
  await serverUnreachable(context);
  await fillForm(page, { odometer: 100_000, liters: 30, price: 7, note: "של אליס" });
  expect(await outboxCount(page, aliceUid)).toBe(1);

  // Signing out with an unacknowledged write warns and keeps it.
  await page.goto("/settings/profile");
  await page.getByRole("button", { name: "התנתקות" }).first().click();
  await expect(page.getByText("יש פעולות שעדיין לא סונכרנו")).toBeVisible();
  await page.getByRole("button", { name: "התנתקות בכל זאת" }).click();
  await expect(page.getByRole("button", { name: /Google/ })).toBeVisible({ timeout: 20_000 });
  // The write never reached the server while Alice was signed in.
  expect(await listDocuments(`users/${aliceUid}/vehicles/${aliceVehicle}/fillups`)).toHaveLength(0);
  await serverReachable(context);

  // Bob sees nothing of Alice's.
  await signIn(page, BOB);
  await createVehicle(page, { make: "טויוטה", model: "יאריס" });
  await page.goto("/settings/unsynced");
  await expect(page.locator("[data-outbox-op]")).toHaveCount(0);
  await page.goto("/history");
  await expect(page.getByText("של אליס")).toHaveCount(0);
  await signOut(page);

  // Alice's record is still hers, and reaches the server now that she is back.
  await signIn(page, ALICE);
  const records = await waitForDocuments(
    `users/${aliceUid}/vehicles/${aliceVehicle}/fillups`,
    1,
    30_000,
  );
  expect(records).toHaveLength(1);
  expect(records[0].data.notes).toBe("של אליס");
  await expect.poll(() => outboxCount(page, aliceUid), { timeout: 20_000 }).toBe(0);
});

/* ------------------------------------------------------------------ *
 * Editing a record that no longer exists never becomes a new record
 * ------------------------------------------------------------------ */

test("a deep link to a missing record shows not-found instead of an empty new form", async ({
  page,
}) => {
  await signedInWithData(page, {});
  await page.goto("/fillup/does-not-exist");
  await expect(page.locator('[data-edit-state="not-found"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "שמירת תדלוק" })).toHaveCount(0);
});

test("a record changed on another device is flagged without overwriting what was typed", async ({
  page,
}) => {
  const { uid, vehicleId } = await signedInWithData(page, {
    fillups: [
      { id: "f1", date: new Date(Date.UTC(2026, 0, 5, 8, 0)), odometer: 100_000, liters: 40, pricePerLiter: 7 },
    ],
  });

  await page.goto("/fillup/f1");
  await expect(page.getByRole("heading", { name: "עריכת תדלוק" })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("הערה").fill("מה שהקלדתי");

  // Another device edits the same record.
  await seedFillups(uid, vehicleId, [
    { id: "f1", date: new Date(Date.UTC(2026, 0, 5, 8, 0)), odometer: 100_000, liters: 42, pricePerLiter: 7 },
  ]);

  await expect(page.getByText("הרשומה השתנתה במכשיר אחר")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("הערה")).toHaveValue("מה שהקלדתי");
  await expect(page.getByLabel("ליטרים", { exact: true })).toHaveValue("40");
});
