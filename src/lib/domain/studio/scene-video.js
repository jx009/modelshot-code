import { createHash } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { saveDocument } from "./documents.js";
import { assertCreationAccess, getCreationEnv } from "../../creation/access.js";

export async function openSceneVideo(userId, { documentId, sceneId, assetId }, db = prisma) {
  assertCreationAccess(await getCreationEnv(userId, { db }), { kind: "video" });
  const parent = await db.studioDocument.findFirst({ where: { id: documentId, userId, kind: "motion", deletedAt: null } });
  const scene = parent?.content.video?.composition?.scenes.find(item => item.id === sceneId);
  if (!scene || scene.assetId !== assetId) throw new AppError("MOTION_SCENE_CHANGED", 409);
  const source = await db.tryOn.findFirst({ where: { userId, status: "succeeded", snapshot: { path: ["tool"], equals: "video" }, resultData: { path: ["assets"], array_contains: [{ id: assetId }] } }, orderBy: { createTime: "desc" } });
  if (!source) throw new AppError("VIDEO_SOURCE_NOT_FOUND", 404);
  const createKey = createHash("sha256").update(`scene-video:${userId}:${documentId}:${sceneId}:${assetId}`).digest("hex");
  const existing = await db.studioDocument.findUnique({ where: { userId_createKey: { userId, createKey } } });
  if (existing?.deletedAt) throw new AppError("DOCUMENT_NOT_FOUND", 404);
  if (existing) return existing;
  const { params, assetId: firstImage, videoProvider, provider } = source.snapshot;
  return saveDocument(userId, { createKey, name: `${parent.name} · ${scene.name || "镜头"}`.slice(0, 100), content: {
    schemaVersion: 1, layers: [], messages: [], jobs: [], appliedJobs: [],
    video: { mode: "video", provider: videoProvider || provider || undefined, prompt: params.prompt, ratio: params.ratio || "16:9", duration: params.duration,
      videoVariant: params.videoVariant, videoFields: params.videoFields,
      media: params.media || (firstImage ? [{ id: firstImage, type: "image", name: "首帧", duration: 0 }] : []),
      sceneOrigin: { documentId, sceneId, assetId, sourceJobId: source.id },
    },
  } }, db);
}
