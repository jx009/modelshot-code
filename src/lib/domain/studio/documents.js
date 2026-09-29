import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { lockUser } from "../billing/ledger.js";
import { documentSchema } from "../../studio/tools.js";
import { projectTitle } from "../../studio/project-title.js";

export async function saveDocument(userId, input, db = prisma) {
  const data = documentSchema.parse(input);
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    if (!data.id && data.createKey) {
      const existing = await tx.studioDocument.findUnique({ where: { userId_createKey: { userId, createKey: data.createKey } } });
      if (existing?.deletedAt) throw new AppError("DOCUMENT_NOT_FOUND", 404);
      if (existing) return { ...existing, replayed: true };
    }
    const refs = new Set([...data.content.layers.map(l => l.assetId), ...data.content.messages.map(m => m.assetId), data.content.commerce?.productAssetId, data.content.commerce?.referenceAssetId].filter(Boolean));
    if (refs.size && await tx.asset.count({ where: { id: { in: [...refs] }, userId, status: "active" } }) !== refs.size) throw new AppError("ASSET_NOT_FOUND", 404);
    const jobIds = [...new Set(data.content.jobs)];
    if (jobIds.length && await tx.tryOn.count({ where: { id: { in: jobIds }, userId } }) !== jobIds.length) throw new AppError("JOB_NOT_FOUND", 404);
    let document;
    const storedContent = { ...data.content, messages: data.content.messages.slice(-100), jobs: data.content.jobs.slice(-100), appliedJobs: data.content.appliedJobs.slice(-100) };
    const metadata = {
      name: projectTitle(data.name, data.content),
      ...(data.nameSource ? { nameSource: data.nameSource } : {}),
      kind: data.content.commerce ? "commerce" : "canvas",
      coverAssetId: data.content.commerce?.productAssetId || data.content.layers.find(layer => layer.type === "image")?.assetId || null,
      itemCount: data.content.commerce?.sections.length ?? data.content.layers.length,
    };
    if (data.id) {
      const count = await tx.studioDocument.updateMany({ where: { id: data.id, userId, deletedAt: null, version: data.version || -1 }, data: { ...metadata, content: storedContent, version: { increment: 1 } } });
      if (!count.count) throw new AppError("DOCUMENT_VERSION_CONFLICT", 409);
      document = await tx.studioDocument.findUnique({ where: { id: data.id } });
    } else document = await tx.studioDocument.create({ data: { userId, ...metadata, createKey: data.createKey, content: storedContent } });
    if (data.copyFromId) {
      if (data.id || !await tx.studioDocument.findFirst({ where: { id: data.copyFromId, userId, deletedAt: null } })) throw new AppError("DOCUMENT_NOT_FOUND", 404);
      const history = await tx.studioMessage.findMany({ where: { documentId: data.copyFromId }, orderBy: { sequence: "asc" } });
      if (history.length) await tx.studioMessage.createMany({ data: history.map(({ messageId, role, text, assetId }) => ({ documentId: document.id, messageId, role, text, assetId })), skipDuplicates: true });
    }
    if (data.content.messages.length) await tx.studioMessage.createMany({ data: data.content.messages.map(message => ({ documentId: document.id, messageId: message.id, role: message.role, text: message.text, assetId: message.assetId })), skipDuplicates: true });
    if (data.content.appliedJobs.length) {
      const accepted = await tx.tryOn.findMany({ where: { id: { in: data.content.appliedJobs }, userId, status: "succeeded", snapshot: { path: ["documentId"], equals: document.id } }, select: { id: true } });
      if (accepted.length) await tx.studioAppliedResult.createMany({ data: accepted.map(job => ({ documentId: document.id, jobId: job.id })), skipDuplicates: true });
    }
    const historyAssets = await tx.studioMessage.findMany({ where: { documentId: document.id, assetId: { not: null } }, select: { assetId: true } });
    for (const message of historyAssets) refs.add(message.assetId);
    const existing = new Set((await tx.assetReference.findMany({ where: { entityId: document.id, kind: "studio" }, select: { assetId: true } })).map(ref => ref.assetId));
    const removed = [...existing].filter(id => !refs.has(id)), added = [...refs].filter(id => !existing.has(id));
    if (removed.length) await tx.assetReference.deleteMany({ where: { entityId: document.id, kind: "studio", assetId: { in: removed } } });
    if (added.length) await tx.assetReference.createMany({ data: added.map(assetId => ({ assetId, entityId: document.id, kind: "studio" })), skipDuplicates: true });
    return document;
  });
}
