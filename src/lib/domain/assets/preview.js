import sharp from "sharp";
import { AppError } from "../../http.js";

const cache = new Map(), pending = new Map();
const MAX_BYTES = 32 * 1024 * 1024;
let used = 0;

export function previewSize(value) {
  if (value === null || value === undefined) return null;
  const size = Number(value);
  if (![320, 1280].includes(size)) throw new AppError("INVALID_PREVIEW_SIZE", 400);
  return size;
}

export async function imagePreview(asset, size, store) {
  const key = asset.userId + ":" + asset.id + ":" + asset.checksum + ":" + size;
  if (cache.has(key)) {
    const bytes = cache.get(key); cache.delete(key); cache.set(key, bytes); return bytes;
  }
  if (pending.has(key)) return pending.get(key);
  if (pending.size >= 16) throw new AppError("PREVIEW_BUSY", 503, true);
  const task = (async () => {
    const source = await store.get(asset.objectKey);
    const bytes = await sharp(source, { limitInputPixels: 40_000_000 }).resize(size, size, { fit: "inside", withoutEnlargement: true }).webp({ quality: 84, alphaQuality: 100 }).toBuffer();
    while (cache.size && used + bytes.length > MAX_BYTES) { const oldest = cache.keys().next().value; used -= cache.get(oldest).length; cache.delete(oldest); }
    if (bytes.length <= MAX_BYTES) { cache.set(key, bytes); used += bytes.length; }
    return bytes;
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}
