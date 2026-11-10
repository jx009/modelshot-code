import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createNativeOfficeArtifact, readNativeOfficeArtifact, saveNativeOfficeArtifact, restoreNativeOfficeArtifact, copyNativeOfficeArtifact, modifyNativeSheetArtifact, modifyNativeDocumentArtifact } from "../../src/lib/domain/creation/native-office-artifacts.js";
import { readSheetArtifact, modifySheetArtifact } from "../../src/lib/domain/creation/sheet-artifacts.js";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";
import { toNativeDocumentArtifact } from "../../src/lib/creation/native-document-adapter.js";

vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => { throw new Error("Real storage forbidden"); } }));
vi.mock("../../src/lib/domain/billing/ledger.js", () => ({ lockUser: vi.fn() }));
const initial = () => toNativeSheetArtifact({ schemaVersion: 1, kind: "sheet", title: "Budget", sheets: [{ id: "a", name: "Costs", cells: [{ id: "v", address: "A1", value: 10 }] }] }, "native-book");
function fixture(content = initial()) {
  const objects = new Map(), blobs = new Map(), revisions = new Map(), keys = new Map();
  const first = Buffer.from(JSON.stringify(content)), checksum = createHash("sha256").update(first).digest("hex");
  objects.set("first", first); blobs.set("first", { id: "first", userId: "u", bytes: first.length, objectKey: "first", checksum, state: "ready" });
  revisions.set(1, { id: "revision1", revision: 1, blobId: "first" });
  const artifact = { id: "artifact", projectId: "project", kind: content.kind, name: content.title, currentRevision: 1, schemaVersion: content.schemaVersion };
  const db = {
    creationArtifact: {
      findFirst: vi.fn(async ({ where }) => where.project.userId === "u" ? artifact : null), findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }) => ({ id: "copy", ...data })),
      updateMany: vi.fn(async ({ where, data }) => { if (artifact.currentRevision !== where.currentRevision) return { count: 0 }; Object.assign(artifact, { name: data.name, schemaVersion: data.schemaVersion, currentRevision: artifact.currentRevision + 1 }); return { count: 1 }; }),
    },
    creationProject: { findFirst: vi.fn(async () => ({ id: "project" })), update: vi.fn() },
    artifactRevision: {
      findUnique: vi.fn(async ({ where }) => { if (where.artifactId_saveKey) return keys.get(where.artifactId_saveKey.saveKey) || null; const row = revisions.get(where.artifactId_revision.revision); return row ? { ...row, blob: blobs.get(row.blobId) } : null; }),
      create: vi.fn(async ({ data }) => { const row = { id: `revision${data.revision}`, ...data }; revisions.set(data.revision, row); keys.set(data.saveKey, row); return row; }),
    },
    creationBlob: {
      create: vi.fn(async ({ data }) => { const blob = { id: `blob${blobs.size}`, state: "staging", ...data }; blobs.set(blob.id, blob); return blob; }),
      updateMany: vi.fn(async ({ where, data }) => { const blob = blobs.get(where.id); if (!blob || blob.state !== where.state) return { count: 0 }; Object.assign(blob, data); return { count: 1 }; }),
    },
    asset: { count: vi.fn(async () => 0) }, assetReference: { createMany: vi.fn() },
  };
  db.$transaction = async fn => fn(db);
  const store = { get: vi.fn(async key => objects.get(key)), put: vi.fn(async (key, bytes) => objects.set(key, bytes)) };
  return { db, store, objects, blobs, artifact, revisions, keys };
}
const request = (content = initial()) => ({ baseRevision: 1, saveKey: "native-save-key-123456", content });

it("saves native document operations with styles and metadata intact and replays the confirmed write", async () => {
  const content = toNativeDocumentArtifact({ schemaVersion: 1, kind: "document", title: "Report", sections: [{ id: "s", title: "Section", blocks: [{ id: "p", type: "paragraph", runs: [{ text: "Original", marks: { bold: true } }] }] }] }, "unit");
  const value = fixture(content), input = { baseRevision: 1, saveKey: "native-doc-edit-key-123", operations: [{ op: "replaceNativeText", segmentId: "", start: 0, end: 8, expectedText: "Original", text: "Updated😀" }] };
  const options = { ...value, sourceRunId: "run" };
  expect(await modifyNativeDocumentArtifact("u", "artifact", input, options)).toMatchObject({ revision: 2, replayed: false });
  const saved = await readNativeOfficeArtifact("u", "artifact", "document", 2, value);
  expect(saved.content.snapshot.body.dataStream).toBe("Updated😀\r\n");
  expect(saved.content.snapshot.body.textRuns[0]).toMatchObject({ st: 0, ed: 9, ts: { bl: 1 } });
  expect(saved.content.snapshot.custom).toEqual(content.snapshot.custom);
  expect(await modifyNativeDocumentArtifact("u", "artifact", input, options)).toMatchObject({ revision: 2, replayed: true });
  expect(value.store.put).toHaveBeenCalledOnce();
  await expect(saveNativeOfficeArtifact("u", "artifact", { ...request(content), baseRevision: 2 }, options)).rejects.toThrow("ARTIFACT_REPLACEMENT_UNSUPPORTED");
});

