import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { ownedAsset } from "./service.js";
import { lockUser } from "../billing/ledger.js";

async function categoryOwned(tx, userId, categoryId) {
  if (categoryId && !await tx.libraryCategory.findFirst({ where: { id: categoryId, userId } })) throw new AppError("CATEGORY_NOT_FOUND", 404);
}
export async function addLibraryItem(userId, data, db = prisma) {
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const asset = await ownedAsset(userId, data.assetId, tx);
    if (!asset.contentType.startsWith("image/")) throw new AppError("INVALID_SOURCE", 422);
    await categoryOwned(tx, userId, data.categoryId);
    const item = await tx.libraryItem.upsert({ where: { userId_assetId: { userId, assetId: data.assetId } }, create: { userId, assetId: data.assetId, name: data.name, categoryId: data.categoryId }, update: { name: data.name, deletedAt: null, ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}) } });
    await tx.assetReference.upsert({ where: { assetId_entityId_kind: { assetId: data.assetId, entityId: item.id, kind: "library" } }, create: { assetId: data.assetId, entityId: item.id, kind: "library" }, update: {} });
    return item;
  });
}
export async function updateLibraryItem(userId, id, input, db = prisma) {
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const item = await tx.libraryItem.findFirst({ where: { id, userId } });
    if (!item) throw new AppError("LIBRARY_ITEM_NOT_FOUND", 404);
    if (input.restore && item.deletedAt && +item.deletedAt < Date.now() - 30 * 86400000) throw new AppError("LIBRARY_ITEM_EXPIRED", 410);
    await categoryOwned(tx, userId, input.categoryId);
    return tx.libraryItem.update({ where: { id }, data: { ...(input.name ? { name: input.name } : {}), ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}), ...(input.trash ? { deletedAt: new Date() } : {}), ...(input.restore ? { deletedAt: null } : {}) } });
  });
}

export async function batchLibraryItems(userId, ids, action, categoryId, db = prisma) {
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const unique = [...new Set(ids)];
    const rows = await tx.libraryItem.findMany({ where: { id: { in: unique }, userId } });
    if (rows.length !== unique.length) throw new AppError("LIBRARY_ITEM_NOT_FOUND", 404);
    if (action === "restore" && rows.some(item => item.deletedAt && +item.deletedAt < Date.now() - 30 * 86400000)) throw new AppError("LIBRARY_ITEM_EXPIRED", 410);
    if (action === "category") await categoryOwned(tx, userId, categoryId);
    await tx.libraryItem.updateMany({ where: { id: { in: unique }, userId }, data: action === "trash" ? { deletedAt: new Date() } : action === "restore" ? { deletedAt: null } : { categoryId } });
    return { count: rows.length };
  });
}
