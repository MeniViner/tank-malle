import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { decodeRawDocument } from "../src/lib/rawDocument";
import type { Outbox, OutboxOperation } from "../src/lib/outbox";
import { DENY_ALL_RULES, getDocument, installRules, listDocuments, restoreRules, seedVehicle, setActiveVehicle } from "./helpers/emulator";
import { captureJournal, journalRawFields, removeJournalDocument, replaceJournalRawFields } from "./helpers/design-v2-journal";
import { assertNoDocumentExpenses, displayDay, documentSaved, fixtureField, openVehicleDoc, replaceVehicleFixture,
  vehicleDayOffset, vehicleFixture, vehicleKeyboardLoop } from "./helpers/design-v2-vehicle";
import { holdJournal, journalOperations, releaseJournal, waitForJournalHold } from "./helpers/journal";
import { outboxCount } from "./helpers/pwa";

test.use({ viewport: { width: 390, height: 844 } });
test.afterEach(async () => { await restoreRules(); });
const LISTEN = /google\.firestore\.v1\.Firestore\/Listen\/channel/;
const rawDocs = (docs: unknown) => ({ docs: fixtureField(docs) });

type DocumentGate = {
  attempted: boolean;
  operation: OutboxOperation | null;
  writerRead: OutboxOperation | null;
  releaseEnqueue: () => void;
  releaseRead: () => void;
  restore: () => void;
};
type DocumentGateWindow = Window & {
  __tankMalleTest: { openOutbox: (uid: string) => Promise<Outbox> };
  vehicleDocumentGate?: DocumentGate;
};

/** Preserve the ordinary enqueue-return ownership handoff between two real async boundaries. */
async function holdDocumentAttempt(page: Page, uid: string, path: string) {
  await page.evaluate(async ({ uid, path }) => {
    const win = window as DocumentGateWindow;
    const rawModulePath = "/src/lib/rawDocument.ts";
    const { decodeRawDocument } = await import(rawModulePath);
    const box = await win.__tankMalleTest.openOutbox(uid);
    const prototype = Object.getPrototypeOf(box) as Outbox;
    const enqueue = prototype.enqueueMany, get = prototype.get;
    box.close();
    const owner = new WeakSet<Outbox>();
    let releaseEnqueue: () => void = () => {}, releaseRead: () => void = () => {};
    const beforeEnqueue = new Promise<void>(resolve => { releaseEnqueue = resolve; });
    const ownedRead = new Promise<void>(resolve => { releaseRead = resolve; });
    const gate: DocumentGate = {
      attempted: false, operation: null, writerRead: null, releaseEnqueue, releaseRead,
      restore: () => { prototype.enqueueMany = enqueue; prototype.get = get; releaseEnqueue(); releaseRead(); },
    };
    win.vehicleDocumentGate = gate;
    prototype.enqueueMany = async function (inputs) {
      const matches = !gate.attempted && this.uid === uid && inputs.some(input => {
        if (input.kind !== "vehicle.update" || input.opType !== "update" || input.path !== path || !input.payload) return false;
        const intent = decodeRawDocument(input.payload);
        return intent.tag === "vehicle-document-intent" && intent.key === "mandatory";
      });
      if (!matches) return enqueue.call(this, inputs);
      gate.attempted = true;
      owner.add(this);
      await beforeEnqueue;
      const operations = await enqueue.call(this, inputs);
      const operation = operations.find(op => op.kind === "vehicle.update" && op.opType === "update" && op.path === path);
      if (!operation) throw new Error("Expected the actual document-update journal operation");
      gate.operation = structuredClone(operation);
      // No awaited gate after commit: submitMany must register ownership normally.
      return operations;
    };
    prototype.get = async function (opId) {
      const operation = await get.call(this, opId);
      if (!gate.writerRead && owner.has(this) && opId === gate.operation?.opId &&
        operation?.version === gate.operation.version && operation.status === "pending") {
        gate.writerRead = structuredClone(operation);
        await ownedRead;
      }
      return operation;
    };
  }, { uid, path });
}

