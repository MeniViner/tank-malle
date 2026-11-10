import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  GALLERY_OUT, collectConsole, galleryAccount, writeConsole, type GalleryScope, type Theme,
} from "./helpers/design-v3-gallery";

/**
 * Design v3 screenshot gallery (Stage 0 "before", reused for later stages).
 *
 * Opt-in only: skipped unless V3_GALLERY=1, so it never runs in the normal suite.
 *
 *   E2E_ISOLATED=1 V3_GALLERY=1 PATH="/opt/homebrew/opt/openjdk/bin:$PATH" \
 *     npx playwright test e2e/design-v3-gallery.spec.ts --project=chromium
 *
 * V3_GALLERY_OUT=<dir> picks the output folder (default design/v3/evidence/stage-0/before).
 * Optional filters: V3_GALLERY_WIDTHS=390,430  V3_GALLERY_THEMES=dark
 * Files: <screen>-<width>-<theme>.png, plus console.json (errors and React key
 * warnings per route) and console-<width>-<theme>.json per run.
 *
 * A screen that cannot be reached is recorded as a capture failure in
 * console.json rather than aborting the remaining screens.
 */

test.skip(process.env.V3_GALLERY !== "1", "screenshot gallery: set V3_GALLERY=1");

const VIEWPORTS = [
  { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 768, height: 1024 },
].filter(v => !process.env.V3_GALLERY_WIDTHS || process.env.V3_GALLERY_WIDTHS.split(",").includes(String(v.width)));
const THEMES = (["light", "dark"] as Theme[])
  .filter(t => !process.env.V3_GALLERY_THEMES || process.env.V3_GALLERY_THEMES.split(",").includes(t));

test.use({
  locale: "he-IL", timezoneId: "Asia/Jerusalem", reducedMotion: "reduce",
  geolocation: { latitude: 31.6688, longitude: 34.5743 }, permissions: ["geolocation"],
});

const SETTLE = 700;

