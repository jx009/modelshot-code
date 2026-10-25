import { beforeEach, expect, it, vi } from "vitest";
const ports = vi.hoisted(() => ({ role: "root", raw: null, write: vi.fn(), audit: vi.fn(), invalidate: vi.fn() }));
vi.mock("../../src/lib/prisma", () => ({ prisma: {} }));
vi.mock("../../src/lib/admin-auth", () => ({ requireAdmin: async (_request, minimum = "admin") =>
  ["admin", "root"].includes(ports.role) && (minimum !== "root" || ports.role === "root")
    ? { user: { id: "actor", role: ports.role } } : { response: new Response(null, { status: 403 }) },
}));
vi.mock("../../src/lib/site-config", () => ({
  getSiteConfig: async () => ports.raw,
  setSiteConfig: ports.write,
  invalidateSiteConfig: ports.invalidate,
}));
vi.mock("../../src/lib/domain/identity/admin-operation", () => ({ auditedOperation: ports.audit }));
import { GET, PATCH } from "../../src/app/api/admin/creation-access/route.js";
import { CREATION_ACCESS_FLAGS } from "../../src/lib/creation/access-flags.js";

const config = Object.fromEntries(CREATION_ACCESS_FLAGS.map(({ key }) => [key, true]));
const request = body => new Request("https://example.test/api/admin/creation-access", { method: "PATCH", headers: {
  "content-type": "application/json", "idempotency-key": "creation-access-save-123",
}, body: JSON.stringify(body) });
beforeEach(() => {
  ports.role = "root"; ports.raw = JSON.stringify(config);
  ports.write.mockReset(); ports.invalidate.mockReset();
  ports.audit.mockReset().mockImplementation(async (_id, _key, _action, _input, mutate) => { await mutate({}); return { ok: true }; });
});

it("lets administrators inspect the seven switches but only root may save", async () => {
  ports.role = "admin";
  const response = await GET(new Request("https://example.test/api/admin/creation-access"));
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ config, canManage: false });
  expect((await PATCH(request({ config, reason: "开放创作" }))).status).toBe(403);
  expect(ports.write).not.toHaveBeenCalled();
  ports.role = "user";
  expect((await GET(new Request("https://example.test/api/admin/creation-access"))).status).toBe(403);
});

it("persists all seven boolean switches atomically through a root-scoped audit", async () => {
  const closed = { ...config, poster: false, runs: false };
  expect((await PATCH(request({ config: closed, reason: "调整创作开放范围" }))).status).toBe(200);
  expect(ports.write).toHaveBeenCalledWith("creation_access", JSON.stringify(closed), {});
  const call = ports.audit.mock.calls[0];
  expect(call.slice(0, 3)).toEqual(["actor", "creation-access-save-123", "UPDATE_CREATION_ACCESS"]);
  expect(call[6]).toBe("root");
  expect(ports.invalidate).toHaveBeenCalledOnce();
});

it.each([{ ...config, poster: "false" }, { poster: false }, { ...config, injected: true }])("rejects malformed or incomplete config without writing", async invalid => {
  expect((await PATCH(request({ config: invalid, reason: "调整配置" }))).status).toBe(400);
  expect(ports.audit).not.toHaveBeenCalled();
  expect(ports.write).not.toHaveBeenCalled();
});
