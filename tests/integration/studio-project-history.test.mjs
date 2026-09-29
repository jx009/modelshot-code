import { beforeAll, afterAll, expect, it } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { saveDocument } from "../../src/lib/domain/studio/documents.js";
import { readDocumentPage } from "../../src/lib/domain/studio/document-read.js";

let fixture;
beforeAll(async () => { fixture = await domainFixture(); });
afterAll(async () => { await fixture?.cleanup(); });
const content = { schemaVersion: 1, layers: [], jobs: [], messages: [] };
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
