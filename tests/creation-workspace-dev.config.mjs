import { defineConfig } from "@playwright/test";
// Start an authorized local dev server first. API fixtures never use the DB,
// queue or paid providers. One browser at a time on the small development host.
export default defineConfig({
  testDir: "./ui", testMatch: "creation-workspace.spec.mjs", workers: 1,
  outputDir: "../test-results-creation-workspace", timeout: 90000,
  expect: { timeout: 15000 }, reporter: "list",
  use: { baseURL: process.env.CREATION_TEST_ORIGIN || "http://localhost:3117", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
