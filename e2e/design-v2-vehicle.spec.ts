import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDocument, listDocuments, seedVehicle, setDocument } from "./helpers/emulator";
import { captureJournal, journalEvidence, journalRawFields } from "./helpers/design-v2-journal";
import { homeAppearance } from "./helpers/design-v2-home";
import {
  DOC_TITLES, VEHICLE_COVERAGE, assertNoDocumentExpenses, displayDay, documentSaved,
  openVehicleDoc, replaceVehicleFixture, vehicleDayOffset, vehicleFixture, vehicleTarget,
  vehicleFieldPair, vehiclePlateGeometry, vehicleKeyboardLoop as keyboardLoop, vehicleStyle,
  type DocKey, type VehicleFixture,
} from "./helpers/design-v2-vehicle";
import { holdJournal, journalOperations, releaseJournal, waitForJournalHold } from "./helpers/journal";
import { outboxCount } from "./helpers/pwa";
import { notificationId } from "../src/lib/vehicle/model";

test.use({ viewport: { width: 390, height: 844 } });

const managed = (page: Page, id: string) => page.locator(`[data-managed-vehicle="${id}"]`);
const docDate = (page: Page) => page.locator("#vehicle-doc-due");
const documentLink = (page: Page, key: DocKey, vehicleId: string) =>
  page.locator(`a[href="/vehicle?doc=${key}&vehicle=${vehicleId}"]`);

async function vehicleReady(page: Page) {
  await expect(page.getByRole("region", { name: "הרכב שלי", exact: true })).toBeVisible();
  await expect(page.getByText(VEHICLE_COVERAGE, { exact: true })).toHaveCount(0);
}

async function currentOdometer(page: Page) {
  await page.getByRole("region", { name: "הרכב שלי", exact: true }).getByRole("button", { name: "עדכון", exact: true }).click();
  await expect(page.getByTestId("care-entry")).toHaveAttribute("data-collection", "odometerReadings");
  return page.getByRole("dialog", { name: "עדכון קילומטראז׳", exact: true });
}

async function visibleManagedFocus(card: Locator) {
  await expect(card).toBeFocused();
  await expect(card).toBeInViewport({ ratio: 1 });
  expect(await card.evaluate(element => element.matches(":focus-visible"))).toBe(true);
  expect(await card.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
}

async function narrowVehicleState(page: Page, name: string, controls: { id: string; target: Locator }[], focused: Locator) {
  await page.setViewportSize({ width: 320, height: 844 });
  try {
    const targets = [];
    for (const { id, target } of controls) targets.push({ id, ...await vehicleTarget(target) });
    await expect(focused).toBeFocused();
    const focus = await focused.evaluate(element => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { visible: box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
        unobscured: hit === element || !!hit && element.contains(hit) };
    });
    expect(focus).toEqual({ visible: true, unobscured: true });
    const pair = await page.locator(".tm-vehicle-edit").count()
      ? await vehicleFieldPair(page.getByLabel("נפח מיכל", { exact: true }), page.getByLabel("נתון יצרן", { exact: true }), true) : null;
    await captureJournal(page, name);
    return { name, viewport: { width: 320, height: 844 }, targets, focus, pair, focusedStyle: await vehicleStyle(focused) };
  } finally { await page.setViewportSize({ width: 390, height: 844 }); }
}

async function seedVehicleCare(scope: VehicleFixture) {
  const service = { schemaVersion: 1, version: 2, day: vehicleDayOffset(-7), title: "בלמים ושמן 42", jobs: ["brakes", "oil"],
    odometer: 100250, costAgorot: 45025, garage: "מוסך מרכז 12", notes: "חשבונית אחת", completedPlanIds: [] };
  const plan = { schemaVersion: 1, version: 3, title: "החלפת שמן", job: "oil", dueDay: null, dueOdometer: 101000,
    intervalMonths: null, intervalKm: 10000, basis: "completion", source: "owner", notes: "לפי מדריך הרכב", active: true };
  const issue = { schemaVersion: 1, version: 4, day: vehicleDayOffset(-5), title: "רעש בלמים 42", symptoms: "צליל בזמן עצירה",
    odometer: 100300, importance: "important", status: "open", notes: "מעקב אישי", serviceEventIds: ["gallery-service"], history: [] };
  await setDocument(`${scope.base}/serviceEvents/gallery-service`, service);
  await setDocument(`${scope.base}/maintenancePlans/gallery-plan`, plan);
  await setDocument(`${scope.base}/vehicleIssues/gallery-issue`, issue);
  return { service, plan, issue };
}

