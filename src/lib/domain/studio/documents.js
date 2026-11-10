import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { lockUser } from "../billing/ledger.js";
import { documentSchema } from "../../studio/tools.js";
import { projectTitle } from "../../studio/project-title.js";
import { createHash } from "node:crypto";
import { videoAssetIds } from "../../video/schema.js";
import { assertCreationAccess, getCreationEnv } from "../../creation/access.js";
import { assertMotionMedia } from "./motion.js";
import { jobDocumentFilter } from "../../studio/job-document.js";

export async function saveDocument(userId, input, db = prisma) {
  const data = documentSchema.parse(input);
  if (data.content.video) assertCreationAccess(await getCreationEnv(userId, { db }), { kind: data.content.video.mode });
  if (data.content.video?.composition) assertMotionMedia(data.content.video.composition, data.content.video.media);
  const saveHash = data.saveKey ? createHash("sha256").update(JSON.stringify(data)).digest("hex") : null;
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const origin = data.content.video?.canvasOrigin;
    const previousVideo = data.id ? (await tx.studioDocument.findFirst({ where: { id: data.id, userId, deletedAt: null }, select: { content: true } }))?.content?.video : undefined;
    const previousOrigin = previousVideo?.canvasOrigin;
    if (data.id && JSON.stringify(origin) !== JSON.stringify(previousOrigin)) throw new AppError("VIDEO_ORIGIN_CHANGED", 409);
    const sceneOrigin = data.content.video?.sceneOrigin;
    if (data.id && JSON.stringify(sceneOrigin) !== JSON.stringify(previousVideo?.sceneOrigin)) throw new AppError("VIDEO_ORIGIN_CHANGED", 409);
    if (!data.id && sceneOrigin) {
      const parent = await tx.studioDocument.findFirst({ where: { id: sceneOrigin.documentId, userId, deletedAt: null, kind: "motion" }, select: { content: true } });
      if (!parent?.content.video?.composition?.scenes.some(scene => scene.id === sceneOrigin.sceneId && scene.assetId === sceneOrigin.assetId)) throw new AppError("MOTION_SCENE_CHANGED", 409);
      if (sceneOrigin.sourceJobId && !await tx.tryOn.findFirst({ where: { id: sceneOrigin.sourceJobId, userId, status: "succeeded", snapshot: { path: ["tool"], equals: "video" }, resultData: { path: ["assets"], array_contains: [{ id: sceneOrigin.assetId }] } }, select: { id: true } })) throw new AppError("VIDEO_SOURCE_NOT_FOUND", 404);
    }
    if (!data.id && origin) {
      const parent = await tx.studioDocument.findFirst({ where: { id: origin.documentId, userId, deletedAt: null, kind: "canvas" }, select: { content: true } });
      if (!parent?.content.layers.some(layer => layer.id === origin.layerId && layer.assetId === origin.assetId && layer.type === "image")) throw new AppError("VIDEO_SOURCE_NOT_FOUND", 404);
    }
    if (data.id && data.saveKey) {
      const previous = await tx.studioDocument.findFirst({ where: { id: data.id, userId, deletedAt: null } });
      if (["video", "motion"].includes(previous?.kind) && previous.kind !== data.content.video?.mode) throw new AppError("DOCUMENT_KIND_CHANGED", 409);
      if (previous?.lastSaveKey === data.saveKey) {
        if (previous.lastSaveHash !== saveHash) throw new AppError("SAVE_KEY_REUSED", 409);
        if (previous.version !== data.version + 1) throw new AppError("DOCUMENT_VERSION_CONFLICT", 409);
        return previous;
      }
    }
    if (!data.id && data.createKey) {
      const existing = await tx.studioDocument.findUnique({ where: { userId_createKey: { userId, createKey: data.createKey } } });
      if (existing?.deletedAt) throw new AppError("DOCUMENT_NOT_FOUND", 404);
      if (existing) {
        if (data.saveKey && existing.lastSaveKey === data.saveKey && existing.lastSaveHash !== saveHash) throw new AppError("SAVE_KEY_REUSED", 409);
        return { ...existing, replayed: true, acknowledged: Boolean(data.saveKey && existing.lastSaveKey === data.saveKey && existing.version === 1) };
      }
    }
    if (data.id && !data.saveKey) {
      const original = await tx.studioDocument.findFirst({ where: { id: data.id, userId, deletedAt: null }, select: { kind: true } });
      if (["video", "motion"].includes(original?.kind) && original.kind !== data.content.video?.mode) throw new AppError("DOCUMENT_KIND_CHANGED", 409);
    }
    const refs = new Set([...data.content.layers.flatMap(l => [l.assetId, l.posterAssetId, ...(l.sourceAssetIds || [])]), ...data.content.messages.map(m => m.assetId), ...(data.content.plan?.referenceAssetIds || []), ...(data.content.commerce?.sections || []).map(s => s.revisionAssetId), data.content.commerce?.productAssetId, data.content.commerce?.referenceAssetId, ...videoAssetIds(data.content.video)].filter(Boolean));
    if (refs.size && await tx.asset.count({ where: { id: { in: [...refs] }, userId, status: "active" } }) !== refs.size) throw new AppError("ASSET_NOT_FOUND", 404);
    const jobIds = [...new Set(data.content.jobs)];
    const videoDocumentIds = [...new Set(data.content.layers.map(layer => layer.videoDocumentId).filter(Boolean))];
    if (videoDocumentIds.length && await tx.studioDocument.count({ where: { id: { in: videoDocumentIds }, userId, kind: "video" } }) !== videoDocumentIds.length) throw new AppError("DOCUMENT_NOT_FOUND", 404);
    if (jobIds.length && await tx.tryOn.count({ where: { id: { in: jobIds }, userId } }) !== jobIds.length) throw new AppError("JOB_NOT_FOUND", 404);
    let document;
    const storedContent = { ...data.content, messages: data.content.messages.slice(-100), jobs: data.content.jobs.slice(-100), appliedJobs: data.content.appliedJobs.slice(-100) };
    const metadata = {
      lastSaveKey: data.saveKey || null, lastSaveHash: saveHash,
      name: projectTitle(data.name, data.content),
      ...(data.nameSource ? { nameSource: data.nameSource } : {}),
      kind: data.content.video?.mode || (data.content.commerce ? "commerce" : "canvas"),
      coverAssetId: data.content.commerce?.productAssetId || data.content.layers.find(layer => layer.type === "image")?.assetId || null,
      itemCount: data.content.video?.composition?.scenes.length ?? data.content.commerce?.sections.length ?? data.content.layers.length,
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
      const accepted = await tx.tryOn.findMany({ where: { id: { in: data.content.appliedJobs }, userId, status: "succeeded", ...jobDocumentFilter(document.id) }, select: { id: true } });
      if (accepted.length) await tx.studioAppliedResult.createMany({ data: accepted.map(job => ({ documentId: document.id, jobId: job.id })), skipDuplicates: true });
    }
    const historyAssets = await tx.studioMessage.findMany({ where: { documentId: document.id, assetId: { not: null } }, select: { assetId: true } });
    for (const message of historyAssets) refs.add(message.assetId);
    const existing = new Set((await tx.assetReference.findMany({ where: { entityId: document.id, kind: "studio" }, select: { assetId: true } })).map(ref => ref.assetId));
    const removed = [...existing].filter(id => !refs.has(id)), added = [...refs].filter(id => !existing.has(id));
    if (removed.length) await tx.assetReference.deleteMany({ where: { entityId: document.id, kind: "studio", assetId: { in: removed } } });
    if (added.length) await tx.assetReference.createMany({ data: added.map(assetId => ({ assetId, entityId: document.id, kind: "studio" })), skipDuplicates: true });
    return document;
  }, { maxWait: 10000, timeout: 15000 });
}