it("publishes controlled native AI operations with CAS, source attribution and replay without whole-snapshot replacement", async () => {
  const value = fixture(), hooks = { beforeCommit: vi.fn(), afterCommit: vi.fn() };
  const input = { baseRevision: 1, saveKey: "native-ai-edit-123456", operations: [{ op: "setNativeCell", sheetId: "sheet0", row: 0, column: 0, value: 42 }] };
  const options = { ...value, sourceRunId: "run", hooks };
  expect(await modifyNativeSheetArtifact("u", "artifact", input, options)).toMatchObject({ revision: 2, replayed: false });
  expect(hooks.beforeCommit).toHaveBeenCalledOnce(); expect(hooks.afterCommit).toHaveBeenCalledOnce();
  expect(value.revisions.get(2)).toMatchObject({ source: "agent", sourceRunId: "run" });
  expect((await readNativeOfficeArtifact("u", "artifact", "sheet", 2, value)).content.snapshot.sheets.sheet0.cellData[0][0].v).toBe(42);
  expect(await modifyNativeSheetArtifact("u", "artifact", input, options)).toMatchObject({ revision: 2, replayed: true });
  expect(value.store.put).toHaveBeenCalledOnce(); expect(hooks.afterCommit).toHaveBeenCalledOnce();
  await expect(modifyNativeSheetArtifact("u", "artifact", { ...input, saveKey: "native-other-key-1234" }, options)).rejects.toThrow("ARTIFACT_VERSION_CONFLICT");
});

it("checks new-copy admission before upload but permits confirmed-create replay after admission closes", async () => {
  const value = fixture(), content = initial(), key = "native-copy-key-123456", beforeStage = vi.fn(() => { throw new Error("ADMISSION_CLOSED"); });
  await expect(createNativeOfficeArtifact("u", "project", content, key, { ...value, hooks: { beforeStage } })).rejects.toThrow("ADMISSION_CLOSED");
  expect(value.store.put).not.toHaveBeenCalled(); expect(value.db.creationBlob.create).not.toHaveBeenCalled();
  const created = await createNativeOfficeArtifact("u", "project", content, key, value);
  value.db.creationArtifact.findUnique.mockResolvedValue({ id: created.artifactId });
  expect(await createNativeOfficeArtifact("u", "project", content, key, { ...value, hooks: { beforeStage } })).toMatchObject({ replayed: true });
  expect(beforeStage).toHaveBeenCalledOnce(); expect(value.store.put).toHaveBeenCalledOnce();
});

it("stores one full native revision, reads unknown metadata unchanged and replays a lost response without another upload", async () => {
  const value = fixture(), input = request();
  input.content.snapshot.sheets.sheet0.mergeData.push({ startRow: 2, endRow: 3, startColumn: 0, endColumn: 1 });
  input.content.snapshot.resources.push({ name: "plugin-example", data: '{"color":"red","opaque":[1,2]}' });
  input.content.snapshot.sheets.sheet0.cellData[0][0].v = 30;
  expect(await saveNativeOfficeArtifact("u", "artifact", input, value)).toMatchObject({ revision: 2, replayed: false });
  const read = await readNativeOfficeArtifact("u", "artifact", "sheet", undefined, value);
  expect(read.content).toEqual(input.content); expect(read.schemaVersion).toBe(2);
  expect((await readNativeOfficeArtifact("u", "artifact", "sheet", 1, value)).content.snapshot.sheets.sheet0.cellData[0][0].v).toBe(10);
  expect(await saveNativeOfficeArtifact("u", "artifact", input, value)).toMatchObject({ revision: 2, replayed: true });
  expect(value.store.put).toHaveBeenCalledOnce();
  const changed = structuredClone(input); changed.content.snapshot.sheets.sheet0.cellData[0][0].v = 31;
  await expect(saveNativeOfficeArtifact("u", "artifact", changed, value)).rejects.toThrow("SAVE_KEY_REUSED");
  expect(value.store.put).toHaveBeenCalledOnce();
});

