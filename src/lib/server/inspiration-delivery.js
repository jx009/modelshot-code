import { createHash } from "node:crypto";
import sharp from "sharp";
import { prisma } from "../prisma.js";
import { getCosConfig, cosTargetId } from "../infra/storage/cos-config.js";
import { cosStorage } from "../infra/storage/cos.js";
import { findInspiration, readInspirationImage } from "./inspiration.js";

const hash = value => createHash("sha256").update(value).digest("hex");
const builtinHashes = new Map();
const signedLinks = new Map();

async function deliveryLinks(entry, config, target, now) {
  const key = `${entry.key}:${config.signedUrlSeconds}`;
  let cached = signedLinks.get(key);
  if (!cached || cached.expiresAt <= now + 30000) {
    if (signedLinks.size >= 600) signedLinks.delete(signedLinks.keys().next().value);
    cached = { expiresAt: now + config.signedUrlSeconds * 1000, urls: Promise.all([target.signedUrl(entry.original), target.signedUrl(entry.thumbnail)]) };
    signedLinks.set(key, cached);
    cached.urls.catch(() => { if (signedLinks.get(key) === cached) signedLinks.delete(key); });
  }
  const [imageUrl, thumbnailUrl] = await cached.urls;
  return { imageUrl, thumbnailUrl, expiresAt: cached.expiresAt };
}

async function sourceVersion(item, db) {
  if (item.cover.type === "builtin") {
    const file = `${item.cover.file}:${item.imageVersion || "legacy"}`;
    if (!builtinHashes.has(file)) {
      const pending = readInspirationImage(item, db).then(image => hash(image.bytes));
      builtinHashes.set(file, pending);
      pending.catch(() => builtinHashes.delete(file));
    }
    return builtinHashes.get(file);
  }
  const asset = await db.asset.findFirst({ where: { id: item.cover.assetId, status: "active", references: { some: { kind: "inspiration", entityId: item.id } } }, select: { checksum: true } });
  if (!asset) throw new Error("INSPIRATION_ASSET_UNAVAILABLE");
  return asset.checksum;
}

async function descriptor(item, config, db) {
  const revision = hash(JSON.stringify([item.id, item.cover, await sourceVersion(item, db)]));
  const key = `inspiration_cos_v1:${cosTargetId(config)}:${revision}`;
  const prefix = `${config.prefix}/inspiration/v1/${revision}`;
  return { key, original: `${prefix}/original`, thumbnail: `${prefix}/640.webp` };
}

// Receipts are durable internal SystemConfig records, separate from the editable
// gallery. They survive deploys; only the short-lived access signatures expire.
export async function inspirationDelivery(gallery, { db = prisma, config, target, now = Date.now() } = {}) {
  try {
    config ||= await getCosConfig(db);
    if (!config.enabled) return gallery;
    target ||= cosStorage(config);
    let pending = false;
    let expiresAt = now + config.signedUrlSeconds * 1000;
    const items = await Promise.all(gallery.items.map(async item => {
      try {
        const entry = await descriptor(item, config, db);
        const receipt = await db.systemConfig.findUnique({ where: { key: entry.key } });
        if (receipt?.value !== "ready") { pending = true; return item; }
        // Share still-valid links across visitors/polls, avoiding a fresh image
        // download just because the gallery metadata was refreshed.
        const { imageUrl, thumbnailUrl, expiresAt: linkExpiry } = await deliveryLinks(entry, config, target, now);
        expiresAt = Math.min(expiresAt, linkExpiry);
        return { ...item, imageUrl, thumbnailUrl };
      } catch { pending = true; return item; }
    }));
    return { ...gallery, items, deliveryPending: pending, deliveryExpiresAt: expiresAt };
  } catch { return gallery; }
}

// Called after the first gallery response. Enqueue every published image, not
// just visible cards. Database uniqueness coalesces concurrent visitors.
export async function enqueueInspirationGallery(gallery, { db = prisma, config, now = Date.now() } = {}) {
  try {
    config ||= await getCosConfig(db);
    if (!config.enabled) return;
    for (const item of gallery.items) {
      try {
        const entry = await descriptor(item, config, db);
        const receipt = await db.systemConfig.findUnique({ where: { key: entry.key } });
        if (receipt?.value === "ready") continue;
        // Queue retries handle transient failures; a later visit can re-enqueue
        // after exhausted retries without permanently stranding an image.
        const businessKey = `inspiration-mirror:${entry.key}:${Math.floor(now / 600000)}`;
        await db.outboxEvent.upsert({ where: { businessKey }, create: { businessKey, kind: "inspiration-mirror", entityId: item.id }, update: {} });
      } catch { console.warn(JSON.stringify({ code: "INSPIRATION_COS_ENQUEUE_DEFERRED", id: item.id })); }
    }
  } catch { console.warn(JSON.stringify({ code: "INSPIRATION_COS_CONFIG_UNAVAILABLE" })); }
}

export async function processInspirationMirror(id, { db = prisma, config, target, source } = {}) {
  config ||= await getCosConfig(db);
  if (!config.enabled) return;
  const item = await findInspiration(id, db);
  if (!item) return; // Removed/hidden entries must not be newly published.
  const entry = await descriptor(item, config, db);
  target ||= cosStorage(config);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${entry.key}, 0))::text`;
    if ((await tx.systemConfig.findUnique({ where: { key: entry.key } }))?.value === "ready") return;
    await target.assertPrivateBucket();
    const { bytes, contentType } = await readInspirationImage(item, tx, source);
    const thumbnail = await sharp(bytes).rotate().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    await target.put(entry.original, bytes, contentType);
    await target.put(entry.thumbnail, thumbnail, "image/webp");
    await tx.systemConfig.upsert({ where: { key: entry.key }, create: { key: entry.key, value: "ready" }, update: { value: "ready" } });
  }, { timeout: 120000, maxWait: 10000 });
}
