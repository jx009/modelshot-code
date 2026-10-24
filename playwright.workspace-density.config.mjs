import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui", testMatch: "parity-tools.spec.mjs", grep: /workspace density/,
  outputDir: "test-results-workspace-density", workers: 1, fullyParallel: false,
  timeout: 60000, expect: { timeout: 15000 }, reporter: "list",
  use: { baseURL: "http://127.0.0.1:3101", serviceWorkers: "block", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
