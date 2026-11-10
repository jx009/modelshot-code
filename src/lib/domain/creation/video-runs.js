import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { videoRunSchema, videoShotSchema } from "../../creation/contracts/video-runs.js";
import { RUN_ACTIVE, RUN_WAITING } from "../../creation/contracts/runs.js";
import { assertCreationAccess, getCreationEnv } from "../../creation/access.js";
import { digestJson } from "../generation/contracts.js";
import { lockUser } from "../billing/ledger.js";
import { ownedAsset } from "../assets/service.js";
import { studioConfig, capabilities } from "../studio/providers.js";
import { videoInputError } from "../../video/model-protocols.js";
import { selectVideoVariant } from "../../video/variants.js";
import { assertVideoMedia } from "../studio/video-media.js";
import { presentRun } from "./runs.js";
import { appendRunEvent, enqueueRun } from "./events.js";

export async function priceVideoShots(steps, _provider, db) {
  const costs = [], providers = [], channels = new Map();
  for (const step of steps) {
    const shot = videoShotSchema.parse(step.params);
    if (!channels.has(shot.provider)) { const config = await studioConfig(db, shot.provider, "video", "video"); channels.set(shot.provider, { config, caps: await capabilities(db, config) }); }
    const { config, caps } = channels.get(shot.provider), tool = caps.tools.find(tool => tool.id === "video");
    if (!tool?.available) throw new AppError(tool?.reason || "TOOL_UNAVAILABLE", 503);
    if (!shot.params.prompt && !config.videoOptions?.promptOptional) throw new AppError("PROMPT_REQUIRED", 422);
    const error = videoInputError(config.videoOptions, { ...shot.params, hasImage: shot.params.media?.some(item => item.type === "image") });
    if (error) throw new AppError(error, 422);
    const selected = selectVideoVariant(config.videoOptions, shot.params.videoVariant);
    costs.push(selected.variant?.creditCost ?? tool.cost);
    providers.push(config.videoProvider || null);
  }
  return { costs, providers };
}

export async function createVideoRun(userId, input, key, db = prisma, env) {
  assertCreationAccess(env || await getCreationEnv(userId, { db }), { kind: "video", runs: true });
  const data = videoRunSchema.parse(input);
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key || "")) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  const requestId = createHash("sha256").update(`video-plan:${userId}:${key}`).digest("hex"), digest = digestJson({ ...data, documentVersion: undefined });
  const include = { steps: { orderBy: { position: "asc" } } };
  const replay = await db.creationRun.findUnique({ where: { requestId }, include });
  if (replay) {
    if (replay.userId !== userId || replay.digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
    return presentRun(replay);
  }
  const heartbeats = await db.serviceHeartbeat.findMany({ where: { id: { in: ["worker", "creation-worker"] }, updatedAt: { gt: new Date(Date.now() - 90000) } }, select: { id: true } });
  if (heartbeats.length !== 2) throw new AppError("CREATION_WORKER_UNAVAILABLE", 503);
  const steps = data.shots.map(shot => ({ tool: "video", params: shot }));
  const quote = await priceVideoShots(steps, null, db);
  if (quote.costs.some((cost, index) => cost !== data.expectedCosts[index])) throw new AppError("PRICE_CHANGED", 409);
  if (quote.costs.reduce((sum, cost) => sum + cost, 0) > data.maxCredits) throw new AppError("CREATION_BUDGET_EXCEEDED", 409);
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const old = await tx.creationRun.findUnique({ where: { requestId }, include });
    if (old) { if (old.digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409); return presentRun(old); }
    const document = await tx.studioDocument.findFirst({ where: { id: data.documentId, userId, kind: "motion", deletedAt: null } });
    if (!document) throw new AppError("DOCUMENT_NOT_FOUND", 404);
    if (document.version !== data.documentVersion) throw new AppError("DOCUMENT_VERSION_CONFLICT", 409);
    const scenes = document.content.video?.composition?.scenes || [];
    if (data.shots.some(shot => !scenes.some(scene => scene.id === shot.sceneId))) throw new AppError("MOTION_SCENE_CHANGED", 409);
    const refs = new Set();
    for (const shot of data.shots) {
      const assetId = scenes.find(scene => scene.id === shot.sceneId)?.assetId;
      if (assetId) { await ownedAsset(userId, assetId, tx); refs.add(assetId); }
    }
    for (const shot of data.shots) for (const media of shot.params.media || []) {
      const asset = await ownedAsset(userId, media.id, tx);
      if (!asset.contentType.startsWith(`${media.type}/`)) throw new AppError("VIDEO_MEDIA_INVALID", 422);
      assertVideoMedia(userId, media); refs.add(media.id);
    }
    if (await tx.creationRun.count({ where: { userId, status: { in: [...RUN_ACTIVE, ...RUN_WAITING] } } })) throw new AppError("CREATION_USER_QUEUE_FULL", 429);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('creation-admission', 0))::text`;
    if (await tx.creationRun.count({ where: { status: { in: RUN_ACTIVE } } }) >= 1000) throw new AppError("CREATION_QUEUE_FULL", 503);
    const ids = steps.map(() => randomUUID());
    const run = await tx.creationRun.create({ data: { userId, documentId: data.documentId, requestId, digest, kind: "video", maxCredits: data.maxCredits,
      input: { summary: data.summary, clientKey: key }, steps: { create: steps.map((step, index) => ({ ...step, params: { ...step.params, provider: quote.providers[index] || undefined }, id: ids[index], position: index, result: { sourceAssetId: scenes.find(scene => scene.id === step.params.sceneId)?.assetId || null, sourceType: (document.content.video.media || []).find(item => item.id === scenes.find(scene => scene.id === step.params.sceneId)?.assetId)?.type || null }, explanation: scenes.find(scene => scene.id === step.params.sceneId)?.name || `Shot ${index + 1}`, expectedCost: quote.costs[index], dependsOn: index ? [ids[index - 1]] : [], status: index ? "blocked" : "ready" })) },
    }, include });
    if (refs.size) await tx.assetReference.createMany({ data: [...refs].map(assetId => ({ assetId, entityId: run.id, kind: "creation_input" })), skipDuplicates: true });
    const updated = await appendRunEvent(tx, run.id, "run.created", { stepCount: steps.length, maxCredits: data.maxCredits });
    await enqueueRun(tx, run.id, "initial");
    return presentRun({ ...updated, steps: run.steps });
  }, { maxWait: 10000, timeout: 15000 });
}
