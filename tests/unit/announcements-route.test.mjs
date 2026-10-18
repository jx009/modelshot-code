import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), get: vi.fn(), save: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/server/announcements", () => ({ getAnnouncements: mocks.get, saveAnnouncements: mocks.save }));
vi.mock("@/lib/domain/identity/admin-operation", () => ({ auditedOperation: mocks.audit }));
import { GET, PATCH } from "../../src/app/api/admin/announcements/route.js";
beforeEach(() => { mocks.auth.mockResolvedValue({ user: { id: "admin" } }); });
it.each([401, 403])("denies read and update before touching configuration (%s)", async status => {
  mocks.auth.mockResolvedValue({ response: new Response("Denied", { status }) });
  expect((await GET(new Request("http://localhost/api/admin/announcements"))).status).toBe(status);
  expect((await PATCH(new Request("http://localhost/api/admin/announcements", { method: "PATCH" }))).status).toBe(status);
  expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
});
it("returns non-cacheable admin configuration", async () => {
  mocks.get.mockResolvedValue({ items: [], version: "a".repeat(64) });
  const response = await GET(new Request("http://localhost/api/admin/announcements"));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.json()).items).toEqual([]);
});
it("rejects malformed updates without writing an audit or configuration", async () => {
  const response = await PATCH(new Request("http://localhost/api/admin/announcements", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ title: "Incomplete" }], version: "a".repeat(64), reason: "Update notice" }) }));
  expect(response.status).toBe(400); expect(mocks.audit).not.toHaveBeenCalled();
});
