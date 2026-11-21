import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Shared Vitest setup. The unit and integration configs add their own
 * include paths; everything else (alias, React transform, jsdom opt-in via
 * a `@vitest-environment` docblock, jest-dom matchers) stays in one place.
 */
export const base = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
  },
});
