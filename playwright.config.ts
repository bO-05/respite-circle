import { defineConfig, devices } from "@playwright/test";

const PORT = 3130;
const BASE_URL = `http://127.0.0.1:${PORT}`;

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
    },
  },
});
