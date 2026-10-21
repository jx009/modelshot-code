import { createHash } from "node:crypto";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
vi.mock("../../src/lib/domain/assets/cos-delivery.js", () => ({ enqueueCosAsset: vi.fn() }));
import { prepareDirectUpload, completeDirectUpload, directUploadSchema } from "../../src/lib/domain/assets/direct-upload.js";
import { cosStorage } from "../../src/lib/infra/storage/cos.js";
import { parseCosObjectKey } from "../../src/lib/infra/storage/cos-primary.js";
const config = { enabled: true, directUploadEnabled: true, bucket: "fixture-1250000000", region: "ap-guangzhou", prefix: "letaidraw", secretId: "fake-id", secretKey: "fake-secret", signedUrlSeconds: 300 };
it.each([10 * 1024 * 1024 + 1, 50 * 1024 * 1024])("accepts a direct upload of %i bytes", bytes => {
  expect(directUploadSchema.safeParse({ contentType: "image/png", bytes, checksum: "a".repeat(64) }).success).toBe(true);
});
it("accepts older clients that omit the optional checksum", () => {
  expect(directUploadSchema.safeParse({ contentType: "image/png", bytes: 12 }).success).toBe(true);
});
it.each([0, 50 * 1024 * 1024 + 1])("rejects a direct upload of %i bytes", bytes => {
  expect(directUploadSchema.safeParse({ contentType: "image/png", bytes, checksum: "a".repeat(64) }).success).toBe(false);
});
async function fixture() {
  const bytes = await sharp({ create: { width: 64, height: 32, channels: 3, background: "red" } }).jpeg().toBuffer();
  let intent, asset;
  const db = { assetUpload: { create: vi.fn(async ({ data }) => { intent = data; return data; }), findUnique: vi.fn(async () => intent) },
    asset: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => asset), upsert: vi.fn(async ({ create }) => { asset ||= { status: "active", ...create }; return asset; }) } };
  const store = { assertPrivateBucket: vi.fn(), signedUpload: vi.fn(async () => "https://cos.example/signed-put"), head: vi.fn(async () => ({ etag: '"version-1"', "content-length": String(bytes.length) })), get: vi.fn(async () => bytes), copy: vi.fn() };
  const input = { contentType: "image/jpeg", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") };
  const plan = await prepareDirectUpload("owner", input, { db, store, config });
  return { db, store, input, plan, intent: () => intent };
}
it("directly signs a bounded private PUT, validates bytes and freezes an immutable COS original", async () => {
  const f = await fixture();
  const result = await completeDirectUpload("owner", f.plan.uploadId, { ...f, config });
  expect(result).toMatchObject({ userId: "owner", contentType: "image/jpeg", bytes: f.input.bytes, checksum: f.input.checksum, width: 64, height: 32 });
  expect(result.objectKey).toBe(`letaidraw/originals/owner/upload/${f.plan.uploadId}.jpg`);
  expect(parseCosObjectKey(result.objectKey)).toMatchObject({ key: result.objectKey });
  expect(f.store.get).toHaveBeenCalledWith(`letaidraw/uploads/pending/owner/${f.plan.uploadId}`, '"version-1"');
  expect(f.store.copy).toHaveBeenCalledWith(`letaidraw/uploads/pending/owner/${f.plan.uploadId}`, `letaidraw/originals/owner/upload/${f.plan.uploadId}.jpg`, '"version-1"', "image/jpeg");
  expect(await completeDirectUpload("owner", f.plan.uploadId, { ...f, config })).toEqual(result);
  expect(f.store.copy).toHaveBeenCalledTimes(1);
  const url = new URL(await cosStorage(config).signedUpload("pending/image", "image/png", 100));
  expect(url.searchParams.get("q-header-list")).toBe("content-length;content-type;host");
  expect(url.href).not.toContain(config.secretKey + "&");
});
it("reuses a previously validated asset with the same user-scoped checksum", async () => {
  const f = await fixture();
  f.db.assetUpload.create.mockClear(); f.store.signedUpload.mockClear(); f.store.assertPrivateBucket.mockClear();
  f.db.asset.findFirst.mockResolvedValueOnce({ id: "existing-asset", width: 64, height: 32 });
  expect(await prepareDirectUpload("owner", f.input, { ...f, config })).toEqual({ mode: "existing", assetId: "existing-asset", url: "/api/assets/existing-asset", width: 64, height: 32 });
  expect(f.store.signedUpload).not.toHaveBeenCalled();
  expect(f.db.assetUpload.create).not.toHaveBeenCalled();
});
it("derives the canonical checksum from the validated COS bytes when an older intent has none", async () => {
  const f = await fixture();
  f.intent().checksum = "";
  const result = await completeDirectUpload("owner", f.plan.uploadId, { ...f, config });
  expect(result.checksum).toBe(f.input.checksum);
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
it("uses the existing upload endpoint with no COS calls when either switch is off or the old config has no upload switch", async () => {
  const f = await fixture();
  f.store.assertPrivateBucket.mockClear(); f.store.signedUpload.mockClear(); f.db.assetUpload.create.mockClear();
  for (const changes of [{ enabled: false }, { directUploadEnabled: false }, { directUploadEnabled: undefined }]) {
    expect(await prepareDirectUpload("owner", f.input, { ...f, config: { ...config, ...changes } })).toEqual({ mode: "proxy" });
  }
  expect(f.db.assetUpload.create).not.toHaveBeenCalled();
  expect(f.store.assertPrivateBucket).not.toHaveBeenCalled();
  expect(f.store.signedUpload).not.toHaveBeenCalled();
});
it("finishes already uploaded images when direct upload is switched off", async () => {
  const f = await fixture();
  expect(await completeDirectUpload("owner", f.plan.uploadId, { ...f, config: { ...config, directUploadEnabled: false } })).toMatchObject({ id: f.plan.uploadId, checksum: f.input.checksum });
});

it("finishes upload intents created with a legacy COS locator", async () => {
  const f = await fixture();
  f.intent().objectKey = `cos://${config.bucket}/${config.region}/${f.intent().objectKey}`;
  const result = await completeDirectUpload("owner", f.plan.uploadId, { ...f, config });
  expect(result.objectKey).toBe(`letaidraw/originals/owner/upload/${f.plan.uploadId}.jpg`);
  expect(f.store.head).toHaveBeenCalledWith(`letaidraw/uploads/pending/owner/${f.plan.uploadId}`);
});
