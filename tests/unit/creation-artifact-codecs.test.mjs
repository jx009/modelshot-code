import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { readLayoutArtifact, modifyLayoutArtifact } from "../../src/lib/domain/creation/artifacts.js";
import { readDocumentArtifact, modifyDocumentArtifact, createDocumentArtifact } from "../../src/lib/domain/creation/document-artifacts.js";
import { readSheetArtifact, modifySheetArtifact } from "../../src/lib/domain/creation/sheet-artifacts.js";
import { readWebArtifact, modifyWebArtifact } from "../../src/lib/domain/creation/web-artifacts.js";

vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => { throw new Error("Unexpected storage access"); } }));
vi.mock("../../src/lib/domain/billing/ledger.js", () => ({ lockUser: vi.fn() }));
const document = { schemaVersion: 1, kind: "document", title: "Report", sections: [{ id: "section", title: "Summary", blocks: [{ id: "p", type: "paragraph", runs: [{ text: "Original" }] }] }] };
const workbook = { schemaVersion: 1, kind: "sheet", title: "Budget", sheets: [{ id: "s", name: "Costs", cells: [{ id: "a", address: "A1", value: 10 }] }] };
const site = { schemaVersion: 1, kind: "web", title: "Coffee", theme: { primary: "#111111", accent: "#ee5500", background: "#ffffff", fontFamily: "sans" }, entryPath: "index.html", files: [{ id: "html", path: "index.html", kind: "html", content: "<h1>Coffee</h1>" }] };
const layout = { schemaVersion: 1, kind: "poster", title: "Poster", theme: { name: "Test", primary: "#112233", accent: "#ffee00", background: "#ffffff", fontFamily: "sans" }, pages: [{ id: "page", title: "Poster", width: 100, height: 100, nodes: [{ id: "p", name: "Text", type: "text", text: "Original", style: {}, x: 0, y: 0, width: 100, height: 100 }] }] };

// Storage/query ports are fakes. These tests verify codec integration and fail-
// closed behavior, not PostgreSQL transaction isolation or actual permissions.
function ports(content) {
  const bytes = Buffer.from(JSON.stringify(content));
  const blob = { id: "source", userId: "u", state: "ready", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex"), objectKey: "source.json" };
  const artifact = { id: "artifact", projectId: "project", currentRevision: 1, kind: content.kind, name: content.title };
  const db = {
    creationArtifact: { findFirst: vi.fn(async () => artifact), findUnique: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 1 })) },
    artifactRevision: { findUnique: vi.fn(async args => args.where.artifactId_revision ? { revision: 1, blob } : null), create: vi.fn(async ({ data }) => ({ id: "revision2", ...data })) },
    creationBlob: { create: vi.fn(async ({ data }) => ({ id: "staged", ...data })), updateMany: vi.fn(async () => ({ count: 1 })) },
    creationProject: { findFirst: vi.fn(async () => ({ id: "project" })), update: vi.fn() },
    asset: { count: vi.fn(async () => 0) }, assetReference: { createMany: vi.fn() },
  };
  db.$transaction = async fn => fn(db);
  const store = { get: vi.fn(async () => bytes), put: vi.fn() };
  return { db, store, blob, artifact };
}

it("reads each format through its own codec and rejects cross-format reads and checksum corruption", async () => {
  const doc = ports(document), poster = ports(layout);
  expect((await readDocumentArtifact("u", "artifact", 1, doc)).content.page.size).toBe("A4");
  expect((await readLayoutArtifact("u", "artifact", 1, poster)).content.pages[0].nodes[0].text).toBe("Original");
  await expect(readLayoutArtifact("u", "artifact", 1, doc)).rejects.toThrow("ARTIFACT_FORMAT_UNSUPPORTED");
  await expect(readDocumentArtifact("u", "artifact", 1, poster)).rejects.toThrow("ARTIFACT_FORMAT_UNSUPPORTED");
  const sheet = ports(workbook);
  expect((await readSheetArtifact("u", "artifact", 1, sheet)).content.sheets[0].cells[0].value).toBe(10);
  await expect(readLayoutArtifact("u", "artifact", 1, sheet)).rejects.toThrow("ARTIFACT_FORMAT_UNSUPPORTED");
  await expect(readSheetArtifact("u", "artifact", 1, doc)).rejects.toThrow("ARTIFACT_FORMAT_UNSUPPORTED");
  const web = ports(site);
  expect((await readWebArtifact("u", "artifact", 1, web)).content.files[0].content).toBe("<h1>Coffee</h1>");
  await expect(readLayoutArtifact("u", "artifact", 1, web)).rejects.toThrow("ARTIFACT_FORMAT_UNSUPPORTED");
  await expect(readWebArtifact("u", "artifact", 1, sheet)).rejects.toThrow("ARTIFACT_FORMAT_UNSUPPORTED");
  doc.blob.checksum = "0".repeat(64);
  await expect(readDocumentArtifact("u", "artifact", 1, doc)).rejects.toThrow("ARTIFACT_INTEGRITY_FAILED");
});

