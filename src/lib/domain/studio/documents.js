import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { lockUser } from "../billing/ledger.js";
import { ownedAsset } from "../assets/service.js";
import { documentSchema } from "../../studio/tools.js";

export async function saveDocument(userId, input, db = prisma) {
  const data = documentSchema.parse(input);
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const refs = new Set([...data.content.layers.map(l => l.assetId), ...data.content.messages.map(m => m.assetId), data.content.commerce?.productAssetId, data.content.commerce?.referenceAssetId].filter(Boolean));
    for (const ref of refs) await ownedAsset(userId, ref, tx);
    for (const id of data.content.jobs) if (!await tx.tryOn.findFirst({ where: { id, userId } })) throw new AppError("JOB_NOT_FOUND", 404);
    let document;
    if (data.id) {
      const count = await tx.studioDocument.updateMany({ where: { id: data.id, userId, version: data.version || -1 }, data: { name: data.name, content: data.content, version: { increment: 1 } } });
      if (!count.count) throw new AppError("DOCUMENT_VERSION_CONFLICT", 409);
      document = await tx.studioDocument.findUnique({ where: { id: data.id } });
    } else document = await tx.studioDocument.create({ data: { userId, name: data.name, content: data.content } });
    await tx.assetReference.deleteMany({ where: { entityId: document.id, kind: "studio" } });
    if (refs.size) await tx.assetReference.createMany({ data: [...refs].map(assetId => ({ assetId, entityId: document.id, kind: "studio" })) });
    return document;
  });
}
