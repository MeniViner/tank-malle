import { test, expect, type Page } from "@playwright/test";
import { DENY_ALL_RULES, installRules, listDocuments, restoreRules } from "./helpers/emulator";
import { signedInWithData } from "./helpers/app";
import { outboxCount } from "./helpers/pwa";

/**
 * Outbox invariants that the UI cannot time deterministically.
 *
 * The first two tests drive the outbox through the e2e-only test hook on
 * `window` — the REAL implementation over the browser's REAL IndexedDB, in
 * two pages of one browser context (shared storage, like two tabs) — and
 * force the interleavings a review found unproven: simultaneous enqueues,
 * an acknowledgement racing an edit-and-resend, and a late answer for an
 * input that has since been replaced.
 *
 * The last two go through the screens: correcting a REJECTED edit opens the
 * rejected input rather than the server's copy, and an import whose rows
 * were rejected retries under the same ids without duplicating a row.
 */

test.describe.configure({ mode: "serial" });

type Hook = {
  openOutbox: (uid: string) => Promise<{
    enqueue: (input: Record<string, unknown>) => Promise<{ opId: string; version: number; revision: number }>;
    acknowledge: (opId: string, version: number) => Promise<boolean>;
    fail: (opId: string, version: number, error: { code: string; message: string; at: number }) => Promise<boolean>;
    claimRetry: (opId: string) => Promise<unknown>;
    get: (opId: string) => Promise<{ status: string; version: number; payload: { liters: number } | null } | null>;
    list: () => Promise<{ opId: string; revision: number; path: string; payload: { liters: number } | null }[]>;
  }>;
};

const UID = "invariants-user";
const PATH = `users/${UID}/vehicles/v1/fillups/f1`;

/** Load any app route so the e2e hook exists on `window`. */
async function ready(page: Page): Promise<void> {
  await page.goto("/legal/terms");
  await page.waitForFunction(() => Boolean((window as unknown as { __tankMalleTest?: Hook }).__tankMalleTest));
}

const enqueue = (page: Page, liters: number, replaceOpId: string | null = null, path = PATH) =>
  page.evaluate(
    async ({ uid, liters, replaceOpId, path }) => {
      const hook = (window as unknown as { __tankMalleTest: Hook }).__tankMalleTest;
      const outbox = await hook.openOutbox(uid);
      return outbox.enqueue({
        kind: "fillup.add",
        path,
        vehicleId: "v1",
        payload: { liters, odometer: 1, date: 1, pricePerLiter: 7, totalCost: liters * 7, isFullTank: true },
        replaceOpId,
      });
    },
    { uid: UID, liters, replaceOpId, path },
  );

const acknowledge = (page: Page, opId: string, version: number) =>
  page.evaluate(
    async ({ uid, opId, version }) => {
      const hook = (window as unknown as { __tankMalleTest: Hook }).__tankMalleTest;
      return (await hook.openOutbox(uid)).acknowledge(opId, version);
    },
    { uid: UID, opId, version },
  );

const reject = (page: Page, opId: string, version: number) =>
  page.evaluate(
    async ({ uid, opId, version }) => {
      const hook = (window as unknown as { __tankMalleTest: Hook }).__tankMalleTest;
      return (await hook.openOutbox(uid)).fail(opId, version, { code: "permission-denied", message: "e2e", at: 1 });
    },
    { uid: UID, opId, version },
  );

const getOp = (page: Page, opId: string) =>
  page.evaluate(
    async ({ uid, opId }) => {
      const hook = (window as unknown as { __tankMalleTest: Hook }).__tankMalleTest;
      return (await hook.openOutbox(uid)).get(opId);
    },
    { uid: UID, opId },
  );

const listOps = (page: Page) =>
  page.evaluate(async (uid) => {
    const hook = (window as unknown as { __tankMalleTest: Hook }).__tankMalleTest;
    return (await hook.openOutbox(uid)).list();
  }, UID);

test.afterEach(async () => {
  await restoreRules();
});

