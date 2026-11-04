import { expect, type Page } from "@playwright/test";

/** Open the optional controls without changing any tank evidence. */
export async function openFillupMore(page: Page): Promise<void> {
  const trigger = page.getByTestId("fillup-more-toggle");
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await expect(page.locator("#fillup-more-content")).toBeVisible();
}

/** The correction/unknown controls are deliberately separate from the primary choices. */
export async function openFillupTankAdvanced(page: Page): Promise<void> {
  await openFillupMore(page);
  const details = page.getByTestId("fillup-tank-advanced");
  if (await details.getAttribute("open") === null) await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
}

export async function setFillupEndState(page: Page, state: "full" | "partial" | "unknown"): Promise<void> {
  if (state === "unknown") {
    await openFillupTankAdvanced(page);
    await page.getByTestId("fillup-end-unknown").click();
    return;
  }
  const choice = page.getByRole("radio", { name: state === "full" ? "מילאתי עד הסוף" : "תדלוק חלקי", exact: true });
  if (await choice.getAttribute("aria-checked") !== "true") await choice.click();
  await expect(choice).toHaveAttribute("aria-checked", "true");
}

/**
 * A new creation first reaches its durable local Saved state. Done is a real
 * UI action and does not wait for server ACK; preservation tests intentionally
 * use it while offline or rejected. Online helpers separately verify the
 * exact new document through the emulator's server REST API.
 */
export async function finishFillupSave(page: Page): Promise<string> {
  const saved = page.getByTestId("fillup-saved");
  await expect(saved).toBeVisible({ timeout: 20_000 });
  const summary = (await saved.innerText()).trim();
  await page.getByTestId("fillup-saved-done").click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/(\?.*)?$/, { timeout: 20_000 });
  return summary;
}
