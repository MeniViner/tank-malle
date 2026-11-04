import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { Outbox, OutboxOperation } from "../src/lib/outbox";
import { DENY_ALL_RULES, getDocument, installRules, listDocuments, restoreRules, seedVehicle, setActiveVehicle } from "./helpers/emulator";
import { fillupFixture, FILLUP_CAR, newServerFillup, typeFillup } from "./helpers/design-v2-fillup";
import { journalOperations } from "./helpers/journal";
import { outboxCount } from "./helpers/pwa";

test.use({ viewport: { width: 390, height: 844 } });
test.afterEach(async () => { await restoreRules(); });

const FIRESTORE_ROUTE = new RegExp(`127\\.0\\.0\\.1:${process.env.CARE_FIRESTORE_PORT ?? "8080"}/`);
const cutFirestore = (context: BrowserContext) => context.route(FIRESTORE_ROUTE, route => route.abort("connectionfailed"));
const restoreFirestore = (context: BrowserContext) => context.unroute(FIRESTORE_ROUTE);

async function create(page: Page) {
  const scope = await fillupFixture(page, { history: "none" });
  await page.getByTestId("refuel-fab").click();
  await typeFillup(page, { odometer: 100000, liters: 20, price: 7, end: "full" });
  return scope;
}

async function savedDeadline(page: Page) {
  await expect(page.getByTestId("fillup-saved")).toBeVisible();
  const deadline = Number(await page.getByTestId("fillup-saved").getAttribute("data-undo-deadline"));
  expect(Number.isFinite(deadline)).toBe(true);
  return deadline;
}

async function waitUntil(page: Page, epoch: number) {
  const remaining = await page.evaluate(epoch => epoch - Date.now(), epoch);
  if (remaining > 0) await page.waitForTimeout(remaining);
}

async function pair(page: Page, uid: string) {
  let create: OutboxOperation | undefined;
  let undo: OutboxOperation | undefined;
  await expect(async () => {
    const operations = await journalOperations(page, uid);
    create = operations.find(op => op.kind === "fillup.add");
    undo = operations.find(op => op.kind === "fillup.delete");
    expect(create).toBeDefined();
    expect(undo).toBeDefined();
    expect(undo!.path).toBe(create!.path);
    expect(undo!.beforeImage?.writeId).toBe(`${create!.opId}.${create!.version}`);
    expect(undo!.opId).not.toBe(create!.opId);
  }).toPass();
  return { create: create!, undo: undo! };
}

test("Done transfers only the original five-second Undo remainder and reload never restarts it", async ({ page }) => {
  const scope = await create(page);
  const clickedAt = await page.evaluate(() => Date.now());
  await page.getByTestId("fillup-save").click();
  const deadline = await savedDeadline(page);
  const visibleAt = await page.evaluate(() => Date.now());
  expect(deadline).toBeGreaterThanOrEqual(clickedAt + 5000);
  expect(deadline).toBeLessThanOrEqual(visibleAt + 5000);
  await expect(page.getByTestId("fillup-saved-undo")).toBeVisible();
  await expect(page.getByTestId("fillup-pump-yes")).toBeDisabled();
  await waitUntil(page, deadline - 2000);
  await page.getByTestId("fillup-saved-done").click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("button", { name: "ביטול", exact: true })).toBeVisible();
  await waitUntil(page, deadline + 350);
  await expect(page.getByRole("button", { name: "ביטול", exact: true })).toHaveCount(0);
  const saved = await newServerFillup(scope, 100000);
  await page.reload();
  await expect(page.getByTestId("home-page")).toBeVisible();
  await expect(page.getByRole("button", { name: "ביטול", exact: true })).toHaveCount(0);
  expect(await getDocument(`${scope.collection}/${saved.id}`)).toMatchObject({ liters: 20, totalCost: 140 });
  expect(await listDocuments(scope.collection)).toHaveLength(1);
});

