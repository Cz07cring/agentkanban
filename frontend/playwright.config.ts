import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    video: "off",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  outputDir: "./e2e/test-results",
  webServer: [
    {
      command: "python -m uvicorn main:app --port 8000",
      port: 8000,
      reuseExistingServer: true,
      cwd: "../backend",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
    {
      command: "npm run dev",
      port: 3000,
      reuseExistingServer: true,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
