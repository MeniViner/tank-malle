import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect, type Download, type Locator, type Page } from "@playwright/test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { ALICE, BOB, signIn, signOut, signedInWithData, uidOf } from "./helpers/app";
import { PROJECT_ID, getDocument, listDocuments, resetEmulators, seedVehicle, setDocument } from "./helpers/emulator";
import { holdFirestoreDisk, releaseFirestoreDisk } from "./helpers/disk";
import { outboxCount } from "./helpers/pwa";
import { holdJournal, releaseJournal, waitForJournalHold } from "./helpers/journal";

// An ordinary test run never rewrites committed evidence from a previous stage.
const stage = process.env.DESIGN_V2_STAGE;
const evidence = resolve(stage ? `design/v2/evidence/stage-${stage}` : "test-results/design-v2");
test.use({ viewport: { width: 390, height: 844 } });

async function fixture(page: Page) {
  const scope = await signedInWithData(page, {
    vehicle: { make: "מאזדה", model: "3", year: 2020, tankLiters: 50, tankLitersSource: "user" },
    regulatedPrice: 7.77,
    fillups: [
      { id: "first", date: new Date("2026-10-01T09:00:00Z"), odometer: 100000, liters: 40, pricePerLiter: 7 },
      { id: "second", date: new Date("2026-10-15T09:00:00Z"), odometer: 100500, liters: 40, pricePerLiter: 7 },
    ],
  });
  const firstPath = `users/${scope.uid}/vehicles/${scope.vehicleId}`;
  await setDocument(firstPath, { ...await getDocument(firstPath), nickname: "המשפחתית", plateNumber: "7248078" });
  await seedVehicle(scope.uid, "second", { make: "טויוטה", model: "יאריס", year: 2022 });
  const secondPath = `users/${scope.uid}/vehicles/second`;
  await setDocument(secondPath, { ...await getDocument(secondPath), nickname: "לעבודה", plateNumber: "12345678" });
  await seedVehicle(scope.uid, "archived", { make: "סוזוקי", model: "סוויפט", year: 2014 });
  const archivedPath = `users/${scope.uid}/vehicles/archived`;
  await setDocument(archivedPath, { ...await getDocument(archivedPath), nickname: "הרכב הקודם", archived: true, plateNumber: "7777777" });
  await page.goto("/");
  await expect(page.getByTestId("open-car-switch")).toContainText("המשפחתית");
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  return scope;
}

async function appearance(page: Page, uid: string, theme: "light" | "dark", accent: "plate" | "mint") {
  await page.goto("/account");
  await page.getByRole("button", { name: /^מראה/ }).click();
  await page.getByRole("radio", { name: theme === "light" ? "בהיר" : "כהה", exact: true }).click();
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ theme });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^צבע/ }).click();
  await page.getByTestId(`accent-${accent}`).click();
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ accentColor: accent });
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect.poll(() => outboxCount(page, uid)).toBe(0);
  await expect(page.getByTestId("account-unsynced")).toHaveCount(0);
}

async function targetSize(target: Locator) {
  const size = await target.boundingBox();
  expect(size, `target exists: ${await target.getAttribute("data-testid")}`).not.toBeNull();
  expect(size!.width).toBeGreaterThanOrEqual(44);
  expect(size!.height).toBeGreaterThanOrEqual(44);
  return size!;
}

async function focusedInside(dialog: Locator) {
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
}

async function capture(page: Page, name: string, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: resolve(evidence, `${name}.png`), animations: "disabled" });
  if (fullPage) await page.screenshot({ path: resolve(evidence, `${name}-full.png`), fullPage: true, animations: "disabled" });
}

