import { expect, test, type Page } from "@playwright/test";
import { Timestamp } from "firebase/firestore";
import { decodeRawDocument } from "../src/lib/rawDocument";
import { DENY_ALL_RULES, FIRESTORE_HOST, PROJECT_ID, getDocument, installRules, listDocuments, restoreRules, seedVehicle, setDocument } from "./helpers/emulator";
import { chooseNamedStation, fillupFixture, FILLUP_CAR, FILLUP_DAY, newServerFillup, typeFillup, type FillupFixture } from "./helpers/design-v2-fillup";
import { finishFillupSave } from "./helpers/fillup";
import { holdJournal, journalOperations, releaseJournal, waitForJournalHold } from "./helpers/journal";
import { outboxCount } from "./helpers/pwa";
import { homeSwitchVehicle } from "./helpers/design-v2-home";

test.use({ viewport: { width: 390, height: 844 } });
test.afterEach(async () => { await restoreRules(); });
const RULE_NAME = "תחנה פרטית לבדיקת קבלה";

async function prepareNo(page: Page, scope: FillupFixture, options: { paid?: number; pump?: number; odometer?: number } = {}) {
  await page.goto("/fillup/new");
  await chooseNamedStation(page, RULE_NAME);
  const paid = options.paid ?? 7.1234567;
  const pump = options.pump ?? 8.7654321;
  const odometer = options.odometer ?? 100000;
  await typeFillup(page, { odometer, liters: 40, price: paid, end: "full" });
  await page.getByTestId("fillup-save").click();
  await expect(page.getByTestId("fillup-saved")).toBeVisible();
  await expect(page.getByTestId("fillup-pump-no")).toBeEnabled({ timeout: 20_000 });
  const saved = await newServerFillup(scope, odometer);
  await page.getByTestId("fillup-pump-no").click();
  await page.getByTestId("fillup-pump-price").fill(String(pump));
  return { saved, paid, pump, odometer };
}

async function submitNo(page: Page, scope: FillupFixture) {
  await page.getByTestId("fillup-pump-confirm").click();
  await expect(page.getByTestId("fillup-pump-confirmed")).toBeVisible();
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  return (await listDocuments(`users/${scope.uid}/personalPriceRules`))[0];
}

