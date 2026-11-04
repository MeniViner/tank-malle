import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { signedInWithData } from "./helpers/app";
import { getDocument, listDocuments } from "./helpers/emulator";
import { outboxCount } from "./helpers/pwa";

test.use({ viewport: { width: 390, height: 844 } });

test("Escape closes a pending offline restore preview, keeps focus in backup and preserves its queued entry", async ({ page, context }) => {
  const { uid, vehicleId } = await signedInWithData(page);
  const path = `users/${uid}/vehicles/${vehicleId}`;
  const expense = { schemaVersion: 1, version: 1, day: "2026-10-20", category: "parking", title: "חניה משוחזרת", costAgorot: 2500, notes: "נשמר גם כשהתצוגה המקדימה נסגרת" };
  const backup = {
    format: "tank-maleh-account", version: 2, owner: uid, exportedAt: new Date().toISOString(),
    cloud: { confirmed: true, settings: {}, entries: [
      { path: `vehicles/${vehicleId}`, data: await getDocument(path) },
      { path: `vehicles/${vehicleId}/vehicleExpenses/restored`, data: expense },
    ] },
    local: { pendingOperations: [], drafts: [], attachmentsIncluded: false },
  };
  await page.goto("/account");
  await page.getByTestId("account-backup").click();
  const outer = page.getByRole("dialog", { name: "גיבוי", exact: true });
  const file = page.getByTestId("backup-file");
  await file.focus();
  await file.setInputFiles({ name: "restore.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  const preview = page.getByRole("dialog", { name: "מה ישוחזר?", exact: true });
  await expect(preview).toContainText("1 רשומות חדשות");
  await context.setOffline(true);
  try {
    await preview.getByRole("button", { name: "הוספת הנתונים שנבחרו", exact: true }).click();
    await expect(preview.getByRole("button", { name: "משחזרים…", exact: true })).toBeDisabled();
    await expect.poll(() => outboxCount(page, uid)).toBe(1);
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect(outer).toBeVisible();
    await expect(outer.getByRole("status")).toHaveText("השחזור נמשך. ממתינים לאישור השרת.");
    await expect(file).toBeDisabled();
    await expect.poll(() => outer.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Tab");
    await expect.poll(() => outer.evaluate(element => element.contains(document.activeElement))).toBe(true);
    const stage = process.env.DESIGN_V2_STAGE;
    const evidence = resolve(stage ? `design/v2/evidence/stage-${stage}` : "test-results/design-v2");
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, "account-backup-restoring-light-plate.png"), animations: "disabled" });
    expect(await listDocuments(`${path}/vehicleExpenses`)).toHaveLength(0);
  } finally {
    await context.setOffline(false);
  }
  await expect.poll(async () => getDocument(`${path}/vehicleExpenses/restored`), { timeout: 30_000 }).toMatchObject(expense);
  await expect.poll(() => outboxCount(page, uid), { timeout: 20_000 }).toBe(0);
  await expect(outer.getByRole("status")).toContainText("נוספו 1 רשומות באישור השרת.");
  expect(await listDocuments(`${path}/vehicleExpenses`)).toHaveLength(1);
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByTestId("account-identity").click();
  await expect(page.getByTestId("account-summary")).toContainText("₪25");
});
