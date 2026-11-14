import { AGENT_LANGUAGE_HEARTBEAT, AGENT_PIPELINE_VERSION } from "../../creation/contracts/agent.js";
import { HTML_PIPELINE_VERSION, HTML_LANGUAGE_HEARTBEAT } from "../../creation/contracts/html-runtime.js";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { lockUser, reserveCreditLots } from "../billing/ledger.js";
import { ACTIVE, LIMITS } from "../generation/contracts.js";
import { creationInputDigest } from "./input-digest.js";
import { studioConfig } from "../studio/providers.js";
import { languageInputSchema } from "../../creation/contracts/language.js";
import { POSTER_IMAGE_PIPELINE_VERSION, POSTER_IMAGE_LANGUAGE_HEARTBEAT } from "../../creation/contracts/poster-runtime.js";
import { ownedArtifact } from "./artifacts.js";
import { lockRun } from "./runs.js";
import { appendRunEvent, enqueueRun } from "./events.js";
import { SLIDE_PAGE_CONCURRENCY } from "../../creation/slide-scheduling.js";
import { requireReferenceAdmission } from "./reference-admission.js";
import { dependenciesFor } from "../../creation/run-dependencies.js";

export async function creationLanguageConfig(db = prisma, provider) {
  return studioConfig(db, provider || undefined, "language", null, { pinned: Boolean(provider), skipPreview: true, imageOnly: true });
}