test("three permanent document rows validate real civil dates and coverage none clears only its insurance details", async ({ page }) => {
  const scope = await vehicleFixture(page, undefined, false);
  for (const key of Object.keys(DOC_TITLES) as DocKey[]) {
    await expect(page.getByTestId(`vehicle-doc-${key}`)).toContainText("הוספה");
  }
  const mandatory = await openVehicleDoc(page, "mandatory");
  await mandatory.getByRole("button", { name: "הראל", exact: true }).click();
  await docDate(page).fill("31/02/2028");
  await page.getByTestId("vehicle-doc-save").click();
  await expect(docDate(page)).toBeFocused();
  await expect(docDate(page)).toHaveAttribute("aria-invalid", "true");
  await expect(docDate(page)).toHaveValue("31/02/2028");
  expect((await getDocument(scope.base))?.docs).toBeUndefined();
  expect(await journalOperations(page, scope.uid)).toHaveLength(0);
  await docDate(page).fill("29/02/28");
  await docDate(page).press("Enter");
  await expect(docDate(page)).toHaveValue("29/02/2028");
  await docDate(page).fill("28/02/2028");
  const nativePicker = mandatory.locator('input[type="date"]');
  await nativePicker.click();
  await captureJournal(page, "vehicle-calendar-native-light-plate");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(docDate(page)).toHaveValue("29/02/2028");
  await expect(nativePicker).toHaveValue("2028-02-29");
  await page.getByTestId("vehicle-doc-cost").fill("1234.56789");
  await expect(page.getByTestId("vehicle-doc-save")).toBeEnabled();
  await keyboardLoop(page, mandatory);
  const insurance = { insurer: "הראל", due: "2028-02-29", cost: 1234.56789 };
  await documentSaved(page, scope, { mandatory: insurance });
  await expect(page.getByTestId("vehicle-doc-mandatory")).toContainText("29/02/2028");
  await expect(page.getByTestId("vehicle-doc-mandatory")).toContainText("1,235\u202F₪");

  const coverage = await openVehicleDoc(page, "coverage");
  await coverage.getByRole("radio", { name: "מקיף", exact: true }).click();
  await page.getByTestId("vehicle-doc-insurer").fill("מבטח אישי 42");
  await docDate(page).fill(displayDay(vehicleDayOffset(6)));
  await page.getByTestId("vehicle-doc-cost").fill("2050.125");
  const covered = { type: "comprehensive", insurer: "מבטח אישי 42", due: vehicleDayOffset(6), cost: 2050.125 };
  await documentSaved(page, scope, { mandatory: insurance, coverage: covered });
  await openVehicleDoc(page, "coverage");
  await page.getByRole("radio", { name: "אין", exact: true }).click();
  await expect(page.getByTestId("vehicle-doc-insurer")).toHaveCount(0);
  await expect(page.getByTestId("vehicle-doc-cost")).toHaveCount(0);
  await expect(docDate(page)).toHaveCount(0);
  await documentSaved(page, scope, { mandatory: insurance, coverage: { type: "none", insurer: null, due: null, cost: null } });
  await page.reload();
  await vehicleReady(page);
  await expect(page.getByTestId("vehicle-doc-coverage")).toContainText("סימנת שאין ביטוח מקיף או צד ג׳");
  await page.goto("/notifications");
  await expect(documentLink(page, "coverage", scope.vehicleId)).toHaveCount(0);
  await assertNoDocumentExpenses(scope, 0);
});

test("current odometer blocks a lower value and asks only above the 3000 km boundary before writing", async ({ page }) => {
  const scope = await vehicleFixture(page);
  await currentOdometer(page);
  await page.getByTestId("care-odo").fill("100499");
  await page.getByTestId("care-save").click();
  await expect(page.getByTestId("care-error")).toContainText("100,500");
  await expect(page.getByTestId("care-error")).toBeFocused();
  expect(await listDocuments(`${scope.base}/odometerReadings`)).toHaveLength(0);
  await page.getByTestId("care-odo").fill("103501");
  await page.getByTestId("care-save").click();
  let confirmation = page.getByRole("alertdialog", { name: "הקילומטראז׳ נכון?", exact: true });
  await expect(confirmation).toContainText("3,001");
  expect(await listDocuments(`${scope.base}/odometerReadings`)).toHaveLength(0);
  await confirmation.getByRole("button", { name: "לתקן את המספר", exact: true }).click();
  await page.getByTestId("care-odo").fill("103500");
  await page.getByTestId("care-save").click();
  await expect(page.getByTestId("care-entry")).toHaveCount(0);
  await expect(confirmation).toHaveCount(0);
  await expect.poll(async () => (await listDocuments(`${scope.base}/odometerReadings`)).map(row => row.data.odometer)).toEqual([103500]);
  await expect(page.getByRole("button", { name: "קילומטראז׳ 103,500 ק״מ", exact: true })).toBeVisible();
  await currentOdometer(page);
  await page.getByTestId("care-odo").fill("106501");
  await page.getByTestId("care-save").click();
  confirmation = page.getByRole("alertdialog", { name: "הקילומטראז׳ נכון?", exact: true });
  await expect(confirmation).toContainText("106,501");
  expect(await listDocuments(`${scope.base}/odometerReadings`)).toHaveLength(1);
  await confirmation.getByRole("button", { name: "כן, זו הקריאה", exact: true }).click();
  await expect(page.getByTestId("care-entry")).toHaveCount(0);
  await expect.poll(async () => (await listDocuments(`${scope.base}/odometerReadings`)).map(row => row.data.odometer).sort()).toEqual([103500, 106501]);
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  expect(await listDocuments(`${scope.base}/fillups`)).toHaveLength(2);
});

