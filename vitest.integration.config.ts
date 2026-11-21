import { defineConfig, mergeConfig } from "vitest/config";
import { base } from "./vitest.base";

// Integration tests run against the isolated `respite_circle_e2e` database in
// the same Neon project as the app database `neondb` (not a Neon branch).
// One worker, one schema; globalSetup refuses to run without
// RC_DB_BRANCH=e2e and E2E_DATABASE_URL_UNPOOLED naming that database.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["tests/integration/**/*.test.ts"],
      exclude: ["node_modules/**", ".next/**"],
      globalSetup: ["./tests/integration/global-setup.ts"],
      testTimeout: 60_000,
      hookTimeout: 60_000,
      pool: "forks",
      maxWorkers: 1,
      fileParallelism: false,
    },
  }),
);
