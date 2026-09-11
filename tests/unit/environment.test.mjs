import { describe, expect, it } from "vitest";
import { getTestEnvironment } from "../support/environment.mjs";

describe("test environment isolation", () => {
  it("does not inherit application database credentials", () => {
    const config = getTestEnvironment({ DATABASE_URL: "postgresql://production/production" });
    expect(config.databaseUrl).toContain("/modelshot_test");
  });
  it.each([
    { TEST_DATABASE_URL: "postgresql://db.example/modelshot_test" },
    { TEST_DATABASE_URL: "postgresql://127.0.0.1/modelshot" },
    { TEST_REDIS_URL: "redis://127.0.0.1/0" },
    { TEST_S3_ENDPOINT: "http://storage.example" },
    { TEST_MAIL_URL: "http://mail.example" },
  ])("rejects destructive or external test targets: %j", config => {
    expect(() => getTestEnvironment(config)).toThrow();
  });
});