test("document Home links, notification occurrence identity and reminder preferences follow the saved civil due date", async ({ page }) => {
  const due = vehicleDayOffset(20);
  const scope = await vehicleFixture(page, { mandatory: { insurer: "הראל", due, cost: 1200 } });
  const occurrence = `doc:mandatory:${due}:month`;
  await page.goto("/");
  const spotlight = page.locator(`[data-testid="spotlight-card"][data-spotlight-id="${occurrence}"]`);
  await expect(spotlight).toContainText("ביטוח חובה");
  await spotlight.locator(".tm-spotlight-open").click();
  await expect(page.getByTestId("vehicle-doc-form")).toHaveAttribute("data-doc-key", "mandatory");
  await expect(docDate(page)).toHaveValue(displayDay(due));
  expect(new URL(page.url()).searchParams.get("vehicle")).toBe(scope.vehicleId);
  await page.keyboard.press("Escape");

  await page.goto("/notifications");
  await expect(documentLink(page, "mandatory", scope.vehicleId)).toContainText("20 ימים");
  await expect(page.locator("article").filter({ has: documentLink(page, "mandatory", scope.vehicleId) })
    .getByRole("button", { name: "רישום טיפול", exact: true })).toHaveCount(0);
  await expect(documentLink(page, "mandatory", scope.vehicleId).locator("xpath=ancestor::article")).toHaveAttribute("data-notification-ready", "true");
  await documentLink(page, "mandatory", scope.vehicleId).click();
  await expect(docDate(page)).toHaveValue(displayDay(due));
  await expect.poll(async () => (await listDocuments(`${scope.base}/notificationStates`)).find(row => row.data.occurrence === occurrence)?.data.read).toBe(true);
  const state = (await listDocuments(`${scope.base}/notificationStates`)).find(row => row.data.occurrence === occurrence)!;
  await page.getByTestId("vehicle-doc-insurer").fill("מבטח מתוקן 42");
  await documentSaved(page, scope, { mandatory: { insurer: "מבטח מתוקן 42", due, cost: 1200 } });
  await page.goto("/notifications");
  await expect(documentLink(page, "mandatory", scope.vehicleId)).toBeVisible();
  expect(await getDocument(`${scope.base}/notificationStates/${state.id}`)).toEqual(state.data);
  expect((await listDocuments(`${scope.base}/notificationStates`)).filter(row => String(row.data.occurrence).startsWith("doc:mandatory:"))).toHaveLength(1);

  await page.goto("/account");
  const reminderSwitch = page.getByRole("switch", { name: "טסט, ביטוח וטיפולים", exact: true });
  await reminderSwitch.click();
  await expect(reminderSwitch).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await getDocument(`users/${scope.uid}`))?.settings).toMatchObject({ reminderNotifications: false });
  // Complete local acknowledgement before hard navigation; deliberate crash/recovery is covered separately.
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  await page.goto("/notifications");
  await expect(documentLink(page, "mandatory", scope.vehicleId)).toHaveCount(0);
  expect((await getDocument(scope.base))?.docs).toEqual({ mandatory: { insurer: "מבטח מתוקן 42", due, cost: 1200 } });
  await page.goto("/account");
  await reminderSwitch.click();
  await expect.poll(async () => (await getDocument(`users/${scope.uid}`))?.settings).toMatchObject({ reminderNotifications: true });
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  await page.goto("/vehicle");
  await vehicleReady(page);
  await openVehicleDoc(page, "mandatory");
  const renewed = vehicleDayOffset(6);
  await docDate(page).fill(displayDay(renewed));
  await documentSaved(page, scope, { mandatory: { insurer: "מבטח מתוקן 42", due: renewed, cost: 1200 } });
  // A prior month occurrence for this same due date cannot suppress its week
  // reminder. This uses actual persisted notification state, not a fake clock.
  const previousMonth = `doc:mandatory:${renewed}:month`;
  const previousState = { schemaVersion: 1, version: 1, occurrence: previousMonth, read: true, archived: true, snoozeUntilDay: null };
  await setDocument(`${scope.base}/notificationStates/${notificationId(previousMonth)}`, previousState);
  await page.goto("/notifications");
  const fresh = page.getByRole("region", { name: "חדש", exact: true });
  await expect(fresh.getByRole("link", { name: /ביטוח חובה/ })).toContainText("6 ימים");
  expect(await getDocument(`${scope.base}/notificationStates/${state.id}`)).toEqual(state.data);
  await expect(documentLink(page, "mandatory", scope.vehicleId).locator("xpath=ancestor::article")).toHaveAttribute("data-notification-ready", "true");
  await documentLink(page, "mandatory", scope.vehicleId).click();
  await expect.poll(async () => (await listDocuments(`${scope.base}/notificationStates`)).find(row => row.data.occurrence === `doc:mandatory:${renewed}:week`)?.data.read).toBe(true);
  await page.goto("/notifications");
  await page.getByRole("button", { name: "העברה לארכיון · ביטוח חובה · בעוד 6 ימים", exact: true }).click();
  await expect.poll(() => getDocument(`${scope.base}/notificationStates/${notificationId(`doc:mandatory:${renewed}:week`)}`)).toEqual({
    schemaVersion: 1, version: 2, occurrence: `doc:mandatory:${renewed}:week`, read: true, archived: true, snoozeUntilDay: null,
  });
  expect(await getDocument(`${scope.base}/notificationStates/${notificationId(previousMonth)}`)).toEqual(previousState);
  await page.goto("/");
  const urgent = page.locator(`[data-testid="spotlight-card"][data-spotlight-id="doc:mandatory:${renewed}:week"]`);
  await expect(urgent).toContainText("ביטוח חובה");
  await expect(page.getByTestId(`spotlight-dismiss-doc:mandatory:${renewed}:week`)).toHaveCount(0);
  await assertNoDocumentExpenses(scope);
});