test("five navigation slots keep the visible refuel label and only the four main routes have tabs", async ({ page }) => {
  await fixture(page);
  for (const [route, active] of [["/", "home"], ["/history", "history"], ["/stats", "stats"], ["/vehicle", "vehicle"], ["/vehicle/", "vehicle"]]) {
    await page.goto(route);
    const nav = page.getByTestId("tab-bar");
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link")).toHaveCount(4);
    await expect(nav.locator(":scope > *")).toHaveCount(5);
    await expect(nav.getByRole("link")).toHaveText(["בית", "יומן", "תובנות", "רכב"]);
    await expect(page.getByTestId(`tab-${active}`)).toHaveAttribute("aria-current", "page");
    for (const link of await nav.getByRole("link").all()) {
      await targetSize(link);
      const pill = await link.locator(".tm-tab-icon-pill").boundingBox();
      expect(pill!.width).toBe(50);
      expect(pill!.height).toBe(30);
    }
    const fab = page.getByTestId("refuel-fab");
    await expect(fab).toHaveAccessibleName("תדלקתי");
    await expect(fab).toContainText("תדלקתי");
    await expect(fab).toHaveCSS("border-radius", "22px");
    const bounds = await fab.boundingBox();
    expect(bounds!.width).toBe(72);
    expect(bounds!.height).toBe(72);
    await expect(fab).toBeInViewport({ ratio: 1 });
  }
  await page.goto("/");
  const header = page.getByTestId("home-header");
  await expect(header.getByRole("button")).toHaveCount(3);
  for (const button of await header.getByRole("button").all()) await targetSize(button);
  await expect(header.getByRole("button", { name: /סנכרון|ענן/ })).toHaveCount(0);
  await page.getByTestId("open-account").click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "חשבון", exact: true })).toBeInViewport();
  await expect(page.getByTestId("account-unsynced")).toHaveCount(0);
  await expect(page.getByTestId("account-admin")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /ניהול רכבים|רכבים וארכיון/ })).toHaveCount(0);
  await page.getByRole("button", { name: "חזרה", exact: true }).click();
  await page.getByRole("button", { name: "התראות", exact: true }).click();
  await expect(page).toHaveURL(/\/notifications$/);

  for (const [route, title] of [
    ["/account", "חשבון"], ["/settings", "חשבון"], ["/settings/profile", "חשבון"],
    ["/settings/vehicles", "הרכבים שלי"], ["/settings/import", "ייבוא נתונים"],
    ["/settings/unsynced", "סנכרון"], ["/notifications", "התראות"],
    ["/feedback", "משוב"], ["/legal/terms", "תנאי שימוש"], ["/fillup/new", "תדלוק חדש"],
  ]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: title, level: 1, exact: true })).toBeVisible();
    if (route === "/settings/unsynced") await expect(page.getByRole("heading", { name: "הכל מעודכן", exact: true })).toBeVisible();
    await expect(page.getByTestId("tab-bar")).toHaveCount(0);
    if (route === "/settings" || route === "/settings/profile") await expect(page).toHaveURL(/\/account$/);
  }
  await page.goto("/vehicle?tab=prefs");
  const manage = page.getByRole("link", { name: /^ניהול רכבים/ });
  await targetSize(manage);
});

test("active-only car switching, archive and restore persist while keeping both vehicle ledgers", async ({ page }) => {
  const { uid, vehicleId } = await fixture(page);
  await page.getByTestId("open-car-switch").click();
  const sheet = page.getByRole("dialog", { name: "הרכבים שלי", exact: true });
  await expect(sheet.locator("button[data-testid^='car-switch-']")).toHaveCount(3); // two cars and management
  await expect(page.getByTestId(`car-switch-${vehicleId}`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("car-switch-archived")).toHaveCount(0);
  for (const choice of await sheet.locator(".tm-car-choice").all()) await targetSize(choice);
  await focusedInside(sheet);
  for (let index = 0; index < 8; index++) { await page.keyboard.press("Tab"); await focusedInside(sheet); }
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("open-car-switch")).toBeFocused();
  await page.getByTestId("open-car-switch").click();
  await page.getByTestId("car-switch-second").click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ activeVehicleId: "second" });
  await page.reload();
  await expect(page.getByTestId("open-car-switch")).toContainText("לעבודה");
  await page.getByTestId("open-car-switch").click();
  await expect(page.getByTestId("car-switch-second")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("car-switch-manage").click();
  await expect(page).toHaveURL(/\/settings\/vehicles$/);
  const second = page.getByRole("article", { name: "לעבודה", exact: true });
  await second.getByRole("button", { name: "העברת לעבודה לארכיון", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "העברה לארכיון", exact: true }).click();
  await expect.poll(async () => (await getDocument(`users/${uid}/vehicles/second`))?.archived).toBe(true);
  await page.goto("/");
  await page.getByTestId("open-car-switch").click();
  await expect(page.getByTestId("car-switch-second")).toHaveCount(0);
  await expect(page.getByTestId(`car-switch-${vehicleId}`)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("car-switch-manage").click();
  await second.getByRole("button", { name: "החזרת לעבודה מהארכיון", exact: true }).click();
  await expect.poll(async () => (await getDocument(`users/${uid}/vehicles/second`))?.archived).toBe(false);
  await page.goto("/");
  await page.getByTestId("open-car-switch").click();
  await page.getByTestId("car-switch-second").click();
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ activeVehicleId: "second" });
  await page.reload();
  await expect(page.getByTestId("open-car-switch")).toContainText("לעבודה");
  expect(await listDocuments(`users/${uid}/vehicles/${vehicleId}/fillups`)).toHaveLength(2);
  expect(await listDocuments(`users/${uid}/vehicles/second/fillups`)).toHaveLength(0);
  await page.getByTestId("open-car-switch").click();
  await sheet.getByRole("button", { name: "הוספת רכב", exact: true }).click();
  await expect(page).toHaveURL(/\/vehicles\/new$/);
  await expect(page.getByRole("heading", { name: "מה מספר הרכב?", exact: true })).toBeVisible();
});

