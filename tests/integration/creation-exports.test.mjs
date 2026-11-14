import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { createProject } from "../../src/lib/domain/creation/projects.js";
import { createLayoutArtifact, modifyLayoutArtifact, cleanupStagedBlobs } from "../../src/lib/domain/creation/artifacts.js";
import { requestArtifactExport, ownedExport, cancelArtifactExport } from "../../src/lib/domain/creation/exports.js";
import { executeArtifactExport, recoverArtifactExports } from "../../src/lib/domain/creation/export-execution.js";
import { EXPORTER_VERSION, exportFormat } from "../../src/lib/creation/contracts/exports.js";
import { AppError } from "../../src/lib/http.js";

let fixture;
const users = [], blobs = new Map();
const store = { put: async (key, bytes) => blobs.set(key, Buffer.from(bytes)), get: async key => Buffer.from(blobs.get(key)), delete: async key => blobs.delete(key),
  stream: async key => new Blob([blobs.get(key)]).stream(),
};
const output = name => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(name)]);
const options = () => ({ db: fixture.db, store, env: { CREATION_PPTX_EXPORT_ENABLED: "true" } });
const request = { revision: 1, format: "pptx" };
async function setup(kind = "slides") {
  const user = await fixture.user(); users.push(user.id);
  const project = await createProject(user.id, { createKey: randomUUID(), name: "Deck", kind }, fixture.db);
  const content = { schemaVersion: 1, kind, title: "Deck", theme: { name: "Day", primary: "#202124", accent: "#ff8800", background: "#ffffff", fontFamily: "sans" }, pages: [
    { id: "page", title: "Slide", width: 1280, height: 720, nodes: [{ id: "title", name: "Title", type: "text", text: "Original", style: {}, x: 0, y: 0, width: 800, height: 100 }] },
  ] };
  const created = await createLayoutArtifact(user.id, project.id, content, randomUUID(), options());
  await fixture.db.serviceHeartbeat.upsert({ where: { id: "creation-export-worker" }, create: { id: "creation-export-worker", details: { exporterVersion: EXPORTER_VERSION } }, update: { updatedAt: new Date(), details: { exporterVersion: EXPORTER_VERSION } } });
  return { user, project, artifactId: created.artifactId };
}
beforeAll(async () => { fixture = await domainFixture(); });
afterAll(async () => {
  if (!fixture) return;
  const exports = await fixture.db.artifactExport.findMany({ where: { userId: { in: users } }, select: { id: true } });
  await fixture.db.outboxEvent.deleteMany({ where: { entityId: { in: exports.map(item => item.id) } } });
  await fixture.db.artifactExport.deleteMany({ where: { userId: { in: users } } });
  await fixture.db.creationProject.deleteMany({ where: { userId: { in: users } } });
  await fixture.db.creationBlob.deleteMany({ where: { userId: { in: users } } });
  await fixture.cleanup();
});

it("requires the poster flag and matching raster capability, separates PNG/JPEG jobs, and rejects a mislabeled renderer result", async () => {
  const { user, artifactId } = await setup("poster");
  const pngRequest = { revision: 1, format: "png" };
  await expect(requestArtifactExport(user.id, artifactId, request, options())).rejects.toThrow("EXPORT_KIND_UNSUPPORTED");
  await expect(requestArtifactExport(user.id, artifactId, pngRequest, options())).rejects.toThrow("EXPORT_NOT_ENABLED");
  const enabled = { ...options(), env: { CREATION_POSTER_EXPORT_ENABLED: "true" } };
  await expect(requestArtifactExport(user.id, artifactId, pngRequest, enabled)).rejects.toThrow("EXPORT_WORKER_UNAVAILABLE");
  await fixture.db.serviceHeartbeat.update({ where: { id: "creation-export-worker" }, data: { details: { exporters: { png: exportFormat("png").version, jpeg: exportFormat("jpeg").version } } } });
  const png = await requestArtifactExport(user.id, artifactId, pngRequest, enabled);
  const jpeg = await requestArtifactExport(user.id, artifactId, { ...pngRequest, format: "jpeg" }, enabled);
  expect(png.id).not.toBe(jpeg.id);
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
  await executeArtifactExport(png.id, { ...options(), render: async (_document, _assets, settings) => { expect(settings.format).toBe("png"); return pngBytes; } });
  const completed = await ownedExport(user.id, png.id, fixture.db);
  expect(completed.status).toBe("succeeded");
  const blob = await fixture.db.creationBlob.findUnique({ where: { id: completed.blobId } });
  expect(blob.objectKey).toMatch(/\.png$/);
  expect((await requestArtifactExport(user.id, artifactId, pngRequest, { ...options(), env: {} })).id).toBe(png.id);
  await executeArtifactExport(jpeg.id, { ...options(), render: async () => pngBytes });
  expect(await ownedExport(user.id, jpeg.id, fixture.db)).toMatchObject({ status: "failed", errorCode: "EXPORT_RESULT_INVALID", blobId: null });
});

