import { defineConfig } from "@playwright/test";

// Authorized, serial component-browser checks. The test owns a short-lived
// loopback fixture server; no Next, database, queue, model or production build.
export default defineConfig({
  testDir: "./tests/ui", testMatch: "creation-canvas.spec.mjs", workers: 1, fullyParallel: false,
  timeout: 30000, expect: { timeout: 5000 }, reporter: "list",
  outputDir: "test-results-creation-canvas",
  use: { serviceWorkers: "block", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