test("two pages enqueuing at once both keep their input, with distinct revisions per document", async ({
  context,
}) => {
  const page1 = await context.newPage();
  const page2 = await context.newPage();
  await ready(page1);
  await ready(page2);

  const results = await Promise.all([
    enqueue(page1, 11),
    enqueue(page2, 12),
    enqueue(page1, 13, null, `users/${UID}/vehicles/v1/fillups/f2`),
    enqueue(page2, 14, null, `users/${UID}/vehicles/v1/fillups/f3`),
    enqueue(page1, 15),
    enqueue(page2, 16),
  ]);

  const stored = await listOps(page2);
  expect(stored.map((op) => op.payload!.liters).sort((a, b) => a - b)).toEqual([11, 12, 13, 14, 15, 16]);
  const f1Revisions = results.filter((_, index) => [0, 1, 4, 5].includes(index)).map((op) => op.revision);
  expect(new Set(f1Revisions).size).toBe(4);
  expect(await outboxCount(page1, UID)).toBe(6);
});

test("a late acknowledgement or rejection of the previous input never touches the edited one, across pages", async ({
  context,
}) => {
  const page1 = await context.newPage();
  const page2 = await context.newPage();
  await ready(page1);
  await ready(page2);

  // Version 1 from page 1; page 2 edits and re-sends under the same op.
  const v1 = await enqueue(page1, 30);
  const v2 = await enqueue(page2, 31, v1.opId);
  expect(v2.opId).toBe(v1.opId);
  expect(v2.version).toBe(2);

  // v1's acknowledgement and v2's rejection arrive, from either page.
  expect(await acknowledge(page1, v1.opId, v1.version)).toBe(false);
  expect(await reject(page2, v1.opId, v2.version)).toBe(true);

  const stored = (await getOp(page1, v1.opId))!;
  expect(stored.status).toBe("failed");
  expect(stored.payload!.liters).toBe(31);

  // Now the race the other way round: an acknowledgement racing an edit.
  const w1 = await enqueue(page1, 40, null, `users/${UID}/vehicles/v1/fillups/f9`);
  await Promise.all([acknowledge(page1, w1.opId, w1.version), enqueue(page2, 41, w1.opId, `users/${UID}/vehicles/v1/fillups/f9`)]);
  const after = (await getOp(page2, w1.opId))!;
  expect(after).not.toBeNull();
  expect(after.payload!.liters).toBe(41);
  expect(after.status).toBe("pending");

  // A page that reloads still sees every entry: the journal is on disk.
  await page2.reload();
  await ready(page2);
  expect(await outboxCount(page2, UID)).toBeGreaterThanOrEqual(2);
});

