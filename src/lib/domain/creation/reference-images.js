import { createHash } from "node:crypto";
import sharp from "sharp";
import { AppError } from "../../http.js";
import { prisma } from "../../prisma.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { ConcurrencyGate } from "../../infra/concurrency.js";
import { IMAGE_UPLOAD_MAX_BYTES } from "../../image-upload-limits.js";

// This module is used only by the creation-language worker. One decoder per
// process, sequential originals, bounded streams and small transient previews.
const processing = new ConcurrencyGate(1);
const MAX_TOTAL_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 512 * 1024;
const MAX_CACHE_BYTES = 16 * 1024 * 1024, CACHE_TTL_MS = 10 * 60 * 1000;
const previews = new Map();
let cacheBytes = 0;
const formats = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

function removeCached(key, entry) { previews.delete(key); cacheBytes -= entry.bytes; }
function cached(key) {
  const entry = previews.get(key);
  if (!entry) return null;
  if (entry.until <= Date.now()) { removeCached(key, entry); return null; }
  previews.delete(key); previews.set(key, entry);
  return entry.image;
}
function remember(key, image) {
  const bytes = Buffer.byteLength(image.dataUrl);
  for (const [oldKey, entry] of previews) if (entry.until <= Date.now()) removeCached(oldKey, entry);
  while (previews.size && (cacheBytes + bytes > MAX_CACHE_BYTES || previews.size >= 32)) {
    const [oldKey, entry] = previews.entries().next().value; removeCached(oldKey, entry);
  }
  previews.set(key, { image, bytes, until: Date.now() + CACHE_TTL_MS }); cacheBytes += bytes;
}

async function readBounded(asset, store, signal) {
  signal.throwIfAborted();
  const stream = await store.stream(asset.objectKey, undefined, signal), reader = stream.getReader();
  const bytes = Buffer.allocUnsafe(asset.bytes);
  let offset = 0, complete = false;
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      if (offset + chunk.value.byteLength > bytes.length) throw new AppError("CREATION_REFERENCE_INVALID", 422);
      bytes.set(chunk.value, offset); offset += chunk.value.byteLength;
    }
    if (offset !== bytes.length || createHash("sha256").update(bytes).digest("hex") !== asset.checksum) throw new AppError("CREATION_REFERENCE_INVALID", 422);
    complete = true;
    return bytes;
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function prepare(userId, asset, store, signal) {
  return processing.run(async () => {
    signal.throwIfAborted();
    // The caller rechecks ownership/status before every cache lookup. Immutable
    // checksum keys let subsequent PPT pages reuse the same bounded preview.
    const key = `${userId}:${asset.id}:${asset.checksum}`, previous = cached(key);
    if (previous) return previous;
    const bytes = await readBounded(asset, store, signal);
    try {
      const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning", animated: false });
      const metadata = await image.metadata();
      if (formats[metadata.format] !== asset.contentType || (metadata.pages || 1) !== 1) throw new AppError("CREATION_REFERENCE_INVALID", 422);
      signal.throwIfAborted();
      let result = await image.rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" }).jpeg({ quality: 80 }).timeout({ seconds: 10 }).toBuffer();
      if (result.length > MAX_PREVIEW_BYTES) result = await sharp(result).resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 70 }).timeout({ seconds: 5 }).toBuffer();
      signal.throwIfAborted();
      if (result.length > MAX_PREVIEW_BYTES) throw new AppError("CREATION_REFERENCE_TOO_LARGE", 413);
      const preview = { assetId: asset.id, dataUrl: `data:image/jpeg;base64,${result.toString("base64")}` };
      remember(key, preview);
      return preview;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof AppError) throw error;
      throw new AppError("CREATION_REFERENCE_INVALID", 422);
    }
  });
}

export async function prepareCreationReferenceImages(userId, inputIds, { db = prisma, store = objectStorage(), signal } = {}) {
  const ids = [...new Set(inputIds)];
  if (!ids.length) return { assets: [], images: [] };
  if (ids.length > 8) throw new AppError("CREATION_REFERENCE_TOO_LARGE", 413);
  const assets = await db.asset.findMany({ where: { id: { in: ids }, userId, status: "active", contentType: { in: Object.values(formats) } },
    select: { id: true, width: true, height: true, bytes: true, checksum: true, objectKey: true, contentType: true } });
  if (assets.length !== ids.length) throw new AppError("ASSET_NOT_FOUND", 404);
  if (assets.some(asset => !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > IMAGE_UPLOAD_MAX_BYTES)
    || assets.reduce((total, asset) => total + asset.bytes, 0) > MAX_TOTAL_SOURCE_BYTES) throw new AppError("CREATION_REFERENCE_TOO_LARGE", 413);
  const ordered = ids.map(id => assets.find(asset => asset.id === id)), images = [];
  const boundedSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(60000)]);
  try {
    for (const asset of ordered) images.push(await prepare(userId, asset, store, boundedSignal));
  } catch (error) {
    if (boundedSignal.aborted && !signal?.aborted) throw new AppError("CREATION_REFERENCE_TIMEOUT", 504);
    throw error;
  }
  return { assets: ordered.map(({ id, width, height }) => ({ id, width, height })), images };
}
