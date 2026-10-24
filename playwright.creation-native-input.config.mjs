import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui", testMatch: "creation-native-input.spec.mjs", workers: 1, fullyParallel: false,
  timeout: 90000, expect: { timeout: 15000 }, reporter: "list",
  outputDir: "test-results-creation-native-input",
  use: { serviceWorkers: "block", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