test("correcting a rejected edit opens the rejected input, not the server's copy, and re-sends under the same operation", async ({
  page,
}) => {
  const { uid, vehicleId } = await signedInWithData(page, {
    fillups: [
      { id: "f1", date: new Date(Date.UTC(2026, 0, 5, 8, 0)), odometer: 100_000, liters: 40, pricePerLiter: 7 },
    ],
  });

  await installRules(DENY_ALL_RULES);
  await page.goto("/fillup/f1");
  await expect(page.getByRole("heading", { name: "עריכת תדלוק" })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("ליטרים", { exact: true }).fill("35");
  await page.getByLabel("הערה").fill("תיקון");
  await page.getByRole("button", { name: "שמירת שינויים" }).click();
  await expect(page.getByText("התדלוק עודכן")).toBeVisible({ timeout: 20_000 });

  // The server refused it; the server still holds 40.
  await page.goto("/settings/unsynced");
  await expect(page.locator('[data-outbox-status="failed"]')).toHaveCount(1, { timeout: 20_000 });
  expect((await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`))[0].data.liters).toBe(40);

  // Editing the failed operation shows the REJECTED input (35), not 40.
  await page.getByRole("button", { name: "עריכה", exact: true }).click();
  await expect(page.getByRole("heading", { name: "תיקון תדלוק שלא סונכרן" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("ליטרים", { exact: true })).toHaveValue("35");
  await expect(page.getByLabel("הערה")).toHaveValue("תיקון");

  await restoreRules();
  await page.getByLabel("ליטרים", { exact: true }).fill("36");
  await page.getByRole("button", { name: "שמירה ושליחה מחדש" }).click();
  await expect(page).toHaveURL(/settings\/unsynced/, { timeout: 20_000 });

  await expect
    .poll(async () => (await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`))[0]?.data.liters, {
      timeout: 20_000,
    })
    .toBe(36);
  const record = (await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`))[0].data;
  expect(record.notes).toBe("תיקון");
  // The rules accepted exactly one version step over the unversioned seed.
  expect(record.version).toBe(1);
  await expect(page.locator("[data-outbox-op]")).toHaveCount(0, { timeout: 20_000 });
  expect(await outboxCount(page, uid)).toBe(0);
});

test("a stale edit is refused by the server, kept as a conflict, and never overwrites the newer version silently", async ({
  page,
}) => {
  const { uid, vehicleId } = await signedInWithData(page, {
    fillups: [
      { id: "f1", date: new Date(Date.UTC(2026, 0, 5, 8, 0)), odometer: 100_000, liters: 40, pricePerLiter: 7 },
    ],
  });

  await page.goto("/fillup/f1");
  await expect(page.getByRole("heading", { name: "עריכת תדלוק" })).toBeVisible({ timeout: 20_000 });
  // Another device edits first, the way a versioned client writes: the whole
  // document, stamped version 1. (The REST patch replaces the document, so
  // every field is given.)
  const { setDocument } = await import("./helpers/emulator");
  await setDocument(`users/${uid}/vehicles/${vehicleId}/fillups/f1`, {
    date: new Date(Date.UTC(2026, 0, 5, 8, 0)),
    odometer: 100_000,
    liters: 42,
    pricePerLiter: 7,
    totalCost: 294,
    isFullTank: true,
    continuityBreakBefore: false,
    createdAt: new Date(Date.UTC(2026, 0, 5, 8, 0)),
    version: 1,
  });
  await expect(page.getByText("הרשומה השתנתה במכשיר אחר")).toBeVisible({ timeout: 20_000 });

  // This device saves its own edit made against the unversioned base (→ version 1).
  await page.getByLabel("ליטרים", { exact: true }).fill("35");
  await page.getByRole("button", { name: "שמירת שינויים" }).click();

  // The server refuses the stale version; the newer 42 stays, the input is
  // kept, and the entry is reported as a CONFLICT (the server moved past the
  // base), whether that verdict comes from the rejection or the reconcile.
  // The toast fires once the journal transaction has committed; only then is
  // it meaningful to leave the page. (Navigating within milliseconds of the
  // click would abandon the save before anything was journaled or sent —
  // the same as closing an unsaved form.)
  await expect(page.getByText("התדלוק עודכן")).toBeVisible({ timeout: 20_000 });
  await page.goto("/settings/unsynced");
  await expect(page.locator('[data-outbox-status="conflict"]')).toHaveCount(1, { timeout: 20_000 });
  expect((await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`))[0].data.liters).toBe(42);
  await expect(page.locator('[data-outbox-op]').getByText("35.00")).toBeVisible();

  // Only an explicit overwrite moves the server, and it does so on the new base.
  await page.getByRole("button", { name: "לדרוס עם הגרסה שלי" }).click();
  await expect
    .poll(async () => (await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`))[0]?.data.liters, {
      timeout: 20_000,
    })
    .toBe(35);
  expect((await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`))[0].data.version).toBe(2);
  await expect(page.locator("[data-outbox-op]")).toHaveCount(0, { timeout: 20_000 });
});

test("a retry that cannot verify against the server writes nothing", async ({ page }) => {
  const { uid, vehicleId } = await signedInWithData(page, {});
  await installRules(DENY_ALL_RULES);
  await page.goto("/fillup/new");
  await page.getByLabel(/^קילומטראז׳/).fill("100000");
  await page.getByLabel("ליטרים", { exact: true }).fill("40");
  await page.getByLabel("מחיר לליטר").fill("7");
  await page.getByRole("button", { name: "מילאתי מיכל מלא", exact: true }).click();
  await page.getByRole("button", { name: "שמירת תדלוק" }).click();
  // Leave only once the save has been journaled (the form navigates home).
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/(\?.*)?$/, { timeout: 20_000 });
  await page.goto("/settings/unsynced");
  await expect(page.locator('[data-outbox-status="failed"]')).toHaveCount(1, { timeout: 20_000 });

  // Writes are allowed again but the verification READ is refused: an
  // unauthorised (or unreachable) verification is not permission to write.
  // The write rule is deliberately open here, so a retry that skipped the
  // check would land on the server and be caught.
  await installRules(`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read: if false; allow write: if request.auth != null; }
  }
}`);
  await page.getByRole("button", { name: "ניסיון חוזר" }).click();
  await expect(page.getByText(/לא ניתן היה לאמת/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-outbox-status="failed"]')).toHaveCount(1);
  expect(await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`)).toHaveLength(0);

  // Verification possible again: the same retry verifies (absent) and writes once.
  await restoreRules();
  await page.getByRole("button", { name: "ניסיון חוזר" }).click();
  await expect
    .poll(async () => (await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`)).length, { timeout: 30_000 })
    .toBe(1);
  await expect(page.locator("[data-outbox-op]")).toHaveCount(0, { timeout: 20_000 });
});