test("the FAB starts manually by default and the saved camera choice keeps the manual draft intact", async ({ page }) => {
  const { uid } = await fixture(page);
  await page.getByTestId("refuel-fab").click();
  await expect(page).toHaveURL(/\/fillup\/new$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("ליטרים", { exact: true })).toBeVisible();
  await page.goto("/account");
  const quick = page.getByRole("switch", { name: "כפתור תדלקתי פותח מצלמה", exact: true });
  await expect(quick).not.toBeChecked();
  await quick.click();
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ quickEntry: true });
  await page.reload();
  await expect(quick).toBeChecked();
  await page.getByRole("button", { name: "חזרה", exact: true }).click();
  await page.getByTestId("refuel-fab").click();
  const camera = page.getByRole("dialog");
  await expect(camera).toBeVisible();
  await camera.getByRole("button", { name: "סגירה", exact: true }).click();
  await expect(camera).toHaveCount(0);
  await page.getByLabel("ליטרים", { exact: true }).fill("17.5");
  await page.getByRole("button", { name: "סגירה", exact: true }).click();
  await page.getByTestId("refuel-fab").click();
  await camera.getByRole("button", { name: "סגירה", exact: true }).click();
  await expect(page.getByLabel("ליטרים", { exact: true })).toHaveValue("17.5");
  await page.goto("/account");
  await quick.click();
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ quickEntry: false });
  await page.getByRole("button", { name: "חזרה", exact: true }).click();
  await page.getByTestId("refuel-fab").click();
  await expect(camera).toHaveCount(0);
  await expect(page.getByLabel("ליטרים", { exact: true })).toHaveValue("17.5");
});

