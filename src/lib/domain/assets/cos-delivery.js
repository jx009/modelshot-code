import { createHash } from "node:crypto";
import { prisma } from "../../prisma.js";
import { getCosConfig, cosTargetId } from "../../infra/storage/cos-config.js";
import { cosStorage } from "../../infra/storage/cos.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { imagePreview } from "./preview.js";

export const DELIVERY_VARIANTS = [320, 640, 1280, 0];
export function cosAssetKey(config, asset, variant) {
  const id = createHash("sha256").update(`${asset.userId}:${asset.id}:${asset.checksum}`).digest("hex");
  return `${config.prefix}/assets/v1/${id}/${variant ? `${variant}.webp` : "original.png"}`;
}

// Best-effort enqueue only; a storage accelerator must never fail generation.
export async function enqueueCosAsset(assetId, { db = prisma, config, now = Date.now() } = {}) {
  try {
    config ||= await getCosConfig(db);
    if (!config.enabled) return;
    const businessKey = `asset-mirror:${cosTargetId(config)}:${assetId}:${Math.floor(now / 600000)}`;
    await db.outboxEvent.upsert({ where: { businessKey }, create: { businessKey, kind: "asset-mirror", entityId: assetId }, update: {} });
  } catch { console.warn(JSON.stringify({ code: "COS_ENQUEUE_DEFERRED", assetId })); }
}

// Called only after the route has checked ownership. No COS HEAD roundtrip:
// local DB receipts identify replicas already uploaded by the durable worker.
export async function assetDeliveryUrl(asset, variant, { db = prisma, config, store } = {}) {
  config ||= await getCosConfig(db);
  if (!config.enabled || !asset.contentType.startsWith("image/")) return null;
  const targetId = cosTargetId(config);
  const receipt = await db.assetDelivery.findUnique({ where: { assetId_targetId_variant: { assetId: asset.id, targetId, variant } } });
  // Objects are permanent. Only signed access URLs expire; a successful
  // receipt stays valid until deletion, content/target changes, or repair.
  if (!receipt) return null;
  const key = cosAssetKey(config, asset, variant);
  if (receipt.objectKey !== key) return null;
  return (store || cosStorage(config)).signedUrl(key);
}

export async function assetDeliveryBatch(userId, assetIds, variants = DELIVERY_VARIANTS, { db = prisma, config, store, now = Date.now() } = {}) {
  try {
    const ids = [...new Set(assetIds.filter(id => typeof id === "string" && id))].slice(0, 256);
    if (!ids.length) return null;
    config ||= await getCosConfig(db);
    if (!config.enabled) return null;
    const receipts = await db.assetDelivery.findMany({
      where: { assetId: { in: ids }, targetId: cosTargetId(config), variant: { in: variants },
        asset: { userId, status: "active", contentType: { startsWith: "image/" } } },
      select: { assetId: true, variant: true, objectKey: true, asset: { select: { id: true, userId: true, checksum: true } } },
    });
    if (!receipts.length) return null;
    const target = store || cosStorage(config);
    const items = await Promise.all(receipts.map(async receipt => {
      if (receipt.asset.userId !== userId || receipt.asset.id !== receipt.assetId || receipt.objectKey !== cosAssetKey(config, receipt.asset, receipt.variant)) return null;
      return { assetId: receipt.assetId, variant: receipt.variant, url: await target.signedUrl(receipt.objectKey) };
    }));
    return { userId, expiresAt: now + config.signedUrlSeconds * 1000, items: items.filter(Boolean) };
  } catch {
    console.warn(JSON.stringify({ code: "COS_BATCH_DELIVERY_DEFERRED" }));
    return null;
  }
}

export function documentAssetIds(content) {
  return [...new Set([
    ...(content.layers || []).map(layer => layer.assetId),
    ...(content.messages || []).map(message => message.assetId),
    ...(content.composer?.referenceIds || []),
    content.commerce?.productAssetId, content.commerce?.referenceAssetId,
    ...(content.commerce?.sections || []).map(section => section.revisionAssetId),
  ].filter(Boolean))];
}

export async function repairCosAsset(asset, variant, { db = prisma, config } = {}) {
  config ||= await getCosConfig(db);
  if (!config.enabled) return;
  await db.assetDelivery.deleteMany({ where: { assetId: asset.id, targetId: cosTargetId(config), variant } });
  await enqueueCosAsset(asset.id, { db, config });
}

export async function processCosAsset(id, { db = prisma, config, source, target } = {}) {
  config ||= await getCosConfig(db);
  if (!config.enabled) return;
  const asset = await db.asset.findFirst({ where: { id, status: "active", contentType: { startsWith: "image/" } } });
  if (!asset) return;
  source ||= objectStorage(); target ||= cosStorage(config);
  await target.assertPrivateBucket();
  const targetId = cosTargetId(config);
  for (const variant of DELIVERY_VARIANTS) {
    const where = { assetId: id, targetId, variant };
    const receipt = await db.assetDelivery.findUnique({ where: { assetId_targetId_variant: where } });
    const key = cosAssetKey(config, asset, variant);
    if (receipt?.objectKey === key) continue;
    const bytes = variant ? await imagePreview(asset, variant, source) : await source.get(asset.objectKey);
    await target.put(key, bytes, variant ? "image/webp" : asset.contentType);
    // Handle deletion racing the upload: never publish a ready receipt afterward.
    const active = await db.asset.findFirst({ where: { id, status: "active" }, select: { id: true } });
    if (!active) { await target.delete(key); return; }
    await db.assetDelivery.upsert({ where: { assetId_targetId_variant: where }, create: { ...where, objectKey: key }, update: { objectKey: key, readyAt: new Date() } });
  }
}

export async function removeCosAsset(asset, { db = prisma, config, target } = {}) {
  config ||= await getCosConfig(db);
  // Cleanup still applies when delivery is disabled but credentials are retained.
  if (!config.bucket || !config.secretId || !config.secretKey) return;
  target ||= cosStorage(config);
  for (const variant of DELIVERY_VARIANTS) await target.delete(cosAssetKey(config, asset, variant));
  await db.assetDelivery.deleteMany({ where: { assetId: asset.id, targetId: cosTargetId(config) } });
}

export async function scheduleCosRemoval(asset, { db = prisma, config } = {}) {
  config ||= await getCosConfig(db);
  if (!config.bucket || !config.secretId || !config.secretKey) return;
  const businessKey = `asset-mirror-delete:${cosTargetId(config)}:${asset.id}`;
  await db.outboxEvent.upsert({ where: { businessKey }, create: { businessKey, kind: "asset-mirror-delete", entityId: asset.id }, update: {} });
}

export async function processCosRemoval(id, { db = prisma, ...options } = {}) {
  const asset = await db.asset.findFirst({ where: { id, status: { in: ["deleted", "purged"] } } });
  if (asset) await removeCosAsset(asset, { db, ...options });
}