async function suspendListeners(context: BrowserContext) {
  await context.setOffline(true);
  await context.route(LISTEN, route => route.abort("connectionfailed"));
  await context.setOffline(false);
}

const containers = [
  { name: "missing container", docs: undefined, container: "missing", selected: { present: false }, siblings: {} },
  { name: "null container", docs: null, container: "null", selected: { present: false }, siblings: {} },
  { name: "missing selected child", docs: { coverage: { type: "none" }, future: { v: 9, text: "  untouched  " } }, container: "map", selected: { present: false },
    siblings: { coverage: { type: "none" }, future: { v: 9, text: "  untouched  " } } },
  { name: "null selected child", docs: { test: null, mandatory: { insurer: null, cost: 0 }, future: ["opaque", 7] }, container: "map", selected: { present: true, value: null },
    siblings: { mandatory: { insurer: null, cost: 0 }, future: ["opaque", 7] } },
];
for (const initial of containers) test(`document creation preserves ${initial.name} and unknown siblings through its actual journal`, async ({ page }) => {
  const scope = await vehicleFixture(page, initial.docs);
  await openVehicleDoc(page, "test");
  await page.locator("#vehicle-doc-due").fill(displayDay(vehicleDayOffset(30)));
  await holdJournal(page, scope.uid, "vehicle.update", "after");
  try {
    await page.getByTestId("vehicle-doc-save").click();
    await waitForJournalHold(page, true);
    const [operation] = await journalOperations(page, scope.uid);
    expect(operation).toMatchObject({ kind: "vehicle.update", opType: "update", path: scope.base, vehicleId: scope.vehicleId, version: 1 });
    expect(decodeRawDocument(operation.payload!)).toEqual({ tag: "vehicle-document-intent", schemaVersion: 1, key: "test", changes: { due: vehicleDayOffset(30) } });
    expect(decodeRawDocument(operation.beforeImage!)).toMatchObject({ tag: "vehicle-document-base", container: initial.container, selected: initial.selected });
    expect(await journalRawFields(scope.base)).toEqual(scope.original);
    await releaseJournal(page);
    const expectedDocs = { ...initial.siblings, test: { due: vehicleDayOffset(30) } };
    await expect.poll(() => journalRawFields(scope.base)).toEqual({ ...scope.original, ...rawDocs(expectedDocs) });
    await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
    await assertNoDocumentExpenses(scope);
    await page.reload();
    expect(await journalRawFields(scope.base)).toEqual({ ...scope.original, ...rawDocs(expectedDocs) });
  } finally { await releaseJournal(page); }
});

test("untouched exact insurance cost, an authored zero, and an authored clear remain distinct without adding an expense", async ({ page }) => {
  const docs = { test: { due: vehicleDayOffset(60) }, mandatory: { insurer: "מקור 42", due: vehicleDayOffset(120), cost: 287.4001234567,
    future: { marker: "  keep exact  ", amount: 1.23456789 } }, future: { version: "next" } };
  const scope = await vehicleFixture(page, docs);
  await expect(page.getByTestId("vehicle-doc-mandatory")).toContainText("287\u202F₪");
  await openVehicleDoc(page, "mandatory");
  await expect(page.getByTestId("vehicle-doc-cost")).toHaveValue("287.4001234567");
  await page.locator("#vehicle-doc-due").fill(displayDay(vehicleDayOffset(121)));
  const changedDue = { ...docs, mandatory: { ...docs.mandatory, due: vehicleDayOffset(121) } };
  await documentSaved(page, scope, changedDue);
  await openVehicleDoc(page, "mandatory");
  await expect(page.getByTestId("vehicle-doc-cost")).toHaveValue("287.4001234567");
  await page.getByTestId("vehicle-doc-cost").fill("0");
  const zero = { ...changedDue, mandatory: { ...changedDue.mandatory, cost: 0 } };
  await documentSaved(page, scope, zero);
  await expect(page.getByTestId("vehicle-doc-mandatory")).toContainText("0\u202F₪");
  await openVehicleDoc(page, "mandatory");
  await expect(page.getByTestId("vehicle-doc-cost")).toHaveValue("0");
  await page.getByTestId("vehicle-doc-cost").fill("");
  const cleared = { ...zero, mandatory: { ...zero.mandatory, cost: null } };
  await documentSaved(page, scope, cleared);
  await expect(page.getByTestId("vehicle-doc-mandatory")).not.toContainText("0\u202F₪");
  expect(await journalRawFields(scope.base)).toEqual({ ...scope.original, ...rawDocs(cleared) });
  await assertNoDocumentExpenses(scope);
});

