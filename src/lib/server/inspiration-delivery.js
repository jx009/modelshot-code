import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { prisma } from "../prisma.js";
import { getCosConfig, cosTargetId } from "../infra/storage/cos-config.js";
import { cosStorage } from "../infra/storage/cos.js";
import { findInspiration, readInspirationImage } from "./inspiration.js";
import { cdnImageUrl } from "../asset-cdn.js";

const hash = value => createHash("sha256").update(value).digest("hex");
const builtinHashes = new Map();
const mirrorTasks = new Map();

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

async function descriptors(items, config, db) {
  const assetItems = items.filter(item => item.cover.type === "asset");
  const assetIds = [...new Set(assetItems.map(item => item.cover.assetId))];
  const assetRows = assetIds.length ? await db.asset.findMany({
    where: {
      id: { in: assetIds },
      status: "active",
      references: { some: { kind: "inspiration", entityId: { in: assetItems.map(item => item.id) } } },
    },
    select: {
      id: true,
      checksum: true,
      references: { where: { kind: "inspiration", entityId: { in: assetItems.map(item => item.id) } }, select: { entityId: true } },
    },
  }) : [];
  const assetVersions = new Map();
  for (const asset of assetRows) {
    for (const reference of asset.references) assetVersions.set(`${reference.entityId}:${asset.id}`, asset.checksum);
  }
  return Promise.all(items.map(async item => {
    try {
      const version = item.cover.type === "builtin"
        ? await sourceVersion(item, db)
        : assetVersions.get(`${item.id}:${item.cover.assetId}`);
      if (!version) throw new Error("INSPIRATION_ASSET_UNAVAILABLE");
      const revision = hash(JSON.stringify([item.id, item.cover, version]));
      const key = `inspiration_cos_v1:${cosTargetId(config)}:${revision}`;
      const prefix = `${config.prefix}/inspiration/v1/${revision}`;
      return { item, entry: { key, original: `${prefix}/original`, thumbnail: `${prefix}/640.webp` } };
    } catch (error) {
      return { item, error };
    }
  }));
}

export async function inspirationDelivery(gallery, { db = prisma, config } = {}) {
  try {
    config ||= await getCosConfig(db);
    if (!config.enabled) return gallery;
    let pending = false;
    const resolved = await descriptors(gallery.items, config, db);
    const keys = resolved.filter(result => result.entry).map(result => result.entry.key);
    const receipts = keys.length ? await db.systemConfig.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } }) : [];
    const receiptMap = new Map(receipts.map(receipt => [receipt.key, receipt.value]));
    const items = resolved.map(({ item, entry, error }) => {
      if (error || !entry || receiptMap.get(entry.key) !== "ready") { pending = true; return item; }
      try {
        return { ...item, imageUrl: cdnImageUrl(entry.original), thumbnailUrl: cdnImageUrl(entry.thumbnail) };
      } catch { pending = true; return item; }
    });
    return { ...gallery, items, deliveryPending: pending };
  } catch { return gallery; }
}

// Called after the first gallery response. Enqueue every published image, not
// just visible cards. Database uniqueness coalesces concurrent visitors.
export async function enqueueInspirationGallery(gallery, { db = prisma, config, now = Date.now() } = {}) {
  try {
    config ||= await getCosConfig(db);
    if (!config.enabled) return;
    const resolved = await descriptors(gallery.items, config, db);
    const keys = resolved.filter(result => result.entry).map(result => result.entry.key);
    const receipts = keys.length ? await db.systemConfig.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } }) : [];
    const ready = new Set(receipts.filter(receipt => receipt.value === "ready").map(receipt => receipt.key));
    const pending = resolved.filter(result => result.entry && !ready.has(result.entry.key));
    if (pending.length) {
      const minute = Math.floor(now / 600000);
      await db.outboxEvent.createMany({
        data: pending.map(({ item, entry }) => ({ businessKey: `inspiration-mirror:${entry.key}:${minute}`, kind: "inspiration-mirror", entityId: item.id })),
        skipDuplicates: true,
      });
    }
    for (const { item, error } of resolved) if (error) console.warn(JSON.stringify({ code: "INSPIRATION_COS_ENQUEUE_DEFERRED", id: item.id }));
  } catch { console.warn(JSON.stringify({ code: "INSPIRATION_COS_CONFIG_UNAVAILABLE" })); }
}

export async function processInspirationMirror(id, options = {}) {
  const { db = prisma } = options;
  const config = options.config || await getCosConfig(db);
  if (!config.enabled) return;
  const item = await findInspiration(id, db);
  if (!item) return;
  const entry = await descriptor(item, config, db);
  const existing = mirrorTasks.get(entry.key);
  if (existing) return existing;
  const task = performInspirationMirror(id, entry, { ...options, db, config });
  mirrorTasks.set(entry.key, task);
  try { await task; }
  finally { if (mirrorTasks.get(entry.key) === task) mirrorTasks.delete(entry.key); }
}

async function performInspirationMirror(id, entry, { db, config, target, source }) {
  const item = await findInspiration(id, db);
  if (!item) return; // Removed/hidden entries must not be newly published.
  if ((await descriptor(item, config, db)).key !== entry.key) return;
  const lease = JSON.stringify({ token: randomUUID(), expiresAt: Date.now() + 300000 });
  const claimed = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${entry.key}, 0))::text`;
    const receipt = await tx.systemConfig.findUnique({ where: { key: entry.key } });
    if (receipt?.value === "ready") return false;
    if (receipt?.value) {
      let active;
      try { active = JSON.parse(receipt.value); } catch {}
      if (active?.expiresAt > Date.now()) throw new Error("INSPIRATION_MIRROR_BUSY");
    }
    await tx.systemConfig.upsert({ where: { key: entry.key }, create: { key: entry.key, value: lease }, update: { value: lease } });
    return true;
  }, { timeout: 15000, maxWait: 5000 });
  if (!claimed) return;
  try {
    target ||= cosStorage(config);
    await target.assertPrivateBucket();
    const { bytes, contentType } = await readInspirationImage(item, db, source);
    const thumbnail = await sharp(bytes).rotate().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    await target.put(entry.original, bytes, contentType);
    await target.put(entry.thumbnail, thumbnail, "image/webp");
    await db.$transaction(async tx => {
      const current = await findInspiration(id, tx);
      if (!current || (await descriptor(current, config, tx)).key !== entry.key) return;
      const result = await tx.systemConfig.updateMany({ where: { key: entry.key, value: lease }, data: { value: "ready" } });
      if (!result.count) throw new Error("INSPIRATION_MIRROR_LEASE_LOST");
    }, { timeout: 15000, maxWait: 5000 });
  } finally {
    await db.systemConfig.deleteMany({ where: { key: entry.key, value: lease } });
  }
}
