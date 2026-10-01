import { defineConfig } from "@playwright/test";

// UI-only checks: intercepted API fixtures, no database or paid model calls.
// Run `npm run build` first, then `npm run test:ui`.
export default defineConfig({
  testDir: "./tests/ui",
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3101",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next start -p 3101",
    url: "http://127.0.0.1:3101/zh",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
