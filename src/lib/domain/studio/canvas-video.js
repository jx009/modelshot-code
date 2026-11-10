import { createHash } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { saveDocument } from "./documents.js";
import { assertCreationAccess, getCreationEnv } from "../../creation/access.js";

export async function openCanvasVideo(userId, { documentId, layerId, layerIds, referenceLayout }, db = prisma) {
  assertCreationAccess(await getCreationEnv(userId, { db }), { kind: "video" });
  const parent = await db.studioDocument.findFirst({ where: { id: documentId, userId, kind: "canvas", deletedAt: null } });
  const layer = parent?.content.layers.find(item => item.id === layerId && item.type === "image");
  if (!layer?.assetId) throw new AppError("VIDEO_SOURCE_NOT_FOUND", 404);
  const asset = await db.asset.findFirst({ where: { id: layer.assetId, userId, status: "active" } });
  if (!asset?.contentType.startsWith("image/")) throw new AppError("ASSET_NOT_FOUND", 404);
  const ids = layerIds || [layerId];
  if (ids[0] !== layerId || !ids.length || ids.length > 30 || new Set(ids).size !== ids.length || ids.length > 1 && !["frames", "reference"].includes(referenceLayout) || referenceLayout === "frames" && ids.length !== 2) throw new AppError("VIDEO_REFERENCE_ROLE_UNSUPPORTED", 422);
  const sources = ids.map(id => parent.content.layers.find(item => item.id === id && item.type === "image"));
  if (sources.some(item => !item?.assetId)) throw new AppError("VIDEO_SOURCE_NOT_FOUND", 404);
  const assetIds = sources.map(item => item.assetId);
  if (new Set(assetIds).size !== assetIds.length) throw new AppError("DUPLICATE_MEDIA", 422);
  if (await db.asset.count({ where: { id: { in: assetIds }, userId, status: "active", contentType: { startsWith: "image/" } } }) !== assetIds.length) throw new AppError("ASSET_NOT_FOUND", 404);
  // Reopening a source resolves the same child even if a response was lost.
  const identity = ids.length === 1 ? `canvas-video:${documentId}:${layerId}:${asset.id}` : `canvas-video:${documentId}:${JSON.stringify([ids, assetIds, referenceLayout])}`;
  const createKey = createHash("sha256").update(identity).digest("hex");
  const existing = await db.studioDocument.findUnique({ where: { userId_createKey: { userId, createKey } } });
  if (existing?.deletedAt) throw new AppError("DOCUMENT_NOT_FOUND", 404);
  if (existing) return existing;
  return saveDocument(userId, { createKey, name: `${parent.name} · 视频`.slice(0, 100), content: {
    schemaVersion: 1, layers: [], messages: [], jobs: [], appliedJobs: [],
    video: { mode: "video", ratio: asset.height > asset.width ? "9:16" : asset.height === asset.width ? "1:1" : "16:9", duration: 5,
      canvasOrigin: { documentId, layerId, assetId: asset.id }, media: sources.map((source, index) => ({ id: source.assetId, type: "image", name: source.name, duration: 0, ...(referenceLayout ? { role: referenceLayout === "frames" ? index === 0 ? "first_frame" : "last_frame" : "reference_image" } : {}) })),
    },
  } }, db);
}
