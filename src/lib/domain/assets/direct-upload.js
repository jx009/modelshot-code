import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import sharp from "sharp";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { getCosConfig, cosTargetId } from "../../infra/storage/cos-config.js";
import { cosStorage } from "../../infra/storage/cos.js";
import { cosObjectKey, primaryCos } from "../../infra/storage/cos-primary.js";
import { imageTransfers, imageProcessing } from "../../infra/concurrency.js";
import { enqueueCosAsset } from "./cos-delivery.js";

export const directUploadSchema = z.object({ contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  bytes: z.number().int().positive().max(10 * 1024 * 1024), checksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export async function prepareDirectUpload(userId, input, { db = prisma, config, store } = {}) {
  input = directUploadSchema.parse(input);
  config ||= await getCosConfig(db);
  if (!config.enabled || !config.directUploadEnabled) return { mode: "proxy" };
  store ||= cosStorage(config);
  await store.assertPrivateBucket();
  const id = randomUUID(), key = `${config.prefix}/uploads/pending/${userId}/${id}`;
  await db.assetUpload.create({ data: { id, userId, objectKey: cosObjectKey(config, key), targetId: cosTargetId(config), ...input, expiresAt: new Date(Date.now() + 900000) } });
  return { mode: "cos", uploadId: id, url: await store.signedUpload(key, input.contentType, input.bytes), headers: { "Content-Type": input.contentType } };
}
export async function completeDirectUpload(userId, id, { db = prisma, config, store } = {}) {
  const intent = await db.assetUpload.findUnique({ where: { id } });
  if (!intent || intent.userId !== userId) throw new AppError("UPLOAD_NOT_FOUND", 404);
  const existing = await db.asset.findUnique({ where: { id } });
  if (existing) {
    if (existing.userId !== userId || existing.status !== "active") throw new AppError("ASSET_NOT_FOUND", 404);
    return existing;
  }
  if (+intent.expiresAt < Date.now()) throw new AppError("UPLOAD_EXPIRED", 410);
  config ||= await getCosConfig(db);
  if (intent.targetId !== cosTargetId(config)) throw new AppError("COS_UPLOAD_CONFIG_CHANGED", 409);
  store ||= cosStorage(config);
  const source = intent.objectKey.split("/").slice(4).join("/");
  return imageTransfers.run(async () => {
    const headers = await store.head(source), etag = headers.etag;
    if (!etag || Number(headers["content-length"]) !== intent.bytes) throw new AppError("UPLOAD_SIZE_MISMATCH", 422);
    // Conditional read/copy binds validation to the same bytes even if a PUT URL is replayed.
    const bytes = await store.get(source, etag);
    if (bytes.length !== intent.bytes || createHash("sha256").update(bytes).digest("hex") !== intent.checksum) throw new AppError("UPLOAD_CHECKSUM_MISMATCH", 422);
    const metadata = await imageProcessing.run(async () => {
      try {
        const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" });
        const meta = await image.metadata();
        if ({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp" }[meta.format] !== intent.contentType || (meta.pages || 1) !== 1) throw new Error("Invalid format");
        await image.stats(); // Fully decode; do not accept a forged header or a truncated body.
        const rotated = [5, 6, 7, 8].includes(meta.orientation);
        return { width: rotated ? meta.height : meta.width, height: rotated ? meta.width : meta.height };
      } catch { throw new AppError("INVALID_IMAGE", 415); }
    });
    const key = `${config.prefix}/originals/${userId}/upload/${id}.${{ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[intent.contentType]}`;
    await store.copy(source, key, etag, intent.contentType);
    let asset;
    try {
      asset = await db.asset.upsert({ where: { id }, create: { id, userId, objectKey: cosObjectKey(config, key), kind: "upload", contentType: intent.contentType, bytes: intent.bytes, checksum: intent.checksum, ...metadata }, update: {} });
    } catch (error) {
      // Prisma may emulate an empty-update upsert. A parallel completion can
      // win the insert after our initial read; return that identical asset.
      if (error.code !== "P2002") throw error;
      asset = await db.asset.findUnique({ where: { id } });
      if (!asset || asset.checksum !== intent.checksum) throw error;
    }
    if (asset.userId !== userId || asset.status !== "active") throw new AppError("ASSET_NOT_FOUND", 404);
    await enqueueCosAsset(id, { db, config });
    return asset;
  });
}
export async function cleanupDirectUploads(db = prisma) {
  // Wait beyond the signed PUT lifetime so an old URL cannot recreate a deleted staging object.
  for (const row of await db.assetUpload.findMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400000) } }, take: 100 })) {
    try {
      const target = await primaryCos(row.objectKey);
      await target.store.delete(target.key);
      await db.assetUpload.delete({ where: { id: row.id } });
    } catch { console.warn(JSON.stringify({ code: "UPLOAD_CLEANUP_DEFERRED", uploadId: row.id })); }
  }
}
