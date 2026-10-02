import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { briefSchema } from "../../src/lib/commerce/schema.js";
import { AppError } from "../../src/lib/http.js";

const mocks = vi.hoisted(() => ({ find: vi.fn(), findUnique: vi.fn(), jobs: vi.fn(), language: vi.fn(), vision: vi.fn(), save: vi.fn(), image: vi.fn(), asset: vi.fn(), submit: vi.fn(), config: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { studioDocument: { findFirst: mocks.find, findUnique: mocks.findUnique }, tryOn: { findMany: mocks.jobs } } }));
vi.mock("@/lib/require-user", () => ({ requireUser: async () => ({ id: "owner" }) }));
vi.mock("@/lib/domain/identity/rate-limit", () => ({ rateLimit: async () => {} }));
vi.mock("@/lib/domain/assets/service", () => ({ readOwnedImage: mocks.image, ownedAsset: mocks.asset }));
vi.mock("@/lib/domain/studio/providers", () => ({ studioConfig: mocks.config, vision: mocks.vision, capabilities: async () => ({ tools: [{ id: "edit", cost: 7, available: true }] }) }));
vi.mock("@/lib/domain/studio/language", () => ({ languageCall: mocks.language }));
vi.mock("@/lib/domain/studio/documents", () => ({ saveDocument: mocks.save }));
vi.mock("@/lib/domain/studio/jobs", () => ({ submitStudioJob: mocks.submit, presentJob: row => ({ ...row, ...row.snapshot }) }));
const { POST } = await import("../../src/app/api/commerce/plan/route.js");
const { POST: run } = await import("../../src/app/api/commerce/run/route.js");
const brief = briefSchema.parse({ product: "Chair", description: "A blue chair", language: "en", imageCount: 1 });
const key = "commerce-request-key-123456";
const body = () => ({ brief, productAssetId: "product", referenceAssetId: "style", size: "1024x1536", provider: "public-model", message: "Create one image" });
const decision = () => ({ action: "plan", message: "One product image", styleLock: "Neutral backdrop", evidence: ["Blue chair"], questions: [], sections: [{ id: "hero", kind: "hero", title: "A quiet moment", body: "", eyebrow: "", layout: "cover", purpose: "Product recognition", direction: "Blue chair against a neutral backdrop", evidence: "User photo" }] });
const request = (data, path = "plan") => new Request(`http://localhost/api/commerce/${path}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(data) });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue(null); mocks.findUnique.mockResolvedValue(null); mocks.jobs.mockResolvedValue([]);
  mocks.asset.mockImplementation(async (_user, id) => ({ id, width: 300, height: 400 }));
  mocks.image.mockResolvedValue(await sharp({ create: { width: 20, height: 20, channels: 3, background: "blue" } }).png().toBuffer());
  mocks.vision.mockResolvedValue(JSON.stringify(decision()));
  mocks.config.mockResolvedValue({ plannerCreditCost: 2 });
  mocks.language.mockImplementation(async (_u, _p, _i, _k, _c, invoke) => ({ ...await invoke(), languageCost: 2 }));
  mocks.save.mockImplementation(async (_u, data) => ({ ...data, id: data.id || "project", version: (data.version || 0) + 1 }));
  mocks.submit.mockResolvedValue({ id: "job", status: "queued" });
});

it("creates a persisted project from an actual model decision and keeps first request as title", async () => {
  const response = await POST(request(body())), result = await response.json();
  expect(response.status).toBe(200);
  expect(result.document.name).toBe("Create one image");
  expect(result.document.content.commerce.sections).toHaveLength(1);
  expect(result.document.content.layers.map(l => l.assetId)).toEqual(["product", "style"]);
  expect(result.document.content.messages).toHaveLength(2);
  expect(mocks.vision.mock.calls[0][1].imageContext).toContain("original product identity");
  expect(mocks.language).toHaveBeenCalledOnce();
});

it("recovers a lost response by key without invoking or billing the language model again", async () => {
  const result = await (await POST(request(body()))).json();
  mocks.findUnique.mockResolvedValue(result.document); mocks.language.mockClear();
  const replay = await POST(request(body()));
  expect((await replay.json()).replayed).toBe(true);
  expect(mocks.language).not.toHaveBeenCalled();
  expect((await POST(request({ ...body(), message: "Different request" }))).status).toBe(409);
});

it("rejects foreign/missing projects and stale versions before a model call", async () => {
  expect((await POST(request({ ...body(), documentId: "foreign", version: 1 }))).status).toBe(404);
  mocks.find.mockResolvedValue({ id: "project", version: 2, content: { commerce: {} } });
  expect((await POST(request({ ...body(), documentId: "project", version: 1 }))).status).toBe(409);
  expect(mocks.language).not.toHaveBeenCalled();
});

it("rejects hallucinated fixed-count plans inside the billable operation", async () => {
  mocks.vision.mockResolvedValue(JSON.stringify({ ...decision(), sections: [] }));
  const response = await POST(request(body()));
  expect(response.status).toBe(502);
  expect((await response.json()).code).toBe("INVALID_AGENT_PLAN");
  expect(mocks.save).not.toHaveBeenCalled();
});

it("review accepts only a succeeded output belonging to this project and current card version", async () => {
  const { document } = await (await POST(request(body()))).json(); mocks.find.mockResolvedValue(document); mocks.language.mockClear();
  const response = await POST(new Request("http://localhost/api/commerce/plan", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "review-request-key-123456" }, body: JSON.stringify({ ...body(), documentId: document.id, version: 1, reviewJobId: "foreign-job" }) }));
  expect(response.status).toBe(404);
  expect(mocks.language).not.toHaveBeenCalled();
});

it("executes durable jobs with the selected provider, exact size, style and previous result", async () => {
  const { document } = await (await POST(request(body()))).json();
  document.content.commerce.sections[0].revisionAssetId = "previous";
  mocks.find.mockResolvedValue(document); mocks.config.mockClear();
  const response = await run(request({ documentId: document.id, version: 1, sectionIds: ["hero", "hero"] }, "run"));
  expect(response.status).toBe(202);
  expect(mocks.config).toHaveBeenCalledWith(undefined, "public-model", "image", "edit");
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(mocks.submit.mock.calls[0][1]).toMatchObject({ provider: "public-model", assetId: "product", referenceAssetIds: ["style", "previous"], params: { size: "1024x1536" } });
});

it("reports partial admission without hiding accepted jobs", async () => {
  const { document } = await (await POST(request(body()))).json();
  document.content.commerce.sections.push({ ...document.content.commerce.sections[0], id: "second" });
  mocks.find.mockResolvedValue(document);
  mocks.submit.mockResolvedValueOnce({ id: "first-job" }).mockRejectedValueOnce(new AppError("INSUFFICIENT_CREDITS"));
  const result = await (await run(request({ documentId: document.id, version: 1, sectionIds: ["hero", "second"] }, "run"))).json();
  expect(result).toEqual({ jobs: [{ id: "first-job" }], failure: "INSUFFICIENT_CREDITS" });
});
