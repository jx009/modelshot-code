import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), set: vi.fn(), get: vi.fn(), audit: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/site-config", () => ({ setSiteConfig: mocks.set, getSiteConfig: mocks.get, invalidateSiteConfig: mocks.invalidate }));
vi.mock("@/lib/domain/identity/admin-operation", () => ({ auditedOperation: mocks.audit }));
import { PATCH, GET } from "../../src/app/api/admin/resolution-pricing/route.js";

const prices = { "1K": 1, "2K": 2, "4K": 4 };
beforeEach(() => {
  mocks.auth.mockResolvedValue({ user: { id: "root", role: "root" } });
  mocks.get.mockResolvedValue(null);
  mocks.audit.mockImplementation(async (_id, _key, _action, _input, mutate) => {
    const result = await mutate({});
    return { ok: true, ...result.response };
  });
});
function request(value) {
  return new Request("http://localhost/api/admin/resolution-pricing", { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": "fixture-pricing-change-key" }, body: JSON.stringify({ surcharges: value, reason: "Update resolution surcharges" }) });
}
it("stores one global surcharge table without writing model pricing", async () => {
  expect((await PATCH(request(prices))).status).toBe(200);
  expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), "root");
  expect(mocks.set).toHaveBeenCalledWith("image_resolution_pricing", JSON.stringify(prices), {});
  expect(mocks.invalidate).toHaveBeenCalledOnce();
});
it.each([{ "1K": 5 }, { ...prices, "4K": -1 }, { ...prices, "2K": 1.5 }, { ...prices, "4K": 100001 }, { ...prices, "8K": 40 }, null])("rejects invalid or incomplete global prices before changing config", async value => {
  expect((await PATCH(request(value))).status).toBe(400);
  expect(mocks.set).not.toHaveBeenCalled();
});
it("allows zero surcharge and returns defaults for an unconfigured site", async () => {
  expect((await PATCH(request({ ...prices, "1K": 0 }))).status).toBe(200);
  expect((await (await GET(new Request("http://localhost"))).json()).surcharges).toEqual({ "1K": 0, "2K": 0, "4K": 0 });
});
it("rejects ordinary admins before changing pricing", async () => {
  mocks.auth.mockResolvedValue({ response: new Response("Forbidden", { status: 403 }) });
  expect((await PATCH(request(prices))).status).toBe(403);
  expect(mocks.set).not.toHaveBeenCalled();
});
