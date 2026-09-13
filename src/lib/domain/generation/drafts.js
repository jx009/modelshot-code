import { z } from "zod";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { ownedAsset } from "../assets/service.js";

export const draftSchema = z.object({ id: z.string().max(128).optional(), version: z.number().int().positive().optional(), name: z.string().trim().min(1).max(100),
  projectId: z.string().max(128).nullable().optional(), config: z.record(z.string(), z.unknown()),
}).strict();

export async function saveDraft(userId, input, db = prisma) {
  const data = draftSchema.parse(input);
  if (JSON.stringify(data.config).length > 32_768) throw new AppError("DRAFT_TOO_LARGE", 413);
  if (!Array.isArray(data.config.images) || data.config.images.length > 50) throw new AppError("INVALID_DRAFT");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    if (data.projectId && !await tx.project.findFirst({ where: { id: data.projectId, userId, archivedAt: null } })) throw new AppError("PROJECT_NOT_FOUND", 404);
    const refs = [...new Set([...data.config.images, data.config.personImage, ...(data.config.referenceImages || []).map(row => row?.id)].filter(Boolean))];
    const assets = [];
    for (const reference of refs) assets.push(await ownedAsset(userId, reference, tx));
    let draft;
    if (data.id) {
      const current = await tx.draft.findFirst({ where: { id: data.id, userId } });
      if (!current) throw new AppError("DRAFT_NOT_FOUND", 404);
      if (current.version !== data.version) throw new AppError("DRAFT_VERSION_CONFLICT", 409);
      draft = await tx.draft.update({ where: { id: current.id }, data: { name: data.name, projectId: data.projectId || null, config: data.config, version: { increment: 1 } } });
      await tx.assetReference.deleteMany({ where: { entityId: draft.id, kind: "draft" } });
    } else draft = await tx.draft.create({ data: { userId, name: data.name, projectId: data.projectId || null, config: data.config } });
    for (const asset of assets) await tx.assetReference.create({ data: { assetId: asset.id, entityId: draft.id, kind: "draft" } });
    return draft;
  });
}
