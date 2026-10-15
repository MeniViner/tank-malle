import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { ALICE, signedInWithData } from "./helpers/app";
import { getDocument, installRules, listAccounts, listDocuments, restoreRules, seedFillups, seedVehicle, setDocument } from "./helpers/emulator";
import { fillupsToCsv, rowsToCsv, tankUpdatesToCsv } from "../src/lib/csv";
import type { Fillup, Vehicle } from "../src/lib/types";

test.afterEach(async () => { await restoreRules(); });
const ownRows = (uid: string) => `users/${uid}/vehicles/v1/fillups`;
const vehicle = (id: string): Vehicle => ({ id, make: "מאזדה", model: "3", fuelType: "95", archived: false, priceAdjustment: 0 });
const row: Fillup = { id: "source", date: Date.UTC(2026, 9, 1, 8), odometer: 123456, liters: 30, pricePerLiter: 7, totalCost: 210, isFullTank: false,
  fillEndState: "unknown", fillEndStateSource: "unknown", preFillLevel: 0.2, preFillLevelSource: "direct-gauge", postFillLevel: 0.8,
  postFillLevelSource: "derived-after-partial", refuelReason: "before-trip", capacityLitersAtEntry: 50, tankSchemaVersion: 2, postedPricePerLiter: 7.2 };
async function upload(page: Page, content: string) {
  await page.goto("/settings/import");
  await page.locator('input[type="file"]').setInputFiles({ name: "audit.csv", mimeType: "text/csv", buffer: Buffer.from(content) });
}
async function startDeletion(page: Page) {
  await page.goto("/settings/profile");
  await page.getByRole("button", { name: "מחיקת חשבון", exact: true }).click();
  await page.getByRole("button", { name: "המשך למחיקה", exact: true }).click();
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "כן, מחקו הכול", exact: true }).click();
  return popup;
}

test("F03: Settings withdraws every contribution and reports the server result", async ({ page }) => {
  const { uid } = await signedInWithData(page);
  for (const suffix of ["", "__v1", "__archived", "__deleted"]) await setDocument(`benchmarks/${uid}${suffix}`, { modelKey: "x", fuelType: "95", year: 2020, avgKmPerLiter: 12, segments: 3, avgPricePerLiter: 7 });
  await page.goto("/settings");
  await page.getByRole("switch", { name: "השוואה אנונימית" }).click();
  await expect(page.getByText("השיתוף כבוי. נתוני ההשוואה שלכם הוסרו מהשרת.")).toBeVisible();
  expect((await listDocuments("benchmarks")).filter((d) => d.id.startsWith(uid))).toHaveLength(0);
  expect((await getDocument(`users/${uid}`))?.settings).toMatchObject({ shareBenchmarks: false });
});

test("F01/F02: cancelling real reauthentication retains account and data", async ({ page }) => {
  const { uid } = await signedInWithData(page);
  const popup = await startDeletion(page);
  await popup.close();
  await expect(page.getByText("נדרשת התחברות מחדש לפני המחיקה", { exact: true })).toBeVisible({ timeout: 25000 });
  expect(await getDocument(`users/${uid}/vehicles/v1`)).not.toBeNull();
  expect((await listAccounts()).some((account) => account.localId === uid)).toBe(true);
});

