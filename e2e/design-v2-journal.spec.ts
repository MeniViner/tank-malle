import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { captureJournal, journalAdd, journalEvidence, journalFixture, openJournalEntry } from "./helpers/design-v2-journal";
import { homeAppearance } from "./helpers/design-v2-home";
import { getDocument, listDocuments } from "./helpers/emulator";
import { setCareTitle } from "./helpers/care";
import { outboxCount } from "./helpers/pwa";
import { formatCivilDay } from "../src/lib/civilDate";

test.use({ viewport: { width: 390, height: 844 } });

async function target44(target: Locator) {
  // Measure the settled target without scrolling or changing the focus setup.
  await target.evaluate(async element => {
    const animations = new Set<Animation>();
    for (let node: Element | null = element; node; node = node.parentElement) {
      for (const animation of node.getAnimations()) {
        const endTime = animation.effect?.getComputedTiming().endTime;
        if (animation.playState === "running" && typeof endTime === "number" && Number.isFinite(endTime)) animations.add(animation);
      }
    }
    await Promise.all([...animations].map(animation => animation.finished.catch(() => undefined)));
  });
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  return box!;
}

async function atmosphere(page: Page, variant: string, insideCare = false) {
  const layer = page.getByTestId("app-atmosphere");
  await expect(layer).toHaveCount(1);
  await expect(layer).toHaveAttribute("data-variant", variant);
  await expect(layer.locator("svg line")).toHaveCount(72);
  await expect(layer.locator("svg circle")).toHaveCount(3);
  expect(await layer.evaluate(element => !!element.closest(".care-entry-sheet"))).toBe(insideCare);
}

async function discardCare(page: Page) {
  await page.getByTestId("care-entry").getByRole("button", { name: "מחיקת הטיוטה", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "יציאה ללא שמירה", exact: true }).click();
  await expect(page.getByTestId("care-entry")).toHaveCount(0);
}

