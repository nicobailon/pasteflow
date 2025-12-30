import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e/electron",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report-electron" }],
  ],
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  outputDir: "test-results-electron",
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },
});
