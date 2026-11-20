import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { signedInWithData } from "./helpers/app";
import { fillupFixture, typeFillup } from "./helpers/design-v2-fillup";
import { homeFixture, homeKmReminder } from "./helpers/design-v2-home";
import { setDocument } from "./helpers/emulator";
import { holdJournal, releaseJournal, waitForJournalHold } from "./helpers/journal";

type NativeBack = {
  back: (canGoBack?: boolean) => void;
  state: (isActive: boolean) => void;
  ready: () => boolean;
  minimizeCalls: number;
};

declare global {
  interface Window { testNativeBack?: NativeBack }
}

// Stub the Android transport. Production Capacitor App listeners, React
// overlays and BrowserRouter's asynchronous history traversal still run.
async function installAndroidBridge(page: Page) {
  await page.addInitScript(() => {
    const listeners = new Map<string, { name: string; call: (payload: object) => void }>();
    let nextId = 0;
    let enabled = false;
    const emit = (name: string, payload: object) => {
      for (const listener of listeners.values()) if (listener.name === name) listener.call(payload);
    };

    window.testNativeBack = {
      back: (canGoBack = (history.state?.idx ?? 0) > 0) => emit("backButton", { canGoBack }),
      state: (isActive) => emit("appStateChange", { isActive }),
      ready: () => enabled && [...listeners.values()].filter(listener => listener.name === "backButton").length === 1,
      minimizeCalls: 0,
    };
    Object.assign(window, {
      androidBridge: {},
      Capacitor: {
        PluginHeaders: [{ name: "App", methods: [
          { name: "addListener", rtype: "callback" }, { name: "removeListener", rtype: "promise" },
          { name: "toggleBackButtonHandler", rtype: "promise" }, { name: "minimizeApp", rtype: "promise" },
        ] }],
        nativeCallback: (_plugin: string, _method: string, { eventName }: { eventName: string }, call: (payload: object) => void) => {
          const id = String(++nextId);
          listeners.set(id, { name: eventName, call });
          return id;
        },
        nativePromise: async (_plugin: string, method: string, options?: { callbackId?: string; enabled?: boolean }) => {
          if (method === "removeListener" && options?.callbackId) listeners.delete(options.callbackId);
          if (method === "toggleBackButtonHandler") enabled = options?.enabled === true;
          if (method === "minimizeApp") window.testNativeBack!.minimizeCalls++;
        },
      },
    });
  });
}

async function back(page: Page) {
  await page.waitForFunction(() => window.testNativeBack?.ready());
  await page.evaluate(() => window.testNativeBack!.back());
}

const exitPrompt = (page: Page) => page.getByText("לחץ שוב כדי לצאת", { exact: true });
const minimizeCalls = (page: Page) => page.evaluate(() => window.testNativeBack!.minimizeCalls);

test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

