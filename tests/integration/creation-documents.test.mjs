import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { createProject } from "../../src/lib/domain/creation/projects.js";
import { createDocumentArtifact, readDocumentArtifact, modifyDocumentArtifact, copyDocumentArtifact, restoreDocumentArtifact } from "../../src/lib/domain/creation/document-artifacts.js";
import { listArtifactRevisions } from "../../src/lib/domain/creation/artifacts.js";

let fixture;
const users = [], blobs = new Map();
const store = { put: async (key, bytes) => blobs.set(key, Buffer.from(bytes)), get: async key => Buffer.from(blobs.get(key)), delete: async key => blobs.delete(key) };
const options = () => ({ db: fixture.db, store });
const change = (text, baseRevision = 1, saveKey = randomUUID()) => ({ baseRevision, saveKey, operations: [{ op: "replaceDocumentText", sectionId: "s", blockId: "p", leafId: "p", start: 0, end: 8, expectedText: "Original", text }] });
async function setup() {
  const user = await fixture.user(); users.push(user.id);
  const project = await createProject(user.id, { createKey: randomUUID(), name: "Report", kind: "document" }, fixture.db);
  const content = { schemaVersion: 1, kind: "document", title: "Report", sections: [{ id: "s", title: "Summary", blocks: [
    { id: "p", type: "paragraph", runs: [{ text: "Original", marks: { bold: true } }] },
    { id: "photo", type: "image", assetId: user.asset.id, width: 300, height: 200, caption: "Reference" },
  ] }] };
  const saved = await createDocumentArtifact(user.id, project.id, content, randomUUID(), options());
  return { user, project, id: saved.artifactId };
}
beforeAll(async () => { fixture = await domainFixture(); });
afterAll(async () => {
  if (!fixture) return;
  await fixture.db.creationProject.deleteMany({ where: { userId: { in: users } } });
  await fixture.db.creationBlob.deleteMany({ where: { userId: { in: users } } });
  await fixture.cleanup();
});

it("preserves immutable versions and image references, and replays one save without overwriting later history", async () => {
  const { user, id } = await setup(), request = change("Edited");
  expect((await modifyDocumentArtifact(user.id, id, request, options())).revision).toBe(2);
  expect((await modifyDocumentArtifact(user.id, id, request, options())).replayed).toBe(true);
  const before = await readDocumentArtifact(user.id, id, 1, options()), after = await readDocumentArtifact(user.id, id, 2, options());
  expect(before.content.sections[0].blocks[0].runs[0].text).toBe("Original");
  expect(after.content.sections[0].blocks[0].runs[0]).toEqual({ text: "Edited", marks: { bold: true } });
  expect(after.content.sections[0].blocks[1]).toEqual(before.content.sections[0].blocks[1]);
  const revisions = await fixture.db.artifactRevision.findMany({ where: { artifactId: id }, select: { id: true } });
  for (const revision of revisions) expect(await fixture.db.assetReference.count({ where: { entityId: revision.id, assetId: user.asset.id, kind: "creation_revision" } })).toBe(1);
  await expect(modifyDocumentArtifact(user.id, id, change("different", 1, request.saveKey), options())).rejects.toThrow("SAVE_KEY_REUSED");
});

it("allows only one concurrent save and can preserve a conflicting draft as a separate document", async () => {
  const { user, id } = await setup(), original = await readDocumentArtifact(user.id, id, 1, options());
  const results = await Promise.allSettled([modifyDocumentArtifact(user.id, id, change("First"), options()), modifyDocumentArtifact(user.id, id, change("Second"), options())]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find(result => result.status === "rejected").reason.code).toBe("ARTIFACT_VERSION_CONFLICT");
  const copy = await copyDocumentArtifact(user.id, id, { content: original.content, saveKey: randomUUID() }, options());
  expect(copy.artifactId).not.toBe(id);
  await restoreDocumentArtifact(user.id, id, { baseRevision: 2, restoreRevision: 1, saveKey: randomUUID() }, options());
  expect((await listArtifactRevisions(user.id, id, undefined, fixture.db)).items).toHaveLength(3);
  expect((await readDocumentArtifact(user.id, id, undefined, options())).content.sections[0].blocks[0].runs[0].text).toBe("Original");
});

it("rejects foreign reads/assets and rolls back document publication when its chat hook fails", async () => {
  const first = await setup(), second = await setup();
  await expect(readDocumentArtifact(second.user.id, first.id, 1, options())).rejects.toThrow("ARTIFACT_NOT_FOUND");
  const local = (await readDocumentArtifact(first.user.id, first.id, 1, options())).content;
  local.sections[0].blocks[1].assetId = second.user.asset.id;
  await expect(copyDocumentArtifact(first.user.id, first.id, { content: local, saveKey: randomUUID() }, options())).rejects.toThrow("ASSET_NOT_FOUND");
  await expect(modifyDocumentArtifact(first.user.id, first.id, change("Failed"), { ...options(), hooks: { afterCommit: async () => { throw new Error("Chat failed"); } } })).rejects.toThrow("Chat failed");
  expect((await readDocumentArtifact(first.user.id, first.id, undefined, options())).revision).toBe(1);
});
