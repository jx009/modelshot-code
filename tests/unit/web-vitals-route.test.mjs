import { expect, test, vi } from "vitest";
import { POST } from "../../src/app/api/vitals/route.js";

const post = body => POST(new Request("https://example.test/api/vitals", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

test("logs a valid metric with a truncated route and no query or identifiers", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const response = await post({ name: "LCP", value: 1820, rating: "good", path: "/studio-v2/abc?document=secret", nav: "navigate" });
  expect(response.status).toBe(204);
  expect(JSON.parse(info.mock.calls[0][0])).toEqual({ code: "WEB_VITAL", name: "LCP", value: 1820, rating: "good", path: "/studio-v2", nav: "navigate" });
});

test("rejects unknown metrics, extra fields, malformed and oversized bodies", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  expect((await post({ name: "FID", value: 1, path: "/" })).status).toBe(400);
  expect((await post({ name: "LCP", value: 1, path: "/", userId: "u" })).status).toBe(400);
  expect((await post("{not json")).status).toBe(400);
  expect((await post("x".repeat(2000))).status).toBe(413);
});
