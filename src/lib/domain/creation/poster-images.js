import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { studioConfig, capabilities } from "../studio/providers.js";
import { imageCreditCost } from "../../studio/image-pricing.js";
import { imageSizeError } from "../../studio/image-size.js";
import { POSTER_IMAGE_TOOL, POSTER_IMAGE_SIZES } from "../../creation/contracts/poster-image.js";
import { languageInputSchema } from "../../creation/contracts/language.js";
import { lockRun } from "./runs.js";
import { appendRunEvent, enqueueRun } from "./events.js";

export async function posterImageQuote(db = prisma, provider, { configFor = studioConfig, capabilitiesFor = capabilities } = {}) {
  const config = await configFor(db, provider, "image", "generate", { pinned: Boolean(provider), skipPreview: true });
  const caps = await capabilitiesFor(db, config), tool = caps.tools.find(item => item.id === "generate");
  if (!tool?.available) throw new AppError(tool?.reason || "TOOL_UNAVAILABLE", 503);
  const prices = Object.fromEntries(POSTER_IMAGE_SIZES.filter(size => !imageSizeError(config, size)).map(size => [size, imageCreditCost(tool, size, 0)]));
  if (Object.values(prices).some(price => !Number.isSafeInteger(price) || price < 0 || price > 200000)) throw new AppError("INVALID_PRICE", 503);
  return { provider: config.imageProvider || null, prices };
}

// Bind the actual generated asset to the next language input atomically with
// step completion. A replay never invokes the image provider again.
export async function publishPosterImage(initial, step, { db = prisma, now = new Date() } = {}) {
  return db.$transaction(async tx => {
    const run = await lockRun(tx, initial.userId, initial.id), current = run.steps.find(item => item.id === step.id);
    if (run.kind !== "poster" || run.eventSequence !== initial.eventSequence || run.cancelRequestedAt || !["queued", "running"].includes(run.status)
      || current?.tool !== POSTER_IMAGE_TOOL || current.status === "succeeded" || current.jobId !== step.jobId) throw new AppError("CREATION_RUN_CHANGED", 409);
    if (!await tx.creationProject.findFirst({ where: { id: run.projectId, userId: run.userId, deletedAt: null }, select: { id: true } })) throw new AppError("CREATION_PROJECT_NOT_FOUND", 404);
    const job = await tx.tryOn.findFirst({ where: { id: step.jobId, userId: run.userId, status: "succeeded" } });
    if (job?.snapshot?.kind !== "studio" || job.snapshot.tool !== "generate" || job.snapshot.creationRunId !== run.id || job.snapshot.creationStepId !== current.id
      || job.snapshot.creationAttempt !== current.attempt) throw new AppError("CREATION_STEP_CHANGED", 409);
    const ids = job.resultData?.assets?.map(asset => asset.id);
    if (ids?.length !== 1) throw new AppError("CREATION_IMAGE_RESULT_INVALID", 409);
    const asset = await tx.asset.findFirst({ where: { id: ids[0], userId: run.userId, status: "active", contentType: { in: ["image/png", "image/jpeg", "image/webp"] } }, select: { id: true } });
    if (!asset) throw new AppError("ASSET_NOT_FOUND", 404);
    const next = run.steps[current.position + 1];
    if (next?.tool !== "poster.generate" || next.status !== "blocked" || next.jobId) throw new AppError("CREATION_STEP_CHANGED", 409);
    const params = languageInputSchema.parse({ ...next.params, assetIds: [...new Set([...next.params.assetIds, asset.id])], visualAssetId: asset.id });
    await tx.assetReference.upsert({ where: { assetId_entityId_kind: { assetId: asset.id, entityId: run.id, kind: "creation_input" } },
      create: { assetId: asset.id, entityId: run.id, kind: "creation_input" }, update: {} });
    await tx.creationStep.update({ where: { id: current.id }, data: { status: "succeeded", result: { assetId: asset.id, jobId: job.id }, errorCode: null } });
    await tx.creationStep.update({ where: { id: next.id }, data: { status: "ready", params } });
    const updated = await appendRunEvent(tx, run.id, "step.succeeded", { stepId: current.id, jobId: job.id, assetId: asset.id }, { status: "running", errorCode: null, nextCheckAt: now });
    await enqueueRun(tx, run.id, `step:${updated.eventSequence}`);
  }, { timeout: 15000 });
}
