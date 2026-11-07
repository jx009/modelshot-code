import { createHash, randomUUID } from "node:crypto";
import { motionAssetIds } from "../../video/schema.js";
import { assertMotionMedia } from "./motion.js";
import { assertCreationAccess, getCreationEnv } from "../../creation/access.js";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { ownedAsset } from "../assets/service.js";
import { lockUser, reserveCreditLots } from "../billing/ledger.js";
import { regionInside } from "../../studio/move-geometry.js";
import { jobSchema, getTool } from "../../studio/tools.js";
import { capabilities, studioConfig } from "./providers.js";
import { ACTIVE, LIMITS, digestJson } from "../generation/contracts.js";
import { commerceReferences } from "../../commerce/project.js";
import { imageSizeChoice, imageSizeError } from "../../studio/image-size.js";
import { imageCreditCost, billingResolution } from "../../studio/image-pricing.js";
import { upscaleInputError } from "../../studio/upscale.js";
import { GUIDED_EDIT_TOOLS, editOutputSize, editTargetSize } from "../../studio/edit-geometry.js";
import { nextImageSource } from "../../creation/contracts/runs.js";
import { POSTER_IMAGE_TOOL, posterImageStepSchema } from "../../creation/contracts/poster-image.js";
import { lockRun } from "../creation/runs.js";
import { appendRunEvent, enqueueRun } from "../creation/events.js";
import { videoInputError, videoModelOptions } from "../../video/model-protocols.js";
import { assertVideoMedia } from "./video-media.js";
import { videoReferenceUrl } from "./video-reference.js";
import { gptBestBody } from "./gptbest-video.js";

export async function submitStudioJob(userId, input, key, db = prisma, deps = {}) {
  const data = jobSchema.parse(input);
  if (["motion-plan", "motion-render", "video"].includes(data.tool)) assertCreationAccess(await getCreationEnv(userId, { db }), { kind: data.tool === "video" ? "video" : "motion", runs: true });
  return submitAdmittedJob(userId, data, key, db, deps);
}

// The public studio schema continues to require a real owned canvas document.
// Only this server entry can admit a document-free poster image, from a locked,
// persisted step. Both paths use the same pricing, ledger, queue and executor.
export async function submitCreationPosterImageStep(userId, runId, stepId, sequence, { db = prisma, config, capabilities: caps, now = new Date() } = {}) {
  return db.$transaction(async tx => {
    const run = await lockRun(tx, userId, runId), step = run.steps.find(item => item.id === stepId);
    if (!["poster", "agent", "slides"].includes(run.kind) || !run.projectId || step?.tool !== POSTER_IMAGE_TOOL) throw new AppError("CREATION_STEP_CHANGED", 409);
    const input = posterImageStepSchema.parse(step.params);
    if (run.kind === "slides" && (!input.visualId || !run.steps.some(row => row.tool === "slides.page" && row.params.visualId === input.visualId))) throw new AppError("CREATION_STEP_CHANGED", 409);
    if (step.jobId) {
      const old = await tx.tryOn.findFirst({ where: { id: step.jobId, userId } });
      if (old?.snapshot?.kind !== "studio" || old.snapshot.tool !== "generate" || old.snapshot.creationRunId !== run.id || old.snapshot.creationStepId !== step.id || old.snapshot.creationAttempt !== step.attempt) throw new AppError("CREATION_STEP_CHANGED", 409);
      return presentJob(old);
    }
    if (run.eventSequence !== sequence || run.cancelRequestedAt || !["queued", "running"].includes(run.status) || step.status !== "ready" || run.kind === "poster" && step.position !== 0 || ["agent", "slides"].includes(run.kind) && step.dependsOn.some(id => run.steps.find(row => row.id === id)?.status !== "succeeded")) throw new AppError("CREATION_STEP_CHANGED", 409);
    if (!await tx.creationProject.findFirst({ where: { id: run.projectId, userId, deletedAt: null }, select: { id: true } })) throw new AppError("CREATION_PROJECT_NOT_FOUND", 404);
    const worker = await tx.serviceHeartbeat.findUnique({ where: { id: "worker" } });
    if (!worker || worker.updatedAt <= new Date(+now - 90000)) throw new AppError("CREATION_WORKER_UNAVAILABLE", 503);
    const selected = config || await studioConfig(db, input.provider, "image", "generate", { pinned: Boolean(input.provider), skipPreview: true });
    if ((input.provider || null) !== (selected.imageProvider || null)) throw new AppError("PROVIDER_CONFIGURATION_CHANGED", 409);
    const output = await submitAdmittedJob(userId, { origin: "chat", tool: "generate", params: input.params, provider: input.provider,
      referenceAssetIds: input.referenceAssetIds, expectedCost: step.expectedCost }, `creation-poster-${step.id}-${step.attempt}`, db,
    { config: selected, capabilities: caps, transaction: tx }, { run, step });
    await tx.creationStepAttempt.create({ data: { stepId: step.id, number: step.attempt, jobId: output.id, cost: output.cost } });
    await tx.creationStep.update({ where: { id: step.id }, data: { jobId: output.id, status: "queued", errorCode: null } });
    const updated = await appendRunEvent(tx, run.id, "step.queued", { stepId: step.id, jobId: output.id, cost: output.cost }, {
      status: "running", errorCode: null, committedCredits: { increment: output.cost }, nextCheckAt: new Date(+now + 30000),
    });
    if (run.kind === "slides") await enqueueRun(tx, run.id, `dispatch:${updated.eventSequence}`);
    return output;
  }, { timeout: 15000 });
}

