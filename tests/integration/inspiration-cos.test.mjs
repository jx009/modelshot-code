import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import sharp from "sharp";
import { domainFixture } from "../support/domain-fixture.mjs";
import { DEFAULT_ITEMS, DEFAULT_LAYOUT } from "../../src/lib/inspiration/gallery.js";
import { publicInspirationGallery, readInspirationImage } from "../../src/lib/server/inspiration.js";
import { enqueueInspirationGallery, inspirationDelivery, processInspirationMirror } from "../../src/lib/server/inspiration-delivery.js";
import { COS_DEFAULTS, cosTargetId } from "../../src/lib/infra/storage/cos-config.js";

const config = { ...COS_DEFAULTS, enabled: true, bucket: "fixture-1250000000", secretId: randomUUID(), secretKey: "fixture" };
const key = "inspiration_gallery_v1", receipts = `inspiration_cos_v1:${cosTargetId(config)}:`;
const objects = new Map();
const target = { assertPrivateBucket: vi.fn(), put: vi.fn(async (key, bytes) => objects.set(key, bytes)), signedUrl: vi.fn(async key => `https://fixture.cos.ap-hongkong.myqcloud.com/${key}?signature=fixture`) };
let f, original, custom, gallery;
async function publish(items) {
  await f.db.systemConfig.upsert({ where: { key }, create: { key, value: JSON.stringify({ items, layout: DEFAULT_LAYOUT }) }, update: { value: JSON.stringify({ items, layout: DEFAULT_LAYOUT }) } });
  gallery = await publicInspirationGallery(f.db);
}
beforeAll(async () => {
  f = await domainFixture();
  original = await f.db.systemConfig.findUnique({ where: { key } });
  const user = await f.user();
  custom = { ...DEFAULT_ITEMS[0], id: `cos-${randomUUID()}`, cover: { type: "asset", assetId: user.asset.id } };
  await f.db.assetReference.create({ data: { assetId: user.asset.id, entityId: custom.id, kind: "inspiration" } });
  await publish([DEFAULT_ITEMS[0], DEFAULT_ITEMS[1], custom]);
});
afterAll(async () => {
  if (!f) return;
  await f.db.outboxEvent.deleteMany({ where: { businessKey: { startsWith: `inspiration-mirror:${receipts}` } } });
  await f.db.systemConfig.deleteMany({ where: { key: { startsWith: receipts } } });
  if (original) await f.db.systemConfig.upsert({ where: { key }, create: original, update: { value: original.value } });
  else await f.db.systemConfig.deleteMany({ where: { key } });
  await f.cleanup();
});

it("first requests enqueue the whole gallery once across visitors and retain source URLs while pending", async () => {
  const options = { db: f.db, config, target, now: 1000 };
  const cold = await inspirationDelivery(gallery, options);
  expect(cold.deliveryPending).toBe(true);
  expect(cold.items.every(item => !item.imageUrl)).toBe(true);
  await Promise.all([enqueueInspirationGallery(gallery, options), enqueueInspirationGallery(gallery, options)]);
  expect(await f.db.outboxEvent.count({ where: { businessKey: { startsWith: `inspiration-mirror:${receipts}` } } })).toBe(3);
  expect(target.put).not.toHaveBeenCalled();
});

it("mirrors builtins and published assets permanently with concurrent upload deduplication", async () => {
  const options = { db: f.db, config, target, source: f.store };
  await Promise.all([processInspirationMirror(gallery.items[0].id, options), processInspirationMirror(gallery.items[0].id, options)]);
  await processInspirationMirror(gallery.items[1].id, options);
  await processInspirationMirror(custom.id, options);
  expect(target.put).toHaveBeenCalledTimes(6);
  const delivered = await inspirationDelivery(gallery, options);
  expect(delivered.deliveryPending).toBe(false);
  for (const item of delivered.items) {
    expect(item.imageUrl).toMatch(/^https:\/\/fixture\.cos\./);
    expect(item.thumbnailUrl).toContain("640.webp");
    const objectKey = new URL(item.imageUrl).pathname.slice(1);
    expect(objects.get(objectKey)).toEqual((await readInspirationImage(item, f.db, f.store)).bytes);
    const thumb = await sharp(objects.get(new URL(item.thumbnailUrl).pathname.slice(1))).metadata();
    expect(thumb.width).toBeLessThanOrEqual(640);
    expect(thumb.format).toBe("webp");
  }
  // A new visitor months later gets new signatures, not another upload/job.
  await enqueueInspirationGallery(gallery, { ...options, now: Date.now() + 90 * 86400000 });
  await processInspirationMirror(custom.id, options);
  expect(target.put).toHaveBeenCalledTimes(6);
  expect(await f.db.outboxEvent.count({ where: { businessKey: { startsWith: `inspiration-mirror:${receipts}` } } })).toBe(3);
  expect((await inspirationDelivery(gallery, { ...options, config: { ...config, bucket: "another-1250000000" } })).deliveryPending).toBe(true);
});

it("does not publish partial uploads, retries replacements, and excludes hidden images", async () => {
  const replacement = { ...DEFAULT_ITEMS[2], id: DEFAULT_ITEMS[0].id };
  await publish([replacement, { ...custom, enabled: false }]);
  const options = { db: f.db, config, target, source: f.store };
  expect((await inspirationDelivery(gallery, options)).items).toHaveLength(1);
  target.put.mockImplementationOnce(async (key, bytes) => objects.set(key, bytes)).mockRejectedValueOnce(new Error("upload failed"));
  await expect(processInspirationMirror(replacement.id, options)).rejects.toThrow("upload failed");
  expect((await inspirationDelivery(gallery, options)).deliveryPending).toBe(true);
  await processInspirationMirror(replacement.id, options);
  expect((await inspirationDelivery(gallery, options)).deliveryPending).toBe(false);
  target.put.mockClear();
  await processInspirationMirror(custom.id, options);
  expect(target.put).not.toHaveBeenCalled();
  expect(await inspirationDelivery(gallery, { ...options, config: { ...config, enabled: false } })).toEqual(gallery);
});
