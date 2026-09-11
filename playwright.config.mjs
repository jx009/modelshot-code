import { defineConfig, devices } from "@playwright/test";
import { getTestEnvironment } from "./tests/support/environment.mjs";

const config = getTestEnvironment();
const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/support/e2e-setup.mjs",
  globalTeardown: "./tests/support/e2e-teardown.mjs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "node tests/support/browser-runtime.mjs",
    url: `${baseURL}/en/login`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: config.databaseUrl,
      DIRECT_URL: config.databaseUrl,
      NEXTAUTH_URL: baseURL,
      NEXTAUTH_SECRET: "isolated-e2e-session-secret-not-for-deployment",
      ENCRYPTION_KEY: "ab".repeat(32),
      REDIS_URL: config.redisUrl,
      S3_ENDPOINT: config.storage.endpoint,
      S3_REGION: config.storage.region,
      S3_BUCKET: "modelshot-e2e",
      S3_ACCESS_KEY_ID: config.storage.credentials.accessKeyId,
      S3_SECRET_ACCESS_KEY: config.storage.credentials.secretAccessKey,
      PAYMENTS_ENABLED: "0",
      QA_ENABLED: "0",
      C2PA_ENABLED: "0",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      OPENAI_API_KEY: "",
      GOOGLE_GEMINI_API_KEY: "",
      FASHN_API_KEY: "",
      STRIPE_SECRET_KEY: "",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(config.smtpPort),
      SMTP_USER: "",
      SMTP_PASS: "",
      SMTP_FROM: "noreply@modelshot.local",
    },
  },
});