test.describe("Android system Back through the Capacitor adapter", () => {
  test.beforeEach(async ({ page }) => { await installAndroidBridge(page); });

  test("Home asks twice, expires the guard and resets it when returning from background", async ({ page }) => {
    await signedInWithData(page);
    await page.clock.install();
    await back(page);
    await expect(exitPrompt(page)).toBeVisible();
    expect(await minimizeCalls(page)).toBe(0);

    await page.clock.runFor(2100);
    await back(page);
    await expect(exitPrompt(page)).toBeVisible();
    expect(await minimizeCalls(page)).toBe(0);

    await page.evaluate(() => {
      window.testNativeBack!.state(false);
      window.testNativeBack!.state(true);
    });
    await back(page);
    await expect(exitPrompt(page)).toBeVisible();
    expect(await minimizeCalls(page)).toBe(0);

    await back(page);
    expect(await minimizeCalls(page)).toBe(1);
  });

  test("station picker returns to fill-up, then Back preserves the draft on exit", async ({ page }) => {
    await signedInWithData(page);
    await page.getByTestId("refuel-fab").click();
    const odometer = page.getByTestId("fillup-odometer");
    await odometer.fill("123456");
    await page.getByTestId("fillup-station").click();
    const station = page.getByRole("dialog", { name: "תחנת דלק" });
    await expect(station).toBeVisible();
    await back(page);
    await expect(station).toHaveCount(0);
    await expect(odometer).toHaveValue("123456");
    await back(page);
    await expect(page.getByTestId("home-page")).toBeVisible();
    await page.getByTestId("refuel-fab").click();
    await expect(page.getByTestId("fillup-draft-status")).toHaveAttribute("data-draft-state", "restored");
    await expect(odometer).toHaveValue("123456");
    expect(await minimizeCalls(page)).toBe(0);
  });

  test("nested tank sheets close in visual order even after a viewport rotation", async ({ page }) => {
    await homeFixture(page);
    await page.getByTestId("tank-hero").click();
    const tank = page.getByTestId("tank-sheet");
    const odometer = page.getByTestId("tank-odometer-sheet");
    await page.getByTestId("tank-open-odometer").click();
    await expect(odometer).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await back(page);
    await expect(odometer).toHaveCount(0);
    await expect(tank).toBeVisible();
    await back(page);
    await expect(tank).toHaveCount(0);
    await expect(exitPrompt(page)).toHaveCount(0);
    await back(page);
    await expect(exitPrompt(page)).toBeVisible();
    expect(await minimizeCalls(page)).toBe(0);
  });

  test("Back follows the hierarchy: nested screen → its tab, tab → Home, never the visit history", async ({ page }) => {
    const scope = await homeFixture(page);
    await homeKmReminder(scope);
    await setDocument(`${scope.base}/vehicleIssues/back-issue`, {
      schemaVersion: 1, version: 1, day: "2026-01-01", title: "רעש בבלמים", symptoms: "בזמן עצירה",
      odometer: null, importance: "important", status: "open", notes: "", serviceEventIds: [], history: [],
    });
    await page.getByTestId("tab-history").click();
    await page.getByTestId("tab-stats").click();
    await page.getByTestId("tab-vehicle").click();
    await expect(page).toHaveURL("/vehicle");

    await page.getByRole("link", { name: /שמן ומסננים/ }).click();
    await expect(page).toHaveURL("/vehicle/reminders/home-oil");
    await back(page);
    await expect(page).toHaveURL("/vehicle");
    await page.getByRole("link", { name: /רעש בבלמים/ }).click();
    await expect(page).toHaveURL("/vehicle/issues/back-issue");
    await back(page);
    await expect(page).toHaveURL("/vehicle");
    await expect(page.getByRole("heading", { name: "מה קורה ברכב" })).toBeVisible();
    // A press while the previous Back is still committing is ignored by design; let it settle.
    await page.waitForTimeout(400);
    // Visited Journal and Insights before: Back from a tab still goes straight Home.
    await back(page);
    await expect(page).toHaveURL("/");
    // Home → Journal → Home → Journal, then Back: Home, then the exit prompt (no replay).
    for (let i = 0; i < 2; i++) {
      await page.getByTestId("tab-history").click();
      await expect(page.getByTestId("journal-page")).toBeVisible();
      await page.getByTestId("tab-home").click();
      await expect(page).toHaveURL("/");
    }
    await page.getByTestId("tab-history").click();
    await expect(page.getByTestId("journal-page")).toBeVisible();
    await back(page);
    await expect(page).toHaveURL("/");
    await back(page);
    await expect(exitPrompt(page)).toBeVisible();
    await expect(page).toHaveURL("/");
    await page.waitForTimeout(2200);

    await page.getByRole("button", { name: "התראות", exact: true }).click();
    await expect(page).toHaveURL("/notifications");
    await back(page);
    await expect(page).toHaveURL("/");
    await page.getByTestId("open-account").click();
    await page.getByTestId("account-import").click();
    await expect(page).toHaveURL("/settings/import");
    const file = page.locator('input[type="file"]');
    await file.setInputFiles(fileURLToPath(new URL("../src/lib/import/__fixtures__/legacy-fuel-tracker.csv", import.meta.url)));
    const preview = page.getByText("זוהה כיומן תדלוקים ישן", { exact: false });
    await expect(preview).toBeVisible();
    await back(page);
    await expect(preview).toHaveCount(0);
    await expect(file).toBeAttached();
    await expect(page).toHaveURL("/settings/import");
    await back(page);
    await expect(page).toHaveURL("/account");
    await expect(page.getByTestId("account-page")).toBeVisible();
    await back(page);
    await expect(page).toHaveURL("/");
    expect(await minimizeCalls(page)).toBe(0);
  });

  test("UI close, backdrop, and saving a nested sheet leave no extra Back entries", async ({ page }) => {
    await homeFixture(page);
    await page.getByTestId("open-account").click();
    const sheet = page.getByRole("dialog", { name: "פרטי החשבון", exact: true });
    for (const close of ["button", "backdrop"]) {
      await page.getByTestId("account-identity").click();
      await expect(sheet).toBeVisible();
      if (close === "button") await sheet.getByRole("button", { name: "סגירה", exact: true }).click();
      else await sheet.locator(".tm-modal-scrim").click({ position: { x: 20, y: 20 } });
      await expect(sheet).toHaveCount(0);
      await back(page);
      await expect(page).toHaveURL("/");
      if (close === "button") await page.getByTestId("open-account").click();
    }

    await page.getByTestId("tank-hero").click();
    await back(page);
    await expect(page.getByTestId("tank-sheet")).toHaveCount(0);
    await back(page);
    await expect(exitPrompt(page)).toBeVisible();
    expect(await minimizeCalls(page)).toBe(0);
  });

  test("Back retraces the vehicle wizard steps and then returns to the opening screen", async ({ page }) => {
    await signedInWithData(page);
    let serveCatalog: () => void = () => {};
    const catalogResponse = new Promise<void>(resolve => { serveCatalog = resolve; });
    await page.route("**/vehicle-catalog.json", async route => {
      await catalogResponse;
      await route.fulfill({ json: { makes: [{ make: "טויוטה", models: [{ model: "קורולה", from: 2020, to: 2024 }] }] } });
    });
    await page.getByTestId("open-car-switch").click();
    await page.getByRole("button", { name: "הוספת רכב", exact: true }).click();
    const wizard = page.getByTestId("vehicle-wizard");
    await expect(wizard).toHaveAttribute("data-step", "plate");
    await page.getByTestId("wizard-manual").click();
    const catalogOpen = page.getByTestId("wizard-catalog-open");
    const catalogTitle = page.getByTestId("wizard-catalog-title");
    try {
      await catalogOpen.click();
      await expect(page.getByText("טוענים דגמים…", { exact: true })).toBeVisible();
      await back(page);
      await expect(catalogTitle).toHaveCount(0);
      await expect(wizard).toHaveAttribute("data-step", "confirm");
    } finally {
      serveCatalog();
    }
    await catalogOpen.click();
    await page.getByTestId("wizard-catalog-option").filter({ hasText: "טויוטה" }).click();
    await page.getByTestId("wizard-catalog-option").filter({ hasText: "קורולה" }).click();
    await expect(catalogTitle).toHaveText("בחירת שנה");
    await back(page);
    await expect(catalogTitle).toHaveText("בחירת דגם");
    await back(page);
    await expect(catalogTitle).toHaveText("בחירת יצרן");
    await back(page);
    await expect(catalogTitle).toHaveCount(0);
    await page.getByTestId("wizard-make").fill("טויוטה");
    await page.getByTestId("wizard-model").fill("קורולה");
    await page.getByTestId("wizard-fuel-95").check();
    await page.getByTestId("wizard-confirm-next").click();
    await expect(wizard).toHaveAttribute("data-step", "extras");
    await back(page);
    await expect(wizard).toHaveAttribute("data-step", "confirm");
    await expect(page.getByTestId("wizard-make")).toHaveValue("טויוטה");
    await back(page);
    await expect(wizard).toHaveAttribute("data-step", "plate");
    await back(page);
    await expect(page.getByTestId("home-page")).toBeVisible();
    expect(await minimizeCalls(page)).toBe(0);
  });

  test("Back retraces the onboarding carousel", async ({ page }) => {
    await page.goto("/");
    const slide = page.getByTestId("onboarding-slide");
    await expect(slide).toHaveAttribute("data-slide", "1");
    await page.getByTestId("onboarding-next").click();
    await page.getByTestId("onboarding-next").click();
    await expect(slide).toHaveAttribute("data-slide", "3");
    await back(page);
    await expect(slide).toHaveAttribute("data-slide", "2");
    await back(page);
    await expect(slide).toHaveAttribute("data-slide", "1");
    expect(await minimizeCalls(page)).toBe(0);
  });

  test("Back leaves an in-flight fill-up on screen while its draft is being saved", async ({ page }) => {
    const { uid } = await fillupFixture(page, { history: "none" });
    await page.getByTestId("refuel-fab").click();
    await typeFillup(page, { odometer: 100000, liters: 20, price: 7, end: "full" });
    await holdJournal(page, uid, "fillup.add", "before");
    try {
      await page.getByTestId("fillup-save").click();
      await waitForJournalHold(page);
      await expect(page.getByTestId("fillup-save")).toBeDisabled();
      await back(page);
      await expect(page.getByTestId("fillup-save")).toBeDisabled();
      await expect(page).toHaveURL("/fillup/new");
      expect(await minimizeCalls(page)).toBe(0);
    } finally {
      await releaseJournal(page);
    }
    await expect(page.getByTestId("fillup-saved")).toBeVisible();
    await back(page);
    await expect(page.getByTestId("home-page")).toBeVisible();
  });
});

test("browser popstate still traverses the actual route history outside the Android shell", async ({ page }) => {
  await signedInWithData(page);
  await page.getByTestId("tab-history").click();
  await page.getByTestId("tab-stats").click();
  await expect(page).toHaveURL("/stats");
  await page.goBack();
  await expect(page).toHaveURL("/history");
  await page.goBack();
  await expect(page.getByTestId("home-page")).toBeVisible();
});