test("vehicle edits preserve exact untouched numbers and docs, and save authored decimal changes without rounding", async ({ page }) => {
  const docs = { mandatory: { insurer: "מבטח 42", due: vehicleDayOffset(40), cost: 2345.67890123 } };
  const scope = await vehicleFixture(page, docs);
  const original = await replaceVehicleFixture(page, scope, { tankLiters: 47.123456789012, declaredKmPerLiter: 16.987654321012,
    tankLitersSource: "trusted", declaredSource: "exact-year", tankSourceUrl: "https://example.test/tank", specSourceUrl: "https://example.test/spec" }, "דיוק לפני עריכה");
  await page.goto(`/vehicle/edit/${scope.vehicleId}`);
  await expect(page.getByLabel("נפח מיכל", { exact: true })).toHaveValue("47.123456789012");
  await expect(page.getByLabel("נתון יצרן", { exact: true })).toHaveValue("16.987654321012");
  await page.getByLabel("כינוי לרכב", { exact: true }).fill("רק הכינוי השתנה");
  await page.getByRole("button", { name: "שמירת שינויים", exact: true }).click();
  await expect(page).toHaveURL(/\/vehicle$/);
  const renamed = (await journalRawFields(scope.base))!;
  expect({ ...renamed, nickname: original.nickname }).toEqual(original);
  await page.goto(`/vehicle/edit/${scope.vehicleId}`);
  await page.getByLabel("נפח מיכל", { exact: true }).fill("49.234567890123");
  await page.getByLabel("נתון יצרן", { exact: true }).fill("17.876543210123");
  await page.getByRole("button", { name: "שמירת שינויים", exact: true }).click();
  await expect(page).toHaveURL(/\/vehicle$/);
  await expect.poll(() => getDocument(scope.base)).toMatchObject({ tankLiters: 49.234567890123, declaredKmPerLiter: 17.876543210123,
    tankLitersSource: "user", declaredSource: "user", tankSourceUrl: null, specSourceUrl: null, docs });
  const edited = (await journalRawFields(scope.base))!;
  const restored = { ...edited };
  for (const key of ["tankLiters", "declaredKmPerLiter", "tankLitersSource", "declaredSource", "tankSourceUrl", "specSourceUrl"]) restored[key] = renamed[key];
  expect(restored).toEqual(renamed);
  await page.goto(`/vehicle/edit/${scope.vehicleId}`);
  await expect(page.getByLabel("נפח מיכל", { exact: true })).toHaveValue("49.234567890123");
  await expect(page.getByLabel("נתון יצרן", { exact: true })).toHaveValue("17.876543210123");
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
});

