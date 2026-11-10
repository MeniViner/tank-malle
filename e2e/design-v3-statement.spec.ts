import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { signedInWithData } from "./helpers/app";
import { getDocument, setDocument } from "./helpers/emulator";

/**
 * Design v3 §7.2 — business monthly statement ("דוח חודשי לעסק").
 * Entry points: Vehicle and Account → הנתונים שלי. Exports: print-ready HTML in
 * a new window and a CSV download (UTF-8 BOM) with the excluded group outside
 * the total. Grouping and totals are unit-tested in src/lib/business.
 */

test.use({ viewport: { width: 390, height: 844 } });

const at = (day: string) => new Date(`${day}T10:00:00+03:00`);
const care = { schemaVersion: 1, version: 1, notes: "" };

async function seed(page: Page) {
  const scope = await signedInWithData(page, {
    vehicle: { make: "סקודה", model: "אוקטביה", year: 2022 },
    fillups: [
      { id: "f1", date: at("2026-10-03"), odometer: 10_000, liters: 40, pricePerLiter: 7.2, totalCost: 288, stationName: "פז הרצליה" },
      { id: "f2", date: at("2026-10-20"), odometer: 10_600, liters: 30, pricePerLiter: 7.3, totalCost: 219, stationName: "דלק רעננה" },
    ],
  });
  const base = `users/${scope.uid}/vehicles/${scope.vehicleId}`;
  await setDocument(`${base}/serviceEvents/s1`, { ...care, day: "2026-10-10", title: "טיפול 10,000", jobs: ["oil"], odometer: 10_300, costAgorot: 50_000, garage: "מוסך הדר", completedPlanIds: [] });
  await setDocument(`${base}/vehicleExpenses/park`, { ...care, day: "2026-10-12", title: "חניה", category: "parking", costAgorot: 2_340 });
  await setDocument(`${base}/vehicleExpenses/refund`, { ...care, day: "2026-10-15", title: "החזר חניה", category: "refund", costAgorot: 1_000 });
  await setDocument(`${base}/vehicleExpenses/gift`, { ...care, day: "2026-10-18", title: "שטיחונים לבית", category: "other", costAgorot: 12_345, excluded: true });
  await setDocument(`${base}/vehicleExpenses/unknown`, { ...care, day: "2026-10-19", title: "שטיפה", category: "other", costAgorot: null });
  return { ...scope, base };
}

test("the vehicle statement groups the month, keeps excluded expenses outside the total and exports CSV (BOM) and print HTML", async ({ page }) => {
  const { base } = await seed(page);
  await page.goto("/vehicle");
  const entry = page.getByTestId("vehicle-business-statement");
  await expect(entry).toBeVisible();
  const box = await entry.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await entry.click();
  const sheet = page.getByRole("dialog");
  const statement = sheet.getByTestId("business-statement");
  await expect(statement).toBeVisible();
  await expect(sheet.getByTestId("business-statement-months").getByRole("button", { name: "אוקטובר 2026" })).toHaveAttribute("aria-pressed", "true");

  // 288 + 219 fuel, 500 service, 23.40 parking, −10 refund = 1,020.40 → whole shekels.
  await expect(statement.getByTestId("business-statement-total")).toHaveText("1,020 ₪");
  await expect(statement.getByTestId("business-statement-km")).toContainText("600");
  await expect(statement.getByTestId("business-group-fuel")).toContainText("507 ₪");
  await expect(statement.getByTestId("business-group-service")).toContainText("500 ₪");
  await expect(statement.getByTestId("business-group-excluded")).toContainText("123 ₪");
  await expect(statement.getByTestId("business-group-excluded")).toContainText("מחוץ לסה״כ");
  await expect(statement.getByTestId("business-statement-facts")).toContainText("1 ללא סכום, לא בסה״כ");

  // Business details: editable, shown in the preview at once, saved on the vehicle.
  await statement.getByText("פרטי העסק בדוח (רשות)").click();
  await statement.getByLabel("שם העסק").fill("וינר הובלות בע״מ");
  await statement.getByLabel("נהג").fill("מני");
  await statement.getByLabel("שימוש עסקי").fill("50");
  await expect(statement.getByTestId("business-statement-share")).toHaveText("510 ₪");
  await statement.getByRole("button", { name: "שמירת פרטי העסק לרכב" }).click();
  await expect.poll(async () => (await getDocument(base))?.biz).toEqual({ company: "וינר הובלות בע״מ", driver: "מני", usagePct: 50 });

  // CSV: BOM, Hebrew headers, exact values, excluded row marked and its group outside the total.
  const [download] = await Promise.all([page.waitForEvent("download"), statement.getByRole("button", { name: /CSV/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^tank-maleh-statement-v1-2026-10-\d{4}-\d{2}-\d{2}_.*\.csv$/);
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const lines = csv.slice(1).split("\r\n");
  expect(lines[0]).toBe('"תאריך","קטגוריה","פירוט","ספק / תחנה","כמות","יחידה","מחיר ליחידה (₪)","קילומטראז׳","סכום (₪)","נכלל בעלות הרכב","הערות"');
  expect(lines.find(line => line.includes("שטיחונים לבית"))).toMatch(/"לא בעלות הרכב".*"123\.45","לא"/);
  expect(lines.find(line => line.includes("פז הרצליה"))).toContain('"288","כן"');
  expect(lines.find(line => line.startsWith('"סה״כ לחודש"'))).toContain('"1020.4"');
  expect(lines.find(line => line.startsWith('"לא בעלות הרכב","מחוץ לסה״כ"'))).toContain('"123.45"');
  expect(lines.find(line => line.startsWith('"ק״מ שתועדו בחודש"'))).toContain('"600"');
  expect(lines.find(line => line.startsWith('"חלק עסקי (50%)"'))).toContain('"510.2"');

  // Print-ready HTML opens in a new window: title, meta, tables, signature lines.
  const [popup] = await Promise.all([page.waitForEvent("popup"), statement.getByRole("button", { name: "PDF להדפסה" }).click()]);
  await popup.waitForLoadState();
  await expect(popup).toHaveTitle("דוח הוצאות רכב · אוקטובר 2026");
  await expect(popup.locator("h1")).toHaveText("דוח הוצאות רכב · אוקטובר 2026");
  await expect(popup.locator("h2")).toContainText("וינר הובלות בע״מ");
  await expect(popup.locator("h2")).toContainText("נהג: מני");
  expect(await popup.locator("table").count()).toBeGreaterThanOrEqual(5);
  await expect(popup.locator(".sig")).toContainText("חתימת הנהג");
  await expect(popup.locator(".sig")).toContainText("אישור הנהלת חשבונות");
  await expect(popup.locator("section.outside h3")).toContainText("מחוץ לסה״כ");
  await expect(popup.locator(".total")).toContainText("1,020 ₪");
  await popup.close();
});

test("Account → הנתונים שלי opens the same statement for the active vehicle", async ({ page }) => {
  await seed(page);
  await page.goto("/account");
  const row = page.getByTestId("account-business-statement");
  await expect(row).toBeVisible();
  await row.click();
  const statement = page.getByRole("dialog").getByTestId("business-statement");
  await expect(statement.getByTestId("business-statement-total")).toHaveText("1,020 ₪");
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
});
