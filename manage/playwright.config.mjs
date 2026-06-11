import { defineConfig, devices } from "@playwright/test";

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
      Authorization: "Bearer manage-local",
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run manage:dev",
    cwd: "..",
    url: "http://127.0.0.1:5186",
    reuseExistingServer: true,
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
