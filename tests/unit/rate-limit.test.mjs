import { afterEach, expect, it, vi } from "vitest";
import { rateLimit } from "../../src/lib/domain/identity/rate-limit.js";
import { errorResponse } from "../../src/lib/http.js";

afterEach(() => vi.useRealTimers());

it("returns the remaining window and a distinct email scope without exposing the address", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T00:30:00Z"));
  const upsert = vi.fn().mockResolvedValue({ hits: 6, expiresAt: new Date("2026-10-20T00:40:00Z") });
  const error = await rateLimit("email-address", "private@example.invalid", 5, 600, { rateLimit: { upsert } }, "EMAIL_ADDRESS_RATE_LIMITED").catch(e => e);
  const response = errorResponse(error);
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("600");
  const body = await response.json();
  expect(body).toMatchObject({ code: "EMAIL_ADDRESS_RATE_LIMITED", retryAfter: 600, retryable: true });
  expect(JSON.stringify(body)).not.toContain("private@example.invalid");
  expect(upsert.mock.calls[0][0].where.key).toMatch(/^[a-f0-9]{64}$/);
});

it("retains the generic limit code and permits requests at the limit", async () => {
  const upsert = vi.fn().mockResolvedValue({ hits: 5, expiresAt: new Date(Date.now() + 10000) });
  await expect(rateLimit("fixture", "user", 5, 600, { rateLimit: { upsert } })).resolves.toBeUndefined();
  upsert.mockResolvedValue({ hits: 6, expiresAt: new Date(Date.now() + 10000) });
  await expect(rateLimit("fixture", "user", 5, 600, { rateLimit: { upsert } })).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429, retryAfter: 10 });
});