async function settle(page: Page, ready?: Locator) {
  if (ready) await ready.first().waitFor({ state: "visible", timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.waitForTimeout(SETTLE);
}

for (const theme of THEMES) for (const viewport of VIEWPORTS) {
  test(`gallery ${viewport.width} ${theme}`, async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const tag = `${viewport.width}-${theme}`;
    await mkdir(GALLERY_OUT, { recursive: true });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    const consoleLog = collectConsole(page);
    const shots: string[] = [];
    const failures: { shot: string; error: string }[] = [];

    /** Run one capture; a failure is recorded and the run continues. */
    async function shot(name: string, steps: () => Promise<void>, options: { fullPage?: boolean } = {}) {
      consoleLog.setRoute(name);
      try {
        await steps();
        const file = `${name}-${tag}.png`;
        await page.screenshot({ path: resolve(GALLERY_OUT, file), fullPage: options.fullPage ?? false, animations: "disabled" });
        shots.push(file);
      } catch (error) {
        failures.push({ shot: name, error: String((error as Error).message ?? error).split("\n")[0] });
      } finally {
        await page.keyboard.press("Escape").catch(() => undefined);
      }
    }
    const go = async (path: string, ready?: Locator) => { await page.goto(path); await settle(page, ready); };

    try {
      /* ---------- signed out: onboarding + sign-in (fresh context) ---------- */
      await shot("onboarding", async () => {
        await go("/", page.getByRole("button", { name: "דלג" }));
      });
      await shot("signin", async () => {
        const skip = page.getByRole("button", { name: "דלג" });
        if (await skip.count()) await skip.first().click();
        await settle(page, page.getByRole("button", { name: /Google/ }));
      });

      const scope: GalleryScope = await galleryAccount(page, theme);
      const main = page.locator("main");

      /* ---------- main tabs ---------- */
      await shot("home", () => go("/", page.getByTestId("home-page")), { fullPage: true });
      await shot("home-viewport", () => go("/", page.getByTestId("home-page")));
      await shot("journal", () => go("/history", main), { fullPage: true });
      for (const tab of ["cons", "price", "spend", "community"]) {
        await shot(`insights-${tab}`, () => go(`/stats?tab=${tab}`, page.locator(".insights-tabs")), { fullPage: true });
      }
      await shot("vehicle", () => go("/vehicle", page.getByRole("region", { name: "הרכב שלי", exact: true })), { fullPage: true });
      await shot("vehicle-costs", () => go("/vehicle?tab=costs", main), { fullPage: true });
      await shot("vehicle-details", () => go("/vehicle?tab=details", main), { fullPage: true });
      await shot("vehicle-prefs", () => go("/vehicle?tab=prefs", main), { fullPage: true });
      await shot("vehicle-edit", () => go(`/vehicle/edit/${scope.vehicleId}`, main), { fullPage: true });
      await shot("year", () => go(`/vehicle/years/${scope.year}`, main), { fullPage: true });

      /* ---------- Home sheets ---------- */
      await shot("sheet-tank", async () => {
        await go("/", page.getByTestId("tank-hero"));
        await page.getByTestId("tank-hero").click();
        await settle(page, page.getByTestId("tank-sheet"));
      });
      await shot("sheet-trip", async () => {
        await go("/", page.getByTestId("tank-hero"));
        await page.getByTestId("tank-hero").click();
        await page.getByTestId("tank-open-trip").click();
        await settle(page, page.getByTestId("tank-trip-sheet"));
      });
      await shot("sheet-measurement", async () => {
        await go("/", page.getByTestId("consumption-details-open"));
        await page.getByTestId("consumption-details-open").click();
        await settle(page, page.getByTestId("consumption-details-sheet"));
      });
      await shot("sheet-tco", async () => {
        await go("/", page.getByTestId("tco-card"));
        await page.getByTestId("tco-card").click();
        await settle(page, page.getByTestId("tco-sheet"));
      });
      await shot("sheet-car-switch", async () => {
        await go("/", page.getByTestId("open-car-switch"));
        await page.getByTestId("open-car-switch").click();
        await settle(page, page.getByRole("dialog"));
      });

      /* ---------- fill-up ---------- */
      await shot("fillup-empty", () => go("/fillup/new", page.getByTestId("fillup-form")), { fullPage: true });
      await shot("fillup-filled", async () => {
        await go("/fillup/new", page.getByTestId("fillup-odometer"));
        await page.getByTestId("fillup-odometer").fill("172450");
        await page.getByTestId("fillup-liters").fill("36.4");
        const price = page.getByTestId("fillup-price");
        if (await price.isVisible().catch(() => false) && await price.isEditable().catch(() => false)) await price.fill("7.35");
        const full = page.getByRole("radio", { name: "מילאתי עד הסוף", exact: true });
        if (await full.count()) await full.click();
        await settle(page, page.getByTestId("fillup-live-preview"));
      }, { fullPage: true });
      await shot("fillup-more", async () => {
        await go("/fillup/new", page.getByTestId("fillup-more-toggle"));
        await page.getByTestId("fillup-more-toggle").click();
        await settle(page, page.locator("#fillup-more-content"));
      }, { fullPage: true });
      await shot("sheet-station", async () => {
        await go("/fillup/new", page.getByTestId("fillup-station"));
        await page.getByTestId("fillup-station").click();
        await settle(page, page.getByRole("dialog"));
      });

      /* ---------- vehicle: reminders, issues, service/expense forms ---------- */
      await shot("reminder-detail", () => go("/vehicle/reminders/g-brakes", main), { fullPage: true });
      await shot("issue-detail", () => go("/vehicle/issues/g-issue", main), { fullPage: true });
      await shot("sheet-reminder-new", async () => {
        await go("/vehicle", page.getByRole("region", { name: "הרכב שלי", exact: true }));
        await page.locator("section[aria-labelledby='vehicle-reminders-heading'] .tm-vehicle-section-head button").click();
        await settle(page, page.getByTestId("care-entry"));
      });
      await shot("sheet-issue-new", async () => {
        await go("/vehicle", page.getByRole("region", { name: "הרכב שלי", exact: true }));
        await page.getByRole("button", { name: /משהו השתנה ברכב/ }).click();
        await settle(page, page.getByRole("dialog"));
      });
      await shot("sheet-service", async () => {
        await go("/vehicle", page.getByRole("region", { name: "הרכב שלי", exact: true }));
        await page.getByRole("button", { name: "הוספת טיפול", exact: true }).click();
        await settle(page, page.getByTestId("care-entry"));
      });
      await shot("sheet-expense", async () => {
        await go("/vehicle", page.getByRole("region", { name: "הרכב שלי", exact: true }));
        await page.getByRole("button", { name: "הוספת הוצאה", exact: true }).click();
        await settle(page, page.getByTestId("care-entry"));
      });
      /* ---------- Stage 4 additions (v3 sheets) ---------- */
      await shot("sheet-expense-details", async () => {
        await go("/vehicle", page.getByRole("region", { name: "הרכב שלי", exact: true }));
        await page.getByRole("button", { name: "הוספת הוצאה", exact: true }).click();
        await page.getByTestId("care-category-parking").click();
        await settle(page, page.getByTestId("care-ownership"));
      });
      await shot("sheet-exclude-info", async () => {
        await go("/vehicle", page.getByRole("region", { name: "הרכב שלי", exact: true }));
        await page.getByRole("button", { name: "הוספת הוצאה", exact: true }).click();
        // The previous capture left a restored draft that reopens on step 2.
        await page.getByTestId("care-entry").waitFor({ timeout: 10_000 });
        if (!await page.getByTestId("care-ownership").isVisible().catch(() => false)) await page.getByTestId("care-category-parking").click({ timeout: 10_000 });
        await page.getByTestId("care-ownership-info").click({ timeout: 10_000 });
        await settle(page, page.getByTestId("exclude-info-sheet"));
      });
      await shot("sheet-journal-info", async () => {
        await go("/history", page.getByTestId("journal-summary-info"));
        await page.getByTestId("journal-summary-info").click();
        await settle(page, page.getByRole("dialog", { name: "על אילו נתונים הסיכום מבוסס?", exact: true }));
      });
      await shot("sheet-snooze", async () => {
        await go("/notifications", page.getByRole("button", { name: "דחיית הופעה", exact: true }).first());
        await page.getByRole("button", { name: "דחיית הופעה", exact: true }).first().click();
        await settle(page, page.getByTestId("snooze-presets"));
      });
      await shot("sheet-doc-test", async () => {
        await go("/vehicle", page.getByTestId("vehicle-doc-test"));
        await page.getByTestId("vehicle-doc-test").click();
        await settle(page, page.getByTestId("vehicle-doc-form"));
      });

      /* ---------- account and secondary screens ---------- */
      await shot("account", () => go("/account", main), { fullPage: true });
      await shot("notifications", () => go("/notifications", main), { fullPage: true });
      await shot("unsynced", () => go("/settings/unsynced", main), { fullPage: true });
      await shot("import", () => go("/settings/import", main), { fullPage: true });
      await shot("vehicles", () => go("/settings/vehicles", main), { fullPage: true });
      await shot("wizard", () => go("/vehicles/new", page.getByTestId("vehicle-wizard")), { fullPage: true });
      await shot("wizard-manual", async () => {
        await go("/vehicles/new", page.getByTestId("wizard-manual"));
        await page.getByTestId("wizard-manual").click();
        await settle(page, page.getByTestId("wizard-make"));
      }, { fullPage: true });

      // EV: the production vehicle model has no powertrain/battery fields yet
      // (DESIGN-V3 §7.4 is a Stage 5 feature), so there is no EV state to capture.
      expect(shots.length).toBeGreaterThan(0);
    } finally {
      await writeConsole(tag, consoleLog.entries, failures, shots);
    }
  });
}
