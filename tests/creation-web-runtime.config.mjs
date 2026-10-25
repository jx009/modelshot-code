import { defineConfig } from "@playwright/test";

// A single browser against intercepted origins; no Next server, DB or Worker.
export default defineConfig({
  testDir: "./browser", testMatch: "creation-web-runtime.spec.mjs",
  outputDir: "../test-results-creation-web-runtime", workers: 1, timeout: 30000,
  reporter: "list", use: { headless: true, trace: "retain-on-failure" },
});
