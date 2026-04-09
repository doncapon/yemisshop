// ui/playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Fail the build on CI if you accidentally left test.only in the source
  forbidOnly: !!process.env.CI,
  // Retry failing tests once on CI
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,

  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],

  use: {
    baseURL: BASE_URL,
    headless: !!process.env.CI,
    // Capture trace on first retry for easier debugging
    trace: "on-first-retry",
    // Screenshot on failure
    screenshot: "only-on-failure",
    // Video on first retry
    video: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],

  // Start the dev server automatically when running E2E locally
  webServer: process.env.CI
    ? undefined
    : {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