test("a pending document can close with Escape while the same exact intent preserves a concurrent sibling and a newer sheet", async ({ page }) => {
  const docs = { test: { due: vehicleDayOffset(60) }, mandatory: { insurer: "מקור 42", due: vehicleDayOffset(90), cost: 287.4001234567 },
    future: { untouched: [null, "  raw  ", 0] } };
  const scope = await vehicleFixture(page, docs);
  const pendingDialog = await openVehicleDoc(page, "mandatory");
  await page.getByTestId("vehicle-doc-insurer").fill("הבחירה שלי");
  await expect(page.getByTestId("vehicle-doc-save")).toBeEnabled();
  await vehicleKeyboardLoop(page, pendingDialog);
  await holdDocumentAttempt(page, scope.uid, scope.base);
  try {
    await page.getByTestId("vehicle-doc-save").click();
    await expect.poll(() => page.evaluate(() => (window as DocumentGateWindow).vehicleDocumentGate?.attempted)).toBe(true);
    expect(await journalOperations(page, scope.uid)).toEqual([]);
    await expect(page.getByTestId("vehicle-doc-insurer")).toBeDisabled();
    await expect(page.locator("#vehicle-doc-due")).toBeDisabled();
    await expect(page.getByTestId("vehicle-doc-save")).toBeDisabled();
    await vehicleKeyboardLoop(page, pendingDialog);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("vehicle-doc-form")).toHaveCount(0);
    await expect(page.getByTestId("vehicle-doc-mandatory")).toBeFocused();
    const concurrent = { ...docs, test: { due: vehicleDayOffset(65), extra: "השתנה במקביל" }, future: { untouched: [null, "  raw  ", 0], next: true } };
    await replaceJournalRawFields(scope.base, { ...scope.original, ...rawDocs(concurrent) });
    await expect(page.getByTestId("vehicle-doc-test")).toContainText(displayDay(vehicleDayOffset(65)));
    await openVehicleDoc(page, "test");
    await page.locator("#vehicle-doc-due").fill("31/02/2027");
    await page.evaluate(() => (window as DocumentGateWindow).vehicleDocumentGate?.releaseEnqueue());
    await expect.poll(() => page.evaluate(() => Boolean((window as DocumentGateWindow).vehicleDocumentGate?.writerRead))).toBe(true);
    const captured = await page.evaluate(() => {
      const gate = (window as DocumentGateWindow).vehicleDocumentGate!;
      return { operation: gate.operation, writerRead: gate.writerRead };
    });
    const operations = await journalOperations(page, scope.uid);
    expect(operations).toEqual([captured.operation]);
    const [operation] = operations;
    expect(operation).toEqual(captured.writerRead);
    expect(operation).toMatchObject({ kind: "vehicle.update", opType: "update", path: scope.base, vehicleId: scope.vehicleId, version: 1, status: "pending" });
    expect(decodeRawDocument(operation.payload!)).toEqual({ tag: "vehicle-document-intent", schemaVersion: 1, key: "mandatory", changes: { insurer: "הבחירה שלי" } });
    expect(decodeRawDocument(operation.beforeImage!)).toMatchObject({ tag: "vehicle-document-base", container: "map", selected: { present: true, value: docs.mandatory } });
    expect(await journalRawFields(scope.base)).toEqual({ ...scope.original, ...rawDocs(concurrent) });
    await page.evaluate(() => (window as DocumentGateWindow).vehicleDocumentGate?.releaseRead());
    const expected = { ...concurrent, mandatory: { ...docs.mandatory, insurer: "הבחירה שלי" } };
    await expect.poll(() => journalRawFields(scope.base)).toEqual({ ...scope.original, ...rawDocs(expected) });
    await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
    await expect(page.getByTestId("vehicle-doc-form")).toHaveAttribute("data-doc-key", "test");
    await expect(page.locator("#vehicle-doc-due")).toHaveValue("31/02/2027");
    expect(decodeRawDocument(operation.payload!)).toMatchObject({ key: "mandatory", changes: { insurer: "הבחירה שלי" } });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("vehicle-doc-test")).toBeFocused();
    await assertNoDocumentExpenses(scope);
  } finally { await page.evaluate(() => (window as DocumentGateWindow).vehicleDocumentGate?.restore()); }
});

