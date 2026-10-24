import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { createProject } from "../../src/lib/domain/creation/projects.js";
import { createLayoutArtifact, copyLayoutArtifact, readLayoutArtifact, modifyLayoutArtifact, restoreLayoutArtifact, listArtifactRevisions, cleanupStagedBlobs } from "../../src/lib/domain/creation/artifacts.js";

let fixture;
const users = [], blobs = new Map();
const store = { put: async (key, bytes) => blobs.set(key, Buffer.from(bytes)), get: async key => Buffer.from(blobs.get(key)), delete: async key => blobs.delete(key) };
const options = () => ({ db: fixture.db, store });
async function setup() {
  const user = await fixture.user(); users.push(user.id);
  const project = await createProject(user.id, { createKey: randomUUID(), name: "Opening", kind: "poster" }, fixture.db);
  const content = { schemaVersion: 1, kind: "poster", title: "Opening", theme: { name: "Neutral", primary: "#202124", accent: "#ff8800", background: "#ffffff", fontFamily: "sans" }, pages: [
    { id: "page", title: "Poster", width: 1080, height: 1440, nodes: [
      { id: "photo", type: "image", name: "Product", assetId: user.asset.id, x: 0, y: 0, width: 1080, height: 1440 },
      { id: "date", type: "text", name: "Date", text: "10 月 24 日", style: { fontSize: 48, fill: "#ff8800", fontWeight: "bold" }, x: 50, y: 100, width: 800, height: 100 },
    ] },
  ] };
  const created = await createLayoutArtifact(user.id, project.id, content, randomUUID(), options());
  return { user, project, content, id: created.artifactId };
}
const change = (text, baseRevision = 1, saveKey = randomUUID()) => ({ baseRevision, saveKey, operations: [{ op: "setText", pageId: "page", nodeId: "date", text }] });
beforeAll(async () => { fixture = await domainFixture(); });
afterAll(async () => {
  if (!fixture) return;
  await fixture.db.creationProject.deleteMany({ where: { userId: { in: users } } });
  await fixture.db.creationBlob.deleteMany({ where: { userId: { in: users } } });
  await fixture.cleanup();
});
it("writes immutable versions, preserves image references and replays a lost save response", async () => {
  const { user, id } = await setup(), request = change("11 月 1 日");
  const result = await modifyLayoutArtifact(user.id, id, request, options());
  expect(result.revision).toBe(2);
  expect((await modifyLayoutArtifact(user.id, id, request, options())).replayed).toBe(true);
  const before = await readLayoutArtifact(user.id, id, 1, options()), after = await readLayoutArtifact(user.id, id, undefined, options());
  expect(before.content.pages[0].nodes[1].text).toBe("10 月 24 日");
  expect(after.content.pages[0].nodes[1].text).toBe("11 月 1 日");
  expect(after.content.pages[0].nodes[0]).toEqual(before.content.pages[0].nodes[0]);
  expect(after.content.pages[0].nodes[1].style).toEqual(before.content.pages[0].nodes[1].style);
  expect((await listArtifactRevisions(user.id, id, undefined, fixture.db)).items).toHaveLength(2);
  await expect(modifyLayoutArtifact(user.id, id, change("different", 1, request.saveKey), options())).rejects.toThrow("SAVE_KEY_REUSED");
});
it("allows only one concurrent revision based on the same snapshot", async () => {
  const { user, id } = await setup();
  const results = await Promise.allSettled([
    modifyLayoutArtifact(user.id, id, change("first"), options()), modifyLayoutArtifact(user.id, id, change("second"), options()),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find(result => result.status === "rejected").reason.code).toBe("ARTIFACT_VERSION_CONFLICT");
  expect((await listArtifactRevisions(user.id, id, undefined, fixture.db)).items).toHaveLength(2);
});
it("restores an old version by creating a new one and preserves later history", async () => {
  const { user, id } = await setup();
  await modifyLayoutArtifact(user.id, id, change("11 月 1 日"), options());
  await restoreLayoutArtifact(user.id, id, { baseRevision: 2, restoreRevision: 1, saveKey: randomUUID() }, options());
  const current = await readLayoutArtifact(user.id, id, undefined, options());
  expect(current.revision).toBe(3);
  expect(current.content.pages[0].nodes[1].text).toBe("10 月 24 日");
  expect((await readLayoutArtifact(user.id, id, 2, options())).content.pages[0].nodes[1].text).toBe("11 月 1 日");
});
it("preserves a conflicting local draft as a separate artifact without replacing the newer cloud revision", async () => {
  const { user, project, id } = await setup();
  const local = (await readLayoutArtifact(user.id, id, 1, options())).content;
  local.title = "Opening (local copy)";
  local.pages[0].nodes[1].text = "Local date";
  await modifyLayoutArtifact(user.id, id, change("Cloud date"), options());
  const request = { content: local, saveKey: randomUUID() };
  const copy = await copyLayoutArtifact(user.id, id, request, options());
  const retry = await copyLayoutArtifact(user.id, id, request, options());
  expect(copy.artifactId).not.toBe(id);
  expect(retry).toMatchObject({ artifactId: copy.artifactId, replayed: true });
  const original = await readLayoutArtifact(user.id, id, undefined, options());
  const copied = await readLayoutArtifact(user.id, copy.artifactId, undefined, options());
  expect(original.revision).toBe(2);
  expect(original.content.pages[0].nodes[1].text).toBe("Cloud date");
  expect(copied.projectId).toBe(project.id);
  expect(copied.content.pages[0].nodes[1].text).toBe("Local date");
  expect(copied.content.pages[0].nodes[0]).toEqual(original.content.pages[0].nodes[0]);
  expect(await fixture.db.creationArtifact.count({ where: { projectId: project.id } })).toBe(2);
  await expect(copyLayoutArtifact(user.id, id, { ...request, content: { ...local, title: "different" } }, options())).rejects.toThrow("SAVE_KEY_REUSED");
});
it("does not publish a version if its object upload fails", async () => {
  const { user, id } = await setup();
  await expect(modifyLayoutArtifact(user.id, id, change("lost upload"), { ...options(), store: { ...store, put: async () => { throw new Error("storage unavailable"); } } })).rejects.toThrow("storage unavailable");
  expect((await readLayoutArtifact(user.id, id, undefined, options())).revision).toBe(1);
  await cleanupStagedBlobs({ ...options(), now: new Date(Date.now() + 2 * 86400000) });
  expect((await readLayoutArtifact(user.id, id, undefined, options())).revision).toBe(1);
});
it("rejects cross-user reads and insertion of another user's asset", async () => {
  const first = await setup(), second = await setup();
  await expect(readLayoutArtifact(second.user.id, first.id, undefined, options())).rejects.toThrow("ARTIFACT_NOT_FOUND");
  await expect(copyLayoutArtifact(second.user.id, first.id, { content: first.content, saveKey: randomUUID() }, options())).rejects.toThrow("ARTIFACT_NOT_FOUND");
  await expect(copyLayoutArtifact(first.user.id, first.id, { content: { ...first.content, kind: "slides" }, saveKey: randomUUID() }, options())).rejects.toThrow("ARTIFACT_KIND_MISMATCH");
  await expect(modifyLayoutArtifact(first.user.id, first.id, { baseRevision: 1, saveKey: randomUUID(), operations: [{ op: "replaceImage", pageId: "page", nodeId: "photo", assetId: second.user.asset.id }] }, options())).rejects.toThrow("ASSET_NOT_FOUND");
});
it("rolls back an artifact revision when its same-transaction publication hook fails", async () => {
  const { user, id } = await setup();
  await expect(modifyLayoutArtifact(user.id, id, change("not published"), { ...options(), hooks: {
    afterCommit: async () => { throw new Error("message persistence failed"); },
  } })).rejects.toThrow("message persistence failed");
  const current = await readLayoutArtifact(user.id, id, undefined, options());
  expect(current.revision).toBe(1);
  expect(current.content.pages[0].nodes[1].text).toBe("10 月 24 日");
  expect((await listArtifactRevisions(user.id, id, undefined, fixture.db)).items).toHaveLength(1);
});
