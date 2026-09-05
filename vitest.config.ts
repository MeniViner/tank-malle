import { defineConfig } from "vitest/config";

/**
 * Separate from vite.config.ts on purpose: the stats engine is pure and needs
 * no plugins, and keeping the two configs apart avoids a type clash between
 * the app's Vite version and the one Vitest bundles.
 */
export default defineConfig({
  test: {
    environment: "node",
    // Scripts are tested too: the nightly price parser lives there, and a
    // wrong reading of the ministry's page would reach every driver.
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