test("Escape during an issue's durable enqueue preserves the original operation and resolving records one history change", async ({ page }) => {
  const scope = await vehicleFixture(page);
  const opener = page.getByRole("button", { name: /משהו השתנה ברכב/ });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "מה קורה ברכב?", exact: true });
  await dialog.getByRole("button", { name: "רעש מוזר", exact: true }).click();
  await dialog.getByLabel("מה שמתם לב?", { exact: true }).fill("רעש בזמן עצירה 42");
  await dialog.getByLabel("חשיבות", { exact: true }).selectOption("important");
  await dialog.getByLabel("הערות ועדכון", { exact: true }).fill("ממתין לבדיקה");
  await holdJournal(page, scope.uid, "maintenance.save", "after");
  try {
    await dialog.getByRole("button", { name: "שמירת תקלה", exact: true }).click();
    await waitForJournalHold(page, true);
    const operations = await journalOperations(page, scope.uid);
    expect(operations).toHaveLength(1);
    const operation = operations[0];
    expect(operation.path).toContain(`${scope.base}/vehicleIssues/`);
    await expect(dialog.getByRole("button", { name: "שומרים…", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await journalOperations(page, scope.uid)).toEqual(operations);
    await releaseJournal(page);
    await expect.poll(() => getDocument(operation.path)).toMatchObject({ title: "רעש מוזר", symptoms: "רעש בזמן עצירה 42", status: "open", version: 1 });
    await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
    await page.locator(`a[href="/vehicle/issues/${operation.docId}"]`).click();
    await page.getByTestId("issue-resolve").click();
    await expect.poll(() => getDocument(operation.path)).toMatchObject({ status: "resolved", version: 2,
      history: [JSON.stringify({ day: scope.today, status: "resolved", note: "ממתין לבדיקה" })] });
    await expect(page.getByTestId("issue-resolve")).toHaveCount(0);
    expect(await listDocuments(`${scope.base}/vehicleIssues`)).toHaveLength(1);
    await page.goto("/vehicle?tab=issues");
    await vehicleReady(page);
    await expect(page.getByRole("button", { name: "קילומטראז׳ 100,500 ק״מ", exact: true })).toBeVisible();
    await expect(page.locator(`a[href="/vehicle/issues/${operation.docId}"]`)).toContainText("נפתרה");
    await assertNoDocumentExpenses(scope);
  } finally { await releaseJournal(page); }
});

