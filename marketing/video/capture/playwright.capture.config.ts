import { defineConfig } from "@playwright/test";

/**
 * Captures app screens from demo mode for the marketing video.
 * Emulator-only (project demo-tankmaleh), the same rig as the e2e suite.
 * Run from the repo root: npx playwright test -c marketing/video/capture/playwright.capture.config.ts --trace off
 */
export default defineConfig({
  testDir: ".",
  testMatch: "capture.spec.ts",
  outputDir: "../../../test-results/marketing-capture",
  globalSetup: "../../../e2e/global-setup.ts",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: "http://127.0.0.1:5273",
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    serviceWorkers: "block",
    launchOptions: { executablePath: "/opt/pw-browsers/chromium" },
  },
  webServer: [
    {
      command: "npx --no-install firebase emulators:start --only auth,firestore --project demo-tankmaleh",
      cwd: "../../..",
      url: "http://127.0.0.1:8080/",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "npx vite --mode e2e --host 127.0.0.1 --port 5273 --strictPort",
      cwd: "../../..",
      url: "http://127.0.0.1:5273",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