test("same-child concurrency retains the exact reviewed raw conflict across reload and real overwrite changes only authored leaves", async ({ page }) => {
  test.setTimeout(120_000);
  const docs = { mandatory: { insurer: "החברה המקורית", due: vehicleDayOffset(90), cost: 287.4001234567, future: { original: "  keep  " } },
    coverage: { type: "none" }, future: { marker: 42 } };
  const scope = await vehicleFixture(page, docs);
  await openVehicleDoc(page, "mandatory");
  await page.getByTestId("vehicle-doc-insurer").fill("בחירת הנהג 42");
  await page.getByTestId("vehicle-doc-cost").fill("1234.567891");
  await holdJournal(page, scope.uid, "vehicle.update", "after");
  try {
    await page.getByTestId("vehicle-doc-save").click();
    await waitForJournalHold(page, true);
    const [submitted] = await journalOperations(page, scope.uid);
    const concurrent = { ...docs, mandatory: { ...docs.mandatory, insurer: "החברה בשרת 99", cost: 398.700012345,
      due: vehicleDayOffset(91), future: { original: "  keep  ", server: "חדש" } } };
    const concurrentRaw = { ...scope.original, ...rawDocs(concurrent) };
    await replaceJournalRawFields(scope.base, concurrentRaw);
    await releaseJournal(page);
    await expect.poll(async () => (await journalOperations(page, scope.uid)).find(operation => operation.opId === submitted.opId)?.status).toBe("conflict");
    expect(await journalRawFields(scope.base)).toEqual(concurrentRaw);
    await page.goto("/settings/unsynced"); await page.reload();
    const card = page.locator(`[data-outbox-op="${submitted.opId}"]`);
    await expect(card).toHaveAttribute("data-outbox-images", "decoded");
    await expect(card.getByTestId("outbox-summary-title")).toHaveText("ביטוח חובה");
    await expect(card.getByTestId("outbox-conflict-insurer").getByTestId("outbox-value-mine")).toContainText("בחירת הנהג 42");
    await expect(card.getByTestId("outbox-conflict-insurer").getByTestId("outbox-value-server")).toContainText("החברה בשרת 99");
    await expect(card.getByTestId("outbox-conflict-cost").getByTestId("outbox-value-mine")).toContainText("1,235\u202F₪");
    await expect(card.getByTestId("outbox-conflict-cost").getByTestId("outbox-value-server")).toContainText("399\u202F₪");
    const recovered = (await journalOperations(page, scope.uid)).find(operation => operation.opId === submitted.opId)!;
    expect(recovered.payload).toEqual(submitted.payload);
    expect(recovered.beforeImage).toEqual(submitted.beforeImage);
    expect(decodeRawDocument(recovered.serverImage!)).toMatchObject({ selected: { present: true, value: concurrent.mandatory } });
    for (const theme of ["light", "dark"] as const) for (const accent of ["plate", "mint"] as const) {
      await page.goto("/account");
      await page.getByRole("button", { name: /^מראה/ }).click();
      await page.getByRole("radio", { name: theme === "light" ? "בהיר" : "כהה", exact: true }).click();
      await expect.poll(async () => (await getDocument(`users/${scope.uid}`))?.settings).toMatchObject({ theme });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^צבע/ }).click();
      await page.getByTestId(`accent-${accent}`).click();
      await expect.poll(async () => (await getDocument(`users/${scope.uid}`))?.settings).toMatchObject({ accentColor: accent });
      await page.keyboard.press("Escape");
      await expect.poll(() => outboxCount(page, scope.uid)).toBe(1);
      await page.getByTestId("account-unsynced").click();
      await expect(card.getByTestId("outbox-overwrite")).toBeEnabled();
      await captureJournal(page, `vehicle-document-conflict-${theme}-${accent}`, true);
    }
    await card.getByTestId("outbox-overwrite").click();
    const expected = { ...concurrent, mandatory: { ...concurrent.mandatory, insurer: "בחירת הנהג 42", cost: 1234.567891 } };
    await expect.poll(() => journalRawFields(scope.base)).toEqual({ ...scope.original, ...rawDocs(expected) });
    await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
    await assertNoDocumentExpenses(scope);
  } finally { await releaseJournal(page); }
});

