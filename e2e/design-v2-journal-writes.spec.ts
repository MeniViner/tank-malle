import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Timestamp } from "firebase/firestore";
import { decodeRawDocument } from "../src/lib/rawDocument";
import type { Outbox } from "../src/lib/outbox";
import { DENY_ALL_RULES, getDocument, installRules, listDocuments, restoreRules, seedVehicle, setActiveVehicle, setDocument } from "./helpers/emulator";
import { captureJournal, journalFixture, journalRawFields, openJournalEntry, removeJournalDocument, replaceJournalRawFields, type RawFields } from "./helpers/design-v2-journal";
import { holdJournal, journalOperations, releaseJournal, waitForJournalHold } from "./helpers/journal";
import { outboxCount } from "./helpers/pwa";
import { openFillupMore } from "./helpers/fillup";

test.use({ viewport: { width: 390, height: 844 } });
test.afterEach(async () => { await restoreRules(); });
const LISTEN = /google\.firestore\.v1\.Firestore\/Listen\/channel/;
const COMMIT = /\/documents:commit(?:\?|$)/;
type Source = "observation" | "service" | "issue" | "fillup";

async function fixture(page: Page, source: Source) {
  const scope = await journalFixture(page, false);
  const key = source === "observation" ? "observations/exact-raw" : source === "service" ? "serviceEvents/exact-raw"
    : source === "issue" ? "vehicleIssues/exact-raw" : "fillups/journal-last";
  const path = `${scope.base}/${key}`;
  if (source === "observation") {
    await setDocument(path, { observedAt: new Date(`${scope.day(-1, 28)}T10:00:00Z`),
      recordedAt: new Date(`${scope.day(-1, 29)}T11:00:00Z`), kind: "level", level: 0,
      levelUncertainty: null, levelSource: "imported-legacy", confirmed: true, fillupId: null });
    const raw = (await journalRawFields(path))!;
    await replaceJournalRawFields(path, { ...raw,
      observedAt: { timestampValue: `${scope.day(-1, 28)}T10:00:00.123456Z` },
      recordedAt: { timestampValue: `${scope.day(-1, 29)}T11:00:00.987654Z` },
    });
  } else if (source === "service") {
    await setDocument(path, { schemaVersion: 1, version: 7, day: scope.day(-1, 28), title: "חשבונית מדויקת 88",
      jobs: ["brakes", "oil"], odometer: null, costAgorot: 12345, garage: "מוסך מדויק 12", notes: "  הערה מקורית 42  ", completedPlanIds: [] });
  } else if (source === "issue") {
    await setDocument(path, { schemaVersion: 1, version: 7, day: scope.day(-1, 28), title: "רעש מדויק 88", symptoms: "בפנייה",
      odometer: null, importance: "normal", status: "resolved", notes: "מקור שלא משנים",
      serviceEventIds: ["service-b", "service-a"],
      history: [`{ "note" : "שמן", "day" : "${scope.day(-1, 28)}", "status" : "resolved" }`] });
  }
  await page.goto(source === "issue" ? "/history?kind=issue" : "/history");
  await expect(page.getByTestId(`journal-entry-${key}`)).toBeVisible();
  // A cached row has no authoritative raw image yet. Capture the record only
  // after the actual scoped listeners have supplied a complete server view.
  await expect(page.getByTestId("journal-coverage")).toHaveCount(0);
  const raw = (await journalRawFields(path))!;
  if (source === "observation") expect(raw.observedAt).toEqual({ timestampValue: `${scope.day(-1, 28)}T10:00:00.123456Z` });
  return { ...scope, source, key, path, raw,
    deleteKind: source === "observation" ? "tank.observation.delete" as const : source === "fillup" ? "fillup.delete" as const : "maintenance.delete" as const,
    restoreKind: source === "observation" ? "tank.observation" as const : source === "fillup" ? "fillup.restore" as const : "maintenance.save" as const };
}

