import { defineConfig, devices } from "@playwright/test";
import { loadEnvLocal } from "./src/db/env";
import {
  assertE2eTarget,
  databaseNameFromUrl,
  E2E_DATABASE_NAME,
} from "./src/db/target";

// The Playwright config process does not run inside Next, so `.env.local` is
// not loaded for it. Load it before reading the test database strings.
loadEnvLocal();

const PORT = 3130;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Ask intake writes rows. The suite therefore runs against the isolated
// `respite_circle_e2e` database and never against the demo database `neondb`.
const e2eDirectUrl = assertE2eTarget();
const e2ePooledUrl = process.env.E2E_DATABASE_URL;

if (!e2ePooledUrl) {
  throw new Error(
    "E2E_DATABASE_URL is not set. Playwright refuses to run against the app database; add the pooled respite_circle_e2e string to .env.local.",
  );
}

if (databaseNameFromUrl(e2ePooledUrl) !== E2E_DATABASE_NAME) {
  throw new Error(
    `E2E_DATABASE_URL targets "${databaseNameFromUrl(e2ePooledUrl)}". Playwright may only use "${E2E_DATABASE_NAME}".`,
  );
}

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  retries: 1,
  fullyParallel: false,
  forbidOnly: true,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/pw-results.json" }],
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: "npm run build && npm run start",
    // Use 127.0.0.1, never localhost: localhost can resolve to ::1 while
    // `next start` binds IPv4 only, and the run hangs waiting for the socket.
    url: BASE_URL,
    reuseExistingServer: process.env.PW_REUSE === "1",
    timeout: 240_000,
    env: {
      NODE_ENV: "production",
      // Enables the test-only 500 probe (`/error-probe`); production builds
      // run without it and the route answers 404.
      RC_E2E: "1",
      RC_DEMO_MODE: "1",
      RC_DEMO_RESET_TOKEN: "e2e-reset-token",
      // No network, no tokens, no flake: the rules engine answers the nine
      // typed questions in the E2E suite.
      LLM_PROVIDER: "deterministic",
      RC_MODEL: "fake-typed-v1",
      // The app writes asks through `/api/asks`; both strings must name the
      // isolated test database, and `globalSetup` refuses anything else.
      DATABASE_URL: e2ePooledUrl,
      DATABASE_URL_UNPOOLED: e2eDirectUrl,
    },
  },
});
