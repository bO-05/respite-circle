import { defineConfig, mergeConfig } from "vitest/config";
import { base } from "./vitest.base";

// Default run: unit and component tests. Integration tests need the Neon
// `e2e` branch and are run by `npm run test:integration` only.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: [
        "tests/unit/**/*.test.{ts,tsx}",
        "tests/component/**/*.test.{ts,tsx}",
      ],
      exclude: ["node_modules/**", ".next/**"],
    },
  }),
);
