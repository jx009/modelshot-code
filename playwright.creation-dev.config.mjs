import { defineConfig } from "@playwright/test";

// Explicitly opt into an already running local server. No service, database,
// Worker, production build or model call is started by this configuration.
export default defineConfig({
  testDir: "./tests/ui", testMatch: "creation-workspace.spec.mjs",
  outputDir: "test-results-creation", workers: 1, fullyParallel: false,
  timeout: 120_000, expect: { timeout: 30_000 }, reporter: "list",
  use: { baseURL: "http://127.0.0.1:3101", serviceWorkers: "block", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
