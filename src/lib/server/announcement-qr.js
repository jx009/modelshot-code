import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { AppError } from "../http.js";
import { getCosConfig } from "../infra/storage/cos-config.js";
import { cosStorage, cosError } from "../infra/storage/cos.js";
import { announcementQrSchema } from "../announcements.js";

export const QR_MAX_BYTES = 5 * 1024 * 1024;
// Credentials may rotate without moving or invalidating a permanent object.
export function qrTarget(config) {
  return createHash("sha256").update(JSON.stringify([config.bucket, config.region, config.prefix])).digest("hex").slice(0, 32);
}
function qrKey(config, id) { return `${config.prefix}/announcements/${id}.png`; }
async function configured(config) {
  config ||= await getCosConfig();
  if (!config.enabled) throw new AppError("COS_NOT_ENABLED");
  return config;
}
export async function uploadAnnouncementQr(bytes, { config, store } = {}) {
  if (!bytes.length || bytes.length > QR_MAX_BYTES) throw new AppError("QR_IMAGE_TOO_LARGE", 413);
  config = await configured(config);
  let png;
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: "error" });
    const meta = await image.metadata();
    if (!["png", "jpeg", "webp"].includes(meta.format) || (meta.pages || 1) > 1) throw new Error("Unsupported image");
    // Preserve QR modules and whitespace: no resizing, cropping or lossy encoding.
    png = await image.rotate().png().toBuffer();
  } catch { throw new AppError("QR_IMAGE_INVALID"); }
  const qrImage = { id: randomUUID(), target: qrTarget(config) };
  try {
    store ||= cosStorage(config);
    await store.assertPrivateBucket();
    await store.put(qrKey(config, qrImage.id), png, "image/png");
    return { qrImage, region: config.region };
  } catch (error) { throw cosError(error); }
}
export async function announcementQrUrl(value, { config, store } = {}) {
  const parsed = announcementQrSchema.safeParse(value);
  if (!parsed.success) throw new AppError("QR_IMAGE_NOT_FOUND", 404);
  config = await configured(config);
  if (parsed.data.target !== qrTarget(config)) throw new AppError("QR_STORAGE_CHANGED", 409);
  try { return { url: await (store || cosStorage(config)).signedUrl(qrKey(config, parsed.data.id)) }; }
  catch (error) { throw cosError(error); }
}
