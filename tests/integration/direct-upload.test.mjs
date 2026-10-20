import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { prepareDirectUpload, completeDirectUpload } from "../../src/lib/domain/assets/direct-upload.js";
import { readOwnedImage } from "../../src/lib/domain/assets/service.js";

const config = { enabled: true, directUploadEnabled: true, bucket: "fixture-1250000000", region: "ap-guangzhou", prefix: "test", secretId: "fake", secretKey: "fake", signedUrlSeconds: 300 };
let fixture, owner, other;
const intents = [];
beforeAll(async () => { fixture = await domainFixture(); owner = await fixture.user(); other = await fixture.user(); });
afterAll(async () => {
  if (!fixture) return;
  await fixture.db.outboxEvent.deleteMany({ where: { entityId: { in: intents } } });
  await fixture.db.assetUpload.deleteMany({ where: { id: { in: intents } } });
  await fixture.cleanup();
});
it("concurrent finalize persists one COS asset and tools read its preserved JPEG as PNG", async () => {
  const bytes = await sharp({ create: { width: 80, height: 48, channels: 3, background: "red" } }).jpeg().toBuffer();
  const store = { assertPrivateBucket: vi.fn(), signedUpload: vi.fn(async () => "https://fixture.cos.ap-guangzhou.myqcloud.com/upload"),
    head: vi.fn(async () => ({ etag: '"fixed"', "content-length": bytes.length })), get: vi.fn(async () => bytes), copy: vi.fn() };
  const plan = await prepareDirectUpload(owner.id, { contentType: "image/jpeg", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") }, { db: fixture.db, config, store });
  intents.push(plan.uploadId);
  await expect(completeDirectUpload(other.id, plan.uploadId, { db: fixture.db, config, store })).rejects.toMatchObject({ code: "UPLOAD_NOT_FOUND" });
  expect(store.get).not.toHaveBeenCalled();
  const results = await Promise.all(Array.from({ length: 4 }, () => completeDirectUpload(owner.id, plan.uploadId, { db: fixture.db, config, store })));
  expect(new Set(results.map(row => row.id)).size).toBe(1);
  expect(results[0]).toMatchObject({ status: "active", bytes: bytes.length, contentType: "image/jpeg", width: 80, height: 48 });
  expect(results[0].objectKey).toMatch(/^cos:\/\/fixture-1250000000\/ap-guangzhou\//);
  expect(await fixture.db.asset.count({ where: { id: plan.uploadId } })).toBe(1);
  const png = await readOwnedImage(owner.id, plan.uploadId, fixture.db, store);
  expect(await sharp(png).metadata()).toMatchObject({ format: "png", width: 80, height: 48 });
  await expect(readOwnedImage(other.id, plan.uploadId, fixture.db, store)).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
  await fixture.db.asset.update({ where: { id: plan.uploadId }, data: { status: "deleted" } });
  await expect(completeDirectUpload(owner.id, plan.uploadId, { db: fixture.db, config, store })).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
});
