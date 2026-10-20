import { createHash } from "node:crypto";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
vi.mock("../../src/lib/domain/assets/cos-delivery.js", () => ({ enqueueCosAsset: vi.fn() }));
import { prepareDirectUpload, completeDirectUpload } from "../../src/lib/domain/assets/direct-upload.js";
import { cosStorage } from "../../src/lib/infra/storage/cos.js";
import { parseCosObjectKey } from "../../src/lib/infra/storage/cos-primary.js";
const config = { enabled: true, bucket: "fixture-1250000000", region: "ap-guangzhou", prefix: "letaidraw", secretId: "fake-id", secretKey: "fake-secret", signedUrlSeconds: 300 };
async function fixture() {
  const bytes = await sharp({ create: { width: 64, height: 32, channels: 3, background: "red" } }).jpeg().toBuffer();
  let intent, asset;
  const db = { assetUpload: { create: vi.fn(async ({ data }) => { intent = data; return data; }), findUnique: vi.fn(async () => intent) },
    asset: { findUnique: vi.fn(async () => asset), upsert: vi.fn(async ({ create }) => { asset ||= { status: "active", ...create }; return asset; }) } };
  const store = { assertPrivateBucket: vi.fn(), signedUpload: vi.fn(async () => "https://cos.example/signed-put"), head: vi.fn(async () => ({ etag: '"version-1"', "content-length": String(bytes.length) })), get: vi.fn(async () => bytes), copy: vi.fn() };
  const input = { contentType: "image/jpeg", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") };
  const plan = await prepareDirectUpload("owner", input, { db, store, config });
  return { db, store, input, plan, intent: () => intent };
}
it("directly signs a bounded private PUT, validates bytes and freezes an immutable COS original", async () => {
  const f = await fixture();
  const result = await completeDirectUpload("owner", f.plan.uploadId, { ...f, config });
  expect(result).toMatchObject({ userId: "owner", contentType: "image/jpeg", bytes: f.input.bytes, checksum: f.input.checksum, width: 64, height: 32 });
  expect(parseCosObjectKey(result.objectKey)).toMatchObject({ bucket: config.bucket, region: config.region });
  expect(f.store.get).toHaveBeenCalledWith(`letaidraw/uploads/pending/owner/${f.plan.uploadId}`, '"version-1"');
  expect(f.store.copy).toHaveBeenCalledWith(`letaidraw/uploads/pending/owner/${f.plan.uploadId}`, `letaidraw/originals/owner/upload/${f.plan.uploadId}.jpg`, '"version-1"', "image/jpeg");
  expect(await completeDirectUpload("owner", f.plan.uploadId, { ...f, config })).toEqual(result);
  expect(f.store.copy).toHaveBeenCalledTimes(1);
  const url = new URL(await cosStorage(config).signedUpload("pending/image", "image/png", 100));
  expect(url.searchParams.get("q-header-list")).toBe("content-length;content-type;host");
  expect(url.href).not.toContain(config.secretKey + "&");
});
it("rejects other owners, expired intents, changed configuration and oversized or corrupt objects", async () => {
  const f = await fixture();
  await expect(completeDirectUpload("intruder", f.plan.uploadId, { ...f, config })).rejects.toMatchObject({ code: "UPLOAD_NOT_FOUND" });
  await expect(completeDirectUpload("owner", f.plan.uploadId, { ...f, config: { ...config, bucket: "other" } })).rejects.toMatchObject({ code: "COS_UPLOAD_CONFIG_CHANGED" });
  f.store.head.mockResolvedValueOnce({ etag: '"version-1"', "content-length": String(1000000000) });
  await expect(completeDirectUpload("owner", f.plan.uploadId, { ...f, config })).rejects.toMatchObject({ code: "UPLOAD_SIZE_MISMATCH" });
  expect(f.store.get).not.toHaveBeenCalled();
  f.store.get.mockResolvedValue(Buffer.from("corrupt"));
  await expect(completeDirectUpload("owner", f.plan.uploadId, { ...f, config })).rejects.toMatchObject({ code: "UPLOAD_CHECKSUM_MISMATCH" });
  f.intent().expiresAt = new Date(0);
  await expect(completeDirectUpload("owner", f.plan.uploadId, { ...f, config })).rejects.toMatchObject({ code: "UPLOAD_EXPIRED" });
  expect(f.db.asset.upsert).not.toHaveBeenCalled(); expect(f.store.copy).not.toHaveBeenCalled();
});
it("falls back to the existing upload endpoint only when COS is disabled", async () => {
  const f = await fixture();
  expect(await prepareDirectUpload("owner", f.input, { ...f, config: { ...config, enabled: false } })).toEqual({ mode: "proxy" });
  expect(f.db.assetUpload.create).toHaveBeenCalledTimes(1);
});
