import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST as create } from "../../src/app/api/creation/document-artifacts/route.js";
import { GET as read, PATCH as save } from "../../src/app/api/creation/artifacts/[id]/document/route.js";
import { POST as copy } from "../../src/app/api/creation/artifacts/[id]/document/copy/route.js";
import { POST as restore } from "../../src/app/api/creation/artifacts/[id]/document/restore/route.js";

const mock = vi.hoisted(() => ({ project: vi.fn(), create: vi.fn(), read: vi.fn(), save: vi.fn(), copy: vi.fn(), restore: vi.fn() }));
vi.mock("../../src/lib/require-user", () => ({ requireUser: async () => ({ id: "user" }) }));
vi.mock("../../src/lib/domain/identity/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { creationProject: { findFirst: (...args) => mock.project(...args) } } }));
vi.mock("../../src/lib/domain/creation/document-artifacts", () => ({ createDocumentArtifact: (...args) => mock.create(...args), readDocumentArtifact: (...args) => mock.read(...args), modifyDocumentArtifact: (...args) => mock.save(...args), copyDocumentArtifact: (...args) => mock.copy(...args), restoreDocumentArtifact: (...args) => mock.restore(...args) }));
const context = { params: Promise.resolve({ id: "doc" }) };
const content = { schemaVersion: 1, kind: "document", title: "Document", sections: [{ id: "s", title: "Summary", blocks: [{ id: "p", type: "paragraph", runs: [{ text: "Hello" }] }] }] };
const request = (body, method = "POST", headers = {}) => new Request("https://example.test/api/creation/document-artifacts", { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.stubEnv("CREATION_WORKSPACE_ENABLED", "true"); vi.stubEnv("CREATION_DOCUMENT_ENABLED", "true");
  for (const fn of Object.values(mock)) fn.mockReset().mockResolvedValue({ artifactId: "doc", revision: 1 });
});
afterEach(() => vi.unstubAllEnvs());

it("validates and normalizes create content before dispatch, and keeps creation gated independently of recovery", async () => {
  const body = { projectId: "project", saveKey: "create-document-key-123", content };
  const response = await create(request(body));
  expect(response.status).toBe(200);
  expect(mock.create.mock.calls[0][0]).toBe("user");
  expect(mock.create.mock.calls[0][2].page.size).toBe("A4");
  expect(mock.project.mock.calls[0][0].where).toEqual({ id: "project", userId: "user", kind: "document", deletedAt: null });
  vi.stubEnv("CREATION_DOCUMENT_ENABLED", "false");
  expect((await create(request(body))).status).toBe(503);
  expect(mock.create).toHaveBeenCalledOnce();
  expect((await restore(request({ baseRevision: 2, restoreRevision: 1, saveKey: "restore-document-key-123" }), context)).status).toBe(200);
  expect(mock.restore).toHaveBeenCalledOnce();
});

it("passes the exact saved version through async route params and blocks oversized operation batches", async () => {
  const response = await read(new Request("https://example.test/api/creation/artifacts/doc/document?revision=3"), context);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mock.read).toHaveBeenCalledWith("user", "doc", 3);
  const body = { baseRevision: 3, saveKey: "save-document-key-123", operations: [{ op: "setDocumentTitle", title: "Edited" }] };
  expect((await save(request(body, "PATCH"), context)).status).toBe(200);
  expect(mock.save).toHaveBeenCalledWith("user", "doc", body);
  const oversized = { ...body, operations: Array.from({ length: 100 }, () => ({ op: "replaceDocumentText", sectionId: "s", blockId: "p", leafId: "p", start: 0, end: 0, expectedText: "", text: "a".repeat(4000) })) };
  expect((await save(request(oversized, "PATCH"), context)).status).toBe(413);
  expect(mock.save).toHaveBeenCalledOnce();
});

it("rejects cross-origin writes, unknown fields and invalid save keys before mutations", async () => {
  const body = { baseRevision: 1, saveKey: "save-document-key-123", operations: [{ op: "setDocumentTitle", title: "Edited" }] };
  expect((await save(request(body, "PATCH", { "sec-fetch-site": "cross-site" }), context)).status).toBe(403);
  expect((await save(request({ ...body, extra: "field" }, "PATCH"), context)).status).toBe(400);
  expect((await save(request({ ...body, saveKey: "short" }, "PATCH"), context)).status).toBe(400);
  expect(mock.save).not.toHaveBeenCalled();
});

it("copies a validated complete document and rejects a poster sent through the document endpoint", async () => {
  const body = { saveKey: "copy-document-key-123", content };
  expect((await copy(request(body), context)).status).toBe(200);
  expect(mock.copy.mock.calls[0][2].content.kind).toBe("document");
  expect((await copy(request({ ...body, content: { ...content, kind: "poster" } }), context)).status).toBe(400);
  expect(mock.copy).toHaveBeenCalledOnce();
});
