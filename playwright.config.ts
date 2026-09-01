import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests.
 *
 * Local and emulated only. The project id is `demo-tankmaleh`, which the
 * Firebase emulators special-case: they refuse to contact any real Google
 * service, so a misconfigured test physically cannot reach production.
 *
 * Two servers are started: the emulator suite (Auth + Firestore) and a Vite dev
 * server in `e2e` mode, which loads `.env.e2e` and therefore points the app at
 * those emulators.
 *
 * Java 21+ must be on PATH for the emulators. On a Homebrew Mac that usually
 * means:  PATH="/opt/homebrew/opt/openjdk/bin:$PATH" npm run test:e2e
 */

const PORT = 5273;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // The emulator hub answers before Auth and Firestore are listening, so the
  // webServer readiness check below is not sufficient on its own.
  globalSetup: "./e2e/global-setup.ts",
  // The emulators are a single shared instance and every spec resets their
  // data, so specs must not overlap.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off",
    // The app is Hebrew RTL; run it the way its users do.
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 430, height: 900 } },
    },
  ],

  webServer: [
    {
      // The locally installed CLI, so this behaves the same on a machine with
      // no global firebase-tools and in CI.
      command:
        "npx --no-install firebase emulators:start --only auth,firestore --project demo-tankmaleh",
      // The FIRESTORE emulator's own root, not the hub's. The hub answered
      // reliably locally but never did on the CI runner, hanging the whole
      // job for the full timeout while the emulators themselves were up and
      // logging "All emulators ready". Probing the service the tests actually
      // need removes a moving part; e2e/global-setup.ts then waits for Auth
      // as well before any test runs.
      url: "http://127.0.0.1:8080/",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `vite --mode e2e --port ${PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
