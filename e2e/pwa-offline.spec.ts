import { test, expect, type Page } from "@playwright/test";
import {
  DENY_ALL_RULES,
  installRules,
  listDocuments,
  restoreRules,
} from "./helpers/emulator";
import { signedInWithData } from "./helpers/app";
import {
  expectNetworkCut,
  fillForm,
  navigationDelivery,
  outboxCount,
  waitForServiceWorkerControl,
} from "./helpers/pwa";

/**
 * A full offline restart, against the PRODUCTION build.
 *
 * `reliability.spec.ts` proves the data-preservation contract, but its
 * "offline" is a blocked Firestore port: the dev server it runs on has no
 * service worker, so the app could not be reloaded with the network truly
 * gone. This spec runs in the `pwa` project — the built `dist/` served by
 * `vite preview`, service worker included — and takes the browser fully
 * offline with `context.setOffline(true)`: no Vite, no emulators, no fonts.
 *
 * What it proves: the app restarts from the service worker with nothing on
 * the wire; fill-ups typed in that state are kept across another cold
 * restart; and when connectivity returns they reach the server exactly once —
 * or, when the server rejects them, they stay retryable with the input intact.
 *
 * Server state is read through the emulator's REST admin path, never through
 * the client's own cache.
 */

test.describe.configure({ mode: "serial" });

async function waitForDocuments(
  path: string,
  count: number,
  timeoutMs = 30_000,
): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const deadline = Date.now() + timeoutMs;
  let documents = await listDocuments(path);
  while (documents.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    documents = await listDocuments(path);
  }
  return documents;
}

/**
 * Sign in, seed a vehicle, and warm the service worker.
 *
 * The screens the offline part will visit are loaded once online: the
 * precache holds every chunk regardless, but visiting also fills the
 * Firestore cache the history and settings screens read from on a cold start.
 */
async function primed(page: Page): Promise<{ uid: string; vehicleId: string; fillups: string }> {
  const { uid, vehicleId } = await signedInWithData(page, {});
  for (const route of ["/", "/fillup/new", "/history", "/settings/unsynced"]) {
    await page.goto(route);
    await expect(page.locator("#root")).not.toBeEmpty();
  }
  await page.goto("/");
  await waitForServiceWorkerControl(page);
  return { uid, vehicleId, fillups: `users/${uid}/vehicles/${vehicleId}/fillups` };
}

/** Reload with the network cut and prove the document came from the worker. */
async function offlineRestart(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator("#root")).not.toBeEmpty({ timeout: 20_000 });
  const delivery = await navigationDelivery(page);
  expect(delivery.workerStart, "the navigation was handled by the service worker").toBeGreaterThan(0);
  expect(delivery.transferSize, "nothing for the document came over the network").toBe(0);
  await expectNetworkCut(page);
}

test.afterEach(async () => {
  // A test that swapped the rules must never leave the next one running
  // against deny-all.
  await restoreRules();
});

/* ------------------------------------------------------------------ *
 * Offline restart, two records, another restart, rejection, retry
 * ------------------------------------------------------------------ */

test("two fill-ups saved across offline restarts are kept through a server rejection and sync once on retry", async ({
  page,
  context,
}) => {
  const { uid, fillups } = await primed(page);

  // Nothing on the wire from here: the app must restart from the worker.
  await context.setOffline(true);
  await offlineRestart(page);
  await expect(page.getByText("מאזדה", { exact: false }).first()).toBeVisible({ timeout: 20_000 });

  await fillForm(page, { odometer: 100_000, liters: 30, price: 7 });
  await fillForm(page, { odometer: 100_400, liters: 32, price: 7 });

  // Honestly labelled — saved on the device, not "synced" — and durably kept.
  await expect(page.getByRole("button", { name: /נשמר במכשיר|ממתין לסנכרון/ })).toBeVisible();
  expect(await outboxCount(page, uid)).toBe(2);

  // A second cold start, still offline: both records are listed and pending.
  await offlineRestart(page);
  await page.goto("/settings/unsynced");
  await expect(page.locator("[data-outbox-op]")).toHaveCount(2, { timeout: 20_000 });
  await expect(page.locator('[data-outbox-status="pending"]')).toHaveCount(2);
  expect(await outboxCount(page, uid)).toBe(2);

  // Connectivity returns to a server that refuses the writes. The SDK replays
  // its queue, the server rejects it, and the rollback must not erase what
  // was typed: both entries become failed, input intact, nothing on the server.
  await installRules(DENY_ALL_RULES);
  await context.setOffline(false);
  await expect(page.locator('[data-outbox-status="failed"]')).toHaveCount(2, { timeout: 45_000 });
  await expect(page.locator("[data-outbox-op]")).toHaveCount(2);
  await expect(page.getByText("30.00", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("32.00", { exact: false }).first()).toBeVisible();
  expect(await listDocuments(fillups)).toHaveLength(0);
  expect(await outboxCount(page, uid)).toBe(2);

  // The server is fixed; each entry is retried by hand and reaches it once.
  await restoreRules();
  const retry = page.getByRole("button", { name: "ניסיון חוזר" });
  await expect(retry).toHaveCount(2);
  await retry.first().click();
  await expect(page.locator("[data-outbox-op]")).toHaveCount(1, { timeout: 30_000 });
  await retry.first().click();
  await expect(page.locator("[data-outbox-op]")).toHaveCount(0, { timeout: 30_000 });

  const records = await waitForDocuments(fillups, 2);
  expect(records.map((entry) => entry.data.odometer).sort()).toEqual([100_000, 100_400]);
  expect(await outboxCount(page, uid)).toBe(0);

  // No second copy shows up later: the retry reused the original document ids.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(await listDocuments(fillups)).toHaveLength(2);
});

/* ------------------------------------------------------------------ *
 * Offline restart, one record, restart, connectivity returns — synced once
 * ------------------------------------------------------------------ */

test("a fill-up saved after an offline restart reaches the server exactly once when connectivity returns", async ({
  page,
  context,
}) => {
  const { uid, fillups } = await primed(page);

  await context.setOffline(true);
  await offlineRestart(page);
  await expect(page.getByText("מאזדה", { exact: false }).first()).toBeVisible({ timeout: 20_000 });

  await fillForm(page, { odometer: 120_000, liters: 35, price: 7.2 });
  await expect(page.getByRole("button", { name: /נשמר במכשיר|ממתין לסנכרון/ })).toBeVisible();
  expect(await outboxCount(page, uid)).toBe(1);
  expect(await listDocuments(fillups)).toHaveLength(0);

  await offlineRestart(page);
  await page.goto("/settings/unsynced");
  await expect(page.locator('[data-outbox-status="pending"]')).toHaveCount(1, { timeout: 20_000 });

  // Back online against the real rules: the queued write is delivered by the
  // SDK, acknowledged, and the outbox lets go of it. Exactly one record.
  await context.setOffline(false);
  const records = await waitForDocuments(fillups, 1);
  expect(records).toHaveLength(1);
  expect(records[0].data.odometer).toBe(120_000);
  expect(records[0].data.liters).toBe(35);

  await expect(page.locator("[data-outbox-op]")).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(() => outboxCount(page, uid), { timeout: 20_000 }).toBe(0);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(await listDocuments(fillups)).toHaveLength(1);
});
