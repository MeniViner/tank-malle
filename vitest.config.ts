import { defineConfig } from "vitest/config";

/**
 * Separate from vite.config.ts on purpose: the stats engine is pure and needs
 * no plugins, and keeping the two configs apart avoids a type clash between
 * the app's Vite version and the one Vitest bundles.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