// Only persisted, ready steps can create these jobs. There is no public API
// accepting arbitrary system prompts, provider credentials or quoted prices.
export async function submitCreationLanguageStep(userId, runId, stepId, sequence, { db = prisma, config, now = new Date(), env = process.env } = {}) {
  const selected = config || await creationLanguageConfig(db);
  return db.$transaction(async tx => {
    const user = await lockUser(tx, userId), run = await lockRun(tx, userId, runId);
    const step = run.steps.find(step => step.id === stepId);
    if (!step) throw new AppError("CREATION_STEP_CHANGED", 409);
    const input = languageInputSchema.parse(step.params);
    const requestId = createHash("sha256").update(`creation-language:${userId}:${step.id}:${step.attempt}`).digest("hex");
    const digest = creationInputDigest(input);
    const old = await tx.tryOn.findUnique({ where: { requestId } });
    if (old) {
      if (old.snapshot?.digest !== digest || step.jobId !== old.id) throw new AppError("CREATION_STEP_CHANGED", 409);
      return { id: old.id, status: old.status, cost: old.creditCost };
    }
    if (run.eventSequence !== sequence || !["queued", "running"].includes(run.status) || run.cancelRequestedAt || step.status !== "ready" || step.jobId || step.tool !== input.purpose) throw new AppError("CREATION_STEP_CHANGED", 409);
    if (!run.projectId || input.purpose.split(".")[0] !== run.kind) throw new AppError("CREATION_KIND_UNSUPPORTED", 422);
    const project = await tx.creationProject.findFirst({ where: { id: run.projectId, userId, deletedAt: null }, select: { id: true } });
    if (!project) throw new AppError("CREATION_PROJECT_NOT_FOUND", 404);
    if (dependenciesFor(step, run.steps).some(dependencyId => run.steps.find(candidate => candidate.id === dependencyId)?.status !== "succeeded")) throw new AppError("CREATION_DEPENDENCY_PENDING", 409);
    if (!selected.visionApiKey || !selected.chatModel) throw new AppError("VISION_NOT_CONFIGURED", 503);
    if ((run.input.languageProvider || null) !== (selected.plannerProvider || null)) throw new AppError("PROVIDER_CONFIGURATION_CHANGED", 409);
    const cost = selected.plannerCreditCost ?? 1;
    if (!Number.isSafeInteger(cost) || cost < 0) throw new AppError("INVALID_PRICE", 503);
    if (step.expectedCost !== cost) throw new AppError("PRICE_CHANGED", 409);
    if (run.committedCredits + cost > run.maxCredits) throw new AppError("CREATION_BUDGET_EXCEEDED", 409);
    const heartbeat = await tx.serviceHeartbeat.findUnique({ where: { id: run.kind === "agent" ? AGENT_LANGUAGE_HEARTBEAT : input.sourceFormat === "html" ? HTML_LANGUAGE_HEARTBEAT : input.visualAssetId ? POSTER_IMAGE_LANGUAGE_HEARTBEAT : "creation-language-worker" } });
    const pipelineVersion = run.kind === "agent" ? AGENT_PIPELINE_VERSION : input.sourceFormat === "html" ? HTML_PIPELINE_VERSION : input.visualAssetId ? POSTER_IMAGE_PIPELINE_VERSION : null;
    if (!heartbeat || heartbeat.updatedAt <= new Date(+now - 90000) || pipelineVersion !== null && heartbeat.details?.version !== pipelineVersion) throw new AppError("CREATION_LANGUAGE_WORKER_UNAVAILABLE", 503);
    if (input.artifactId) {
      const artifact = await ownedArtifact(userId, input.artifactId, tx);
      if (artifact.projectId !== run.projectId || artifact.kind !== run.kind) throw new AppError("ARTIFACT_NOT_FOUND", 404);
      if (artifact.currentRevision !== input.baseRevision) throw new AppError("ARTIFACT_VERSION_CONFLICT", 409);
    }
    const assetIds = [...new Set(input.assetIds)];
    if (assetIds.length && await tx.asset.count({ where: { id: { in: assetIds }, userId, status: "active", contentType: { in: ["image/png", "image/jpeg", "image/webp"] } } }) !== assetIds.length) throw new AppError("ASSET_NOT_FOUND", 404);
    await requireReferenceAdmission(tx, userId, run.sessionId, input.referenceIds, { env, now });
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('queue-admission', 0))::text`;
    if (await tx.tryOn.count({ where: { status: { in: ACTIVE } } }) >= LIMITS.queue) throw new AppError("QUEUE_FULL", 503);
    if (await tx.tryOn.count({ where: { executionQueue: "creation-language", status: { in: ACTIVE } } }) >= 1000) throw new AppError("QUEUE_FULL", 503);
    const userLimit = input.purpose === "slides.page" ? SLIDE_PAGE_CONCURRENCY : 1;
    if (await tx.tryOn.count({ where: { userId, executionQueue: "creation-language", status: { in: ACTIVE } } }) >= userLimit) throw new AppError("USER_QUEUE_FULL", 429);
    const output = await tx.tryOn.create({ data: {
      id: randomUUID(), userId, requestId, personImage: "", clothesImage: "", prompt: input.prompt,
      executionQueue: "creation-language", provider: selected.plannerProvider || "language-env", creditCost: cost, billingType: "credits", qaStatus: "skipped", exportStatus: "skipped",
      snapshot: { kind: "language", executionVersion: 1, purpose: input.purpose, input, digest, price: cost,
        provider: selected.plannerProvider || null, providerKind: selected.plannerKind || "openai", providerBaseURL: selected.visionBaseURL || null, model: selected.chatModel,
        creationRunId: run.id, creationStepId: step.id, creationAttempt: step.attempt },
    } });
    if (cost) {
      const allocations = await reserveCreditLots(tx, user, cost);
      await tx.creditReservation.create({ data: { userId, tryOnId: output.id, channel: "credits", amount: cost, allocations } });
    }
    if (assetIds.length) await tx.assetReference.createMany({ data: assetIds.map(assetId => ({ assetId, entityId: output.id, kind: "generation_input" })) });
    await tx.outboxEvent.create({ data: { businessKey: `creation-language:${output.id}:0`, kind: "creation-language", entityId: output.id } });
    await tx.creationStepAttempt.create({ data: { stepId: step.id, number: step.attempt, jobId: output.id, cost } });
    await tx.creationStep.update({ where: { id: step.id }, data: { jobId: output.id, status: "queued", errorCode: null } });
    const updated = await appendRunEvent(tx, run.id, "step.queued", { stepId: step.id, jobId: output.id, cost }, {
      status: "running", errorCode: null, committedCredits: { increment: cost }, nextCheckAt: new Date(+now + 30000),
    });
    if (input.purpose === "slides.page") await enqueueRun(tx, run.id, `dispatch:${updated.eventSequence}`);
    return { id: output.id, status: output.status, cost };
  }, { timeout: 15000 });
}
