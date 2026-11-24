import { defineConfig, mergeConfig } from "vitest/config";
import { base } from "./vitest.base";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["tests/unit/**/*.test.{ts,tsx}"],
      exclude: ["node_modules/**", ".next/**"],
      // The suite spawns `git check-ignore` and reads every file under src and
      // tests. On a saturated 4-vCPU host that exceeds Vitest's 5 s default,
      // which reads as a failing test rather than slow I/O.
      testTimeout: 30_000,
    },
  }),
);