for (const close of ["Done", "Back"] as const) test(`${close} transfers Undo which still deletes its exact creation after the form unmounts`, async ({ page }) => {
  const scope = await create(page);
  await page.getByTestId("fillup-save").click();
  await savedDeadline(page);
  if (close === "Done") await page.getByTestId("fillup-saved-done").click();
  else await page.goBack();
  await expect(page).toHaveURL("/");
  const saved = await newServerFillup(scope, 100000);
  await page.getByRole("button", { name: "ביטול", exact: true }).click();
  await expect.poll(() => getDocument(`${scope.collection}/${saved.id}`)).toBeNull();
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  expect(await listDocuments(scope.collection)).toHaveLength(0);
  await page.reload();
  await expect(page.getByTestId("home-first-fillup")).toBeVisible();
  expect(await listDocuments(scope.collection)).toHaveLength(0);
});

test("pump confirmation requires the expired deadline and true creation ACK, while Done stays available offline", async ({ page, context }) => {
  const scope = await create(page);
  await context.setOffline(true);
  try {
    await page.getByTestId("fillup-save").click();
    const deadline = await savedDeadline(page);
    await expect(page.getByTestId("fillup-saved")).toHaveAttribute("data-write-state", "pending");
    await expect(page.getByTestId("fillup-saved-done")).toBeEnabled();
    await expect(page.getByTestId("fillup-pump-yes")).toBeDisabled();
    await expect(page.getByTestId("fillup-pump-no")).toBeDisabled();
    await waitUntil(page, deadline + 250);
    await expect(page.getByTestId("fillup-saved-undo")).toHaveCount(0);
    await expect(page.getByTestId("fillup-pump-yes")).toBeDisabled();
    await expect(page.getByTestId("fillup-pump-no")).toBeDisabled();
    expect(await listDocuments(scope.collection)).toHaveLength(0);
    expect((await journalOperations(page, scope.uid)).filter(op => op.kind === "fillup.add")).toHaveLength(1);
    await context.setOffline(false);
    await expect(page.getByTestId("fillup-saved")).toHaveAttribute("data-write-state", "accepted");
    await expect(page.getByTestId("fillup-pump-yes")).toBeEnabled();
    await page.getByTestId("fillup-pump-yes").click();
    await expect(page.getByTestId("fillup-pump-confirmed")).toBeVisible();
    await expect(page.getByTestId("fillup-pump-confirmed")).toBeFocused();
    const saved = await newServerFillup(scope, 100000);
    expect(saved.data).toMatchObject({ pricePerLiter: 7, postedPricePerLiter: 7, totalCost: 140 });
    expect(await listDocuments(`users/${scope.uid}/personalPriceRules`)).toHaveLength(0);
    await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  } finally { await context.setOffline(false); }
});

test("live offline creation Undo drains the SDK create before deletion and cannot resurrect after reload", async ({ page, context }) => {
  const scope = await create(page);
  await context.setOffline(true);
  try {
    await page.getByTestId("fillup-save").click();
    await page.getByTestId("fillup-saved-undo").click();
    const linked = await pair(page, scope.uid);
    expect(linked.create.payload).toMatchObject({ odometer: 100000, liters: 20, pricePerLiter: 7, totalCost: 140 });
    expect(await listDocuments(scope.collection)).toHaveLength(0);
    await context.setOffline(false);
    await expect.poll(() => outboxCount(page, scope.uid), { timeout: 30_000 }).toBe(0);
    expect(await listDocuments(scope.collection)).toHaveLength(0);
    await page.reload();
    await expect(page.getByTestId("home-first-fillup")).toBeVisible();
    expect(await listDocuments(scope.collection)).toHaveLength(0);
  } finally { await context.setOffline(false); }
});

