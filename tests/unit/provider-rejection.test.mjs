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

it("names a real-person input rejection separately so the caller can explain it", async () => {
  const response = new Response(JSON.stringify({ error: { code: "InputImageSensitiveContentDetected.PrivacyInformation", message: "The request failed because the input image 'content[1]' may contain real person.", param: "content[1]" } }), { status: 400 });
  const error = await providerRejection(response, "/contents/generations/tasks");
  expect(error.code).toBe("VIDEO_IMAGE_REAL_PERSON");
  expect(error.status).toBe(400);
  expect(error.providerBody).toContain("content[1]");
});