async function confirmDelete(page: Page, key: string) {
  await openJournalEntry(page, key);
  await page.getByTestId("journal-entry-delete").click();
  await page.getByRole("alertdialog", { name: "מחיקת הרשומה?", exact: true })
    .getByRole("button", { name: "מחיקת הרשומה", exact: true }).click();
}

async function acceptedDelete(page: Page, path: string, uid: string) {
  await expect(page.locator("[data-toast-title]").filter({ hasText: /^הרשומה נמחקה$/ })).toBeVisible();
  expect(await journalRawFields(path)).toBeNull();
  await expect.poll(() => outboxCount(page, uid)).toBe(0);
  await expect(page.getByRole("button", { name: "ביטול", exact: true })).toBeVisible();
}

async function disconnectListeners(context: BrowserContext) {
  // End an existing long-poll stream before blocking subsequent Listen calls.
  // Actual transaction BatchGet/Commit requests remain available afterward.
  await context.setOffline(true);
  await context.route(LISTEN, route => route.abort("connectionfailed"));
  await context.setOffline(false);
}

for (const source of ["observation", "service", "issue"] as const) test(`Journal ${source} Undo restores the exact raw source after navigation and retires the delete first`, async ({ page }) => {
  const scope = await fixture(page, source);
  let releaseCommit = () => {};
  let held = false;
  let commitReleasedAt = 0;
  const gate = new Promise<void>(resolve => { releaseCommit = resolve; });
  if (source === "observation") await page.route(COMMIT, async route => {
    if (!held && route.request().postData()?.includes(scope.path)) {
      held = true;
      await gate;
    }
    await route.continue();
  });
  try {
    await confirmDelete(page, scope.key);
    if (source === "observation") {
      await expect.poll(() => held).toBe(true);
      await expect(page.getByRole("button", { name: "ביטול", exact: true })).toHaveCount(0);
      expect(await journalRawFields(scope.path)).toEqual(scope.raw);
      const deletion = (await journalOperations(page, scope.uid)).find(op => op.path === scope.path)!;
      expect(deletion.kind).toBe("tank.observation.delete");
      expect(deletion.status).toBe("pending");
      const captured = decodeRawDocument(deletion.beforeImage!);
      expect(captured.observedAt).toBeInstanceOf(Timestamp);
      expect((captured.observedAt as Timestamp).nanoseconds).toBe(123456000);
      expect(captured.level).toBe(0);
      expect(captured.levelUncertainty).toBeNull();
      expect(Object.hasOwn(captured, "odometer")).toBe(false);
      await page.getByTestId("tab-home").click();
      commitReleasedAt = await page.evaluate(() => Date.now());
      releaseCommit();
      await acceptedDelete(page, scope.path, scope.uid);
    } else {
      await acceptedDelete(page, scope.path, scope.uid);
      await page.getByTestId("tab-home").click();
    }
    if (source === "observation") {
      // A refused disk commit must not consume the user's only Undo. The
      // retry still occurs inside the original, unextended five-second window.
      await holdJournal(page, scope.uid, scope.restoreKind, "before");
      await page.getByRole("button", { name: "ביטול", exact: true }).click();
      await waitForJournalHold(page);
      expect(await journalOperations(page, scope.uid)).toHaveLength(0);
      expect(await journalRawFields(scope.path)).toBeNull();
      await releaseJournal(page, true);
      await expect(page.locator("[data-toast-title]").filter({ hasText: "e2e: journal storage refused this attempt" })).toBeVisible();
      await expect(page.getByRole("button", { name: "ביטול", exact: true })).toBeVisible();
      expect(await page.evaluate(() => Date.now()) - commitReleasedAt).toBeLessThan(5000);
      expect(await journalOperations(page, scope.uid)).toHaveLength(0);
      expect(await journalRawFields(scope.path)).toBeNull();
    }
    await page.getByRole("button", { name: "ביטול", exact: true }).click();
    const expected = source === "observation" ? scope.raw : { ...scope.raw, version: { integerValue: "1" } };
    await expect.poll(() => journalRawFields(scope.path)).toEqual(expected);
    await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
    await page.reload();
    expect(await journalRawFields(scope.path)).toEqual(expected);
    await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  } finally { releaseCommit(); await releaseJournal(page); if (source === "observation") await page.unroute(COMMIT); }
});