test("an import interrupted by a reload settles every journal entry — rows and batch record — and retries without duplicates", async ({
  page,
  context,
}) => {
  const { uid, vehicleId } = await signedInWithData(page);
  const { fileURLToPath } = await import("node:url");
  const fixture = fileURLToPath(new URL("../src/lib/import/__fixtures__/legacy-fuel-tracker.csv", import.meta.url));
  const FIRESTORE = /127\.0\.0\.1:8080\//;

  // The server is unreachable while the import runs, so all eight writes
  // (seven rows and the batch record) are journaled and queued, none
  // answered. Then the page reloads: every write promise dies with it, and
  // the entries are orphans the new page must settle on its own.
  await context.route(FIRESTORE, (route) => route.abort("connectionfailed"));
  await page.goto("/settings/import");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByRole("button", { name: /ייבוא 7 רשומות/ }).click();
  await expect(page.getByText("הייבוא הסתיים")).toBeVisible({ timeout: 25_000 });
  await expect.poll(() => outboxCount(page, uid), { timeout: 15_000 }).toBe(8);

  await page.goto("/settings/unsynced");
  await expect(page.locator('[data-outbox-status="pending"]')).toHaveCount(8, { timeout: 25_000 });

  // The server comes back refusing everything: the SDK re-sends the queued
  // writes, they are rejected, and — with no promise left to report it —
  // only the per-document reconciliation can turn "pending" into "failed".
  // The batch record lives in a collection with no query listener at all.
  await installRules(DENY_ALL_RULES);
  await context.unroute(FIRESTORE);
  await page.reload();
  await page.goto("/settings/unsynced");
  await expect(page.locator('[data-outbox-status="failed"]')).toHaveCount(8, { timeout: 40_000 });
  expect(await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`)).toHaveLength(0);
  expect(await listDocuments(`users/${uid}/importBatches`)).toHaveLength(0);
  const journaled = await page.locator("[data-outbox-op]").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-outbox-op")),
  );
  expect(new Set(journaled).size).toBe(8);

  await restoreRules();
  for (let i = 0; i < 8; i += 1) {
    await page.getByRole("button", { name: "ניסיון חוזר" }).first().click();
    await expect(page.locator("[data-outbox-op]")).toHaveCount(7 - i, { timeout: 20_000 });
  }

  const rows = await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`);
  expect(rows).toHaveLength(7);
  expect(new Set(rows.map((row) => row.data.importRowHash)).size).toBe(7);
  expect(rows.every((row) => row.data.version === 1)).toBe(true);
  expect(await listDocuments(`users/${uid}/importBatches`)).toHaveLength(1);

  // Re-importing the same file now finds all seven as duplicates.
  await page.goto("/settings/import");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.getByText("כבר קיימות", { exact: true }).locator("..")).toContainText("7", { timeout: 25_000 });
});

test("an import rejected by the server keeps every row with its error, and retries under the same ids", async ({
  page,
}) => {
  const { uid, vehicleId } = await signedInWithData(page);
  const { fileURLToPath } = await import("node:url");
  const fixture = fileURLToPath(new URL("../src/lib/import/__fixtures__/legacy-fuel-tracker.csv", import.meta.url));

  await installRules(DENY_ALL_RULES);
  await page.goto("/settings/import");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByRole("button", { name: /ייבוא 7 רשומות/ }).click();
  // "Done" is shown only once every commit — the batch record's included —
  // has been answered.
  await expect(page.getByText("הייבוא הסתיים")).toBeVisible({ timeout: 25_000 });

  await page.goto("/settings/unsynced");
  await expect(page.locator('[data-outbox-status="failed"]')).toHaveCount(8, { timeout: 25_000 });
  await expect(page.getByText("permission-denied").first()).toBeVisible();
  expect(await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`)).toHaveLength(0);

  await restoreRules();
  for (let i = 0; i < 8; i += 1) {
    await page.getByRole("button", { name: "ניסיון חוזר" }).first().click();
    await expect(page.locator("[data-outbox-op]")).toHaveCount(7 - i, { timeout: 20_000 });
  }
  expect(await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`)).toHaveLength(7);
  expect(await listDocuments(`users/${uid}/importBatches`)).toHaveLength(1);
});