type RawFields = Record<string, Record<string, unknown>>;
async function rawFields(path: string): Promise<RawFields> {
  const response = await fetch(`${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    { headers: { Authorization: "Bearer owner" } });
  expect(response.ok).toBe(true);
  return (await response.json()).fields;
}
async function replaceRawFields(path: string, fields: RawFields) {
  const response = await fetch(`${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    { method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
  expect(response.ok).toBe(true);
}

test("No saves an exact private difference, never a public price, and only that vehicle/station reuses it", async ({ page }) => {
  const scope = await fillupFixture(page, { history: "none", price: 8.77 });
  const pricesBefore = await getDocument("appConfig/fuelPrices");
  const answer = await prepareNo(page, scope);
  const rule = await submitNo(page, scope);
  expect(rule.id).toMatch(/^tmpp\.v1\.[A-Za-z0-9_-]{43}$/);
  expect(rule.data).toMatchObject({ vehicleId: scope.vehicleId, fuelType: "95", stationName: RULE_NAME,
    discountPerLiter: answer.pump - answer.paid, fixedPricePerLiter: null, expiresAt: null, reviewed: true, legacy: false });
  expect(rule.data.stationId).toMatch(/^tmpp:v1:name:[A-Za-z0-9_-]{43}$/);
  expect(await getDocument(`${scope.collection}/${answer.saved.id}`)).toEqual(answer.saved.data);
  expect(answer.saved.data.station).toEqual({ name: RULE_NAME });
  expect(answer.saved.data.postedPricePerLiter ?? null).toBeNull();
  expect(await getDocument("appConfig/fuelPrices")).toEqual(pricesBefore);
  expect(await listDocuments(`users/${scope.uid}/stationPriceReports`)).toHaveLength(0);
  expect(await listDocuments("stationPriceAggregates")).toHaveLength(0);
  await finishFillupSave(page);
  await page.goto("/fillup/new");
  await chooseNamedStation(page, RULE_NAME);
  // applyPersonalRule retains its existing three-decimal suggestion arithmetic;
  // the private stored difference above retains the full typed precision.
  await expect(page.getByTestId("fillup-price")).toHaveValue("7.128");
  await expect(page.locator("#fillup-price-caption")).toContainText("הנחה אישית");
  await page.goto("/");
  await seedVehicle(scope.uid, "separate", { ...FILLUP_CAR, model: "רכב נפרד" });
  await homeSwitchVehicle(page, scope.uid, "separate");
  await page.goto("/fillup/new");
  await chooseNamedStation(page, RULE_NAME);
  await expect(page.getByTestId("fillup-price")).toHaveValue("8.77");
  expect(await listDocuments(`users/${scope.uid}/personalPriceRules`)).toHaveLength(1);
});

test("a pump answer cannot report success before durable journaling, and storage refusal retains the typed price", async ({ page }) => {
  const scope = await fillupFixture(page, { history: "none" });
  const answer = await prepareNo(page, scope);
  await holdJournal(page, scope.uid, "priceRule.save", "before");
  try {
    await page.getByTestId("fillup-pump-confirm").click();
    await waitForJournalHold(page);
    await expect(page.getByTestId("fillup-pump-question")).toHaveAttribute("data-state", "journaling");
    await expect(page.getByTestId("fillup-pump-confirmed")).toHaveCount(0);
    await expect(page.getByTestId("fillup-pump-pending")).toHaveCount(0);
    await expect(page.getByTestId("fillup-pump-price")).toHaveValue(String(answer.pump));
    expect((await journalOperations(page, scope.uid)).filter(op => op.kind === "priceRule.save")).toHaveLength(0);
    expect(await listDocuments(`users/${scope.uid}/personalPriceRules`)).toHaveLength(0);
    await releaseJournal(page, true);
    await expect(page.getByTestId("fillup-pump-question")).toHaveAttribute("data-state", "idle");
    await expect(page.locator("#fillup-pump-error")).toContainText("journal storage refused");
    await expect(page.getByTestId("fillup-pump-price")).toHaveValue(String(answer.pump));
    await expect(page.getByTestId("fillup-pump-confirm")).toBeEnabled();
    // Hold the real transaction Commit, after durable journaling. A late ACK
    // must not pull focus away from a driver who deliberately moved to Done.
    const commitPattern = /\/documents:commit(?:\?|$)/;
    let releaseCommit!: () => void;
    let commitHeld = false;
    const commitGate = new Promise<void>(resolve => { releaseCommit = resolve; });
    await page.route(commitPattern, async route => {
      if (route.request().postData()?.includes("/personalPriceRules/")) {
        commitHeld = true;
        await commitGate;
      }
      await route.continue();
    });
    try {
      await page.getByTestId("fillup-pump-confirm").click();
      await expect.poll(() => commitHeld).toBe(true);
      await expect(page.getByTestId("fillup-pump-question")).toHaveAttribute("data-state", "pending");
      expect((await journalOperations(page, scope.uid)).filter(op => op.kind === "priceRule.save")).toHaveLength(1);
      expect(await listDocuments(`users/${scope.uid}/personalPriceRules`)).toHaveLength(0);
      await page.getByTestId("fillup-saved-done").focus();
      releaseCommit();
      await expect(page.getByTestId("fillup-pump-confirmed")).toBeVisible();
      await expect(page.getByTestId("fillup-saved-done")).toBeFocused();
      await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
      const rule = (await listDocuments(`users/${scope.uid}/personalPriceRules`))[0];
      expect(rule.data.discountPerLiter).toBe(answer.pump - answer.paid);
      expect(await getDocument(`${scope.collection}/${answer.saved.id}`)).toEqual(answer.saved.data);
    } finally { releaseCommit(); await page.unroute(commitPattern); }
  } finally { await releaseJournal(page); }
});

for (const attempt of ["initial", "retry"] as const) test(`private rule ${attempt} compares the exact raw timestamp, including a sub-millisecond concurrent change`, async ({ page, context }) => {
  test.setTimeout(90_000);
  const scope = await fillupFixture(page, { history: "none" });
  await prepareNo(page, scope, { paid: 7, pump: 7.77 });
  const firstRule = await submitNo(page, scope);
  const path = `users/${scope.uid}/personalPriceRules/${firstRule.id}`;
  // The emulator canonicalizes stored timestamps to microseconds. Use its
  // real stored precision here; nanosecond codec equality has separate unit
  // coverage. A millisecond-normalized base still cannot detect this change.
  const initialRaw = { ...await rawFields(path), migratedAt: { timestampValue: "2026-01-02T03:04:05.123456Z" } };
  await replaceRawFields(path, initialRaw);
  expect(await rawFields(path)).toEqual(initialRaw);
  await finishFillupSave(page);
  const answer = await prepareNo(page, scope, { odometer: 100400, paid: 7.11, pump: 8.42 });
  const nextRaw = { ...initialRaw, migratedAt: { timestampValue: "2026-01-02T03:04:05.123457Z" } };
  const listen = /google\.firestore\.v1\.Firestore\/Listen\/channel/;
  if (attempt === "initial") await holdJournal(page, scope.uid, "priceRule.save", "after");
  else await installRules(DENY_ALL_RULES);
  try {
    await page.getByTestId("fillup-pump-confirm").click();
    if (attempt === "initial") await waitForJournalHold(page, true);
    else await expect(page.getByTestId("fillup-pump-question")).toHaveAttribute("data-state", "attention");
    const operation = (await journalOperations(page, scope.uid)).find(op => op.kind === "priceRule.save")!;
    expect(operation).toBeDefined();
    expect(operation.path).toBe(path);
    const before = decodeRawDocument(operation.beforeImage!);
    expect(before.migratedAt).toBeInstanceOf(Timestamp);
    expect((before.migratedAt as Timestamp).nanoseconds).toBe(123456000);
    expect(decodeRawDocument(operation.payload!).discountPerLiter).toBe(answer.pump - answer.paid);
    if (attempt === "initial") {
      await replaceRawFields(path, nextRaw);
      await releaseJournal(page);
      await expect(page.getByTestId("fillup-pump-question")).toHaveAttribute("data-state", "attention");
      await finishFillupSave(page);
      await page.goto("/settings/unsynced");
    } else {
      expect(operation.status).toBe("failed");
      expect(operation.error?.code).toBe("permission-denied");
      await finishFillupSave(page);
      // Recovery uses the actual persisted encoded base. Block only listeners
      // so that the fixture stays failed until the real Retry action; guarded
      // transaction BatchGet/Commit requests remain available.
      await context.route(listen, route => route.abort("connectionfailed"));
      await page.goto("/settings/unsynced");
      await page.reload();
      await replaceRawFields(path, nextRaw);
      await restoreRules();
      const recovered = (await journalOperations(page, scope.uid)).find(op => op.opId === operation.opId)!;
      expect(recovered.beforeImage).toEqual(operation.beforeImage);
      expect(recovered.payload).toEqual(operation.payload);
      await page.locator(`[data-outbox-op="${operation.opId}"]`).getByRole("button", { name: "ניסיון חוזר", exact: true }).click();
    }
    const row = page.locator(`[data-outbox-op="${operation.opId}"]`);
    await expect(row).toHaveAttribute("data-outbox-status", "conflict");
    const kept = (await journalOperations(page, scope.uid)).find(op => op.opId === operation.opId)!;
    expect(decodeRawDocument(kept.beforeImage!).migratedAt).toEqual(new Timestamp(1767323045, 123456000));
    expect(decodeRawDocument(kept.serverImage!).migratedAt).toEqual(new Timestamp(1767323045, 123457000));
    expect(await rawFields(path)).toEqual(nextRaw);
    expect(await getDocument(`${scope.collection}/${answer.saved.id}`)).toEqual(answer.saved.data);
    expect(await listDocuments(`users/${scope.uid}/stationPriceReports`)).toHaveLength(0);
  } finally { await releaseJournal(page); await context.unroute(listen); await restoreRules(); }
});

test("an occupied incompatible private scope is preserved and the answer falls back to this receipt only", async ({ page }) => {
  const scope = await fillupFixture(page, { history: "none", price: 8.77 });
  await prepareNo(page, scope, { paid: 7, pump: 7.77 });
  const original = await submitNo(page, scope);
  const occupied = { ...original.data, vehicleId: "another-vehicle", discountPerLiter: .123456789 };
  const path = `users/${scope.uid}/personalPriceRules/${original.id}`;
  await setDocument(path, occupied);
  await finishFillupSave(page);
  const answer = await prepareNo(page, scope, { odometer: 100400, paid: 7.1, pump: 8.1 });
  await page.getByTestId("fillup-pump-confirm").click();
  await expect(page.getByTestId("fillup-pump-confirmed")).toContainText("לתדלוק הזה בלבד");
  const all = await listDocuments(`users/${scope.uid}/personalPriceRules`);
  expect(all).toHaveLength(2);
  expect(await getDocument(path)).toEqual(occupied);
  const receiptOnly = all.find(rule => rule.id !== original.id)!;
  expect(receiptOnly.data).toMatchObject({ vehicleId: scope.vehicleId, fuelType: "95", discountPerLiter: 8.1 - 7.1 });
  expect(receiptOnly.data.stationId).toMatch(/^tmpp:v1:receipt:[A-Za-z0-9_-]{43}$/);
  expect(await getDocument(`${scope.collection}/${answer.saved.id}`)).toEqual(answer.saved.data);
  await finishFillupSave(page);
  await page.goto("/fillup/new");
  await chooseNamedStation(page, RULE_NAME);
  await expect(page.getByTestId("fillup-price")).toHaveValue("8.77");
});

for (const fuelType of ["98", "diesel"] as const) test(`${fuelType} prefill uses exact prior paid fuel/station, never a configured list reference or a second discount`, async ({ page }) => {
  const scope = await fillupFixture(page, { history: "none", vehicle: { ...FILLUP_CAR, fuelType, manualPricePerLiter: 9.99, priceAdjustment: -.5 } });
  const prices = (await getDocument("appConfig/fuelPrices"))!;
  await setDocument("appConfig/fuelPrices", { ...prices,
    byFuelType: { ...prices.byFuelType as Record<string, unknown>, [fuelType]: { self: {
      current: { pricePerLiter: 9.31, updatedAt: new Date() }, source: "manual", history: {}, scheduledHistory: {},
    } } } });
  await page.goto("/fillup/new");
  await expect(page.getByTestId("fillup-price")).toHaveValue("");
  const station = { name: "תחנת ההיסטוריה המדויקת", stationId: "exact-history-station" };
  const row = { liters: 20, totalCost: 142.2, pricePerLiter: 7.11, station, fuelType, isFullTank: true, odometer: 100000,
    date: new Date(scope.now - 3 * FILLUP_DAY), createdAt: new Date(scope.now - 3 * FILLUP_DAY) };
  await setDocument(`${scope.collection}/matching-fuel`, row);
  await setDocument(`${scope.collection}/wrong-fuel`, { ...row, fuelType: "95", pricePerLiter: 5.55, totalCost: 111,
    odometer: 100200, date: new Date(scope.now - FILLUP_DAY) });
  await seedVehicle(scope.uid, "unrelated", { ...FILLUP_CAR, fuelType });
  await setDocument(`users/${scope.uid}/vehicles/unrelated/fillups/foreign`, { ...row, pricePerLiter: 3.33, totalCost: 66.6 });
  await setDocument(`users/${scope.uid}/personalPriceRules/strict-private-rule`, { vehicleId: scope.vehicleId, fuelType,
    stationId: station.stationId, stationName: station.name, discountPerLiter: 2, fixedPricePerLiter: null,
    expiresAt: null, legacy: false, reviewed: true, label: "לא להחיל פעמיים" });
  await page.goto("/");
  await expect(page.getByTestId("journal-entry-fillups/wrong-fuel")).toBeVisible();
  await page.goto("/fillup/new");
  await chooseNamedStation(page, station.name);
  await expect(page.getByTestId("fillup-price")).toHaveValue("7.11");
  await expect(page.locator("#fillup-price-caption")).toContainText("ששילמת כאן לאחרונה");
  await chooseNamedStation(page, "תחנה אחרת ללא מחיר שמור");
  await expect(page.getByTestId("fillup-price")).toHaveValue("");
  expect((await getDocument(`${scope.collection}/matching-fuel`))?.pricePerLiter).toBe(7.11);
});
