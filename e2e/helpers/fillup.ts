import { expect, type Page } from "@playwright/test";

/** Open the optional controls without changing any tank evidence. */
export async function openFillupMore(page: Page): Promise<void> {
  const trigger = page.getByTestId("fillup-more-toggle");
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await expect(page.locator("#fillup-more-content")).toBeVisible();
}

export async function setFillupEndState(page: Page, state: "full" | "partial" | "unknown"): Promise<void> {
  if (state === "unknown") {
    // Unknown is simply unanswered: tap a chosen answer again to clear it.
    for (const name of ["מילאתי עד הסוף", "תדלוק חלקי"]) {
      const choice = page.getByRole("radio", { name, exact: true });
      if (await choice.getAttribute("aria-checked") === "true") await choice.click();
    }
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