for (const attempt of ["initial", "retry"] as const) test(`observation ${attempt} deletion detects a raw sub-millisecond edit and preserves both server image and original journal`, async ({ page, context }) => {
  const scope = await fixture(page, "observation");
  if (attempt === "initial") await holdJournal(page, scope.uid, scope.deleteKind, "after");
  else await installRules(DENY_ALL_RULES);
  try {
    await confirmDelete(page, scope.key);
    if (attempt === "initial") await waitForJournalHold(page, true);
    else await expect.poll(async () => (await journalOperations(page, scope.uid)).find(op => op.path === scope.path)?.status).toBe("failed");
    const original = (await journalOperations(page, scope.uid)).find(op => op.path === scope.path)!;
    const before = decodeRawDocument(original.beforeImage!);
    expect((before.observedAt as Timestamp).nanoseconds).toBe(123456000);
    if (attempt === "retry") {
      await disconnectListeners(context);
      await page.goto("/settings/unsynced");
      await page.reload();
      const recovered = (await journalOperations(page, scope.uid)).find(op => op.opId === original.opId)!;
      expect(recovered.beforeImage).toEqual(original.beforeImage);
      expect(recovered.payload).toBeNull();
    }
    const concurrent: RawFields = { ...scope.raw, observedAt: { timestampValue: `${scope.day(-1, 28)}T10:00:00.123457Z` } };
    await replaceJournalRawFields(scope.path, concurrent);
    expect(await journalRawFields(scope.path)).toEqual(concurrent);
    if (attempt === "initial") await releaseJournal(page);
    else {
      await restoreRules();
      await page.getByRole("button", { name: "ניסיון חוזר", exact: true }).click();
    }
    await expect.poll(async () => (await journalOperations(page, scope.uid)).find(op => op.opId === original.opId)?.status).toBe("conflict");
    const conflict = (await journalOperations(page, scope.uid)).find(op => op.opId === original.opId)!;
    expect(conflict.beforeImage).toEqual(original.beforeImage);
    expect(conflict.payload).toBeNull();
    expect((decodeRawDocument(conflict.serverImage!).observedAt as Timestamp).nanoseconds).toBe(123457000);
    expect(await journalRawFields(scope.path)).toEqual(concurrent);
    await expect(page.getByRole("button", { name: "ביטול", exact: true })).toHaveCount(0);
    if (attempt === "retry") {
      const difference = page.getByTestId("outbox-conflict-observedAt");
      await expect(difference.getByTestId("outbox-value-mine")).toContainText(".123456000");
      await expect(difference.getByTestId("outbox-value-server")).toContainText(".123457000");
    }
  } finally { await releaseJournal(page); await context.unroute(LISTEN); await context.setOffline(false); }
});

test("an already absent observation is acknowledged without inventing an Undo or recreating it", async ({ page }) => {
  const scope = await fixture(page, "observation");
  await holdJournal(page, scope.uid, scope.deleteKind, "after");
  try {
    await confirmDelete(page, scope.key);
    await waitForJournalHold(page, true);
    await removeJournalDocument(scope.path);
    await releaseJournal(page);
    await expect(page.locator("[data-toast-title]").filter({ hasText: "הרשומה כבר אינה ביומן" })).toBeVisible();
    await expect(page.getByRole("button", { name: "ביטול", exact: true })).toHaveCount(0);
    await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
    expect(await journalRawFields(scope.path)).toBeNull();
  } finally { await releaseJournal(page); }
});