it("rejects stale/foreign saves, unit-ID changes, wrong codec and whole-snapshot AI writes before upload", async () => {
  const value = fixture(), input = request();
  await expect(saveNativeOfficeArtifact("other", "artifact", input, value)).rejects.toThrow("ARTIFACT_NOT_FOUND");
  await expect(saveNativeOfficeArtifact("u", "artifact", { ...input, baseRevision: 2 }, value)).rejects.toThrow("ARTIFACT_VERSION_CONFLICT");
  const changed = structuredClone(input); changed.content.snapshot.id = "new-unit";
  await expect(saveNativeOfficeArtifact("u", "artifact", changed, value)).rejects.toThrow("NATIVE_OFFICE_ID_CHANGED");
  await expect(saveNativeOfficeArtifact("u", "artifact", input, { ...value, sourceRunId: "ai-run" })).rejects.toThrow("ARTIFACT_REPLACEMENT_UNSUPPORTED");
  await expect(readNativeOfficeArtifact("u", "artifact", "document", 1, value)).rejects.toThrow("ARTIFACT_FORMAT_UNSUPPORTED");
  await expect(readSheetArtifact("u", "artifact", 1, value)).rejects.toThrow("ARTIFACT_FORMAT_UNSUPPORTED");
  await expect(modifySheetArtifact("u", "artifact", { baseRevision: 1, saveKey: input.saveKey, operations: [{ op: "renameSheet", sheetId: "sheet0", name: "Changed" }] }, value)).rejects.toThrow("ARTIFACT_FORMAT_UNSUPPORTED");
  expect(value.store.put).not.toHaveBeenCalled();
});

it("checks every declared private image twice and pins references only to the committed revision", async () => {
  const value = fixture(), input = request(); input.content.assetIds = ["image1"];
  await expect(saveNativeOfficeArtifact("u", "artifact", input, value)).rejects.toThrow("ASSET_NOT_FOUND");
  expect(value.store.put).not.toHaveBeenCalled();
  value.db.asset.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
  await expect(saveNativeOfficeArtifact("u", "artifact", input, value)).rejects.toThrow("ASSET_NOT_FOUND");
  expect(value.db.creationBlob.updateMany).not.toHaveBeenCalled();
  expect(value.db.assetReference.createMany).not.toHaveBeenCalled();
  value.db.asset.count.mockResolvedValue(1);
  await saveNativeOfficeArtifact("u", "artifact", input, value);
  expect(value.db.asset.count.mock.lastCall[0].where).toMatchObject({ userId: "u", status: "active", id: { in: ["image1"] } });
  expect(value.db.assetReference.createMany.mock.lastCall[0].data).toEqual([{ assetId: "image1", entityId: "revision2", kind: "creation_revision" }]);
});

it("keeps a staged blob uncommitted when the revision changes during upload", async () => {
  const value = fixture(); value.db.creationArtifact.updateMany.mockResolvedValue({ count: 0 });
  await expect(saveNativeOfficeArtifact("u", "artifact", request(), value)).rejects.toThrow("ARTIFACT_VERSION_CONFLICT");
  expect(value.store.put).toHaveBeenCalledOnce();
  expect(value.db.creationBlob.updateMany).not.toHaveBeenCalled();
  expect(value.db.artifactRevision.create).not.toHaveBeenCalled();
});

it("restores a native revision as a new version and records schemaVersion on new copies", async () => {
  const value = fixture(), input = request(); input.content.snapshot.sheets.sheet0.cellData[0][0].v = 99;
  await saveNativeOfficeArtifact("u", "artifact", input, value);
  await restoreNativeOfficeArtifact("u", "artifact", "sheet", { baseRevision: 2, restoreRevision: 1, saveKey: "native-restore-key-123" }, value);
  expect(value.artifact.currentRevision).toBe(3);
  expect((await readNativeOfficeArtifact("u", "artifact", "sheet", 3, value)).content.snapshot.sheets.sheet0.cellData[0][0].v).toBe(10);
  const copy = fixture(); await copyNativeOfficeArtifact("u", "artifact", { saveKey: "native-copy-key-12345", content: input.content }, copy);
  expect(copy.db.creationArtifact.create.mock.calls[0][0].data).toMatchObject({ kind: "sheet", schemaVersion: 2 });
  expect(copy.db.creationProject.findFirst.mock.calls[0][0].where).toMatchObject({ userId: "u", deletedAt: null });
});

it("rejects legacy snapshots in the native service, checksum corruption and unavailable projects", async () => {
  const legacy = { schemaVersion: 1, kind: "sheet", title: "Old", sheets: [{ id: "s", name: "Old", cells: [] }] };
  await expect(readNativeOfficeArtifact("u", "artifact", "sheet", 1, fixture(legacy))).rejects.toThrow("ARTIFACT_FORMAT_UNSUPPORTED");
  const corrupt = fixture(); corrupt.blobs.get("first").checksum = "0".repeat(64);
  await expect(readNativeOfficeArtifact("u", "artifact", "sheet", 1, corrupt)).rejects.toThrow("ARTIFACT_INTEGRITY_FAILED");
  const value = fixture(); value.db.creationProject.findFirst.mockResolvedValue(null);
  await expect(createNativeOfficeArtifact("u", "project", initial(), "native-create-key-123", value)).rejects.toThrow("CREATION_PROJECT_NOT_FOUND");
  expect(value.store.put).not.toHaveBeenCalled();
});
