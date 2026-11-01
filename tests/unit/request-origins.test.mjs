import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { readJson } from "../../src/lib/http.js";
import { allowedRequestOrigins } from "../../src/lib/request-origins.js";

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_URL", "https://www.letaidraw.com");
  vi.stubEnv("ALLOWED_ORIGINS", "");
});
afterEach(() => vi.unstubAllEnvs());

const submit = (origin, extra = {}) => readJson(new Request("http://web:3000/api/example", {
  method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}), ...extra }, body: "{}",
}), z.object({}));

it.each(["https://www.letaidraw.com", "https://letaidraw.com"])("accepts writes from %s behind the internal proxy", async origin => {
  await expect(submit(origin, { "sec-fetch-site": "same-origin" })).resolves.toEqual({});
});

it("also accepts www when the configured primary has no www", async () => {
  vi.stubEnv("NEXTAUTH_URL", "https://letaidraw.com");
  await expect(submit("https://www.letaidraw.com")).resolves.toEqual({});
});

it.each(["https://evil.test", "https://letaidraw.com.evil.test", "https://acm.letaidraw.com", "http://letaidraw.com", "https://letaidraw.com:8443", "null"])("rejects unconfigured origin %s even with forged proxy headers", async origin => {
  await expect(submit(origin, { host: "evil.test", "x-forwarded-host": "evil.test", "sec-fetch-site": "same-origin" })).rejects.toThrow("CROSS_ORIGIN_REQUEST");
});

it("accepts additional explicitly configured public entry points", async () => {
  vi.stubEnv("ALLOWED_ORIGINS", "https://acm.letaidraw.com, https://preview.example.com:8443/");
  await expect(submit("https://acm.letaidraw.com", { "sec-fetch-site": "same-origin" })).resolves.toEqual({});
  await expect(submit("https://preview.example.com:8443")).resolves.toEqual({});
  await expect(submit("https://preview.example.com")).rejects.toThrow("CROSS_ORIGIN_REQUEST");
});

it.each([undefined, "https://letaidraw.com"])("retains cross-site request rejection with origin %s", async origin => {
  await expect(submit(origin, { "sec-fetch-site": "cross-site" })).rejects.toThrow("CROSS_ORIGIN_REQUEST");
});

it("invalid allowlist entries grant no access", () => {
  const origins = allowedRequestOrigins("http://web:3000/api", {
    NEXTAUTH_URL: "https://www.letaidraw.com",
    ALLOWED_ORIGINS: "*,null,not-a-url,https://*.evil.test,https://user:password@evil.test,https://evil.test/path,https://evil.test?x=1,https://evil.test#x,ftp://evil.test",
  });
  expect([...origins]).toEqual(["https://www.letaidraw.com", "https://letaidraw.com"]);
});

it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])("preserves local configuration %s without aliases", url => {
  expect([...allowedRequestOrigins("http://web:3000", { NEXTAUTH_URL: url })]).toEqual([url]);
});

it("does not trust a sibling domain implicitly or infer www from the request URL", () => {
  expect(allowedRequestOrigins("https://evil.test", { NEXTAUTH_URL: "https://acm.letaidraw.com" }).has("https://letaidraw.com")).toBe(false);
  expect([...allowedRequestOrigins("http://localhost:3000/api", {})]).toEqual(["http://localhost:3000"]);
});