test("F01/F02: a partial deletion failure retains auth, then retry completes", async ({ page }) => {
  const { uid } = await signedInWithData(page);
  await setDocument(`users/${uid}/personalPriceRules/r1`, { vehicleId: "v1" });
  await setDocument(`users/${uid}/importBatches/b1`, { vehicleId: "v1" });
  await setDocument(`userSummaries/${uid}`, { version: 1, vehicles: {}, vehicleCount: 1 });
  await setDocument(`benchmarks/${uid}__archived`, { modelKey: "x" });
  await setDocument("feedback/owned", { uid, message: "audit" });
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  await installRules(rules.replace('match /personalPriceRules/{ruleId} {\n        allow read, delete: if isOwner(uid);', 'match /personalPriceRules/{ruleId} {\n        allow read: if isOwner(uid);\n        allow delete: if false;'));
  let popup = await startDeletion(page);
  await popup.getByText(ALICE.email, { exact: false }).first().click();
  await expect(page.getByText("המחיקה נעצרה לפני השלמתה", { exact: true })).toBeVisible({ timeout: 25000 });
  expect(await getDocument(`users/${uid}/vehicles/v1`)).toBeNull();
  expect(await getDocument(`users/${uid}/personalPriceRules/r1`)).not.toBeNull();
  expect((await listAccounts()).some((account) => account.localId === uid)).toBe(true);
  await restoreRules();
  await page.reload();
  popup = await startDeletion(page);
  await popup.getByText(ALICE.email, { exact: false }).first().click();
  await expect.poll(async () => (await listAccounts()).some((account) => account.localId === uid), { timeout: 25000 }).toBe(false);
  for (const path of [`users/${uid}`, `users/${uid}/personalPriceRules/r1`, `users/${uid}/importBatches/b1`, `userSummaries/${uid}`, `benchmarks/${uid}__archived`, "feedback/owned"]) expect(await getDocument(path), path).toBeNull();
  await expect(page.getByRole("button", { name: /Google/ })).toBeVisible();
});

test("F04/F05: backup retains measurements and repeated import targets the second vehicle", async ({ page }) => {
  const { uid } = await signedInWithData(page);
  await seedVehicle(uid, "v2", { make: "טויוטה", model: "יאריס" });
  await upload(page, fillupsToCsv([row], vehicle("v2")));
  await page.getByRole("button", { name: /ייבוא 1 רשומות/ }).click();
  await expect(page.getByText("הייבוא הסתיים", { exact: true })).toBeVisible();
  const records = await listDocuments(`users/${uid}/vehicles/v2/fillups`);
  expect(records).toHaveLength(1);
  expect(records[0].data).toMatchObject({ fillEndState: "unknown", preFillLevel: 0.2, postFillLevel: 0.8, postedPricePerLiter: 7.2, tankSchemaVersion: 2 });
  expect(await listDocuments(ownRows(uid))).toHaveLength(0);
  await upload(page, fillupsToCsv([row], vehicle("v2")));
  await expect(page.getByText("כבר קיימות", { exact: false }).first()).toBeVisible();
  expect(await listDocuments(`users/${uid}/vehicles/v2/fillups`)).toHaveLength(1);
  await upload(page, tankUpdatesToCsv([{ id: "o1", vehicleId: "v2", observedAt: row.date, recordedAt: row.date, kind: "both", odometer: 123500, level: 0.5, confirmed: true, phase: "standalone" }], [{ id: "p1", vehicleId: "v2", date: row.date, distanceKm: 100, mode: "additional" }]));
  await page.getByRole("button", { name: "ייבוא 2 עדכונים" }).click();
  await expect(page.getByText("הייבוא הסתיים", { exact: true })).toBeVisible();
  expect(await listDocuments(`users/${uid}/vehicles/v2/observations`)).toHaveLength(1);
  expect(await listDocuments(`users/${uid}/vehicles/v2/tankPlans`)).toHaveLength(1);
  expect(await listDocuments(ownRows(uid))).toHaveLength(0);
});

test("F06: both tank editors preserve grouped odometers and reject a backward reading", async ({ page }) => {
  const { uid } = await signedInWithData(page, { vehicle: { make: "מאזדה", model: "3", tankLiters: 50, tankLitersSource: "user" }, fillups: [{ id: "base", date: new Date(Date.UTC(2026, 9, 1)), odometer: 100000, liters: 40, pricePerLiter: 7 }] });
  await setDocument(`users/${uid}/vehicles/v1/observations/seed`, { observedAt: new Date(Date.now() - 60000), recordedAt: new Date(), kind: "level", level: 0.5, confirmed: true, levelSource: "direct-gauge" });
  await page.reload();
  await page.getByRole("button", { name: "עדכון קילומטראז׳", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("קילומטראז׳ נוכחי").fill("123,456");
  await dialog.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect.poll(async () => (await listDocuments(`users/${uid}/vehicles/v1/observations`)).find((record) => record.id !== "seed")?.data.odometer).toBe(123456);
  await page.getByRole("button", { name: "עדכון מד הדלק", exact: true }).last().click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("קילומטראז׳ (לא חובה)").fill("123,455");
  await expect(dialog.getByText("הזינו קילומטראז׳ שלם שאינו נמוך מהקריאה האחרונה")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "שמירה", exact: true })).toBeDisabled();
});

