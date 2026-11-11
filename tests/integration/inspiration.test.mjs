import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { DEFAULT_ITEMS, gallerySchema } from "../../src/lib/inspiration/gallery.js";
import { getInspirationGallery, publicInspirationGallery, findInspiration, saveInspirationGallery, readInspirationImage, lockInspirationGallery } from "../../src/lib/server/inspiration.js";
import { auditedOperation } from "../../src/lib/domain/identity/admin-operation.js";
import { deleteAsset } from "../../src/lib/domain/assets/lifecycle.js";

let f, original, originalRefs, admin, other;
const key = "inspiration_gallery_v1";
const publish = (actor, input, requestKey = randomUUID()) => auditedOperation(actor.id, requestKey, "UPDATE_INSPIRATION", input, tx => saveInspirationGallery(tx, input), f.db, "admin", { beforeActorLock: lockInspirationGallery });
const inputFor = async (items, layout = { mode: "grid", columns: 3, gap: 24 }) => ({ items, layout, version: (await getInspirationGallery(f.db)).version, reason: "Curate inspiration test" });

beforeAll(async () => {
  f = await domainFixture();
  original = await f.db.systemConfig.findUnique({ where: { key } });
  originalRefs = await f.db.assetReference.findMany({ where: { kind: "inspiration" } });
  await f.db.systemConfig.deleteMany({ where: { key } });
  admin = await f.user(); other = await f.user();
  await f.db.user.updateMany({ where: { id: { in: [admin.id, other.id] } }, data: { role: "admin" } });
});
afterAll(async () => {
  if (!f) return;
  await f.db.assetReference.deleteMany({ where: { kind: "inspiration" } });
  if (originalRefs?.length) await f.db.assetReference.createMany({ data: originalRefs });
  if (original) await f.db.systemConfig.upsert({ where: { key }, create: original, update: { value: original.value } });
  else await f.db.systemConfig.deleteMany({ where: { key } });
  await f.cleanup();
});

it("serves the complete generated defaults only when no gallery is configured", async () => {
  const gallery = await publicInspirationGallery(f.db);
  expect(gallery.items).toHaveLength(DEFAULT_ITEMS.length);
  for (const item of gallery.items) {
    expect(item.prompt).toBe(DEFAULT_ITEMS.find(row => row.id === item.id).prompt);
    expect(item.prompt.trim().length).toBeGreaterThan(0);
    expect(item.prompt.length).toBeLessThanOrEqual(4000);
    const image = await readInspirationImage(item, f.db, f.store);
    expect(image.contentType).toBe("image/webp");
    expect(image.bytes.length).toBeGreaterThan(20000);
  }
  await publish(admin, await inputFor([]));
  expect((await publicInspirationGallery(f.db)).items).toEqual([]);
  expect(await findInspiration(DEFAULT_ITEMS[0].id, f.db)).toBeNull();
});

it("publishes order/layout, retains private source assets and releases references on removal", async () => {
  const custom = { ...DEFAULT_ITEMS[0], id: "published-from-user", cover: { type: "asset", assetId: other.asset.id } };
  const hidden = { ...DEFAULT_ITEMS[1], enabled: false };
  const input = await inputFor([custom, hidden, DEFAULT_ITEMS[2]]), requestKey = randomUUID();
  await publish(admin, input, requestKey);
  expect((await publish(admin, input, requestKey)).replayed).toBe(true);
  const gallery = await publicInspirationGallery(f.db);
  expect(gallery.items.map(i => i.id)).toEqual([custom.id, DEFAULT_ITEMS[2].id]);
  expect(gallery.layout).toEqual(input.layout);
  expect(await findInspiration(hidden.id, f.db)).toBeNull();
  expect((await readInspirationImage(custom, f.db, f.store)).bytes).toEqual(f.image);
  await expect(readInspirationImage({ ...custom, id: "unpublished-id" }, f.db, f.store)).rejects.toMatchObject({ status: 404 });
  await expect(deleteAsset(other.id, other.asset.id, f.db)).rejects.toMatchObject({ code: "ASSET_IN_USE" });
  const audit = await f.db.adminAuditLog.findUnique({ where: { businessKey: `operation:${admin.id}:${requestKey}` } });
  expect(JSON.parse(audit.detail).after.items[0].prompt).toBe(custom.prompt);
  await expect(publish(admin, { ...input, items: [] })).rejects.toMatchObject({ code: "INSPIRATION_CHANGED" });
  await publish(admin, await inputFor([{ ...custom, enabled: false }]));
  expect((await publicInspirationGallery(f.db)).items).toHaveLength(0);
  await expect(deleteAsset(other.id, other.asset.id, f.db)).rejects.toMatchObject({ code: "ASSET_IN_USE" });
  await publish(admin, await inputFor([]));
  expect(await f.db.assetReference.count({ where: { assetId: other.asset.id, kind: "inspiration" } })).toBe(0);
  expect((await f.db.asset.findUnique({ where: { id: other.asset.id } })).status).toBe("active");
});

it("rolls back invalid assets and validates prompt reuse constraints", async () => {
  const before = await getInspirationGallery(f.db);
  const invalid = { ...DEFAULT_ITEMS[0], cover: { type: "asset", assetId: "missing-asset" } };
  await expect(publish(admin, await inputFor([invalid]))).rejects.toMatchObject({ code: "INSPIRATION_ASSET_UNAVAILABLE" });
  expect(await getInspirationGallery(f.db)).toEqual(before);
  expect(gallerySchema.safeParse({ ...before, version: undefined }).success).toBe(false);
  expect(gallerySchema.safeParse({ items: [{ ...DEFAULT_ITEMS[0], prompt: "x".repeat(4001) }], layout: before.layout }).success).toBe(false);
});

it("serializes cross-owner concurrent admin edits without deadlock or lost updates", async () => {
  const before = await getInspirationGallery(f.db);
  const results = await Promise.allSettled([admin, other].map((actor, index) => publish(actor, {
    items: [{ ...DEFAULT_ITEMS[index], cover: { type: "asset", assetId: (index ? admin : other).asset.id } }],
    layout: before.layout, version: before.version, reason: "Concurrent cross-owner publication",
  })));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find(r => r.status === "rejected").reason.code).toBe("INSPIRATION_CHANGED");
});
