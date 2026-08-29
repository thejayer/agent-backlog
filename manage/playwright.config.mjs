import { defineConfig, devices } from "@playwright/test";

const manageAuthToken = process.env.MANAGE_PLAYWRIGHT_AUTH_TOKEN || "manage-playwright-local-agent-token";
const manageOperatorToken = process.env.MANAGE_PLAYWRIGHT_OPERATOR_TOKEN || "manage-playwright-local-operator-token";
const manageAuthSecret = process.env.MANAGE_PLAYWRIGHT_AUTH_SECRET || "manage-playwright-local-secret";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  workers: 1,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: "http://127.0.0.1:5186",
    extraHTTPHeaders: {
      Authorization: `Bearer ${manageAuthToken}`,
      "x-csrf-protection": "1",
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run manage:dev",
    cwd: "..",
    env: {
      ...process.env,
      MANAGE_AUTH_SECRET: manageAuthSecret,
      MANAGE_AUTH_TOKEN: manageAuthToken,
      MANAGE_OPERATOR_TOKEN: manageOperatorToken,
      MANAGE_BASE_URL: "http://127.0.0.1:5186",
      MANAGE_COOKIE_SECURE: "false",
      NODE_ENV: "test",
    },
    url: "http://127.0.0.1:5186",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
    },
  ],
});
