import { AUTH_HOST, FIRESTORE_HOST, resetEmulators } from "./helpers/emulator";

/**
 * Wait for the emulators to be genuinely ready.
 *
 * Playwright's `webServer.url` check is satisfied by the emulator HUB, which
 * starts before Auth and Firestore are listening. That produced a run where
 * the first test in every spec file failed with ECONNREFUSED on 9099 and the
 * rest were skipped — a startup race, reported as six unrelated bugs.
 *
 * So each emulator is polled on its own port before any test starts.
 */

async function waitFor(name: string, url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      // Any HTTP answer means the port is serving; the emulators return a
      // banner on their root, not necessarily a 200.
      if (response.status > 0) return;
    } catch (error) {
      lastError = (error as Error).message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`${name} emulator did not come up at ${url}: ${lastError}`);
}

export default async function globalSetup(): Promise<void> {
  // Without .env.e2e the app has no Firebase config, renders its
  // "not configured" state, and EVERY test then fails on a missing sign-in
  // button — sixty timeouts describing one missing file. Say so once instead.
  const { existsSync } = await import("node:fs");
  const envFile = new URL("../.env.e2e", import.meta.url);
  if (!existsSync(envFile)) {
    throw new Error(
      ".env.e2e is missing. It holds emulator-only placeholder values and is " +
        "committed on purpose; without it the app cannot initialise Firebase.",
    );
  }

  await waitFor("Auth", `${AUTH_HOST}/`);
  await waitFor("Firestore", `${FIRESTORE_HOST}/`);

  // Start from a known-empty state, so a previous run cannot leak into this one.
  await resetEmulators();
}
