import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../prisma.js";
import { AppError } from "../http.js";
import { objectStorage } from "../infra/storage/s3.js";
import { defaultGallery, gallerySchema, upgradeDefaultGallery } from "../inspiration/gallery.js";

// Separate from generic settings: all gallery writes must maintain asset references.
const KEY = "inspiration_gallery_v1";
export const galleryVersion = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function lockInspirationGallery(tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(72619402)`;
}
export async function getInspirationGallery(db = prisma) {
  const row = await db.systemConfig.findUnique({ where: { key: KEY } });
  const gallery = gallerySchema.parse(upgradeDefaultGallery(gallerySchema.parse(row ? JSON.parse(row.value) : defaultGallery)));
  return { ...gallery, version: galleryVersion(gallery) };
}
export async function publicInspirationGallery(db = prisma) {
  const { items, layout } = await getInspirationGallery(db);
  return { items: items.filter(i => i.enabled), layout };
}
export async function findInspiration(id, db = prisma) {
  return (await publicInspirationGallery(db)).items.find(i => i.id === id) || null;
}
export async function saveInspirationGallery(tx, input) {
  await lockInspirationGallery(tx);
  const before = await getInspirationGallery(tx);
  if (before.version !== input.version) throw new AppError("INSPIRATION_CHANGED", 409);
  const after = gallerySchema.parse({ items: input.items, layout: input.layout, catalogVersion: 3 });
  const ids = [...new Set(after.items.filter(i => i.cover.type === "asset").map(i => i.cover.assetId))];
  // Lock owners just like asset deletion/retention, preventing a publication/deletion race.
  const assets = ids.length ? await tx.asset.findMany({ where: { id: { in: ids } } }) : [];
  for (const userId of [...new Set(assets.map(a => a.userId))].sort()) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const active = ids.length ? await tx.asset.findMany({ where: { id: { in: ids }, status: "active", contentType: { in: ["image/png", "image/jpeg", "image/webp"] } } }) : [];
  if (active.length !== ids.length) throw new AppError("INSPIRATION_ASSET_UNAVAILABLE", 409);
  // Retain drafts as well: switching visibility must not lose the source image.
  await tx.assetReference.deleteMany({ where: { kind: "inspiration" } });
  if (ids.length) await tx.assetReference.createMany({ data: after.items.filter(i => i.cover.type === "asset").map(i => ({ assetId: i.cover.assetId, entityId: i.id, kind: "inspiration" })) });
  await tx.systemConfig.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(after) }, update: { value: JSON.stringify(after) } });
  return { audit: { before: { items: before.items, layout: before.layout }, after } };
}
export async function readInspirationImage(item, db = prisma, store) {
  if (item.cover.type === "builtin") return { bytes: await readFile(path.join(process.cwd(), "public/inspiration/generated", `${item.cover.file}${item.imageVersion ? `.${item.imageVersion}` : ""}.webp`)), contentType: "image/webp" };
  const asset = await db.asset.findFirst({ where: { id: item.cover.assetId, status: "active", references: { some: { kind: "inspiration", entityId: item.id } } } });
  if (!asset) throw new AppError("INSPIRATION_ASSET_UNAVAILABLE", 404);
  return { bytes: await (store || objectStorage()).get(asset.objectKey), contentType: asset.contentType };
}