test("F07: invalid vehicle edits stay open, rejected valid edits never report success", async ({ page }) => {
  const { uid } = await signedInWithData(page, { vehicle: { make: "מאזדה", model: "3", tankLiters: 50 } });
  await page.goto("/settings/vehicles");
  await page.getByRole("button", { name: "עריכה", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("נפח מיכל", { exact: true }).fill("-10");
  await expect(dialog.getByRole("button", { name: "שמירת שינויים" })).toBeDisabled();
  await dialog.getByLabel("נפח מיכל", { exact: true }).fill("60");
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  await installRules(rules.replace('allow create, update: if isOwner(uid) && accountWritable(uid) && validVehicle(request.resource.data);', 'allow create, update: if false;'));
  await dialog.getByRole("button", { name: "שמירת שינויים" }).click();
  await expect(dialog.getByRole("alert")).toContainText("השינוי לא אושר בשרת");
  expect((await getDocument(`users/${uid}/vehicles/v1`))?.tankLiters).toBe(50);
  await expect(dialog.getByLabel("נפח מיכל", { exact: true })).toHaveValue("60");
  await page.goto("/");
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.getByRole("button", { name: "פעולות שלא סונכרנו" })).toBeInViewport();
    await expect(page.getByRole("button", { name: "פרופיל", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await restoreRules();
  await page.goto("/settings/unsynced");
  await page.getByRole("button", { name: "ניסיון חוזר", exact: true }).click();
  await expect(page.locator("[data-outbox-op]")).toHaveCount(0);
  expect((await getDocument(`users/${uid}/vehicles/v1`))?.tankLiters).toBe(60);
});

test("F07: a rejected archive preserves the active preference and can be retried", async ({ page }) => {
  const { uid } = await signedInWithData(page);
  await seedVehicle(uid, "v2", { make: "טויוטה", model: "יאריס" });
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  await installRules(rules.replace('allow create, update: if isOwner(uid) && accountWritable(uid) && validVehicle(request.resource.data);', 'allow create, update: if false;'));
  await page.goto("/settings/vehicles");
  await page.getByRole("button", { name: "העברה לארכיון", exact: true }).first().click();
  await expect(page.getByText("העברה לארכיון נכשלה", { exact: true })).toBeVisible();
  expect((await getDocument(`users/${uid}`))?.settings).toMatchObject({ activeVehicleId: "v1" });
  expect((await getDocument(`users/${uid}/vehicles/v1`))?.archived).toBe(false);
  await restoreRules();
  await page.goto("/settings/unsynced");
  await page.getByRole("button", { name: "ניסיון חוזר", exact: true }).click();
  await expect(page.locator("[data-outbox-op]")).toHaveCount(0);
  expect((await getDocument(`users/${uid}/vehicles/v1`))?.archived).toBe(true);
  await page.goto("/settings/vehicles");
  await page.getByRole("button", { name: "שחזור", exact: true }).click();
  await expect.poll(async () => (await getDocument(`users/${uid}/vehicles/v1`))?.archived).toBe(false);
});

test("F08: profile counts and exports all vehicles including archived ones", async ({ page }) => {
  const { uid } = await signedInWithData(page);
  await seedFillups(uid, "v1", [{ id: "a", date: new Date(row.date), odometer: 100000, liters: 40, pricePerLiter: 7 }]);
  await seedVehicle(uid, "v2", { make: "טויוטה", model: "יאריס" });
  await setDocument(`users/${uid}/vehicles/v2`, { ...vehicle("v2"), make: "טויוטה", archived: true });
  await seedFillups(uid, "v2", [{ id: "b", date: new Date(row.date), odometer: 200000, liters: 20, pricePerLiter: 7 }]);
  await page.goto("/settings/profile");
  await expect(page.getByText("60 ליטר בסך הכול", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /ייצוא הנתונים שלי/ }).click();
  const file = await download;
  const content = readFileSync((await file.path())!, "utf8");
  expect(content).toContain(",v1,"); expect(content).toContain(",v2,");
});

test("F07: a rejected tank-capacity confirmation never claims success and retries", async ({ page }) => {
  const { uid } = await signedInWithData(page, { vehicle: { make: "מאזדה", model: "3", tankLiters: 50, tankLitersSource: "estimate" }, fillups: [{ id: "base", date: new Date(row.date), odometer: 100000, liters: 40, pricePerLiter: 7 }] });
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  await installRules(rules.replace('allow create, update: if isOwner(uid) && accountWritable(uid) && validVehicle(request.resource.data);', 'allow create, update: if false;'));
  await page.getByRole("button", { name: "מאשר", exact: true }).click();
  await expect(page.getByText("נפח המיכל לא אושר בשרת", { exact: true })).toBeVisible();
  await expect(page.getByText("נפח המיכל אושר", { exact: true })).toHaveCount(0);
  expect((await getDocument(`users/${uid}/vehicles/v1`))?.tankLitersSource).toBe("estimate");
  await restoreRules();
  await page.goto("/settings/unsynced");
  await page.getByRole("button", { name: "ניסיון חוזר", exact: true }).click();
  await expect(page.locator("[data-outbox-op]")).toHaveCount(0);
  expect((await getDocument(`users/${uid}/vehicles/v1`))?.tankLitersSource).toBe("user");
});

test("F09/F12: unknown stays unknown and a draft survives navigation and reload", async ({ page }) => {
  const { uid } = await signedInWithData(page);
  await setDocument(`${ownRows(uid)}/unknown`, { ...row, date: new Date(row.date) });
  await page.reload();
  await expect(page.getByText("לא צוין", { exact: true }).first()).toBeVisible();
  await page.goto("/fillup/new");
  await page.getByLabel(/^קילומטראז׳/).fill("124000");
  await page.getByLabel("ליטרים", { exact: true }).fill("35.5");
  await page.getByRole("button", { name: "סגירה", exact: true }).click();
  await page.goto("/fillup/new");
  await expect(page.getByLabel("ליטרים", { exact: true })).toHaveValue("35.5");
  await page.reload();
  await expect(page.getByLabel(/^קילומטראז׳/)).toHaveValue("124000");
  await expect(page.getByText("הטיוטה שלכם שוחזרה מהמכשיר")).toBeVisible();
});

test("F13/F14: modal focus and segmented keyboard navigation", async ({ page }) => {
  await signedInWithData(page);
  await page.goto("/settings");
  const group = page.getByRole("radiogroup").first();
  const selected = group.getByRole("radio", { checked: true });
  await selected.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(group.getByRole("radio", { checked: true })).toBeFocused();
  await expect(group.locator('[tabindex="0"]')).toHaveCount(1);
  await page.goto("/settings/profile");
  await page.getByRole("button", { name: "מחיקת חשבון", exact: true }).click();
  const modal = page.getByRole("alertdialog", { name: "למחוק את החשבון?" });
  await expect(modal.getByRole("button", { name: "ביטול", exact: true })).toBeFocused();
  for (let i = 0; i < 8; i++) { await page.keyboard.press("Tab"); expect(await modal.evaluate((el) => el.contains(document.activeElement))).toBe(true); }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "מחיקת חשבון", exact: true })).toBeFocused();
});

test("F15/F16: narrow header contains long names, pushed screens start at the heading", async ({ page }) => {
  const { uid } = await signedInWithData(page, { vehicle: { make: "מאזדה", model: "3", tankLiters: 50, tankLitersSource: "user" }, regulatedPrice: 7.31, fillups: [{ id: "known", date: new Date(row.date), odometer: 100000, liters: 40, pricePerLiter: 7 }] });
  const data = await getDocument(`users/${uid}/vehicles/v1`);
  await setDocument(`users/${uid}/vehicles/v1`, { ...data, nickname: "שם רכב ארוך במיוחד לבדיקת הרוחב במסך צר מאוד מאוד" });
  await setDocument(`users/${uid}/vehicles/v1/observations/current`, { observedAt: new Date(), recordedAt: new Date(), kind: "level", level: 0.5, confirmed: true, levelSource: "direct-gauge" });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.reload();
  await expect(page.getByText("כדאי לתדלק", { exact: true })).toBeVisible();
  expect(await page.getByText("כדאי לתדלק", { exact: true }).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/settings");
  await page.getByRole("button", { name: "מדיניות פרטיות", exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "מדיניות פרטיות", exact: true }).click();
  await expect(page.getByRole("heading", { name: "מדיניות פרטיות", exact: true })).toBeInViewport();
  await expect(page.getByRole("heading", { name: "מדיניות פרטיות", exact: true })).toBeFocused();
});

test("F10/F11: History and Statistics share calendar bounds, including month-end", async ({ page }) => {
  await signedInWithData(page, { fillups: [
    { id: "old", date: new Date("2026-02-27T12:00:00Z"), odometer: 100000, liters: 40 },
    { id: "feb-end", date: new Date("2026-02-28T12:00:00Z"), odometer: 100400, liters: 40 },
    { id: "may-old", date: new Date("2026-05-30T12:00:00Z"), odometer: 100800, liters: 40 },
    { id: "may-end", date: new Date("2026-05-31T12:00:00Z"), odometer: 101200, liters: 40 },
    { id: "jun", date: new Date("2026-06-01T12:00:00Z"), odometer: 101600, liters: 40 },
  ] });
  await page.clock.setFixedTime(new Date("2026-08-31T09:00:00Z"));
  await page.goto("/history");
  await page.getByRole("radio", { name: "3 חודשים", exact: true }).click();
  await expect(page.getByText(/2 תדלוקים מוצגים/)).toContainText("31.5.26");
  await page.goto("/stats");
  await expect(page.getByText(/^4 תדלוקים ·/)).toBeVisible();
  await expect(page.getByText("28.2.26 – 31.8.26", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "6 חודשים אחרונים", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "3 חודשים אחרונים", exact: true }).click();
  await expect(page.getByText(/^2 תדלוקים ·/)).toBeVisible();
  await expect(page.getByText("31.5.26 – 31.8.26", { exact: true })).toBeVisible();
});

test("F18: an expired station catalog refreshes in the picker and remains usable offline", async ({ page }) => {
  await signedInWithData(page);
  const catalog = (name: string) => ({ count: 1, companies: ["פז"], stations: [{ i: "audit-station", n: name, c: "פז", a: "בדיקה", lat: 32, lng: 34.8 }] });
  await page.evaluate((catalog) => localStorage.setItem("tm.stations.v2", JSON.stringify({ at: 1, catalog })), catalog("תחנה ישנה"));
  await page.route("**/fuel-stations.json", (route) => route.fulfill({ json: catalog("תחנה מעודכנת") }));
  await page.goto("/fillup/new");
  await page.getByRole("button", { name: /^תחנה / }).click();
  await page.getByPlaceholder("חיפוש תחנה…").fill("מעודכנת");
  await expect(page.getByRole("button", { name: /תחנה מעודכנת/ })).toBeVisible();
  await page.evaluate(() => { const cached = JSON.parse(localStorage.getItem("tm.stations.v2")!); cached.at = 1; localStorage.setItem("tm.stations.v2", JSON.stringify(cached)); });
  await page.unroute("**/fuel-stations.json");
  await page.route("**/fuel-stations.json", (route) => route.abort("internetdisconnected"));
  await page.reload();
  await page.getByRole("button", { name: /^תחנה / }).click();
  await page.getByPlaceholder("חיפוש תחנה…").fill("מעודכנת");
  await expect(page.getByRole("button", { name: /תחנה מעודכנת/ })).toBeVisible();
});

test("F17: summary refreshes edited liters/date and removes archived vehicles", async ({ page }) => {
  const { uid } = await signedInWithData(page, { fillups: [{ id: "f1", date: new Date(row.date), odometer: 100000, liters: 40, pricePerLiter: 7 }] });
  await expect.poll(async () => ((await getDocument(`userSummaries/${uid}`))?.vehicles as Record<string, Record<string, unknown>>)?.v1?.liters).toBe(40);
  const data = (await getDocument(`${ownRows(uid)}/f1`))!;
  const changedAt = row.date + 86400000;
  await setDocument(`${ownRows(uid)}/f1`, { ...data, date: new Date(changedAt), createdAt: new Date(row.date), liters: 45, pricePerLiter: 280 / 45 });
  await expect.poll(async () => ((await getDocument(`userSummaries/${uid}`))?.vehicles as Record<string, Record<string, unknown>>)?.v1?.liters).toBe(45);
  expect(((await getDocument(`userSummaries/${uid}`))?.vehicles as Record<string, Record<string, unknown>>)?.v1?.lastFillupAt).toBe(changedAt);
  await seedVehicle(uid, "v2", { make: "טויוטה", model: "יאריס" });
  await setDocument(`userSummaries/${uid}`, { version: 1, vehicleCount: 2, vehicles: { v1: { fillups: 1 }, v2: { fillups: 9 } } });
  await page.goto("/settings/vehicles");
  await page.getByText("טויוטה יאריס", { exact: true }).waitFor();
  await page.getByRole("button", { name: "העברה לארכיון", exact: true }).last().click();
  await expect.poll(async () => Object.keys((await getDocument(`userSummaries/${uid}`))?.vehicles as object)).toEqual(["v1"]);
});

test("F04/F08: a multi-car backup can restore a chosen source into a new vehicle", async ({ page }) => {
  const { uid } = await signedInWithData(page);
  await upload(page, rowsToCsv([
    { vehicle: { ...vehicle("old-a"), nickname: "מקור ראשון" }, fillup: row },
    { vehicle: { ...vehicle("old-b"), nickname: "מקור שני" }, fillup: { ...row, odometer: 234567 } },
  ]));
  await page.getByLabel("רכב המקור בתוך הגיבוי").selectOption("old-b");
  await page.getByRole("button", { name: /ייבוא 1 רשומות/ }).click();
  await expect(page.getByText("הייבוא הסתיים", { exact: true })).toBeVisible();
  const records = await listDocuments(ownRows(uid));
  expect(records).toHaveLength(1);
  expect(records[0].data.odometer).toBe(234567);
  expect(records[0].data.fillEndState).toBe("unknown");
});

test("F12: explicitly loading the server version replaces a saved edit draft", async ({ page }) => {
  const { uid } = await signedInWithData(page, { fillups: [{ id: "f1", date: new Date(row.date), odometer: 100000, liters: 40, pricePerLiter: 7 }] });
  await page.goto("/fillup/f1");
  await expect(page.getByLabel("ליטרים", { exact: true })).toHaveValue("40");
  await page.getByLabel("הערה").fill("טיוטה ישנה");
  const data = (await getDocument(`${ownRows(uid)}/f1`))!;
  await setDocument(`${ownRows(uid)}/f1`, { ...data, date: new Date(row.date), createdAt: new Date(row.date), liters: 42, totalCost: 294, notes: "גרסת שרת" });
  await page.getByRole("button", { name: "טעינת הגרסה החדשה" }).click();
  await expect(page.getByLabel("ליטרים", { exact: true })).toHaveValue("42");
  await expect(page.getByLabel("הערה")).toHaveValue("גרסת שרת");
  await page.reload();
  await expect(page.getByLabel("הערה")).toHaveValue("גרסת שרת");
});

test("F05: imports cannot mistake a denied server read for an empty destination", async ({ page }) => {
  const { uid } = await signedInWithData(page);
  await installRules(`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }`);
  await upload(page, fillupsToCsv([row], vehicle("v1")));
  await expect(page.getByText(/לא ניתן להכין את הייבוא/)).toBeVisible();
  expect(await listDocuments(ownRows(uid))).toHaveLength(0);
  await expect(page.getByRole("button", { name: /ייבוא 1 רשומות/ })).toHaveCount(0);
});