it("deduplicates concurrent submissions, exports the fixed revision, and replays completed results with admissions off", async () => {
  const { user, artifactId } = await setup();
  const [first, second] = await Promise.all([requestArtifactExport(user.id, artifactId, request, options()), requestArtifactExport(user.id, artifactId, request, options())]);
  expect(first.id).toBe(second.id);
  expect(await fixture.db.outboxEvent.count({ where: { entityId: first.id, kind: "creation-export" } })).toBe(1);
  await modifyLayoutArtifact(user.id, artifactId, { baseRevision: 1, saveKey: randomUUID(), operations: [{ op: "setText", pageId: "page", nodeId: "title", text: "New version" }] }, options());
  const render = vi.fn(async document => { expect(document.pages[0].nodes[0].text).toBe("Original"); return output("original"); });
  await executeArtifactExport(first.id, { ...options(), render });
  await executeArtifactExport(first.id, { ...options(), render });
  expect(render).toHaveBeenCalledOnce();
  const saved = await ownedExport(user.id, first.id, fixture.db);
  expect(saved.status).toBe("succeeded"); expect(saved.revision.revision).toBe(1);
  expect((await requestArtifactExport(user.id, artifactId, request, { ...options(), env: {} })).status).toBe("succeeded");
  await cleanupStagedBlobs({ ...options(), now: new Date(Date.now() + 2 * 86400000) });
  expect((await fixture.db.creationBlob.findUnique({ where: { id: saved.blobId } })).state).toBe("ready");
});

it("does not publish output after cancellation or grant access to another user", async () => {
  const first = await setup(), other = await setup();
  const task = await requestArtifactExport(first.user.id, first.artifactId, request, options());
  await expect(ownedExport(other.user.id, task.id, fixture.db)).rejects.toThrow("EXPORT_NOT_FOUND");
  await expect(requestArtifactExport(other.user.id, first.artifactId, request, options())).rejects.toThrow("ARTIFACT_NOT_FOUND");
  await executeArtifactExport(task.id, { ...options(), render: async () => { await cancelArtifactExport(first.user.id, task.id, fixture.db); return output("cancelled"); } });
  const row = await ownedExport(first.user.id, task.id, fixture.db);
  expect(row.status).toBe("cancelled"); expect(row.blobId).toBeNull();
});

it("fences a late old process when a crashed lease is reclaimed", async () => {
  const { user, artifactId } = await setup(), task = await requestArtifactExport(user.id, artifactId, request, options());
  let release, started;
  const start = new Promise(resolve => { started = resolve; }), hold = new Promise(resolve => { release = resolve; });
  const old = executeArtifactExport(task.id, { ...options(), render: async () => { started(); await hold; return output("old"); } });
  await start;
  await fixture.db.artifactExport.update({ where: { id: task.id }, data: { leaseUntil: new Date(0), nextCheckAt: new Date(0) } });
  await recoverArtifactExports({ db: fixture.db });
  await executeArtifactExport(task.id, { ...options(), render: async () => output("new") });
  release(); await old;
  const row = await ownedExport(user.id, task.id, fixture.db);
  expect(row.status).toBe("succeeded"); expect(row.attempt).toBe(2);
  const blob = await fixture.db.creationBlob.findUnique({ where: { id: row.blobId } });
  expect(blobs.get(blob.objectKey)).toEqual(output("new"));
});

it("bounds automatic retries and replays an explicit retry key without resetting the attempt fence", async () => {
  const { user, artifactId } = await setup(), task = await requestArtifactExport(user.id, artifactId, request, options());
  const render = vi.fn(async () => { throw new AppError("EXPORT_RENDER_FAILED", 422); });
  await executeArtifactExport(task.id, { ...options(), render });
  await executeArtifactExport(task.id, { ...options(), render });
  expect(render).toHaveBeenCalledOnce(); // A duplicate wake must respect backoff.
  for (let i = 0; i < 3; i++) {
    await fixture.db.artifactExport.update({ where: { id: task.id }, data: { nextCheckAt: new Date(0) } });
    await executeArtifactExport(task.id, { ...options(), render });
  }
  expect(render).toHaveBeenCalledTimes(3);
  const failed = await ownedExport(user.id, task.id, fixture.db);
  expect(failed.status).toBe("failed"); expect(failed.attempt).toBe(3);
  const retry = { ...request, retryKey: randomUUID(), retryAttempt: failed.attempt };
  const accepted = await requestArtifactExport(user.id, artifactId, retry, options());
  expect(accepted.id).toBe(task.id);
  expect((await requestArtifactExport(user.id, artifactId, retry, { ...options(), env: {} })).id).toBe(task.id);
  await executeArtifactExport(task.id, { ...options(), render: async () => output("retry") });
  expect((await ownedExport(user.id, task.id, fixture.db)).attempt).toBe(4);
});

it("rejects excess user admission and expires abandoned work", async () => {
  const { user, artifactId } = await setup();
  const first = await requestArtifactExport(user.id, artifactId, request, options());
  for (let revision = 2; revision <= 3; revision++) {
    await modifyLayoutArtifact(user.id, artifactId, { baseRevision: revision - 1, saveKey: randomUUID(), operations: [{ op: "setText", pageId: "page", nodeId: "title", text: String(revision) }] }, options());
    if (revision === 2) await requestArtifactExport(user.id, artifactId, { ...request, revision }, options());
    else await expect(requestArtifactExport(user.id, artifactId, { ...request, revision }, options())).rejects.toThrow("EXPORT_USER_QUEUE_FULL");
  }
  await fixture.db.artifactExport.update({ where: { id: first.id }, data: { deadlineAt: new Date(0), nextCheckAt: new Date(0) } });
  await recoverArtifactExports({ db: fixture.db });
  expect((await ownedExport(user.id, first.id, fixture.db)).status).toBe("failed");
});
