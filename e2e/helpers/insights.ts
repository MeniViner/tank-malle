import { expect, type Page } from "@playwright/test";

export type InsightSection = "cons" | "price" | "spend" | "community";

export async function selectInsight(page: Page, section: InsightSection) {
  const tab = page.getByTestId(`insights-tab-${section}`);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId(`insights-panel-${section}`)).toBeVisible();
}

export async function selectInsightRange(page: Page, label: string) {
  await page.getByTestId("insights-page").locator(".period-trigger").click();
  const sheet = page.getByRole("dialog", { name: "תקופת התובנות", exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: label, exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

/** Detailed fuel purchase grouping remains separate from the selected range. */
export async function openInsightFuelDetail(page: Page) {
  const detail = page.getByTestId("insights-fuel-detail");
  await expect(detail).toBeVisible();
  if (!await detail.evaluate(element => (element as HTMLDetailsElement).open)) {
    await detail.locator("summary").first().click();
  }
  await expect(detail.getByRole("radiogroup", { name: "קיבוץ", exact: true })).toBeVisible();
  return detail;
}