async function submitAdmittedJob(userId, data, key, db, deps, posterContext = null) {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key || "")) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  const config = deps.config || await studioConfig(db, data.provider, data.tool === "video" ? "video" : "image", data.tool, { skipPreview: Boolean(data.maskId) });
  if (data.tool === "inpaint" && config.imageKind === "dashscope" && data.referenceAssetIds?.length > 1) throw new AppError("TOO_MANY_EDIT_REFERENCES", 422);
  const caps = deps.capabilities || await capabilities(db, config);
  const requestId = createHash("sha256").update(`studio:${userId}:${key}`).digest("hex");
  // A replay may follow an unrelated document save; the immutable source and
  // actual operation still must match. Document version is an admission check.
  const digest = digestJson({ ...data, documentVersion: undefined, expectedCost: undefined });
  const submit = async tx => {
    const user = await lockUser(tx, userId);
    const old = await tx.tryOn.findUnique({ where: { requestId } });
    if (old) {
      if (old.snapshot?.digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return presentJob(old);
    }
    if (["video", "motion-plan", "motion-render"].includes(data.tool)) {
      const heartbeat = await tx.serviceHeartbeat.findUnique({ where: { id: "worker" }, select: { updatedAt: true } });
      if (!heartbeat || +heartbeat.updatedAt <= Date.now() - 90000) throw new AppError("WORKER_UNAVAILABLE", 503);
    }
    const tool = caps.tools.find(t => t.id === data.tool);
    const cost = imageCreditCost(tool, data.params.size, 0);
    // Preview availability only gates choosing an object. Once a valid owned
    // mask exists, an outage of the preview service must not block image editing.
    if (!tool?.available && !(tool?.reason === "SEGMENTATION_NOT_CONFIGURED" && data.maskId)) throw new AppError(tool?.reason || "TOOL_UNAVAILABLE", 503);
    if (data.expectedCost !== undefined && data.expectedCost !== cost) throw new AppError("PRICE_CHANGED", 409);
    if (data.tool === "video") {
      if (!data.params.prompt && !config.videoOptions?.promptOptional) throw new AppError("PROMPT_REQUIRED", 422);
      const error = videoInputError(config.videoOptions || videoModelOptions(config.videoKind), { ...data.params, hasImage: Boolean(data.assetId) });
      if (error) throw new AppError(error, 422);
    }
    const document = posterContext ? null : await tx.studioDocument.findFirst({ where: { id: data.documentId, userId, deletedAt: null } });
    if (!posterContext && !document) throw new AppError("DOCUMENT_NOT_FOUND", 404);
    if (["motion", "video"].includes(document?.kind) && !["motion-plan", "motion-render", "video"].includes(data.tool)) throw new AppError("INVALID_VIDEO_TOOL", 422);
    if (["motion-plan", "motion-render", "video"].includes(data.tool) && await tx.tryOn.count({ where: { userId, status: { in: ACTIVE }, snapshot: { path: ["documentId"], equals: data.documentId } } })) throw new AppError("DOCUMENT_BUSY", 409);
    if (data.tool === "video" && data.params.media) {
      if (document.content.video?.mode !== "video" || digestJson(data.params.media) !== digestJson(document.content.video.media)) throw new AppError("VIDEO_MEDIA_CHANGED", 409);
      if ((data.params.media.find(item => item.type === "image")?.id || undefined) !== data.assetId) throw new AppError("VIDEO_MEDIA_CHANGED", 409);
      let referenceBytes = 0;
      for (const item of data.params.media) {
        const asset = await ownedAsset(userId, item.id, tx);
        if (!asset.contentType.startsWith(`${item.type}/`)) throw new AppError("VIDEO_MEDIA_INVALID", 422);
        referenceBytes += asset.bytes;
        assertVideoMedia(userId, item);
      }
      if (config.videoOptions?.api === "veo-omni" && referenceBytes > 100 * 1024 * 1024) throw new AppError("VIDEO_MEDIA_TOO_LARGE", 413);
    }
    if (data.tool === "video" && ["zzshu", "gptbest"].includes(config.videoKind) && (data.assetId || data.params.media?.length)) videoReferenceUrl(userId, data.assetId || data.params.media[0].id);
    if (data.tool === "video" && config.videoKind === "gptbest") gptBestBody(config, { ...data.params, validateOnly: true,
      references: (data.params.media || (data.assetId ? [{ id: data.assetId, type: "image" }] : [])).map(item => ({ ...item, url: "https://reference.invalid/input" })) });
    if (data.tool === "video" && config.videoKind === "gptbest") {
      const sourceTaskId = data.params.videoFields?.sourceTaskId || config.videoOptions.parameters?.sourceTaskId;
      if (sourceTaskId && !await tx.generationAttempt.findFirst({ where: { requestId: sourceTaskId, output: { userId, status: "succeeded", snapshot: { path: ["videoProvider"], equals: config.videoProvider } } }, select: { id: true } })) throw new AppError("VIDEO_SOURCE_NOT_FOUND", 404);
      const videoId = data.params.videoFields?.video_id || config.videoOptions.parameters?.video_id;
      if (videoId && !await tx.tryOn.findFirst({ where: { userId, status: "succeeded", snapshot: { path: ["videoProvider"], equals: config.videoProvider }, resultData: { path: ["providerVideoId"], equals: videoId } }, select: { id: true } })) throw new AppError("VIDEO_SOURCE_NOT_FOUND", 404);
    }
    // Only the server scheduler can supply this context. Verify it against the
    // persisted run; request JSON cannot opt out of canvas admission checks.
    let creation;
    if (posterContext) {
      const { run, step } = posterContext;
      if (run.committedCredits + cost > run.maxCredits) throw new AppError("CREATION_BUDGET_EXCEEDED", 409);
      creation = { creationRunId: run.id, creationStepId: step.id, creationAttempt: step.attempt };
    } else if (deps.creationStepId) {
      const step = await tx.creationStep.findUnique({ where: { id: deps.creationStepId } });
      const run = step && await tx.creationRun.findUnique({ where: { id: step.runId } });
      if (!run || run.userId !== userId || run.documentId !== data.documentId || run.cancelRequestedAt || !["queued", "running"].includes(run.status) || step.status !== "ready" || step.jobId) throw new AppError("CREATION_STEP_CHANGED", 409);
      const previous = step.position ? await tx.creationStep.findUnique({ where: { runId_position: { runId: run.id, position: step.position - 1 } } }) : null;
      const previousJob = previous?.jobId ? await tx.tryOn.findUnique({ where: { id: previous.jobId } }) : null;
      if (step.position && (previous?.status !== "succeeded" || previousJob?.status !== "succeeded")) throw new AppError("CREATION_DEPENDENCY_PENDING", 409);
      const source = nextImageSource(run, previous, previousJob);
      if (step.tool !== data.tool || digestJson(step.params) !== digestJson(data.params) || step.expectedCost !== cost || (run.input.provider || undefined) !== data.provider || data.assetId !== (source?.assetId || undefined) || data.targetId !== (source?.targetId || undefined)) throw new AppError("CREATION_STEP_CHANGED", 409);
      if (run.committedCredits + cost > run.maxCredits) throw new AppError("CREATION_BUDGET_EXCEEDED", 409);
      creation = { creationRunId: run.id, creationStepId: step.id, creationAttempt: step.attempt };
    } else if (document.version !== data.documentVersion) throw new AppError("DOCUMENT_VERSION_CONFLICT", 409);
    if (data.sectionId) {
      const commerce = document.content.commerce;
      const section = commerce?.sections.find(s => s.id === data.sectionId);
      if (!section || data.tool !== "edit" || section.attempt !== data.sectionAttempt || commerce.productAssetId !== data.assetId || section.prompt !== data.params.prompt || JSON.stringify(data.referenceAssetIds || []) !== JSON.stringify(commerceReferences(commerce, section)) || data.provider !== commerce.provider || data.params.size !== (section.size || commerce.size || "1024x1536")) throw new AppError("STORYBOARD_CHANGED", 409);
    }
    for (const ref of data.referenceAssetIds || []) {
      const asset = await ownedAsset(userId, ref, tx);
      if (!["image/png", "image/jpeg", "image/webp"].includes(asset.contentType)) throw new AppError("INVALID_SOURCE");
    }
    if (getTool(data.tool).workspaceOnly) {
      if (document?.content.video?.mode !== "motion") throw new AppError("INVALID_MOTION_DOCUMENT", 422);
      if (data.tool === "motion-render" && !document.content.video.confirmed) throw new AppError("MOTION_CONFIRM_REQUIRED", 409);
      const media = document.content.video.media;
      if (digestJson(data.params.media || []) !== digestJson(media)) throw new AppError("MOTION_MEDIA_CHANGED", 409);
      if (data.params.motion) assertMotionMedia(data.params.motion, media);
      for (const item of media) {
        const asset = await ownedAsset(userId, item.id, tx);
        if (!asset.contentType.startsWith(`${item.type}/`)) throw new AppError("MOTION_MEDIA_INVALID", 422);
      }
      if (data.tool === "motion-render" && digestJson(data.params.motion) !== digestJson(document.content.video.composition)) throw new AppError("DOCUMENT_VERSION_CONFLICT", 409);
    }
    const target = document?.content.layers.find(l => l.id === data.targetId);
    if (!creation && getTool(data.tool).source && (!target || target.assetId !== data.assetId || target.type !== "image")) throw new AppError("TARGET_CHANGED", 409);
    const inputAsset = data.assetId ? await ownedAsset(userId, data.assetId, tx) : null;
    if (inputAsset && !["image/png", "image/jpeg", "image/webp"].includes(inputAsset.contentType)) throw new AppError("INVALID_SOURCE");
    if (data.tool === "upscale") {
      const invalid = upscaleInputError(inputAsset, data.params.scale);
      if (invalid) throw new AppError(invalid, 422);
    }
    // Reject known unsupported dimensions before reserving any credits.
    if (getTool(data.tool).dependency === "image") {
      if (config.imageKind === "minimax" && (data.assetId || data.maskId || data.referenceAssetIds?.length)) throw new AppError("PROVIDER_CAPABILITY_UNSUPPORTED", 422);
      if (config.imageKind === "minimax" && (!data.params.prompt?.trim() || Array.from(data.params.prompt).length > 1500)) throw new AppError("IMAGE_PROMPT_INVALID", 422);
      const targetSize = GUIDED_EDIT_TOOLS.includes(data.tool) ? editTargetSize(data.tool, inputAsset, data.params.padding) : null;
      if (targetSize && (Math.max(targetSize.width, targetSize.height) > 8192 || targetSize.width * targetSize.height > 40000000)) throw new AppError("IMAGE_TOO_LARGE", 413);
      const sizeError = targetSize ? editOutputSize(config, data.params.size, targetSize).error : imageSizeError(config, data.params.size, inputAsset);
      if (sizeError) throw new AppError(sizeError, 422);
    }
    if (data.params.selectionMode === "region" && ![data.params.moveSource, data.params.moveTarget].every(r => regionInside(r, inputAsset.width, inputAsset.height))) throw new AppError("MOVE_OUT_OF_BOUNDS", 422);
    if (data.maskId) {
      const mask = await ownedAsset(userId, data.maskId, tx);
      if (mask.width !== inputAsset.width || mask.height !== inputAsset.height) throw new AppError("MASK_SIZE_MISMATCH");
    }
    if (data.moveBundle) {
      const { objectAssetId, holeAssetId, bounds } = data.moveBundle;
      const object = await ownedAsset(userId, objectAssetId, tx), hole = await ownedAsset(userId, holeAssetId, tx);
      if (object.contentType !== "image/png" || hole.contentType !== "image/png" || object.width !== bounds.width || object.height !== bounds.height || hole.width !== inputAsset.width || hole.height !== inputAsset.height || bounds.left + bounds.width > inputAsset.width || bounds.top + bounds.height > inputAsset.height) throw new AppError("INVALID_MOVE_BUNDLE", 422);
    }
    if (data.tool === "crop" && (data.params.rect.left + data.params.rect.width > inputAsset.width || data.params.rect.top + data.params.rect.height > inputAsset.height)) throw new AppError("CROP_OUT_OF_BOUNDS");
    if (data.tool === "upscale" && (inputAsset.width * inputAsset.height * data.params.scale ** 2 > 40000000 || Math.max(inputAsset.width, inputAsset.height) * data.params.scale > 8192)) throw new AppError("IMAGE_TOO_LARGE", 413);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('queue-admission', 0))::text`;
    if (await tx.tryOn.count({ where: { status: { in: ACTIVE } } }) >= LIMITS.queue) throw new AppError("QUEUE_FULL", 503);
    if (await tx.tryOn.count({ where: { userId, status: { in: ACTIVE } } }) >= LIMITS.activePerUser) throw new AppError("USER_QUEUE_FULL", 429);
    if (data.tool === "video") creation = { ...creation, videoProvider: config.videoProvider || null, videoBaseURL: config.videoURL || null, videoKind: config.videoKind || "volcengine", videoOptions: config.videoOptions || videoModelOptions(config.videoKind) };
    const channel = data.tool === "video" ? { name: config.videoProvider, kind: config.videoKind, model: config.videoModel, baseURL: config.videoURL } : ["split", "ocr", "upscale"].includes(data.tool) ? config[`${data.tool}Channel`] : getTool(data.tool).dependency === "vision" ? { name: config.plannerProvider, kind: config.plannerKind, model: config.chatModel, baseURL: config.visionBaseURL } : null;
    const output = await tx.tryOn.create({ data: { id: randomUUID(), userId, requestId, personImage: "", clothesImage: inputAsset ? `/api/assets/${inputAsset.id}` : "", prompt: data.params.prompt, provider: data.tool === "video" ? "ark" : channel?.name || config.imageProvider || "studio", creditCost: cost, billingType: "credits",
      snapshot: { kind: "studio", ...data, ...creation, provider: channel?.name || config.imageProvider, providerKind: channel?.kind || config.imageKind || "openai", providerBaseURL: (channel ? channel.baseURL : config.baseURL) || null, digest, checksum: inputAsset?.checksum || null, price: cost, priceVersion: "studio-base-plus-resolution-v3", pricing: { mode: tool.resolutionSurcharges ? "base-plus-resolution" : "fixed", basePrice: tool.cost, resolutionSurcharge: cost - tool.cost, resolution: billingResolution(tool, data.params.size), requestedResolution: imageSizeChoice(data.params.size).resolution, unitPrice: cost }, imageModel: channel?.model || config.imageModel, chatModel: config.chatModel || null, videoModel: config.videoModel || null } } });
    if (cost) {
      const allocations = await reserveCreditLots(tx, user, cost);
      await tx.creditReservation.create({ data: { userId, tryOnId: output.id, channel: "credits", amount: cost, allocations } });
    }
    for (const assetId of new Set([data.assetId, data.maskId, data.moveBundle?.objectAssetId, data.moveBundle?.holeAssetId, ...(data.referenceAssetIds || []), ...(data.params.media || []).map(item => item.id), ...motionAssetIds(data.params.motion)].filter(Boolean))) await tx.assetReference.create({ data: { assetId, entityId: output.id, kind: "generation_input" } });
    await tx.outboxEvent.create({ data: { businessKey: `generate:${output.id}:0`, kind: "generate", entityId: output.id } });
    return presentJob(output);
  };
  return deps.transaction ? submit(deps.transaction) : db.$transaction(submit, { timeout: 30000 });
}

export function presentJob(row) {
  return { id: row.id, status: row.status, tool: row.snapshot.tool, origin: row.snapshot.origin, targetId: row.snapshot.targetId, documentId: row.snapshot.documentId,
    assetId: row.snapshot.assetId, moveBundle: row.snapshot.moveBundle,
    sectionId: row.snapshot.sectionId, sectionAttempt: row.snapshot.sectionAttempt,
    cost: row.creditCost, errorCode: row.errorCode, resultData: row.resultData, createdAt: row.createTime, cancelRequested: Boolean(row.cancelRequestedAt) };
}
