import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), write: vi.fn(), invalidate: vi.fn(), count: vi.fn(), audit: vi.fn(), test: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { asset: { count: mocks.count } } }));
vi.mock("@/lib/site-config", () => ({ getSiteConfig: mocks.read, setSiteConfig: mocks.write, invalidateSiteConfig: mocks.invalidate }));
vi.mock("@/lib/domain/identity/admin-operation", () => ({ auditedOperation: mocks.audit }));
vi.mock("@/lib/infra/storage/cos", () => ({ testCosConnection: mocks.test, cosError: e => e }));
import { GET, PATCH, POST } from "../../src/app/api/admin/storage/route.js";
const config = { enabled: true, bucket: "fixture-1250000000", region: "ap-hongkong", prefix: "letaidraw", signedUrlSeconds: 300, secretId: "private-id", secretKey: "private-secret" };
beforeEach(() => {
  mocks.auth.mockResolvedValue({ user: { id: "root", role: "root" } }); mocks.read.mockResolvedValue(JSON.stringify(config)); mocks.count.mockResolvedValue(3);
  mocks.audit.mockImplementation(async (_id, _key, _action, _input, mutate) => { await mutate({}); return { ok: true }; });
  mocks.test.mockResolvedValue({ ok: true, probeUrl: "https://fixture/probe" });
});
function request(method, changes = {}) { return new Request("http://localhost/api/admin/storage", { method, headers: { "Content-Type": "application/json", "Idempotency-Key": "fixture-root-storage-key" }, body: JSON.stringify({ config: { ...config, secretId: "", secretKey: "", ...changes }, reason: "Configure COS delivery" }) }); }
it.each([GET, PATCH, POST])("rejects unauthenticated access before reading config or running any network tests", async handler => {
  mocks.auth.mockResolvedValue({ response: new Response("Denied", { status: 401 }) });
  expect((await handler(new Request("http://localhost/api/admin/storage"))).status).toBe(401);
  expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.test).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
});
it("does not return either credential to the browser", async () => {
  const response = await GET(new Request("http://localhost/api/admin/storage"));
  const text = await response.text();
  expect(text).not.toContain(config.secretId); expect(text).not.toContain(config.secretKey);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("requires ROOT to save and audits only safe configuration fields", async () => {
  expect((await PATCH(request("PATCH"))).status).toBe(200);
  expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), "root");
  expect(JSON.parse(mocks.write.mock.calls[0][1])).toEqual(config);
  const mutate = mocks.audit.mock.calls[0][4];
  const result = await mutate({});
  expect(JSON.stringify(result.audit)).not.toContain(config.secretId);
  expect(JSON.stringify(result.audit)).not.toContain(config.secretKey);
});
it("rejects arbitrary endpoints and cross-origin config writes", async () => {
  expect((await PATCH(request("PATCH", { endpoint: "http://127.0.0.1" }))).status).toBe(400);
  const req = request("PATCH"); req.headers.set("sec-fetch-site", "cross-site");
  expect((await PATCH(req)).status).toBe(403);
  expect(mocks.write).not.toHaveBeenCalled();
});
it("tests unsaved credentials without persisting them", async () => {
  const response = await POST(request("POST", { secretKey: "new-private-key" }));
  expect(response.status).toBe(200); expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.test).toHaveBeenCalledWith({ ...config, secretKey: "new-private-key" });
});
it("blocks a bucket switch when originals exist but permits credential rotation", async () => {
  mocks.audit.mockImplementation(async (_id, _key, _action, _input, mutate) => { await mutate({ asset: { count: mocks.count } }); return { ok: true }; });
  expect((await PATCH(request("PATCH", { bucket: "different-1250000000" }))).status).toBe(409);
  expect(mocks.write).not.toHaveBeenCalled();
  expect((await PATCH(request("PATCH", { secretKey: "rotated-secret" }))).status).toBe(200);
});