for (const theme of ["light", "dark"] as const) for (const accent of ["plate", "mint"] as const) {
  test(`Vehicle native gallery ${theme}/${accent}: documents, odometer, reminders, issues, edit and manager keyboard focus`, async ({ page }) => {
    test.setTimeout(180_000);
    const suffix = `${theme}-${accent}`;
    const docs = { test: { due: vehicleDayOffset(17) }, mandatory: { insurer: "הראל", due: vehicleDayOffset(28), cost: 1234.56789 },
      coverage: { type: "comprehensive", insurer: "הפניקס", due: vehicleDayOffset(7), cost: 2850.12 } };
    const scope = await vehicleFixture(page, docs);
    const seeded = await seedVehicleCare(scope);
    for (let number = 1; number <= 5; number++) await seedVehicle(scope.uid, `gallery-car-${number}`, { make: "רכב בדיקה", model: String(number), year: 2021 });
    await homeAppearance(page, scope.uid, theme, accent);
    await page.goto("/vehicle");
    await vehicleReady(page);
    await expect(page.locator('a[href="/vehicle/reminders/gallery-plan"]')).toBeVisible();
    await captureJournal(page, `vehicle-full-${suffix}`, true);
    const targets: { id: string; x: number; y: number; width: number; height: number }[] = [];
    const styles: { id: string; sample: Awaited<ReturnType<typeof vehicleStyle>> }[] = [];
    const narrow: Awaited<ReturnType<typeof narrowVehicleState>>[] = [];
    const geometry = [];
    const overview = await page.locator(".tm-vehicle-overview").evaluate(element => ({
      top: element.querySelector(".tm-vehicle-topline")!.getBoundingClientRect().top,
      plateTop: element.querySelector(".tm-plate-xl")!.getBoundingClientRect().top,
    }));
    expect(overview.top).toBeCloseTo(52, 1);
    expect(overview.plateTop).toBeCloseTo(120, 1);
    geometry.push({ id: "vehicle-overview-placement", ...overview });
    if (theme === "dark") {
      const secondary = page.getByRole("button", { name: /משהו השתנה ברכב/ }).locator("small");
      await secondary.evaluate(element => element.scrollIntoView({ block: "center" }));
      styles.push({ id: "scrolled-secondary-label", sample: await vehicleStyle(secondary) });
      await captureJournal(page, `vehicle-secondary-${suffix}`);
    }
    for (const key of Object.keys(DOC_TITLES) as DocKey[]) {
      const opener = page.getByTestId(`vehicle-doc-${key}`);
      targets.push({ id: `vehicle-doc-${key}`, ...await vehicleTarget(opener) });
      const dialog = await openVehicleDoc(page, key);
      await keyboardLoop(page, dialog);
      if (key === "test") await docDate(page).focus();
      else if (key === "coverage") await dialog.getByRole("radio", { name: "מקיף", exact: true }).focus();
      else await page.getByTestId("vehicle-doc-insurer").focus();
      await captureJournal(page, `vehicle-doc-${key}-${suffix}`);
      targets.push({ id: `${key}-civil-input`, ...await vehicleTarget(docDate(page)) });
      targets.push({ id: `${key}-civil-picker`, ...await vehicleTarget(dialog.locator('input[type="date"]')) });
      targets.push({ id: `${key}-disclosure`, ...await vehicleTarget(dialog.locator("details > summary").first()) });
      if (key !== "test") {
        await page.getByTestId("vehicle-doc-cost").focus();
        await captureJournal(page, `vehicle-doc-${key}-details-${suffix}`);
        targets.push({ id: `${key}-cost`, ...await vehicleTarget(page.getByTestId("vehicle-doc-cost")) });
        for (const id of ["vehicle-doc-insurer", "vehicle-doc-cost"]) {
          styles.push({ id: `${key}-${id}`, sample: await vehicleStyle(page.getByTestId(id)) });
          const field = await page.getByTestId(id).evaluate(element => {
            const control = element.closest(".tm-field-control")!, style = getComputedStyle(control), input = getComputedStyle(element);
            const probe = document.createElement("i"); probe.style.color = "var(--line-control)"; document.body.append(probe);
            const line = getComputedStyle(probe).color; probe.remove();
            return { height: control.getBoundingClientRect().height, border: style.borderTopColor, line, borderWidth: style.borderTopWidth,
              foreground: input.color, weight: Number(input.fontWeight), radius: style.borderRadius };
          });
          expect(field.height).toBeCloseTo(52, 1);
          // v3 stage 4: inputs use the 1px --line-control boundary (≥3:1, WCAG 1.4.11); v2 used an ink rule.
          expect(field.border).toBe(field.line);
          expect(field.borderWidth).toBe("1px");
          expect(field.weight).toBe(400);
          geometry.push({ id: `${key}-${id}`, ...field });
        }
      }
      if (key === "mandatory") {
        const insurer = page.getByTestId("vehicle-doc-insurer");
        const originalInsurer = await insurer.inputValue(), originalDate = await docDate(page).inputValue();
        if (theme === "light" && accent === "plate") {
          await insurer.fill("חברת הביטוח לדוגמה עם שם ארוך 42");
          narrow.push(await narrowVehicleState(page, "vehicle-insurer-320-light-plate", [
            { id: "insurer", target: insurer }, { id: "due", target: docDate(page) },
            { id: "calendar", target: dialog.locator('input[type="date"]') }, { id: "save", target: page.getByTestId("vehicle-doc-save") },
          ], insurer));
        }
        await docDate(page).fill("31/02/2027");
        await page.getByTestId("vehicle-doc-save").click();
        await expect(docDate(page)).toBeFocused();
        await expect(docDate(page)).toHaveAttribute("aria-invalid", "true");
        styles.push({ id: "document-date-error", sample: await vehicleStyle(dialog.locator(".tm-civil-field [role=alert]")) });
        styles.push({ id: "document-focused-date", sample: await vehicleStyle(docDate(page)) });
        await captureJournal(page, `vehicle-doc-error-${suffix}`);
        if (theme === "light" && accent === "plate") narrow.push(await narrowVehicleState(page, "vehicle-doc-error-320-light-plate", [
          { id: "due", target: docDate(page) }, { id: "save", target: page.getByTestId("vehicle-doc-save") },
        ], docDate(page)));
        await docDate(page).fill(originalDate);
        await insurer.fill(originalInsurer);
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    }

    const odo = await currentOdometer(page);
    await page.getByTestId("care-odo").focus();
    await captureJournal(page, `vehicle-odometer-${suffix}`);
    targets.push({ id: "care-odo", ...await vehicleTarget(page.getByTestId("care-odo")) });
    styles.push({ id: "odometer-readout-focused", sample: await vehicleStyle(page.getByTestId("care-odo")) });
    const readout = await page.getByTestId("care-odo").evaluate(element => {
      const panel = element.closest(".care-odometer-pump")!, placeholder = getComputedStyle(element, "::placeholder");
      return { background: getComputedStyle(panel).backgroundColor, foreground: getComputedStyle(element).color,
        textAlign: getComputedStyle(element).textAlign, placeholder: { color: placeholder.color, opacity: placeholder.opacity,
          fontSize: placeholder.fontSize, fontWeight: placeholder.fontWeight },
        label: getComputedStyle(panel.querySelector("label")!).color };
    });
    expect(readout.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(readout.textAlign).toBe("left");
    geometry.push({ id: "odometer-readout", ...readout });
    await page.getByTestId("care-odo").fill("104001");
    await page.getByTestId("care-save").click();
    const confirmation = page.getByRole("alertdialog", { name: "הקילומטראז׳ נכון?", exact: true });
    await expect(confirmation).toBeVisible();
    await keyboardLoop(page, confirmation);
    await captureJournal(page, `vehicle-odometer-confirm-${suffix}`);
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(odo).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(odo).toHaveCount(0);

    await page.getByRole("button", { name: "תזכורת", exact: true }).click();
    await expect(page.getByTestId("care-entry")).toHaveAttribute("data-collection", "maintenancePlans");
    await captureJournal(page, `vehicle-reminder-categories-${suffix}`);
    await page.getByTestId("care-job-tires").click();
    await page.getByLabel("יעד קילומטראז׳", { exact: true }).fill("110000");
    await captureJournal(page, `vehicle-reminder-new-${suffix}`);
    await page.keyboard.press("Escape");
    await page.goto("/vehicle/reminders/gallery-plan");
    await expect(page.getByRole("heading", { name: "החלפת שמן", exact: true })).toBeVisible();
    await expect(page.getByText(VEHICLE_COVERAGE, { exact: true })).toHaveCount(0);
    await captureJournal(page, `vehicle-reminder-detail-${suffix}`, true);
    await page.getByRole("button", { name: "עריכת התזכורת", exact: true }).click();
    await captureJournal(page, `vehicle-reminder-edit-${suffix}`);
    await page.keyboard.press("Escape");

    await page.goto("/vehicle");
    await vehicleReady(page);
    await page.getByRole("button", { name: /משהו השתנה ברכב/ }).click();
    let issue = page.getByRole("dialog", { name: "מה קורה ברכב?", exact: true });
    await issue.getByRole("button", { name: "נורה בלוח", exact: true }).click();
    await keyboardLoop(page, issue);
    await captureJournal(page, `vehicle-issue-new-${suffix}`);
    targets.push({ id: "issue-title", ...await vehicleTarget(issue.getByLabel("שם התקלה", { exact: true })) });
    await page.keyboard.press("Escape");
    await page.goto("/vehicle/issues/gallery-issue");
    await expect(page.getByRole("heading", { name: "רעש בלמים 42", exact: true })).toBeVisible();
    await captureJournal(page, `vehicle-issue-detail-${suffix}`, true);
    await page.getByRole("button", { name: "עדכון מצב וקישור לטיפול", exact: true }).click();
    issue = page.getByRole("dialog", { name: "מעקב אחר תקלה", exact: true });
    await expect(issue.getByLabel("שם התקלה", { exact: true })).toHaveValue("רעש בלמים 42");
    await captureJournal(page, `vehicle-issue-edit-${suffix}`);
    await page.keyboard.press("Escape");
    await page.getByTestId("issue-resolve").click();
    await expect.poll(() => getDocument(`${scope.base}/vehicleIssues/gallery-issue`)).toMatchObject({ status: "resolved", version: 5 });
    await expect(page.getByTestId("issue-resolve")).toHaveCount(0);
    await captureJournal(page, `vehicle-issue-resolved-${suffix}`, true);

    await page.goto(`/vehicle/edit/${scope.vehicleId}`);
    await expect(page.getByLabel("נפח מיכל", { exact: true })).toHaveValue("50");
    await captureJournal(page, `vehicle-edit-${suffix}`, true);
    geometry.push({ id: "vehicle-edit-plate", ...await vehiclePlateGeometry(page.locator(".tm-vehicle-edit .tm-plate-xl"), 64) });
    geometry.push({ id: "vehicle-edit-numeric-pair", ...await vehicleFieldPair(page.getByLabel("נפח מיכל", { exact: true }), page.getByLabel("נתון יצרן", { exact: true })) });
    const editHeader = page.locator(".tm-vehicle-edit > .tm-screen-header");
    expect((await editHeader.boundingBox())!.y).toBeCloseTo(52, 1);
    targets.push({ id: "vehicle-edit-back", ...await vehicleTarget(editHeader.getByRole("button", { name: "חזרה לרכב", exact: true })) });
    targets.push({ id: "vehicle-edit-plate", ...await vehicleTarget(page.getByLabel("מספר רכב", { exact: true })) });
    if (theme === "light" && accent === "plate") {
      const nickname = page.getByLabel("כינוי לרכב", { exact: true });
      const originalNickname = await nickname.inputValue();
      await nickname.fill("הרכב המשפחתי עם כינוי ארוך במיוחד 42");
      narrow.push(await narrowVehicleState(page, "vehicle-edit-320-light-plate", [
        { id: "nickname", target: nickname }, { id: "save", target: page.getByRole("button", { name: "שמירת שינויים", exact: true }) },
      ], nickname));
      await nickname.fill(originalNickname);
    }

    await page.goto("/settings/vehicles");
    await expect(page.locator("[data-managed-vehicle]")).toHaveCount(6);
    await captureJournal(page, `vehicle-manager-${suffix}`, true);
    const managerHeader = (await page.locator(".tm-vehicle-manager > .tm-screen-header").boundingBox())!;
    expect(managerHeader.y).toBeCloseTo(52, 1);
    expect(managerHeader.height).toBeCloseTo(48, 1);
    geometry.push({ id: "vehicle-manager-header", ...managerHeader });
    const last = page.locator('[data-managed-vehicle^="gallery-car-"]').last();
    const targetId = (await last.getAttribute("data-managed-vehicle"))!;
    const card = managed(page, targetId);
    const select = card.getByRole("button", { name: /^בחירה ברכב/ });
    await select.focus();
    targets.push({ id: "manager-select", ...await vehicleTarget(select) });
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await getDocument(`users/${scope.uid}`))?.settings).toMatchObject({ activeVehicleId: targetId });
    await visibleManagedFocus(card);
    const archive = card.getByRole("button", { name: /^העברת .* לארכיון$/ });
    await archive.focus();
    targets.push({ id: "manager-archive", ...await vehicleTarget(archive) });
    await page.keyboard.press("Enter");
    const archiveDialog = page.getByRole("alertdialog", { name: "להעביר לארכיון?", exact: true });
    await keyboardLoop(page, archiveDialog);
    await captureJournal(page, `vehicle-archive-confirm-${suffix}`);
    await archiveDialog.getByRole("button", { name: "העברה לארכיון", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => getDocument(`users/${scope.uid}/vehicles/${targetId}`)).toMatchObject({ archived: true });
    await expect(card).toHaveAttribute("data-archived", "true");
    await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
    await visibleManagedFocus(card);
    await captureJournal(page, `vehicle-archived-${suffix}`);
    styles.push({ id: "archived-metadata", sample: await vehicleStyle(card.locator(".tm-vehicle-card-title p")) });
    styles.push({ id: "archived-restore-action", sample: await vehicleStyle(card.getByRole("button", { name: /^החזרת .* מהארכיון$/ })) });
    styles.push({ id: "archived-focus", sample: await vehicleStyle(card) });
    const restore = card.getByRole("button", { name: /^החזרת .* מהארכיון$/ });
    await expect(restore).toBeEnabled();
    await restore.focus();
    targets.push({ id: "manager-restore", ...await vehicleTarget(restore) });
    await page.keyboard.press("Enter");
    await expect.poll(() => getDocument(`users/${scope.uid}/vehicles/${targetId}`)).toMatchObject({ archived: false });
    await expect(card).toHaveAttribute("data-archived", "false");
    await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
    await visibleManagedFocus(card);
    await captureJournal(page, `vehicle-restored-${suffix}`);
    // Restoration can supersede the automatic archive selection. In that
    // valid server-confirmed case this card is already active, with no select
    // button; otherwise select it through the same accessible manager action.
    const restoredSelect = card.getByRole("button", { name: /^בחירה ברכב/ });
    const restoredActive = card.locator(".tm-vehicle-status[data-active]");
    await expect(restoredSelect.or(restoredActive)).toBeVisible();
    if (await restoredSelect.isVisible()) {
      await expect(restoredSelect).toBeEnabled();
      await restoredSelect.click();
    } else {
      await expect(restoredActive).toHaveText("פעיל");
    }
    await expect.poll(async () => (await getDocument(`users/${scope.uid}`))?.settings).toMatchObject({ activeVehicleId: targetId });
    await page.goto("/vehicle");
    await vehicleReady(page);
    await expect(page.getByRole("button", { name: "עדכון הקילומטראז׳", exact: true })).toBeVisible();
    for (const key of Object.keys(DOC_TITLES) as DocKey[]) await expect(page.getByTestId(`vehicle-doc-${key}`)).toContainText("הוספה");
    await captureJournal(page, `vehicle-new-${suffix}`, true);
    await page.goto("/settings/vehicles");
    await managed(page, scope.vehicleId).getByRole("button", { name: /^בחירה ברכב/ }).click();
    await expect.poll(async () => (await getDocument(`users/${scope.uid}`))?.settings).toMatchObject({ activeVehicleId: scope.vehicleId });
    await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
    expect((await getDocument(scope.base))?.docs).toEqual(docs);
    expect(await getDocument(`${scope.base}/serviceEvents/gallery-service`)).toEqual(seeded.service);
    expect(await getDocument(`${scope.base}/maintenancePlans/gallery-plan`)).toEqual(seeded.plan);
    expect(await listDocuments(`${scope.base}/fillups`)).toHaveLength(2);
    expect(await listDocuments(`${scope.base}/odometerReadings`)).toHaveLength(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await vehicleStyle(managed(page, scope.vehicleId));
    for (const duration of [...reduced.animationDuration.split(","), ...reduced.transitionDuration.split(",")]) {
      const seconds = Number.parseFloat(duration) / (duration.trim().endsWith("ms") ? 1000 : 1);
      expect(seconds).toBeLessThanOrEqual(.001);
    }
    styles.push({ id: "vehicle-reduced-motion", sample: reduced });
    await mkdir(journalEvidence, { recursive: true });
    await writeFile(resolve(journalEvidence, `vehicle-controls-${suffix}.json`), JSON.stringify({ viewport: { width: 390, height: 844 }, theme, accent, targets, styles, narrow, geometry }, null, 2));
  });
}