test("a new account can reach Account and both legacy routes before creating a vehicle", async ({ page }) => {
  await resetEmulators();
  await signIn(page, ALICE);
  const uid = await uidOf(ALICE);
  for (const route of ["/account", "/settings", "/settings/profile"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { name: "חשבון", exact: true })).toBeVisible();
    await expect(page.getByTestId("account-identity")).toContainText(ALICE.email);
    await expect(page.getByTestId("account-signout")).toBeEnabled();
    await expect(page.getByTestId("account-delete")).toBeEnabled();
    await expect(page.getByTestId("tab-bar")).toHaveCount(0);
  }
  await page.getByTestId("account-identity").click();
  await expect(page.getByTestId("account-summary")).toContainText("זו ההתחברות הראשונה");
  await page.keyboard.press("Escape");
  await page.getByTestId("account-backup").click();
  await expect(page.getByTestId("backup-download")).toBeEnabled();
  await expect(page.getByTestId("account-legacy-backup")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("account-delete").click();
  await expect(page.getByRole("alertdialog", { name: "למחוק את החשבון?", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("account-delete")).toBeFocused();
  await page.goto("/settings/import");
  await expect(page.getByRole("button", { name: "הוספת רכב", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "לרכב שלי", exact: true }).click();
  await expect(page.getByRole("heading", { name: "מה מספר הרכב?", exact: true })).toBeVisible();
  expect(await listDocuments(`users/${uid}/vehicles`)).toHaveLength(0);
});

test("an archived-only import returns through Vehicle to management without changing archived records", async ({ page }) => {
  const { uid } = await fixture(page);
  for (const id of ["v1", "second"]) {
    const path = `users/${uid}/vehicles/${id}`;
    await setDocument(path, { ...await getDocument(path), archived: true });
  }
  await page.goto("/settings/import");
  await expect(page.getByText("בחרו רכב פעיל כדי לשייך אליו את ההיסטוריה.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "לרכב שלי", exact: true }).click();
  await expect(page).toHaveURL(/\/vehicle$/);
  const manage = page.getByRole("link", { name: "ניהול רכבים", exact: true });
  const bounds = await targetSize(manage);
  test.info().annotations.push({ type: "touch-target", description: JSON.stringify({ target: "vehicle-empty-management", width: bounds.width, height: bounds.height }) });
  await manage.click();
  await expect(page).toHaveURL(/\/settings\/vehicles$/);
  await expect(page.getByRole("button", { name: /^החזרת .* מהארכיון$/ })).toHaveCount(3);
  await expect(page.getByRole("button", { name: /^העברת .* לארכיון$/ })).toHaveCount(0);
  for (const id of ["v1", "second", "archived"]) expect((await getDocument(`users/${uid}/vehicles/${id}`))?.archived).toBe(true);
  expect(await listDocuments(`users/${uid}/vehicles/v1/fillups`)).toHaveLength(2);
});

test("unknown outbox health keeps Account actionable and prevents clearing an unreadable local record", async ({ page }) => {
  const { uid } = await fixture(page);
  const unreadable = '{"operations":invalid-preserve-these-bytes';
  await page.evaluate(({ uid, unreadable }) => localStorage.setItem(`tm.outbox.v1.${uid}`, unreadable), { uid, unreadable });
  await page.goto("/account");
  await expect(page.getByTestId("account-unsynced")).toContainText("מצב האחסון לא ידוע");
  await expect(page.getByTestId("account-unsynced-count")).toHaveCount(0);
  await page.getByTestId("account-unsynced").click();
  await expect(page).toHaveURL(/\/settings\/unsynced$/);
  await expect(page.getByText(/לא ניתנת לקריאה ונשמרה בצד/)).toBeVisible();
  await page.goto("/account");
  await page.getByTestId("account-signout").click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("הנתונים המקומיים לא יימחקו");
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const retained = await page.evaluate(unreadable => Object.keys(localStorage).some(key => localStorage.getItem(key) === unreadable), unreadable);
  expect(retained, "quarantining must preserve the original bytes").toBe(true);
  expect(await listDocuments(`users/${uid}/vehicles/v1/fillups`)).toHaveLength(2);
});

test("a delayed vehicle selection cannot close or toast into a later Account screen", async ({ page }) => {
  const { uid } = await fixture(page);
  await page.getByTestId("open-car-switch").click();
  // Hold the real selection journal, including its guarded raw intent. There
  // are no other pending settings operations after the fixture readiness gate.
  await holdJournal(page, uid, "settings.update", "before");
  try {
    await page.getByTestId("car-switch-second").click();
    await waitForJournalHold(page);
    await expect(page.getByTestId("car-switch-second")).toHaveAttribute("aria-busy", "true");
    await page.keyboard.press("Escape");
    await page.getByTestId("open-account").click();
    await expect(page.getByTestId("account-page")).toBeVisible();
  } finally {
    await releaseJournal(page);
  }
  await expect.poll(async () => (await getDocument(`users/${uid}`))?.settings).toMatchObject({ activeVehicleId: "second" });
  await expect.poll(() => outboxCount(page, uid)).toBe(0);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText("הרכב הפעיל הוחלף", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "חזרה", exact: true }).click();
  await expect(page.getByTestId("open-car-switch")).toContainText("לעבודה");
});

test("an export finishing after Account unmount cannot download from the retired screen", async ({ page }) => {
  await fixture(page);
  await page.goto("/account");
  await page.getByTestId("account-identity").click();
  await expect(page.getByRole("button", { name: "רענון הסיכום", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.getByTestId("account-export").click();
  const downloads: Download[] = [];
  page.on("download", download => downloads.push(download));
  await holdFirestoreDisk(page);
  try {
    await page.getByTestId("account-export-fillups").click();
    await expect(page.getByTestId("account-export-fillups")).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "חזרה", exact: true }).click();
    await expect(page.getByTestId("home-header")).toBeVisible();
    await page.getByTestId("open-account").click();
  } finally {
    await releaseFirestoreDisk(page);
  }
  // A fresh summary performs the same complete server reads after the old
  // request, so waiting for it proves the disk gate has actually drained.
  await page.getByTestId("account-identity").click();
  await expect(page.getByTestId("account-summary")).toContainText("80 ליטר בסך הכול");
  await expect(page.getByRole("button", { name: "רענון הסיכום", exact: true })).toBeEnabled();
  await expect(page.getByText("הקובץ הוכן להורדה", { exact: true })).toHaveCount(0);
  expect(downloads).toHaveLength(0);
});

for (const theme of ["light", "dark"] as const) for (const accent of ["plate", "mint"] as const) {
  test(`Account and shell evidence, keyboard sheets and claimed entry: ${theme}/${accent}`, async ({ page }) => {
    test.setTimeout(180_000);
    const { uid } = await fixture(page);
    await appearance(page, uid, theme, accent);
    const suffix = `${theme}-${accent}`;
    await page.goto("/");
    await page.getByTestId("open-car-switch").click();
    await expect(page.getByTestId("car-switch-archived")).toHaveCount(0);
    await capture(page, `car-switch-${suffix}`);
    await page.keyboard.press("Escape");
    await page.getByTestId("open-account").click();
    await expect(page.getByTestId("account-unsynced")).toHaveCount(0);
    await expect(page.getByTestId("account-page").locator("section > h2")).toHaveText([
      "דלק ומחיר", "תצוגה", "התראות", "השוואה לנהגים", "הנתונים שלי", "עוד",
    ]);
    await capture(page, `account-${suffix}`, true);
    for (const [name, id] of [
      ["notifications", "account-all-notifications"],
      ["data", "account-export"], ["more", "account-share"], ["actions", "account-delete"],
    ]) {
      await page.getByTestId(id).scrollIntoViewIfNeeded();
      await capture(page, `account-${name}-${suffix}`);
    }
    for (const id of ["account-identity", "account-discount", "account-fuel-price", "account-export", "account-backup", "account-import", "account-signout", "account-delete"]) {
      await targetSize(page.getByTestId(id));
    }

    async function sheet(trigger: Locator, title: string | RegExp, name: string) {
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: title, exact: typeof title === "string" });
      await expect(dialog).toBeVisible();
      await focusedInside(dialog);
      await capture(page, `${name}-${suffix}`);
      for (let index = 0; index < 6; index++) { await page.keyboard.press("Tab"); await focusedInside(dialog); }
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    await sheet(page.getByTestId("account-identity"), "פרטי החשבון", "account-identity");
    await sheet(page.getByTestId("account-fuel-price"), "מחיר בנזין 95", "account-price");
    await sheet(page.getByTestId("account-discount"), "הנחה בתדלוק", "account-discount");
    await sheet(page.getByRole("button", { name: /^מראה/ }), "מראה", "account-theme");
    await sheet(page.getByRole("button", { name: /^יחידת צריכה/ }), "יחידת צריכה", "account-unit");
    await page.getByRole("button", { name: /^צבע/ }).click();
    const colors = page.getByRole("dialog", { name: "צבע", exact: true });
    await expect(colors.getByTestId(/^accent-/)).toHaveCount(6);
    for (const swatch of await colors.getByTestId(/^accent-/).all()) await targetSize(swatch);
    await capture(page, `account-accent-${suffix}`);
    await page.keyboard.press("Escape");
    await sheet(page.getByTestId("account-notification-preferences"), "העדפות התראות", "account-notification-preferences");
    await sheet(page.getByRole("button", { name: "מה משותף בהשוואה", exact: true }), "השוואה לנהגים", "account-sharing-details");

    await page.getByTestId("account-export").click();
    const exportSheet = page.getByRole("dialog", { name: "ייצוא נתונים", exact: true });
    await capture(page, `account-export-${suffix}`);
    await page.getByTestId("account-export-scope").click();
    const scopeSheet = page.getByRole("dialog", { name: "היקף הייצוא", exact: true });
    await expect(scopeSheet.getByRole("radio", { name: "כל הרכבים, כולל הארכיון", exact: true })).toBeChecked();
    for (let index = 0; index < 6; index++) { await page.keyboard.press("Tab"); await focusedInside(scopeSheet); }
    await capture(page, `account-export-scope-${suffix}`);
    await page.keyboard.press("Escape");
    await expect(scopeSheet).toHaveCount(0);
    await expect(exportSheet).toBeVisible();
    await expect(page.getByTestId("account-export-scope")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("account-export")).toBeFocused();

    await page.getByTestId("account-backup").click();
    const backup = page.getByRole("dialog", { name: "גיבוי", exact: true });
    await expect(backup.getByTestId("backup-download")).toBeVisible();
    await capture(page, `account-backup-${suffix}`);
    const file = page.getByTestId("backup-file");
    await file.focus();
    const previewData = {
      format: "tank-maleh-account", version: 2, owner: uid, exportedAt: new Date().toISOString(),
      cloud: { confirmed: true, settings: {}, entries: [{ path: "vehicles/v1", data: await getDocument(`users/${uid}/vehicles/v1`) }] },
      local: { pendingOperations: [], drafts: [], attachmentsIncluded: false },
    };
    await file.setInputFiles({ name: "preview.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(previewData)) });
    const preview = page.getByRole("dialog", { name: "מה ישוחזר?", exact: true });
    await expect(preview).toContainText("0 רשומות חדשות");
    await focusedInside(preview);
    await capture(page, `account-backup-preview-${suffix}`);
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    // The file is disabled while it is read, so returning to the parent's
    // close control is the usable focus fallback for an async preview.
    await focusedInside(backup);
    await page.getByTestId("account-legacy-backup").click();
    const legacy = page.getByRole("dialog", { name: "גיבוי וייצוא תחזוקה", exact: true });
    await capture(page, `account-backup-legacy-${suffix}`);
    await page.keyboard.press("Escape");
    await expect(legacy).toHaveCount(0);
    await expect(backup).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("account-backup")).toBeFocused();

    // Force the existing manual-share fallback, without sharing with anyone.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    });
    await sheet(page.getByTestId("account-share"), "שיתוף האפליקציה", "account-share");
    await page.getByTestId("account-signout").click();
    const signout = page.getByRole("alertdialog", { name: "להתנתק מהחשבון?", exact: true });
    await expect(signout).toBeVisible();
    await capture(page, `account-signout-${suffix}`);
    await page.keyboard.press("Escape");
    await page.getByTestId("account-delete").click();
    const confirmation = page.getByRole("alertdialog", { name: "למחוק את החשבון?", exact: true });
    await expect(confirmation.getByRole("button", { name: "ביטול", exact: true })).toBeFocused();
    await capture(page, `account-delete-${suffix}`);
    await confirmation.getByRole("button", { name: "המשך למחיקה", exact: true }).click();
    const last = page.getByRole("alertdialog", { name: "אישור אחרון", exact: true });
    await expect(last).toBeVisible();
    await capture(page, `account-delete-final-${suffix}`);
    await page.keyboard.press("Escape");

    process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${process.env.CARE_AUTH_PORT ?? "9099"}`;
    const adminApp = initializeApp({ projectId: PROJECT_ID }, `shell-evidence-${theme}-${accent}`);
    await getAuth(adminApp).setCustomUserClaims(uid, { admin: true });
    await deleteApp(adminApp);
    await signOut(page);
    await signIn(page, ALICE);
    await page.goto("/account");
    await expect(page.getByTestId("account-admin")).toBeVisible();
    await page.getByTestId("account-admin").scrollIntoViewIfNeeded();
    await capture(page, `account-admin-${suffix}`);
    await page.getByTestId("account-admin").click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("tab-bar")).toHaveCount(0);

    for (const id of ["v1", "second"]) {
      const path = `users/${uid}/vehicles/${id}`;
      await setDocument(path, { ...await getDocument(path), archived: true });
    }
    await page.goto("/settings/import");
    await expect(page.getByRole("button", { name: "לרכב שלי", exact: true })).toBeVisible();
    await capture(page, `import-no-active-${suffix}`);
    await page.getByRole("button", { name: "לרכב שלי", exact: true }).click();
    await expect(page.getByRole("link", { name: "ניהול רכבים", exact: true })).toBeVisible();
    await capture(page, `vehicle-no-active-${suffix}`);
    await page.goto("/");
    await page.getByTestId("open-car-switch").click();
    await expect(page.getByTestId("car-switch-sheet")).toContainText("כל הרכבים נמצאים בארכיון.");
    await capture(page, `car-switch-no-active-${suffix}`);
    await page.keyboard.press("Escape");

    await signOut(page);
    await signIn(page, BOB);
    const bobUid = await uidOf(BOB);
    await expect.poll(async () => (await getDocument(`users/${bobUid}`))?.settings).toBeTruthy();
    await appearance(page, bobUid, theme, accent);
    await expect(page.getByTestId("account-identity")).toContainText(BOB.email);
    await expect(page.getByTestId("account-admin")).toHaveCount(0);
    await expect(page.getByTestId("account-discount")).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, `account-no-vehicle-${suffix}`, true);
    expect(await listDocuments(`users/${bobUid}/vehicles`)).toHaveLength(0);
  });
}