test("an old observation deletion remains invalid after the active vehicle changes away and back", async ({ page }) => {
  const scope = await fixture(page, "observation");
  await seedVehicle(scope.uid, "journal-other-car", { make: "טויוטה", model: "יאריס", fuelType: "95", tankLiters: 40, tankLitersSource: "user", declaredKmPerLiter: 18 });
  await holdJournal(page, scope.uid, scope.deleteKind, "after");
  try {
    await confirmDelete(page, scope.key);
    await waitForJournalHold(page, true);
    const submitted = (await journalOperations(page, scope.uid)).find(op => op.path === scope.path)!;
    await setActiveVehicle(scope.uid, "journal-other-car");
    await expect(page.getByTestId(`journal-entry-${scope.key}`)).toHaveCount(0);
    await expect(page.getByRole("alertdialog", { name: "מחיקת הרשומה?", exact: true })).toHaveCount(0);
    await setActiveVehicle(scope.uid, scope.vehicleId);
    await expect(page.getByTestId(`journal-entry-${scope.key}`)).toBeVisible();
    await releaseJournal(page);
    await expect.poll(async () => (await journalOperations(page, scope.uid)).find(op => op.opId === submitted.opId)?.status).toBe("failed");
    const retained = (await journalOperations(page, scope.uid)).find(op => op.opId === submitted.opId)!;
    expect(retained.beforeImage).toEqual(submitted.beforeImage);
    expect(retained.payload).toBeNull();
    expect(await journalRawFields(scope.path)).toEqual(scope.raw);
    await expect(page.getByRole("button", { name: "ביטול", exact: true })).toHaveCount(0);
  } finally { await releaseJournal(page); }
});

test("a recovered encoded care conflict exposes exact competing fields and malformed snapshots cannot be overwritten", async ({ page }) => {
  test.setTimeout(90_000);
  const scope = await fixture(page, "service");
  await holdJournal(page, scope.uid, scope.deleteKind, "after");
  try {
    await confirmDelete(page, scope.key);
    await waitForJournalHold(page, true);
    const submitted = (await journalOperations(page, scope.uid)).find(op => op.path === scope.path)!;
    const concurrent = { ...scope.raw, version: { integerValue: "8" }, title: { stringValue: "החשבונית בשרת 99" }, costAgorot: { integerValue: "24680" } };
    await replaceJournalRawFields(scope.path, concurrent);
    await releaseJournal(page);
    await expect.poll(async () => (await journalOperations(page, scope.uid)).find(op => op.opId === submitted.opId)?.status).toBe("conflict");
    await page.goto("/settings/unsynced");
    await page.reload();
    const card = page.locator(`[data-outbox-op="${submitted.opId}"]`);
    await expect(card).toHaveAttribute("data-outbox-images", "decoded");
    await expect(card.getByTestId("outbox-summary-title")).toHaveText("חשבונית מדויקת 88");
    await expect(card.getByTestId("outbox-summary-amount")).toHaveText("₪123");
    await expect(card.getByTestId("outbox-conflict-title").getByTestId("outbox-value-mine")).toContainText("חשבונית מדויקת 88");
    await expect(card.getByTestId("outbox-conflict-title").getByTestId("outbox-value-server")).toContainText("החשבונית בשרת 99");
    await expect(card.getByTestId("outbox-conflict-costAgorot").getByTestId("outbox-value-mine")).toContainText("₪123");
    await expect(card.getByTestId("outbox-conflict-costAgorot").getByTestId("outbox-value-server")).toContainText("₪247");
    const recovered = (await journalOperations(page, scope.uid)).find(op => op.opId === submitted.opId)!;
    expect(recovered.beforeImage).toEqual(submitted.beforeImage);
    expect(decodeRawDocument(recovered.serverImage!)).toMatchObject({ costAgorot: 24680, title: "החשבונית בשרת 99" });

    const appearance = async (theme: "light" | "dark", accent: "plate" | "mint") => {
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
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    };
    for (const theme of ["light", "dark"] as const) for (const accent of ["plate", "mint"] as const) {
      await appearance(theme, accent);
      await expect(card.getByTestId("outbox-conflict-details")).toBeVisible();
      await captureJournal(page, `journal-care-conflict-${theme}-${accent}`, true);
    }
    // Exercise a malformed recovered envelope in the actual durable journal.
    // Its recognizable codec marker must never fall through to a plain write.
    const malformed = { __tankMalehRawDocument: { version: 999, document: null } };
    const replacement = await page.evaluate(async ({ uid, opId, malformed }) => {
      const box = await (window as Window & { __tankMalleTest: { openOutbox: (uid: string) => Promise<Outbox> } }).__tankMalleTest.openOutbox(uid);
      try {
        const current = (await box.get(opId))!;
        const next = await box.enqueue({ kind: current.kind, path: current.path, vehicleId: current.vehicleId,
          payload: current.payload, beforeImage: malformed, opType: current.opType, replaceOpId: current.opId });
        if (!await box.markConflict(next.opId, next.version, current.serverImage!)) throw new Error("The conflict fixture was replaced unexpectedly");
        return (await box.get(next.opId))!;
      } finally { box.close(); }
    }, { uid: scope.uid, opId: submitted.opId, malformed });
    await page.reload();
    await expect(card).toHaveAttribute("data-outbox-images", "unverified");
    await expect(card.getByTestId("outbox-record-unverified")).toBeVisible();
    await expect(card.getByTestId("outbox-overwrite")).toBeDisabled();
    for (const theme of ["light", "dark"] as const) for (const accent of ["plate", "mint"] as const) {
      await appearance(theme, accent);
      await expect(card.getByTestId("outbox-record-unverified")).toBeVisible();
      await expect(card.getByTestId("outbox-overwrite")).toBeDisabled();
      await captureJournal(page, `journal-malformed-conflict-${theme}-${accent}`, true);
    }
    const retained = (await journalOperations(page, scope.uid)).find(op => op.opId === replacement.opId)!;
    expect(retained.beforeImage).toEqual(malformed);
    expect(retained.payload).toEqual(replacement.payload);
    expect(retained.serverImage).toEqual(replacement.serverImage);
    expect(await journalRawFields(scope.path)).toEqual(concurrent);
  } finally { await releaseJournal(page); }
});

