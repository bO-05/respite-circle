import { defineConfig, mergeConfig } from "vitest/config";
import { base } from "./vitest.base";

// Integration tests run against the Neon `e2e` branch, one fork at a time.
// There are none until the schema feature lands, so an empty directory is
// not a failure.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["tests/integration/**/*.test.ts"],
      exclude: ["node_modules/**", ".next/**"],
      passWithNoTests: true,
      testTimeout: 60_000,
    },
  }),
);
