import { defineConfig } from "vitest/config";

/**
 * Firestore Rules tests.
 *
 * Separated from the unit suite because they need a running emulator (and
 * therefore Java), so `npm test` stays fast and dependency-free.
 */
export default defineConfig({
  test: {
    include: ["tests/rules/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // The emulator is a single shared instance; parallel files would race on
    // clearFirestore().
    fileParallelism: false,
  },
});