test("a rejected document update survives reload with its original raw base and retries exactly once", async ({ page }) => {
  const docs = { test: null, mandatory: { insurer: "לפני", cost: 0, due: vehicleDayOffset(90), future: { a: 1 } } };
  const scope = await vehicleFixture(page, docs);
  await openVehicleDoc(page, "mandatory");
  await page.getByTestId("vehicle-doc-cost").fill("987.654321");
  await installRules(DENY_ALL_RULES);
  await page.getByTestId("vehicle-doc-save").click();
  await expect.poll(async () => (await journalOperations(page, scope.uid)).find(operation => operation.path === scope.base)?.status).toBe("failed");
  const [submitted] = await journalOperations(page, scope.uid);
  expect(await journalRawFields(scope.base)).toEqual(scope.original);
  await page.goto("/settings/unsynced"); await page.reload();
  const recovered = (await journalOperations(page, scope.uid)).find(operation => operation.opId === submitted.opId)!;
  expect(recovered.payload).toEqual(submitted.payload);
  expect(recovered.beforeImage).toEqual(submitted.beforeImage);
  expect(decodeRawDocument(recovered.payload!)).toMatchObject({ changes: { cost: 987.654321 } });
  await restoreRules();
  await page.locator(`[data-outbox-op="${submitted.opId}"]`).getByRole("button", { name: "ניסיון חוזר", exact: true }).click();
  const expected = { ...docs, mandatory: { ...docs.mandatory, cost: 987.654321 } };
  await expect.poll(() => journalRawFields(scope.base)).toEqual({ ...scope.original, ...rawDocs(expected) });
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  await page.reload();
  expect(await journalRawFields(scope.base)).toEqual({ ...scope.original, ...rawDocs(expected) });
  await assertNoDocumentExpenses(scope);
});

test("a document transaction cannot resurrect a missing parent and the retained conflict cannot be overwritten", async ({ page, context }) => {
  const scope = await vehicleFixture(page, { test: { due: vehicleDayOffset(60) } });
  await openVehicleDoc(page, "test");
  await page.locator("#vehicle-doc-due").fill(displayDay(vehicleDayOffset(61)));
  await holdJournal(page, scope.uid, "vehicle.update", "after");
  try {
    await page.getByTestId("vehicle-doc-save").click();
    await waitForJournalHold(page, true);
    const [operation] = await journalOperations(page, scope.uid);
    // Keep the reviewed screen alive while the actual transaction independently
    // reads the missing server parent. BatchGet and Commit stay unblocked.
    await suspendListeners(context);
    await removeJournalDocument(scope.base);
    await releaseJournal(page);
    await expect.poll(async () => (await journalOperations(page, scope.uid)).find(row => row.opId === operation.opId)?.status).toBe("conflict");
    const retained = (await journalOperations(page, scope.uid)).find(row => row.opId === operation.opId)!;
    expect(retained.payload).toEqual(operation.payload);
    expect(retained.beforeImage).toEqual(operation.beforeImage);
    expect(retained.serverImage).toBeNull();
    expect(await journalRawFields(scope.base)).toBeNull();
    await context.unroute(LISTEN);
    await page.goto("/settings/unsynced"); await page.reload();
    await expect(page.locator(`[data-outbox-op="${operation.opId}"]`).getByTestId("outbox-overwrite")).toBeDisabled();
    expect(await journalRawFields(scope.base)).toBeNull();
    expect((await journalOperations(page, scope.uid)).find(row => row.opId === operation.opId)?.payload).toEqual(operation.payload);
    expect(await listDocuments(`${scope.base}/fillups`)).toHaveLength(2);
  } finally { await releaseJournal(page); await context.unroute(LISTEN); await context.setOffline(false); }
});