test("a legacy empty-note Journal edit and its Undo preserve precise receipt fields and the original note", async ({ page }) => {
  const scope = await fixture(page, "fillup");
  expect(scope.raw.notes).toEqual({ stringValue: "" });
  await replaceJournalRawFields(scope.path, { ...scope.raw,
    pricePerLiter: { doubleValue: 7.185 }, totalCost: { doubleValue: 287.4001234567 } });
  const original = (await getDocument(scope.path))!;
  await page.reload();
  await expect(page.getByTestId(`journal-entry-${scope.key}`)).toBeVisible();
  await expect(page.getByTestId("journal-coverage")).toHaveCount(0);
  await openJournalEntry(page, scope.key);
  await page.getByTestId("journal-entry-edit").click();
  await expect(page.getByTestId("fillup-total")).toHaveValue("287.4001234567");
  await expect(page.getByTestId("fillup-price")).toHaveValue("7.185");
  await expect(page.getByTestId("fillup-liters")).toHaveValue("40");
  await openFillupMore(page);
  await expect(page.getByTestId("fillup-notes")).toHaveValue("");
  await page.getByTestId("fillup-notes").fill("  עריכה מהיומן 42  ");
  await page.getByTestId("fillup-save").click();
  await expect(page).toHaveURL("/");
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  const edited = (await getDocument(scope.path))!;
  expect(edited.notes).toBe("עריכה מהיומן 42");
  expect(edited.version).toBe(Number(original.version) + 1);
  expect(edited.writeId).toEqual(expect.any(String));
  for (const [key, value] of Object.entries(original)) {
    if (!["notes", "version", "writeId"].includes(key)) expect(edited[key], key).toEqual(value);
  }
  await expect(page.locator("[data-toast-title]").filter({ hasText: /^השינויים נשמרו במכשיר$/ })).toBeVisible();
  await captureJournal(page, "legacy-edit-undo-toast-light-plate");
  await page.getByRole("button", { name: "ביטול", exact: true }).click();
  await expect.poll(async () => (await getDocument(scope.path))?.notes).toBe("");
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  const restored = (await getDocument(scope.path))!;
  for (const [key, value] of Object.entries(original)) {
    if (!["version", "writeId"].includes(key)) expect(restored[key], key).toEqual(value);
  }
  expect(restored.version).toBe(Number(original.version) + 2);
  expect(restored.writeId).toEqual(expect.any(String));
  expect(restored.writeId).not.toBe(edited.writeId);
  expect(await listDocuments(`${scope.base}/fillups`)).toHaveLength(scope.fills.length);
  await page.reload();
  expect(await getDocument(scope.path)).toEqual(restored);
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
});