it("retains user/project ownership predicates and never reads blobs when the metadata or blob owner differs", async () => {
  const value = ports(document);
  value.db.creationArtifact.findFirst.mockResolvedValueOnce(null);
  await expect(readDocumentArtifact("other", "artifact", 1, value)).rejects.toThrow("ARTIFACT_NOT_FOUND");
  expect(value.store.get).not.toHaveBeenCalled();
  expect(value.db.creationArtifact.findFirst.mock.calls[0][0].where.project).toEqual({ userId: "other", deletedAt: null });
  await expect(readDocumentArtifact("other", "artifact", 1, value)).rejects.toThrow("ARTIFACT_REVISION_NOT_FOUND");
  expect(value.store.get).not.toHaveBeenCalled();
});

it("uses the shared immutable blob and revision CAS path for document and layout edits", async () => {
  const cases = [
    { content: site, modify: modifyWebArtifact, op: { op: "setFile", fileId: "html", path: "index.html", kind: "html", content: "<h1>Updated</h1>" } },
    { content: workbook, modify: modifySheetArtifact, op: { op: "setCell", sheetId: "s", address: "A1", id: "a", value: 20 } },
    { content: document, modify: modifyDocumentArtifact, op: { op: "replaceDocumentText", sectionId: "section", blockId: "p", leafId: "p", start: 0, end: 8, expectedText: "Original", text: "Edited" } },
    { content: layout, modify: modifyLayoutArtifact, op: { op: "setText", pageId: "page", nodeId: "p", text: "Edited" } },
  ];
  for (const item of cases) {
    const value = ports(item.content);
    const saved = await item.modify("u", "artifact", { baseRevision: 1, saveKey: "save-test-key-123456", operations: [item.op] }, value);
    expect(saved).toMatchObject({ artifactId: "artifact", revision: 2, baseRevision: 1 });
    expect(value.db.creationArtifact.updateMany.mock.calls[0][0].where).toEqual({ id: "artifact", currentRevision: 1, deletedAt: null });
    expect(value.db.artifactRevision.create.mock.calls[0][0].data).toMatchObject({ blobId: "staged", source: "manual", baseRevision: 1, revision: 2 });
    expect(JSON.parse(value.store.put.mock.calls[0][1].toString()).kind).toBe(item.content.kind);
  }
});

