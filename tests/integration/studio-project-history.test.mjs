import { beforeAll, afterAll, expect, it } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { saveDocument } from "../../src/lib/domain/studio/documents.js";
import { readDocumentPage } from "../../src/lib/domain/studio/document-read.js";

let fixture;
beforeAll(async () => { fixture = await domainFixture(); });
afterAll(async () => { await fixture?.cleanup(); });
const content = { schemaVersion: 1, layers: [], jobs: [], messages: [] };
for (const originKey of ["canvasOrigin", "sceneOrigin"]) {
  it(`saves ${originKey} after a JSONB round trip while rejecting changed or removed source links`, async () => {
    const user = await fixture.user();
    await fixture.db.user.update({ where: { id: user.id }, data: { role: "root" } });
    const media = [{ id: user.asset.id, type: "image", name: "Source" }];
    const parentContent = originKey === "canvasOrigin"
      ? { ...content, layers: [{ id: "source", type: "image", name: "Source", assetId: user.asset.id, x: 0, y: 0, width: 100, height: 100 }] }
      : { ...content, video: { mode: "motion", media, composition: { version: 1, ratio: "16:9", fps: 24, scenes: [{ id: "source", name: "Source", title: "", duration: 5, assetId: user.asset.id }] } } };
    const parent = await saveDocument(user.id, { name: "Source project", content: parentContent }, fixture.db);
    const origin = { documentId: parent.id, [originKey === "canvasOrigin" ? "layerId" : "sceneId"]: "source", assetId: user.asset.id };
    const child = await saveDocument(user.id, { name: "Linked video", content: { ...content, video: { mode: "video", media, [originKey]: origin } } }, fixture.db);
    const stored = await fixture.db.studioDocument.findUnique({ where: { id: child.id } });
    const input = { id: child.id, version: stored.version, saveKey: `origin-save-${originKey}`, name: child.name,
      content: { ...stored.content, video: { ...stored.content.video, prompt: "Animate the source" } } };
    const saved = await saveDocument(user.id, input, fixture.db);
    expect(saved.version).toBe(stored.version + 1);
    expect(saved.content.video[originKey]).toEqual(origin);
    expect((await saveDocument(user.id, input, fixture.db)).version).toBe(saved.version);
    for (const field of Object.keys(origin)) {
      await expect(saveDocument(user.id, { ...input, version: saved.version, saveKey: undefined,
        content: { ...saved.content, video: { ...saved.content.video, [originKey]: { ...origin, [field]: "different-source" } } } }, fixture.db)).rejects.toThrow("VIDEO_ORIGIN_CHANGED");
    }
    const { [originKey]: removed, ...withoutOrigin } = saved.content.video;
    expect(removed).toEqual(origin);
    await expect(saveDocument(user.id, { ...input, version: saved.version, saveKey: undefined,
      content: { ...saved.content, video: withoutOrigin } }, fixture.db)).rejects.toThrow("VIDEO_ORIGIN_CHANGED");
  });
}
it("acknowledges a lost creation response without creating or updating twice", async () => {
  const user = await fixture.user();
  const input = { createKey: "lost-create", saveKey: "create-receipt", name: "Cat", content };
  const first = await saveDocument(user.id, input, fixture.db);
  const retry = await saveDocument(user.id, input, fixture.db);
  expect(retry).toMatchObject({ id: first.id, version: 1, acknowledged: true });
  await expect(saveDocument(user.id, { ...input, name: "Different" }, fixture.db)).rejects.toThrow("SAVE_KEY_REUSED");
});
it("replays an update once, but rejects changed payloads and genuinely stale versions", async () => {
  const user = await fixture.user();
  const initial = await saveDocument(user.id, { name: "Cat", content }, fixture.db);
  const input = { id: initial.id, version: 1, saveKey: "update-receipt", name: "Updated cat", content };
  const [first, replay] = await Promise.all([saveDocument(user.id, input, fixture.db), saveDocument(user.id, input, fixture.db)]);
  expect(first.version).toBe(2); expect(replay.version).toBe(2);
  expect((await readDocumentPage(user.id, initial.id, 0, undefined, fixture.db)).lastSaveKey).toBe(input.saveKey);
  await expect(saveDocument(user.id, { ...input, name: "Wrong" }, fixture.db)).rejects.toThrow("SAVE_KEY_REUSED");
  const other = await fixture.user();
  await expect(saveDocument(other.id, input, fixture.db)).rejects.toThrow("DOCUMENT_VERSION_CONFLICT");
  await saveDocument(user.id, { ...input, version: 2, saveKey: "another-tab", name: "Other tab" }, fixture.db);
  await expect(saveDocument(user.id, input, fixture.db)).rejects.toThrow("DOCUMENT_VERSION_CONFLICT");
});
it("deduplicates creation retries without overwriting the first accepted snapshot", async () => {
  const user = await fixture.user();
  const input = { createKey: "retry-create-project", name: "生成一只猫", nameSource: "prompt", content };
  const [one, two] = await Promise.all([saveDocument(user.id, input, fixture.db), saveDocument(user.id, { ...input, name: "later request" }, fixture.db)]);
  expect(one.id).toBe(two.id);
  expect(await fixture.db.studioDocument.count({ where: { userId: user.id } })).toBe(1);
  expect([one.replayed, two.replayed].filter(Boolean)).toHaveLength(1);
});
it("archives more than 100 messages and retains their asset references after compacting the snapshot", async () => {
  const user = await fixture.user();
  const messages = Array.from({ length: 125 }, (_, i) => ({ id: `message-${i}`, role: "user", text: `Message ${i}`, ...(i === 0 ? { assetId: user.asset.id } : {}) }));
  const doc = await saveDocument(user.id, { name: "History", content: { ...content, messages } }, fixture.db);
  expect(doc.content.messages).toHaveLength(100);
  expect(await fixture.db.studioMessage.count({ where: { documentId: doc.id } })).toBe(125);
  await saveDocument(user.id, { id: doc.id, version: doc.version, name: "History", content: doc.content }, fixture.db);
  expect(await fixture.db.studioMessage.count({ where: { documentId: doc.id } })).toBe(125);
  expect(await fixture.db.assetReference.count({ where: { entityId: doc.id, assetId: user.asset.id, kind: "studio" } })).toBe(1);
});
it("does not resurrect a deleted project through autosave or creation replay", async () => {
  const user = await fixture.user();
  const doc = await saveDocument(user.id, { createKey: "deleted-project-create", name: "Delete", content }, fixture.db);
  await fixture.db.studioDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
  await expect(saveDocument(user.id, { id: doc.id, version: doc.version, name: "Oops", content }, fixture.db)).rejects.toThrow("DOCUMENT_VERSION_CONFLICT");
  await expect(saveDocument(user.id, { createKey: "deleted-project-create", name: "Oops", content }, fixture.db)).rejects.toThrow("DOCUMENT_NOT_FOUND");
});
it("reads all 175 canvas objects in version-consistent pages and copies archived messages", async () => {
  const user = await fixture.user(), other = await fixture.user();
  const layers = Array.from({ length: 175 }, (_, i) => ({ id: `layer-${i}`, type: "image", name: `Image ${i}`, assetId: user.asset.id, x: i * 30, y: 0, width: 20, height: 20 }));
  const messages = Array.from({ length: 130 }, (_, i) => ({ id: `message-${i}`, role: "user", text: `History ${i}` }));
  const doc = await saveDocument(user.id, { name: "Long project", content: { ...content, layers, messages } }, fixture.db);
  const first = await readDocumentPage(user.id, doc.id, 0, undefined, fixture.db);
  const second = await readDocumentPage(user.id, doc.id, 100, first.version, fixture.db);
  expect(first.layerCount).toBe(175); expect(first.content.layers).toHaveLength(100); expect(second.content.layers).toHaveLength(75);
  expect(second.content.layers[0].id).toBe("layer-100");
  await expect(readDocumentPage(other.id, doc.id, 0, undefined, fixture.db)).rejects.toThrow("DOCUMENT_NOT_FOUND");
  await expect(readDocumentPage(user.id, doc.id, 100, first.version + 1, fixture.db)).rejects.toThrow("DOCUMENT_VERSION_CONFLICT");
  const copy = await saveDocument(user.id, { name: "Copy", copyFromId: doc.id, content: doc.content }, fixture.db);
  expect(await fixture.db.studioMessage.count({ where: { documentId: copy.id } })).toBe(130);
});