test("offline creation Undo survives reload as a linked retry and retires in order without resurrection", async ({ page, context }) => {
  const scope = await create(page);
  await context.setOffline(true);
  let linked: Awaited<ReturnType<typeof pair>>;
  try {
    await page.getByTestId("fillup-save").click();
    await page.getByTestId("fillup-saved-undo").click();
    linked = await pair(page, scope.uid);
    await cutFirestore(context);
    await context.setOffline(false);
    await page.goto("/settings/unsynced");
    await page.reload();
    const recovered = await journalOperations(page, scope.uid);
    expect(recovered.find(op => op.opId === linked.undo.opId)?.beforeImage).toEqual(linked.undo.beforeImage);
    expect(recovered.find(op => op.opId === linked.create.opId)?.payload).toEqual(linked.create.payload);
    await restoreFirestore(context);
    // The create was in Firestore's durable queue. The waiting transaction was
    // only journaled, so its fresh verified recovery is explicitly retryable.
    await expect.poll(() => getDocument(linked.create.path), { timeout: 30_000 }).toMatchObject({ writeId: `${linked.create.opId}.${linked.create.version}`, totalCost: 140 });
    const deletion = page.locator(`[data-outbox-op="${linked.undo.opId}"]`);
    await expect(deletion).toHaveAttribute("data-outbox-status", "failed", { timeout: 30_000 });
    await expect(deletion).toContainText("unconfirmed");
    await deletion.getByRole("button", { name: "ניסיון חוזר", exact: true }).click();
    await expect.poll(() => outboxCount(page, scope.uid), { timeout: 30_000 }).toBe(0);
    expect(await getDocument(linked.create.path)).toBeNull();
    await page.reload();
    await expect(page.locator("[data-outbox-op]")).toHaveCount(0);
    expect(await listDocuments(scope.collection)).toHaveLength(0);
  } finally { await restoreFirestore(context); await context.setOffline(false); }
});

test("Undo of a rejected initial creation retires the exact failed input and remains absent after rules recover", async ({ page }) => {
  const scope = await create(page);
  await installRules(DENY_ALL_RULES);
  await page.getByTestId("fillup-save").click();
  await expect(page.getByTestId("fillup-saved")).toHaveAttribute("data-write-state", "attention");
  const operations = await journalOperations(page, scope.uid);
  const creation = operations.find(op => op.kind === "fillup.add")!;
  expect(creation.status).toBe("failed");
  expect(creation.payload).toMatchObject({ odometer: 100000, liters: 20, totalCost: 140 });
  await page.getByTestId("fillup-saved-undo").click();
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  expect(await listDocuments(scope.collection)).toHaveLength(0);
  await restoreRules();
  await page.reload();
  await expect(page.getByTestId("home-first-fillup")).toBeVisible();
  expect(await listDocuments(scope.collection)).toHaveLength(0);
  expect(await journalOperations(page, scope.uid)).toHaveLength(0);
});

