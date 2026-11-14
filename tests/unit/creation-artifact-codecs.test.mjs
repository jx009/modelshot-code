import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { readLayoutArtifact, modifyLayoutArtifact } from "../../src/lib/domain/creation/artifacts.js";

vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => { throw new Error("Unexpected storage access"); } }));
vi.mock("../../src/lib/domain/billing/ledger.js", () => ({ lockUser: vi.fn() }));
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

it("reads layout artifacts through the layout codec and rejects other formats and checksum corruption", async () => {
  const poster = ports(layout);
  expect((await readLayoutArtifact("u", "artifact", 1, poster)).content.pages[0].nodes[0].text).toBe("Original");
  const foreign = ports({ schemaVersion: 1, kind: "sheet", title: "Legacy", sheets: [] });
  await expect(readLayoutArtifact("u", "artifact", 1, foreign)).rejects.toThrow("ARTIFACT_FORMAT_UNSUPPORTED");
  poster.blob.checksum = "0".repeat(64);
  await expect(readLayoutArtifact("u", "artifact", 1, poster)).rejects.toThrow("ARTIFACT_INTEGRITY_FAILED");
});

it("uses the immutable blob and revision CAS path for layout edits", async () => {
  const value = ports(layout);
  const saved = await modifyLayoutArtifact("u", "artifact", { baseRevision: 1, saveKey: "save-test-key-123456", operations: [{ op: "setText", pageId: "page", nodeId: "p", text: "Edited" }] }, value);
  expect(saved).toMatchObject({ artifactId: "artifact", revision: 2, baseRevision: 1 });
  expect(value.db.creationArtifact.updateMany.mock.calls[0][0].where).toEqual({ id: "artifact", currentRevision: 1, deletedAt: null });
  expect(value.db.artifactRevision.create.mock.calls[0][0].data).toMatchObject({ blobId: "staged", source: "manual", baseRevision: 1, revision: 2 });
  expect(JSON.parse(value.store.put.mock.calls[0][1].toString()).kind).toBe("poster");
});

it("does not finalize a new blob or create a revision when the CAS loses after upload", async () => {
  const value = ports(layout); value.db.creationArtifact.updateMany.mockResolvedValue({ count: 0 });
  await expect(modifyLayoutArtifact("u", "artifact", { baseRevision: 1, saveKey: "save-test-key-123456", operations: [{ op: "setText", pageId: "page", nodeId: "p", text: "Edited" }] }, value)).rejects.toThrow("ARTIFACT_VERSION_CONFLICT");
  expect(value.store.put).toHaveBeenCalledOnce();
  expect(value.db.creationBlob.updateMany).not.toHaveBeenCalled();
  expect(value.db.artifactRevision.create).not.toHaveBeenCalled();
});
