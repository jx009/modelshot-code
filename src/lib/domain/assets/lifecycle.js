import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { objectStorage } from "../../infra/storage/s3.js";

export async function deleteAsset(userId, id, db = prisma) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const asset = await tx.asset.findFirst({ where: { id, userId, status: "active" }, include: { _count: { select: { references: true } } } });
    if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);
    if (asset._count.references) throw new AppError("ASSET_IN_USE", 409);
    await tx.asset.update({ where: { id }, data: { status: "deleted", deletedAt: new Date() } });
    return { ok: true };
  });
}

export async function cleanupStorage({ db = prisma, store = objectStorage(), now = new Date() } = {}) {
  const assets = await db.asset.findMany({ where: { status: "deleted", deletedAt: { lt: new Date(+now - 7 * 86400_000) }, references: { none: {} } }, take: 100 });
  for (const asset of assets) { await store.delete(asset.objectKey); await db.asset.update({ where: { id: asset.id }, data: { status: "purged" } }); }
  const exports = await db.exportJob.findMany({ where: { OR: [{ expiresAt: { lt: now }, objectKey: { not: null } }, { status: { in: ["failed", "cancelled"] }, updatedAt: { lt: new Date(+now - 86400_000) } }] }, take: 100 });
  for (const job of exports) {
    if (job.objectKey) await store.delete(job.objectKey);
    await db.$transaction(async tx => { await tx.exportJob.update({ where: { id: job.id }, data: { objectKey: null, status: "expired" } }); await tx.assetReference.deleteMany({ where: { entityId: job.id, kind: "export" } }); });
  }
  await db.rateLimit.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.verificationCode.deleteMany({ where: { expiresAt: { lt: new Date(+now - 86400_000) } } });
  return { assets: assets.length, exports: exports.length };
}

export async function cleanupOrphans({ db = prisma, store = objectStorage(), now = new Date() } = {}) {
  let cursor, scanned = 0, removed = 0;
  do {
    const page = await store.list(cursor);
    for (const object of page.Contents || []) {
      scanned++;
      if (!object.LastModified || +now - object.LastModified < 86400_000) continue;
      if (await db.asset.findUnique({ where: { objectKey: object.Key } }) || await db.exportJob.findFirst({ where: { objectKey: object.Key } })) continue;
      const parts = object.Key.split("/");
      if (parts.length !== 3 || !["upload", "original", "delivery", "exports"].includes(parts[1])) continue;
      // A stable original key may be awaiting database recovery; keep every active job's objects.
      const outputId = parts[2].split("_original")[0].split("_delivery_")[0];
      if (await db.tryOn.findFirst({ where: { id: outputId, status: { notIn: ["succeeded", "failed", "cancelled"] } } })) continue;
      await store.delete(object.Key); removed++;
    }
    cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (cursor);
  return { scanned, removed };
}