for (const [source, parentState] of [["observation", "absent"], ["service", "deleting"], ["fillup", "absent"]] as const) {
  test(`${source} Undo and its real retry cannot restore into a ${parentState} vehicle`, async ({ page, context }) => {
    test.setTimeout(90_000);
    const scope = await fixture(page, source);
    await confirmDelete(page, scope.key);
    await acceptedDelete(page, scope.path, scope.uid);
    await holdJournal(page, scope.uid, scope.restoreKind, "after");
    try {
      await page.getByRole("button", { name: "ביטול", exact: true }).click();
      await waitForJournalHold(page, true);
      const submitted = (await journalOperations(page, scope.uid)).find(op => op.path === scope.path)!;
      expect(submitted.kind).toBe(scope.restoreKind);
      expect(submitted.payload).not.toBeNull();
      await disconnectListeners(context);
      if (parentState === "absent") await removeJournalDocument(scope.base);
      else {
        const parent = await getDocument(scope.base);
        await setDocument(scope.base, { ...parent, createdAt: new Date(Number(parent!.createdAt)), deletionPending: true });
      }
      await releaseJournal(page);
      await expect.poll(async () => (await journalOperations(page, scope.uid)).find(op => op.opId === submitted.opId)?.error?.code).toBe("vehicle-unavailable");
      expect(await journalRawFields(scope.path)).toBeNull();
      await page.getByTestId("tab-home").click();
      await page.getByTestId("open-account").click();
      await page.getByTestId("account-unsynced").click();
      const failed = (await journalOperations(page, scope.uid)).find(op => op.opId === submitted.opId)!;
      // Only the initial race needs the stale vehicle listener. Restore real
      // connectivity before Retry: fill-up replay verifies its document with
      // getDocFromServer, which shares the SDK's Listen transport.
      await context.unroute(LISTEN);
      await page.reload();
      await expect(page.locator(`[data-outbox-op="${submitted.opId}"]`)).toBeVisible();
      const recovered = (await journalOperations(page, scope.uid)).find(op => op.opId === submitted.opId)!;
      expect(recovered.payload).toEqual(failed.payload);
      expect(recovered.beforeImage).toEqual(failed.beforeImage);
      expect(recovered.version).toBe(failed.version);
      expect(recovered.kind).toBe(failed.kind);
      expect(recovered.error?.code).toBe("vehicle-unavailable");
      expect(await journalRawFields(scope.path)).toBeNull();
      if (parentState === "absent") expect(await journalRawFields(scope.base)).toBeNull();
      else expect((await getDocument(scope.base))?.deletionPending).toBe(true);
      await page.getByRole("button", { name: "ניסיון חוזר", exact: true }).click();
      await expect.poll(async () => {
        const operation = (await journalOperations(page, scope.uid)).find(op => op.opId === submitted.opId);
        return operation && operation.version > submitted.version ? operation.status : null;
      }).toBe("failed");
      const retried = (await journalOperations(page, scope.uid)).find(op => op.opId === submitted.opId)!;
      expect(retried.error?.code).toBe("vehicle-unavailable");
      expect(retried.payload).toEqual(submitted.payload);
      expect(await journalRawFields(scope.path)).toBeNull();
      if (parentState === "absent") expect(await journalRawFields(scope.base)).toBeNull();
      else expect((await getDocument(scope.base))?.deletionPending).toBe(true);
    } finally { await releaseJournal(page); await context.unroute(LISTEN); await context.setOffline(false); }
  });
}
