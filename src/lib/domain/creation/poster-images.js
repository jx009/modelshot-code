import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { studioConfig, capabilities } from "../studio/providers.js";
import { imageCreditCost } from "../../studio/image-pricing.js";
import { imageSizeError } from "../../studio/image-size.js";
import { POSTER_IMAGE_TOOL, POSTER_IMAGE_SIZES } from "../../creation/contracts/poster-image.js";
import { languageInputSchema } from "../../creation/contracts/language.js";
import { lockRun } from "./runs.js";
import { appendRunEvent, enqueueRun } from "./events.js";
import { newlyUnblockedSteps } from "../../creation/run-dependencies.js";

export async function posterImageQuote(db = prisma, provider, { configFor = studioConfig, capabilitiesFor = capabilities } = {}) {
  const config = await configFor(db, provider, "image", "generate", { pinned: Boolean(provider), skipPreview: true });
  const caps = await capabilitiesFor(db, config, undefined, { imageOnly: true }), tool = caps.tools.find(item => item.id === "generate");
  if (!tool?.available) throw new AppError(tool?.reason || "TOOL_UNAVAILABLE", 503);
  const prices = Object.fromEntries(POSTER_IMAGE_SIZES.filter(size => !imageSizeError(config, size)).map(size => [size, imageCreditCost(tool, size, 0)]));
  if (Object.values(prices).some(price => !Number.isSafeInteger(price) || price < 0 || price > 200000)) throw new AppError("INVALID_PRICE", 503);
  return { provider: config.imageProvider || null, prices };
}

export async function posterImageModels(db = prisma) {
  const caps = await capabilities(db, undefined, undefined, { imageOnly: true });
  return caps.imageModels.filter(model => Object.values(model.prices || {}).some(price => Number.isSafeInteger(price) && price >= 0 && price <= 200000)).map(model => ({ id: model.id, label: model.label, provider: model.id, prices: model.prices }));
}

// Bind the actual generated asset to the next language input atomically with
// step completion. A replay never invokes the image provider again.
export async function publishPosterImage(initial, step, { db = prisma, now = new Date() } = {}) {
  return db.$transaction(async tx => {
    const run = await lockRun(tx, initial.userId, initial.id), current = run.steps.find(item => item.id === step.id);
    if (!["poster", "slides"].includes(run.kind) || run.eventSequence !== initial.eventSequence || run.cancelRequestedAt || !["queued", "running"].includes(run.status)
      || current?.tool !== POSTER_IMAGE_TOOL || current.status === "succeeded" || current.jobId !== step.jobId) throw new AppError("CREATION_RUN_CHANGED", 409);
    if (!await tx.creationProject.findFirst({ where: { id: run.projectId, userId: run.userId, deletedAt: null }, select: { id: true } })) throw new AppError("CREATION_PROJECT_NOT_FOUND", 404);
    const job = await tx.tryOn.findFirst({ where: { id: step.jobId, userId: run.userId, status: "succeeded" } });
    if (job?.snapshot?.kind !== "studio" || job.snapshot.tool !== "generate" || job.snapshot.creationRunId !== run.id || job.snapshot.creationStepId !== current.id
      || job.snapshot.creationAttempt !== current.attempt) throw new AppError("CREATION_STEP_CHANGED", 409);
    const ids = job.resultData?.assets?.map(asset => asset.id);
    if (ids?.length !== 1) throw new AppError("CREATION_IMAGE_RESULT_INVALID", 409);
    const asset = await tx.asset.findFirst({ where: { id: ids[0], userId: run.userId, status: "active", contentType: { in: ["image/png", "image/jpeg", "image/webp"] } }, select: { id: true } });
    if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);
    const targets = run.kind === "slides"
      ? run.steps.filter(item => item.tool === "slides.page" && current.params.visualId && item.params.visualId === current.params.visualId)
      : run.steps.filter(item => item.position === current.position + 1 && item.tool === "poster.generate");
    if (!targets.length || targets.some(item => item.status !== "blocked" || item.jobId)) throw new AppError("CREATION_STEP_CHANGED", 409);
    const bound = targets.map(item => ({ id: item.id, params: languageInputSchema.parse({ ...item.params, assetIds: [...new Set([...item.params.assetIds, asset.id])], visualAssetId: asset.id }) }));
    await tx.assetReference.upsert({ where: { assetId_entityId_kind: { assetId: asset.id, entityId: run.id, kind: "creation_input" } },
      create: { assetId: asset.id, entityId: run.id, kind: "creation_input" }, update: {} });
    await tx.creationStep.update({ where: { id: current.id }, data: { status: "succeeded", result: { assetId: asset.id, jobId: job.id }, errorCode: null } });
    const released = newlyUnblockedSteps(run.steps, new Set([current.id]));
    const readyIds = new Set(released.map(item => item.id));
    for (const item of bound) await tx.creationStep.update({ where: { id: item.id }, data: { params: item.params, ...(readyIds.has(item.id) ? { status: "ready" } : {}) } });
    for (const item of released) if (!bound.some(target => target.id === item.id)) await tx.creationStep.update({ where: { id: item.id }, data: { status: "ready" } });
    const updated = await appendRunEvent(tx, run.id, "step.succeeded", { stepId: current.id, jobId: job.id, assetId: asset.id }, { status: "running", errorCode: null, nextCheckAt: now });
    await enqueueRun(tx, run.id, `step:${updated.eventSequence}`);
  }, { timeout: 15000 });
}
