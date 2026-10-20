import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), audit: vi.fn(), update: vi.fn(), create: vi.fn(), invalidate: vi.fn() }));
vi.mock("../../src/lib/admin-auth", () => ({ requireAdmin: mocks.auth }));
vi.mock("../../src/lib/prisma", () => ({ prisma: {} }));
vi.mock("../../src/lib/domain/identity/admin-operation.js", () => ({ auditedOperation: mocks.audit }));
vi.mock("../../src/lib/ai/runner", () => ({ invalidateProviderConfig: mocks.invalidate, invokeModel: vi.fn() }));
vi.mock("../../src/lib/domain/studio/providers", () => ({ vision: vi.fn(), studioConfig: vi.fn(), generateImage: vi.fn() }));
vi.mock("../../src/lib/domain/studio/cloud", () => ({ segmentCloudImage: vi.fn(), splitCloudImage: vi.fn() }));
vi.mock("../../src/lib/domain/studio/volc-visual", () => ({ entityLabels: vi.fn() }));
vi.mock("../../src/lib/domain/studio/ocr.js", () => ({ recognizeText: vi.fn() }));
vi.mock("../../src/lib/domain/studio/upscale.js", () => ({ upscaleVolcImage: vi.fn() }));
import { PATCH, PUT } from "../../src/app/api/admin/providers/route.js";

beforeEach(() => {
  mocks.auth.mockResolvedValue({ user: { id: "root", role: "root" } });
  const tx = { $queryRaw: vi.fn(), modelProvider: {
    findUnique: vi.fn(async () => ({ id: "model", name: "gateway", kind: "openai", config: JSON.stringify({ model: "gpt-image-2.5-flare", scope: "public", studioCapability: "image", baseURL: "http://152.53.36.159:3000/v1", apiKeyEnc: "existing-encrypted-key" }) })),
    update: mocks.update, create: mocks.create, aggregate: vi.fn(async () => ({ _max: { priority: 1 } })),
  } };
  mocks.create.mockResolvedValue({ id: "new", name: "gateway", kind: "openai", displayName: "Gateway" });
  mocks.audit.mockImplementation(async (_id, _key, _action, _input, mutate) => { const result = await mutate(tx); return { ok: true, ...result.response }; });
});
function request(method, body) {
  return new Request("http://localhost/api/admin/providers", { method, headers: { "Content-Type": "application/json", "Idempotency-Key": "provider-http-fixture-key" }, body: JSON.stringify({ reason: "Configure self-hosted model gateway", ...body }) });
}
it("saves the screenshot's HTTP gateway, preserves its key and normalizes pasted full endpoints", async () => {
  for (const baseURL of ["http://152.53.36.159:3000/v1", " http://152.53.36.159:3000/v1/images/generations "]) {
    const result = await PATCH(request("PATCH", { id: "model", baseURL, creditCost: 3, apiKey: "" }));
    expect(result.status).toBe(200);
    expect(JSON.parse(mocks.update.mock.calls.at(-1)[0].data.config)).toMatchObject({ baseURL: "http://152.53.36.159:3000/v1", apiKeyEnc: "existing-encrypted-key" });
  }
  expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), "root");
  expect(mocks.invalidate).toHaveBeenCalledTimes(2);
});
it("creates HTTP channels and keeps ordinary configuration edits working", async () => {
  expect((await PUT(request("PUT", { kind: "openai", displayName: "Gateway", model: "image-model", baseURL: "http://152.53.36.159:3000/v1" }))).status).toBe(201);
  expect(JSON.parse(mocks.create.mock.calls[0][0].data.config).baseURL).toBe("http://152.53.36.159:3000/v1");
  expect((await PATCH(request("PATCH", { id: "model", creditCost: 5 }))).status).toBe(200);
  expect(JSON.parse(mocks.update.mock.calls[0][0].data.config).baseURL).toBe("http://152.53.36.159:3000/v1");
});
it.each([PATCH, PUT])("rejects invalid URLs and unauthorized edits before writing configuration", async handler => {
  const method = handler === PATCH ? "PATCH" : "PUT";
  const body = handler === PATCH ? { id: "model" } : { kind: "openai", displayName: "Gateway", model: "image-model" };
  const invalid = await handler(request(method, { ...body, baseURL: "https://user:password@gateway/v1" }));
  expect(invalid.status).toBe(400);
  expect((await invalid.json()).code).toBe("PROVIDER_BASE_URL_INVALID");
  expect(mocks.audit).not.toHaveBeenCalled();
  mocks.auth.mockResolvedValue({ response: new Response("Forbidden", { status: 403 }) });
  expect((await handler(request(method, { ...body, baseURL: "http://152.53.36.159:3000/v1" }))).status).toBe(403);
  expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
});