it("rejects stale saves before upload and prevents AI lock changes before reading an artifact", async () => {
  const value = ports(document);
  const request = { baseRevision: 2, saveKey: "save-test-key-123456", operations: [{ op: "setDocumentTitle", title: "New" }] };
  await expect(modifyDocumentArtifact("u", "artifact", request, value)).rejects.toThrow("ARTIFACT_VERSION_CONFLICT");
  expect(value.store.put).not.toHaveBeenCalled();
  value.db.creationArtifact.findFirst.mockClear();
  await expect(modifyDocumentArtifact("u", "artifact", { ...request, baseRevision: 1, operations: [{ op: "setDocumentLock", sectionId: "section", blockId: "p", locked: false }] }, { ...value, sourceRunId: "run" })).rejects.toThrow("AI_CANNOT_CHANGE_LOCK");
  expect(value.db.creationArtifact.findFirst).not.toHaveBeenCalled();
  const web = ports(site);
  await expect(modifyWebArtifact("u", "artifact", { baseRevision: 1, saveKey: request.saveKey, operations: [{ op: "setFile", fileId: "html", path: "index.html", kind: "js", content: "alert(1)" }] }, { ...web, sourceRunId: "run" })).rejects.toThrow("WEB_AGENT_JS_EDIT_DISABLED");
  await expect(modifyWebArtifact("u", "artifact", { baseRevision: 1, saveKey: request.saveKey, operations: [{ op: "renameFile", fileId: "html", path: "index.html", nextPath: "other.html" }] }, { ...web, sourceRunId: "run" })).rejects.toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
  expect(web.db.creationArtifact.findFirst).not.toHaveBeenCalled();
});
it("checks ownership for manual web asset-registry changes and keeps AI limited to file text edits", async () => {
  const value = ports(site), request = { baseRevision: 1, saveKey: "web-assets-save-123456", operations: [{ op: "setAssetIds", assetIds: ["foreign-asset"] }] };
  await expect(modifyWebArtifact("u", "artifact", request, value)).rejects.toThrow("ASSET_NOT_FOUND");
  expect(value.store.put).not.toHaveBeenCalled();
  expect(value.db.asset.count.mock.calls[0][0].where).toMatchObject({ userId: "u", status: "active", id: { in: ["foreign-asset"] } });
  await expect(modifyWebArtifact("u", "artifact", request, { ...value, sourceRunId: "run" })).rejects.toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
});
it("commits a file rename and all reference updates in one revision and rejects stale linked targets before upload", async () => {
  const content = { ...site, files: [...site.files, { id: "other", path: "other.html", kind: "html", content: '<a href="index.html">Home</a>' }] };
  const request = { baseRevision: 1, saveKey: "web-rename-save-123456", operations: [{ op: "renameFile", fileId: "html", path: "index.html", nextPath: "home.html", updates: [{ fileId: "other", path: "other.html", kind: "html", content: '<a href="home.html">Home</a>' }] }] };
  const value = ports(content);
  await modifyWebArtifact("u", "artifact", request, value);
  expect(value.store.put).toHaveBeenCalledOnce(); expect(value.db.artifactRevision.create).toHaveBeenCalledOnce();
  const persisted = JSON.parse(value.store.put.mock.calls[0][1].toString());
  expect(persisted.entryPath).toBe("home.html"); expect(persisted.files[0].path).toBe("home.html"); expect(persisted.files[1].content).toContain('href="home.html"');
  const stale = ports(content), broken = structuredClone(request); broken.operations[0].updates[0].path = "outdated.html";
  await expect(modifyWebArtifact("u", "artifact", broken, stale)).rejects.toThrow("WEB_FILE_NOT_FOUND");
  expect(stale.store.put).not.toHaveBeenCalled(); expect(stale.db.artifactRevision.create).not.toHaveBeenCalled();
  await expect(modifyWebArtifact("u", "artifact", request, { ...stale, sourceRunId: "run" })).rejects.toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
});
it("checks active image ownership before replacing a web resource and retains historical content in its old snapshot", async () => {
  const content = { ...site, assetIds: ["original-image-12345"], files: [...site.files, { id: "image", kind: "asset", path: "hero.webp", assetId: "original-image-12345" }] };
  const request = { baseRevision: 1, saveKey: "web-image-save-123456", operations: [{ op: "replaceAsset", fileId: "image", path: "hero.webp", expectedAssetId: "original-image-12345", assetId: "new-image-1234567" }] };
  const value = ports(content);
  await expect(modifyWebArtifact("u", "artifact", request, value)).rejects.toThrow("ASSET_NOT_FOUND"); expect(value.store.put).not.toHaveBeenCalled();
  value.db.asset.count.mockResolvedValue(1);
  await modifyWebArtifact("u", "artifact", request, value);
  expect(value.db.asset.count.mock.lastCall[0].where).toMatchObject({ userId: "u", status: "active", id: { in: ["new-image-1234567"] } });
  expect(JSON.parse(value.store.put.mock.lastCall[1].toString()).files[1].assetId).toBe("new-image-1234567");
  expect(content.files[1].assetId).toBe("original-image-12345");
  await expect(modifyWebArtifact("u", "artifact", request, { ...value, sourceRunId: "run" })).rejects.toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
});

it("does not finalize a new blob or create a revision when the CAS loses after upload", async () => {
  const value = ports(document); value.db.creationArtifact.updateMany.mockResolvedValue({ count: 0 });
  await expect(modifyDocumentArtifact("u", "artifact", { baseRevision: 1, saveKey: "save-test-key-123456", operations: [{ op: "setDocumentTitle", title: "New" }] }, value)).rejects.toThrow("ARTIFACT_VERSION_CONFLICT");
  expect(value.store.put).toHaveBeenCalledOnce();
  expect(value.db.creationBlob.updateMany).not.toHaveBeenCalled();
  expect(value.db.artifactRevision.create).not.toHaveBeenCalled();
});

it("only creates documents in document projects and checks that restriction before staging content", async () => {
  const value = ports(document); value.db.creationProject.findFirst.mockResolvedValue(null);
  await expect(createDocumentArtifact("u", "project", document, "create-test-key-123456", value)).rejects.toThrow("CREATION_PROJECT_NOT_FOUND");
  expect(value.db.creationProject.findFirst.mock.calls[0][0].where).toEqual({ id: "project", userId: "u", deletedAt: null, kind: "document" });
  expect(value.store.put).not.toHaveBeenCalled();
});
