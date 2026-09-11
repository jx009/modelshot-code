import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { objectStorage } from "../../infra/storage/s3.js";

export const IMAGE_LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, pixels: 40_000_000 });
const formats = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

export async function normalizeImage(bytes, declaredType) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > IMAGE_LIMITS.bytes) throw new AppError("INVALID_IMAGE_SIZE", 413);
  try {
    const image = sharp(bytes, { limitInputPixels: IMAGE_LIMITS.pixels, failOn: "warning", animated: false });
    const meta = await image.metadata();
    if (!formats[meta.format] || (meta.pages || 1) !== 1 || (declaredType && declaredType !== formats[meta.format])) throw new AppError("INVALID_IMAGE_TYPE", 415);
    const { data, info } = await image.rotate().png().toBuffer({ resolveWithObject: true });
    if (data.length > IMAGE_LIMITS.bytes) throw new AppError("INVALID_IMAGE_SIZE", 413);
    return { data, width: info.width, height: info.height, contentType: "image/png", bytes: data.length, checksum: createHash("sha256").update(data).digest("hex") };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INVALID_IMAGE", 415);
  }
}

export function assetUrl(id) { return `/api/assets/${id}`; }
export function assetId(reference) {
  if (typeof reference !== "string") throw new AppError("INVALID_ASSET");
  const id = reference.startsWith("/api/assets/") ? reference.slice(12) : reference;
  if (!/^[a-zA-Z0-9_-]{16,64}$/.test(id)) throw new AppError("INVALID_ASSET");
  return id;
}

export async function ownedAsset(userId, reference, db = prisma) {
  const asset = await db.asset.findFirst({ where: { id: assetId(reference), userId, status: "active" } });
  if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);
  return asset;
}

export async function readOwnedImage(userId, reference, db = prisma, store = objectStorage()) {
  const asset = await ownedAsset(userId, reference, db);
  return store.get(asset.objectKey);
}

export async function createImage(userId, bytes, { kind = "upload", id = randomUUID(), declaredType } = {}, db = prisma, store = objectStorage()) {
  const normalized = await normalizeImage(bytes, declaredType);
  const objectKey = `${userId}/${kind}/${id}.png`;
  const old = await db.asset.findUnique({ where: { id } });
  if (old) {
    if (old.userId !== userId || old.checksum !== normalized.checksum) throw new AppError("ASSET_CONFLICT", 409);
    return old;
  }
  // Stable object keys allow a worker to recover an upload whose DB write failed.
  await store.put(objectKey, normalized.data, normalized.contentType);
  const { data: _data, ...metadata } = normalized;
  return db.asset.create({ data: { id, userId, objectKey, kind, ...metadata } });
}

export async function readPreset(reference) {
  if (typeof reference !== "string" || !/^\/presets\/[a-zA-Z0-9/_-]+\.(png|jpg|jpeg|webp)$/.test(reference)) throw new AppError("INVALID_PRESET");
  const root = await realpath(path.join(process.cwd(), "public", "presets"));
  const file = await realpath(path.join(process.cwd(), "public", reference));
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new AppError("INVALID_PRESET");
  return (await normalizeImage(await readFile(file))).data;
}