test("a newer parent input cannot be retired or resent across its retained earlier Undo", async ({ page, context }) => {
  const scope = await create(page);
  await context.setOffline(true);
  try {
    await page.getByTestId("fillup-save").click();
    await page.getByTestId("fillup-saved-undo").click();
    const linked = await pair(page, scope.uid);
    const replacement = await page.evaluate(async ({ uid, original }) => {
      const box = await (window as unknown as { __tankMalleTest: { openOutbox: (uid: string) => Promise<Outbox> } }).__tankMalleTest.openOutbox(uid);
      try { return await box.enqueue({ kind: original.kind, path: original.path, vehicleId: original.vehicleId,
        payload: { ...original.payload, notes: "קלט חדש יותר שחייב להישאר" }, beforeImage: original.beforeImage,
        opType: original.opType, replaceOpId: original.opId }); } finally { box.close(); }
    }, { uid: scope.uid, original: linked.create });
    expect(replacement.opId).toBe(linked.create.opId);
    expect(replacement.version).toBe(linked.create.version + 1);
    await context.setOffline(false);
    await expect.poll(() => getDocument(linked.create.path), { timeout: 30_000 }).toMatchObject({ writeId: `${linked.create.opId}.${linked.create.version}`, liters: 20, totalCost: 140 });
    await expect.poll(async () => (await journalOperations(page, scope.uid)).find(op => op.opId === linked.undo.opId)?.status).toBe("failed");
    expect((await journalOperations(page, scope.uid)).find(op => op.opId === linked.undo.opId)?.error?.code).toBe("undo-origin-changed");
    const retained = (await journalOperations(page, scope.uid)).find(op => op.opId === replacement.opId)!;
    expect(retained.payload).toEqual(replacement.payload);
    expect((await getDocument(linked.create.path))?.notes ?? null).toBeNull();
    // Present a recovered failed attempt through the actual Retry UI. The
    // retained later Undo must guard it before a competing create can be sent.
    await page.evaluate(async ({ uid, operation }) => {
      const box = await (window as unknown as { __tankMalleTest: { openOutbox: (uid: string) => Promise<Outbox> } }).__tankMalleTest.openOutbox(uid);
      try { await box.fail(operation.opId, operation.version, { code: "unconfirmed", message: "recovered newer input", at: Date.now() }); } finally { box.close(); }
    }, { uid: scope.uid, operation: retained });
    await page.goto("/settings/unsynced");
    const parent = page.locator(`[data-outbox-op="${retained.opId}"]`);
    await expect(parent).toHaveAttribute("data-outbox-status", "failed");
    await parent.getByRole("button", { name: "ניסיון חוזר", exact: true }).click();
    await expect(page.locator("[data-toast-title]").filter({ hasText: "ביטול" })).toBeVisible();
    let operations = await journalOperations(page, scope.uid);
    expect(operations.find(op => op.opId === retained.opId)?.payload).toEqual(replacement.payload);
    expect(operations.find(op => op.opId === linked.undo.opId)?.beforeImage).toEqual(linked.undo.beforeImage);
    expect((await getDocument(linked.create.path))?.writeId).toBe(`${linked.create.opId}.${linked.create.version}`);
    await page.getByRole("button", { name: "סגירת ההודעה", exact: true }).click();
    await expect(page.locator("[data-toast-title]").filter({ hasText: "ביטול" })).toHaveCount(0);
    await parent.getByRole("button", { name: "עריכה", exact: true }).click();
    await expect(page.getByTestId("fillup-recovered-operation")).toBeVisible();
    await page.getByTestId("fillup-save").click();
    await expect(page.locator("[data-toast-title]").filter({ hasText: "ביטול" })).toBeVisible();
    await expect(page.getByTestId("fillup-save")).toBeEnabled();
    await expect(page.getByTestId("fillup-form")).toBeVisible();
    operations = await journalOperations(page, scope.uid);
    expect(operations.find(op => op.opId === retained.opId)?.payload).toEqual(replacement.payload);
    expect(operations.find(op => op.opId === linked.undo.opId)?.beforeImage).toEqual(linked.undo.beforeImage);
    expect((await getDocument(linked.create.path))?.writeId).toBe(`${linked.create.opId}.${linked.create.version}`);
  } finally { await context.setOffline(false); }
});

test("a transferred creation Undo cannot mutate after an active vehicle A→B→A session change", async ({ page }) => {
  const scope = await create(page);
  await seedVehicle(scope.uid, "other", { ...FILLUP_CAR, model: "רכב אחר" });
  await page.getByTestId("fillup-save").click();
  const deadline = await savedDeadline(page);
  await page.getByTestId("fillup-saved-done").click();
  const saved = await newServerFillup(scope, 100000);
  await setActiveVehicle(scope.uid, "other");
  await expect(page.getByTestId("open-car-switch")).toContainText("רכב אחר");
  await setActiveVehicle(scope.uid, scope.vehicleId);
  await expect(page.getByTestId("open-car-switch")).toContainText("מאזדה 3");
  expect(await page.evaluate(() => Date.now())).toBeLessThan(deadline);
  const oldUndo = page.getByRole("button", { name: "ביטול", exact: true });
  if (await oldUndo.count()) await oldUndo.click();
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  expect(await getDocument(`${scope.collection}/${saved.id}`)).toMatchObject({ liters: 20, totalCost: 140 });
  expect(await listDocuments(`users/${scope.uid}/vehicles/other/fillups`)).toHaveLength(0);
});