test("Journal filters and search share exact totals with their month groups, including zero, unknown and refund", async ({ page }) => {
  const scope = await journalFixture(page);
  const summary = page.getByRole("region", { name: "סיכום היומן המסונן", exact: true });
  await expect(page.locator(".ledger-row")).toHaveCount(13);
  await expect(page.getByTestId("ledger-total")).toHaveText("1,567\u202F₪");
  await expect(summary).toContainText("1 עלות חסרה");
  await expect(page.getByTestId(`journal-month-${scope.firstMonth}`).locator("header")).toContainText("751\u202F₪");
  await expect(page.getByTestId(`journal-month-${scope.lastMonth}`).locator("header")).toContainText("816\u202F₪");

  for (const [kind, rows, total] of [["fuel", 6, "1,436\u202F₪"], ["service", 3, "123\u202F₪"], ["expense", 2, "8\u202F₪"], ["odometer", 2, "—"]] as const) {
    await page.getByTestId(`journal-filter-${kind}`).click();
    await expect(page.locator(".ledger-row")).toHaveCount(rows);
    await expect(page.getByTestId("ledger-total")).toHaveText(total);
    if (kind === "odometer") for (const row of await page.locator(".ledger-row").all()) {
      await expect(row).not.toContainText("₪");
      await expect(row).toHaveClass(/tm-journal-quiet/);
    }
  }
  await page.getByTestId("journal-filter-service").click();
  await expect(page.getByTestId("journal-entry-serviceEvents/journal-unknown")).toContainText("כדאי לבדוק");
  await expect(page.getByTestId("journal-entry-serviceEvents/journal-unknown")).toContainText("—");
  await expect(page.getByTestId("journal-entry-serviceEvents/journal-zero")).toContainText("0\u202F₪");
  await page.getByTestId("journal-search").fill("שמן ובלמים");
  await expect(page.locator(".ledger-row")).toHaveCount(1);
  await expect(page.getByTestId("ledger-total")).toHaveText("123\u202F₪");
  await expect(page.getByTestId(`journal-month-${scope.lastMonth}`)).toHaveCount(0);
  await page.getByTestId("journal-search").fill("לא קיים 784");
  await expect(page.getByRole("heading", { name: "לא נמצאו רשומות", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ניקוי סינון", exact: true }).click();
  await expect(page.locator(".ledger-row")).toHaveCount(13);
  expect((await getDocument(`${scope.base}/serviceEvents/journal-service`))?.costAgorot).toBe(12345);
  expect((await getDocument(`${scope.base}/serviceEvents/journal-unknown`))?.costAgorot).toBeNull();
  expect((await getDocument(`${scope.base}/serviceEvents/journal-zero`))?.costAgorot).toBe(0);
  expect((await getDocument(`${scope.base}/vehicleExpenses/journal-refund`))?.costAgorot).toBe(1050);
});

test("a Home fuel row opens its scoped Journal receipt before editing; direct editor links remain direct", async ({ page }) => {
  const scope = await journalFixture(page, false);
  const original = await getDocument(`${scope.base}/fillups/journal-last`);
  await page.goto("/");
  await page.getByTestId("recent-fillups-timeline").getByTestId("journal-entry-fillups/journal-last").click();
  const url = new URL(page.url());
  expect(url.pathname).toBe("/history");
  expect(url.searchParams.get("owner")).toBe(scope.uid);
  expect(url.searchParams.get("vehicle")).toBe(scope.vehicleId);
  expect(url.searchParams.get("entry")).toBe("fillups/journal-last");
  await expect(page.getByTestId("journal-entry-sheet")).toHaveAttribute("data-entry-key", "fillups/journal-last");
  await expect(page.getByTestId("journal-entry-price")).toContainText("7.00\u202F₪");
  await expect(page.getByTestId("entry-odometer")).toContainText("101,840");
  await page.getByTestId("journal-entry-edit").click();
  await expect(page).toHaveURL(/\/fillup\/journal-last$/);
  await expect(page.getByTestId("fillup-total")).toHaveValue("280");
  await page.goto("/fillup/journal-partial");
  await expect(page.getByTestId("fillup-odometer")).toHaveValue("100300");
  await expect(page.getByTestId("journal-entry-sheet")).toHaveCount(0);
  expect(await getDocument(`${scope.base}/fillups/journal-last`)).toEqual(original);
});

test("Journal Add records one multi-job invoice, keeps its draft across steps and reload, and adds a real odometer row", async ({ page }) => {
  const scope = await journalFixture(page, false);
  await journalAdd(page, "service");
  await expect(page.getByTestId("care-step")).toHaveAttribute("data-step", "1");
  await expect(page.getByTestId("care-next")).toBeDisabled();
  await page.getByTestId("care-job-tires").click();
  await page.getByTestId("care-job-brakes").click();
  await page.getByTestId("care-next").click();
  await page.getByTestId("care-cost").fill("850.25");
  await page.getByTestId("care-day").fill(formatCivilDay(scope.day(-1, 26)));
  await page.getByTestId("care-odo").fill("101900");
  await page.getByTestId("care-notes").fill("חשבונית 88: צמיגים ובלמים");
  await page.getByTestId("care-back").click();
  await expect(page.getByTestId("care-job-tires")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("care-job-brakes")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("care-next").click();
  await expect(page.getByTestId("care-cost")).toHaveValue("850.25");
  await page.getByTestId("care-day").fill("31/02/2026");
  await expect(page.getByTestId("care-draft")).toHaveAttribute("data-draft-state", "saved");
  await page.reload();
  await journalAdd(page, "service");
  await expect(page.getByTestId("care-draft-restored")).toBeVisible();
  await expect(page.getByTestId("care-entry").getByRole("heading")).toContainText("צמיגים · בלמים");
  await expect(page.getByTestId("care-cost")).toHaveValue("850.25");
  await expect(page.getByTestId("care-notes")).toHaveValue("חשבונית 88: צמיגים ובלמים");
  await expect(page.getByTestId("care-day")).toHaveValue("31/02/2026");
  await page.getByTestId("care-save").click();
  await expect(page.getByTestId("care-entry")).toBeVisible();
  await expect(page.getByTestId("care-day")).toHaveValue("31/02/2026");
  expect(await listDocuments(`${scope.base}/serviceEvents`)).toHaveLength(0);
  await page.getByTestId("care-day").fill(formatCivilDay(scope.day(-1, 26)));
  await page.getByTestId("care-save").click();
  await expect(page.getByTestId("care-entry")).toHaveCount(0);
  await expect.poll(() => listDocuments(`${scope.base}/serviceEvents`)).toHaveLength(1);
  const [service] = await listDocuments(`${scope.base}/serviceEvents`);
  expect(service.data).toMatchObject({ jobs: ["tires", "brakes"], day: scope.day(-1, 26), costAgorot: 85025, odometer: 101900, notes: "חשבונית 88: צמיגים ובלמים", version: 1 });
  expect(await listDocuments(`${scope.base}/vehicleExpenses`)).toHaveLength(0);
  expect(await listDocuments(`${scope.base}/fillups`)).toHaveLength(6);
  await journalAdd(page, "odometer");
  await page.getByTestId("care-odo").fill("102100");
  await page.getByTestId("care-notes").fill("עדכון ללא תדלוק");
  await page.getByTestId("care-save").click();
  await expect(page.getByTestId("care-entry")).toHaveCount(0);
  await expect.poll(() => listDocuments(`${scope.base}/odometerReadings`)).toHaveLength(1);
  expect((await listDocuments(`${scope.base}/odometerReadings`))[0].data).toMatchObject({ odometer: 102100, notes: "עדכון ללא תדלוק" });
  expect(await listDocuments(`${scope.base}/fillups`)).toHaveLength(6);
  await expect.poll(() => outboxCount(page, scope.uid)).toBe(0);
  await expect(page.getByTestId("ledger-total")).toHaveText("2,286\u202F₪");
});

for (const theme of ["light", "dark"] as const) for (const accent of ["plate", "mint"] as const) {
  test(`Journal and two-step care evidence: ${theme}/${accent}`, async ({ page }) => {
    test.setTimeout(180_000);
    const scope = await journalFixture(page);
    await homeAppearance(page, scope.uid, theme, accent);
    await page.goto("/history");
    await expect(page.getByTestId("ledger-total")).toHaveText("1,567\u202F₪");
    await expect(page.getByTestId("journal-coverage")).toHaveCount(0);
    await atmosphere(page, "journal");
    const capture = (name: string, full = false) => captureJournal(page, `${name}-${theme}-${accent}`, full);
    const measurements: Record<string, unknown>[] = [];
    for (const key of ["observations/journal-gauge", "odometerReadings/journal-odometer"]) {
      const row = page.getByTestId(`journal-entry-${key}`);
      const box = await target44(row);
      measurements.push({ id: `journal-entry-${key}`, width: box.width, height: box.height, kind: "quiet" });
    }
    await capture("journal-all", true);
    for (const kind of ["fuel", "service", "expense", "odometer"] as const) {
      await target44(page.getByTestId(`journal-filter-${kind}`));
      await page.getByTestId(`journal-filter-${kind}`).click();
      await capture(`journal-${kind}`);
    }
    await page.getByTestId("journal-filter-all").click();
    await page.getByTestId("journal-search").fill("שמן");
    await expect(page.locator(".ledger-row")).toHaveCount(1);
    await expect(page.getByTestId("ledger-range")).toContainText("1 רשומה · 0 תדלוקים");
    await capture("journal-search");
    await page.getByTestId("journal-search").fill("אין תוצאה כזו");
    await capture("journal-empty");
    await page.getByRole("button", { name: "ניקוי סינון", exact: true }).click();
    await page.getByRole("button", { name: "תקופת היומן", exact: true }).click();
    await capture("journal-period");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "תקופת היומן", exact: true })).toBeFocused();
    for (const [key, name] of [
      ["fillups/journal-last", "journal-fuel-entry"], ["serviceEvents/journal-service", "journal-service-entry"],
      ["serviceEvents/journal-unknown", "journal-warning-entry"], ["vehicleExpenses/journal-parking", "journal-expense-entry"],
      ["vehicleExpenses/journal-refund", "journal-refund-entry"], ["odometerReadings/journal-odometer", "journal-odometer-entry"],
      ["observations/journal-gauge", "journal-gauge-entry"],
    ]) {
      await openJournalEntry(page, key);
      await target44(page.getByTestId("journal-entry-delete"));
      await capture(name);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId(`journal-entry-${key}`)).toBeFocused();
    }
    await openJournalEntry(page, "vehicleExpenses/journal-refund");
    await page.getByTestId("journal-entry-delete").click();
    await capture("journal-delete-confirm");
    await page.keyboard.press("Escape");
    await page.getByTestId("journal-add").click();
    await capture("journal-add");
    for (const action of await page.getByTestId("journal-add-menu").getByRole("button").all()) await target44(action);
    await page.getByTestId("journal-add-service").click();
    await atmosphere(page, "entry", true);
    const heading = page.getByTestId("care-entry").getByRole("heading", { name: "מה עשו ברכב?", exact: true });
    await expect(heading).toBeFocused();
    await expect.poll(() => page.locator(".care-entry-sheet").boundingBox()).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
    const panel = await page.locator(".care-entry-sheet").evaluate(element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { x: box.x, y: box.y, width: box.width, height: box.height, radius: style.borderRadius };
    });
    expect(panel).toMatchObject({ x: 0, y: 0, width: 390, height: 844, radius: "0px" });
    const headingStyle = await heading.evaluate(element => {
      const style = getComputedStyle(element);
      return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight };
    });
    expect(headingStyle.family).toContain("Karantina");
    expect(parseFloat(headingStyle.size)).toBeGreaterThanOrEqual(48);
    expect(headingStyle.weight).toBe("400"); // v3 §1: Karantina 400
    measurements.push({ id: "care-entry-panel", ...panel }, { id: "care-entry-heading", ...headingStyle });
    await capture("care-service-choose");
    for (const choice of await page.getByTestId("care-entry").locator(".care-choice").all()) await target44(choice);
    await page.getByTestId("care-job-tires").click();
    await page.getByTestId("care-job-brakes").click();
    await page.getByTestId("care-next").click();
    await page.getByTestId("care-cost").fill("850.25");
    await page.getByTestId("care-odo").fill("102100");
    await page.getByTestId("care-notes").fill("לבדוק לחץ אוויר אחרי 50 ק״מ");
    await page.getByTestId("care-scroll").evaluate(element => { element.scrollTop = 0; });
    await capture("care-service-details");
    for (const id of ["care-cost", "care-day", "care-odo", "care-notes", "care-save"]) {
      const input = page.getByTestId(id);
      const box = await target44(input);
      await input.focus();
      const focus = await input.evaluate(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { direction: style.direction, outline: style.outlineStyle, shadow: style.boxShadow,
          unobscured: hit === element || !!hit && element.contains(hit),
          insideCare: !!element.closest(".care-entry-sheet") };
      });
      expect(focus.unobscured, id).toBe(true);
      measurements.push({ id, width: box.width, height: box.height, ...focus });
    }
    await setCareTitle(page, "טיפול שנתי 88");
    await page.getByTestId("care-garage").fill("מוסך מרכז 12");
    await capture("care-service-more");
    await page.getByTestId("care-entry").getByRole("button", { name: "מחיקת הטיוטה", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await atmosphere(page, "entry", true);
    await capture("care-service-discard");
    const confirmation = page.getByRole("alertdialog");
    for (let index = 0; index < 4; index++) {
      await page.keyboard.press("Tab");
      expect(await confirmation.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("care-entry").getByRole("button", { name: "מחיקת הטיוטה", exact: true })).toBeFocused();
    await atmosphere(page, "entry", true);
    await page.getByTestId("care-cost").fill("-1");
    await page.getByTestId("care-save").click();
    await expect(page.getByTestId("care-error")).toBeVisible();
    await expect(page.getByTestId("care-error")).toBeFocused();
    await capture("care-service-error");
    await discardCare(page);
    await atmosphere(page, "journal");
    await openJournalEntry(page, "serviceEvents/journal-service");
    await page.getByTestId("journal-entry-edit").click();
    await expect(page.getByTestId("care-cost")).toHaveValue("123.45");
    await capture("care-service-edit");
    await page.getByTestId("care-close").click();
    await atmosphere(page, "journal");
    await journalAdd(page, "expense");
    await atmosphere(page, "entry", true);
    await capture("care-expense-choose");
    await page.getByTestId("care-category-parking").click();
    await expect(page.getByTestId("care-step")).toHaveAttribute("data-step", "2");
    await page.getByTestId("care-cost").fill("18.50");
    await page.getByTestId("care-notes").fill("חניון מרכז 8");
    await capture("care-expense-details");
    await page.getByTestId("care-back").click();
    await page.getByTestId("care-category-refund").click();
    await expect(page.getByTestId("care-cost")).toHaveValue("18.50");
    await expect(page.getByTestId("care-cost")).toHaveAccessibleName("סכום שהוחזר");
    await capture("care-refund-details");
    await discardCare(page);
    await atmosphere(page, "journal");
    await journalAdd(page, "odometer");
    await expect(page.getByRole("dialog").getByRole("heading", { name: "עדכון קילומטראז׳", exact: true })).toHaveCount(1);
    await page.getByTestId("care-odo").fill("102100");
    await capture("care-odometer");
    await discardCare(page);
    await atmosphere(page, "journal");
    expect(await listDocuments(`${scope.base}/serviceEvents`)).toHaveLength(3);
    expect(await listDocuments(`${scope.base}/vehicleExpenses`)).toHaveLength(2);
    await writeFile(resolve(journalEvidence, `care-input-accessibility-${theme}-${accent}.json`), JSON.stringify(measurements, null, 2));
  });
}