test("a document intent captured before vehicle A→B→A remains scoped and preserves both vehicles", async ({ page }) => {
  const scope = await vehicleFixture(page, { test: { due: vehicleDayOffset(60) } });
  await seedVehicle(scope.uid, "docs-other", { make: "טויוטה", model: "יאריס", tankLiters: 40, tankLitersSource: "user", declaredKmPerLiter: 18 });
  const otherPath = `users/${scope.uid}/vehicles/docs-other`, otherBefore = await journalRawFields(otherPath);
  await openVehicleDoc(page, "test");
  await page.locator("#vehicle-doc-due").fill(displayDay(vehicleDayOffset(61)));
  await holdJournal(page, scope.uid, "vehicle.update", "after");
  try {
    await page.getByTestId("vehicle-doc-save").click();
    await waitForJournalHold(page, true);
    const [submitted] = await journalOperations(page, scope.uid);
    await setActiveVehicle(scope.uid, "docs-other");
    await expect(page.getByRole("heading", { name: "טויוטה יאריס", exact: true })).toBeVisible();
    await expect(page.getByTestId("vehicle-doc-form")).toHaveCount(0);
    await setActiveVehicle(scope.uid, scope.vehicleId);
    await expect(page.getByRole("heading", { name: "מאזדה 3", exact: true })).toBeVisible();
    await releaseJournal(page);
    await expect.poll(async () => (await journalOperations(page, scope.uid)).find(row => row.opId === submitted.opId)?.status).toBe("failed");
    const retained = (await journalOperations(page, scope.uid)).find(row => row.opId === submitted.opId)!;
    expect(retained.payload).toEqual(submitted.payload);
    expect(retained.beforeImage).toEqual(submitted.beforeImage);
    expect(await journalRawFields(scope.base)).toEqual(scope.original);
    expect(await journalRawFields(otherPath)).toEqual(otherBefore);
    await expect(page.getByText("פרטי הרישוי נשמרו במכשיר — ממתינים לסנכרון", { exact: true })).toHaveCount(0);
  } finally { await releaseJournal(page); }
});

test("unreadable document values stay intact and an unsupported sibling never blocks a valid document", async ({ page }) => {
  const docs = { test: { due: vehicleDayOffset(60) }, mandatory: "legacy-opaque-insurance", future: { map: [null, 0, "  exact  "] } };
  const scope = await vehicleFixture(page, docs);
  await page.getByTestId("vehicle-doc-mandatory").click();
  await expect(page.getByRole("dialog", { name: "ביטוח חובה", exact: true })).toContainText("הפרטים השמורים אינם בפורמט שניתן לערוך כאן");
  await expect(page.getByTestId("vehicle-doc-form")).toHaveCount(0);
  expect(await journalOperations(page, scope.uid)).toHaveLength(0);
  await page.keyboard.press("Escape");
  await openVehicleDoc(page, "test");
  await page.locator("#vehicle-doc-due").fill(displayDay(vehicleDayOffset(61)));
  const expected = { ...docs, test: { due: vehicleDayOffset(61) } };
  await documentSaved(page, scope, expected);
  expect(await journalRawFields(scope.base)).toEqual({ ...scope.original, ...rawDocs(expected) });
  const unsupported = await replaceVehicleFixture(page, scope, { docs: "future-container-preserve" }, "מסמך לא מוכר");
  await page.getByTestId("vehicle-doc-test").click();
  await expect(page.getByRole("dialog", { name: "טסט שנתי", exact: true })).toContainText("הפרטים השמורים אינם בפורמט שניתן לערוך כאן");
  await expect(page.getByTestId("vehicle-doc-save")).toHaveCount(0);
  expect(await journalOperations(page, scope.uid)).toHaveLength(0);
  expect(await journalRawFields(scope.base)).toEqual(unsupported);
  await assertNoDocumentExpenses(scope);
});
