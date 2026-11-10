import { expect, test, type Page } from "@playwright/test";
import { signedInWithData } from "./helpers/app";
import { getDocument, listDocuments, setDocument } from "./helpers/emulator";
import { journalAdd } from "./helpers/design-v2-journal";
import { addCivilDays } from "../src/lib/vehicle/snooze";
import { addMonths } from "../src/lib/maintenance/model";

/* Design v3 Stage 4: the "לכלול בעלות הרכב" toggle (§7.1), snooze presets and the journal summary. */

const zoneDay = (at = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(at);

async function seed(page: Page) {
  const scope = await signedInWithData(page, { fillups: [] });
  return { ...scope, base: `users/${scope.uid}/vehicles/${scope.vehicleId}` };
}

test("an expense can be left out of ownership: default on, explainer, excluded:true, journal tag, and back", async ({ page }) => {
  const { base } = await seed(page);
  await page.goto("/history");
  await journalAdd(page, "expense");
  await page.getByTestId("care-category-parking").click();
  await page.getByTestId("care-cost").fill("45.5");

  const toggle = page.getByRole("switch", { name: "לכלול בעלות הרכב", exact: true });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  const box = await toggle.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(30);
  const info = page.getByRole("button", { name: "מה זה לכלול בעלות הרכב?", exact: true });
  const infoBox = await info.boundingBox();
  expect(Math.min(infoBox!.width, infoBox!.height)).toBeGreaterThanOrEqual(44);
  await info.click();
  const sheet = page.getByRole("dialog", { name: "לכלול בעלות הרכב?", exact: true });
  await expect(sheet).toContainText("ההוצאה תישאר ביומן ובסכום של היומן");
  await sheet.getByRole("button", { name: "הבנתי", exact: true }).click();
  await expect(sheet).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("care-save").click();
  await expect(page.getByTestId("care-entry")).toHaveCount(0);

  await expect.poll(async () => (await listDocuments(`${base}/vehicleExpenses`)).length).toBe(1);
  const [stored] = await listDocuments(`${base}/vehicleExpenses`);
  expect(stored.data).toMatchObject({ category: "parking", costAgorot: 4550, excluded: true });

  const row = page.getByTestId(`journal-entry-vehicleExpenses/${stored.id}`);
  await expect(row.getByTestId("journal-excluded-tag")).toHaveText("לא בעלות הרכב");
  // The journal keeps it in its own totals and says how much of that is outside ownership.
  await expect(page.getByTestId("ledger-total")).toContainText("46");
  await expect(page.getByTestId("ledger-excluded")).toContainText("46");

  await row.click();
  const entry = page.getByTestId("journal-entry-sheet");
  await expect(entry.getByTestId("journal-entry-excluded")).toHaveText("לא בעלות הרכב");
  await entry.getByTestId("journal-entry-edit").click();
  const editToggle = page.getByRole("switch", { name: "לכלול בעלות הרכב", exact: true });
  await expect(editToggle).toHaveAttribute("aria-checked", "false");
  await editToggle.click();
  await page.getByTestId("care-save").click();
  await expect(page.getByTestId("care-entry")).toHaveCount(0);
  await expect.poll(async () => (await getDocument(`${base}/vehicleExpenses/${stored.id}`))?.excluded).toBeUndefined();
  await expect(page.getByTestId(`journal-entry-vehicleExpenses/${stored.id}`).getByTestId("journal-excluded-tag")).toHaveCount(0);
});

test("snooze presets write the existing snooze day without touching the reminder", async ({ page }) => {
  const { base } = await seed(page);
  const plan = { schemaVersion: 1, version: 1, title: "טיפול שמן הבא", job: "oil", dueDay: addMonths(zoneDay(), -1), dueOdometer: null,
    intervalMonths: null, intervalKm: null, basis: "manual", source: "owner", notes: "", active: true };
  await setDocument(`${base}/maintenancePlans/p`, plan);
  await page.goto("/notifications");
  await page.getByRole("button", { name: "דחיית הופעה", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "מתי להציג שוב?", exact: true });
  const presets = sheet.getByRole("group", { name: "דחייה מהירה", exact: true });
  await expect(presets.getByRole("button")).toHaveText([/מחר/, /בעוד שבוע/, /בעוד חודש/]);
  for (const button of await presets.getByRole("button").all()) {
    const b = await button.boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(44);
  }
  // The free date picker is still there for any other day.
  await expect(sheet.getByLabel("יום הופעה מחדש", { exact: true })).toBeVisible();
  await presets.getByTestId("snooze-week").click();
  const expected = addCivilDays(zoneDay(), 7);
  await expect(async () => expect((await listDocuments(`${base}/notificationStates`))[0]?.data.snoozeUntilDay).toBe(expected)).toPass();
  expect((await getDocument(`${base}/maintenancePlans/p`))?.dueDay).toBe(plan.dueDay);
});

test("journal: period chip first in the filter row, always-available summary info, fade mask", async ({ page }) => {
  const { base } = await seed(page);
  await setDocument(`${base}/vehicleExpenses/e1`, { schemaVersion: 1, version: 1, day: zoneDay(), category: "wash", title: "שטיפה", costAgorot: 4000, notes: "" });
  await setDocument(`${base}/vehicleExpenses/e2`, { schemaVersion: 1, version: 1, day: zoneDay(), category: "other", title: "בלי סכום", costAgorot: null, notes: "" });
  await page.goto("/history");
  const filters = page.getByLabel("סוג רשומה", { exact: true });
  const period = page.getByRole("button", { name: "תקופת היומן", exact: true });
  await expect(filters.locator("button").first()).toHaveAttribute("aria-label", "תקופת היומן");
  await expect(period).toContainText("כל התקופה");
  expect(await filters.evaluate(element => getComputedStyle(element).maskImage || getComputedStyle(element).webkitMaskImage)).toContain("linear-gradient");
  const summary = page.getByRole("region", { name: "סיכום היומן המסונן", exact: true });
  await expect(summary.getByTestId("ledger-total")).toContainText("40");
  await summary.getByTestId("journal-summary-info").click();
  const info = page.getByRole("dialog", { name: "על אילו נתונים הסיכום מבוסס?", exact: true });
  await expect(info).toContainText("רשומה אחת בלי סכום");
  await expect(info).toContainText("לא בעלות הרכב");
  await page.keyboard.press("Escape");
  await expect(summary.getByTestId("journal-summary-info")).toBeFocused();
  await period.click();
  await page.getByRole("dialog", { name: "תקופת היומן", exact: true }).getByRole("button", { name: "החודש", exact: true }).click();
  await expect(page).toHaveURL(/period=month/);
  await expect(period).toContainText("החודש");
});
