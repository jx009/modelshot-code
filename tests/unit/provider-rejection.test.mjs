import { expect, it } from "vitest";
import { providerRejection } from "../../src/lib/domain/studio/provider-rejection.js";

it("keeps the provider status, path and a redacted, bounded body", async () => {
  const response = new Response(JSON.stringify({ error: { message: "invalid key sk-abcdef123456 for model" } }) + "x".repeat(600), { status: 401 });
  const error = await providerRejection(response, "/contents/generations/tasks");
  expect(error.code).toBe("VIDEO_PROVIDER_REJECTED");
  expect(error.status).toBe(401);
  expect(error).toMatchObject({ providerStatus: 401, providerPath: "/contents/generations/tasks" });
  expect(error.providerBody).toContain("[redacted]");
  expect(error.providerBody).not.toContain("sk-abcdef");
  expect(error.providerBody.length).toBeLessThanOrEqual(300);
});
