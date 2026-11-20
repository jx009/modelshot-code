import { assertCreationAccess, getCreationEnv } from "../../creation/access.js";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { digestJson } from "../generation/contracts.js";
import { lockUser } from "../billing/ledger.js";
import { ownedAsset } from "../assets/service.js";
import { capabilities, studioConfig } from "../studio/providers.js";
import { imageCreditCost } from "../../studio/image-pricing.js";
import { imageRunSchema, resumeRunSchema, RUN_ACTIVE, RUN_WAITING, isRunTerminal } from "../../creation/contracts/runs.js";
import { appendRunEvent, enqueueRun } from "./events.js";

export function creationAdmissionEnabled(env = process.env) { return env.CREATION_RUNS_ENABLED === "true"; }

export async function lockRun(tx, userId, id) {
  // Keep the same lock order as billing, saves and output completion.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "CreationRun" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
  const run = await tx.creationRun.findFirst({ where: { id, userId }, include: { steps: { orderBy: { position: "asc" } } } });
  if (!run) throw new AppError("CREATION_RUN_NOT_FOUND", 404);
  return run;
}

export function presentRun(run) {
  return {
    id: run.id, kind: run.kind, documentId: run.documentId, projectId: run.projectId, sessionId: run.sessionId, status: run.status,
    summary: run.input.summary, maxCredits: run.maxCredits, committedCredits: run.committedCredits,
    clientKey: run.input.clientKey, ...(run.input.agentParent ? { parentRunId: run.input.agentParent.runId } : {}),
    eventSequence: run.eventSequence, errorCode: run.errorCode,
    cancelRequested: Boolean(run.cancelRequestedAt), createdAt: run.createdAt, updatedAt: run.updatedAt,
    steps: run.steps.map(step => ({ id: step.id, position: step.position, tool: step.tool,
      ...(run.kind === "video" ? { prompt: step.params.params?.prompt, duration: step.params.params?.duration, ratio: step.params.params?.ratio, provider: step.params.provider } : {}),
      ...(run.kind === "storyboard" ? { sceneId: step.params.sceneId || null } : {}),
      explanation: step.explanation, status: step.status, jobId: step.jobId,
      expectedCost: step.expectedCost, attempt: step.attempt, errorCode: step.errorCode, result: step.result || null })),
  };
}

async function priceSteps(steps, provider, db) {
  const config = await studioConfig(db, provider);
  const caps = await capabilities(db, config);
  const costs = steps.map(step => {
    const tool = caps.tools.find(tool => tool.id === step.tool);
    if (!tool?.available) throw new AppError(tool?.reason || "TOOL_UNAVAILABLE", 503);
    return imageCreditCost(tool, step.params.size, 0);
  });
  return { provider: config.imageProvider, costs };
}

export async function createImageRun(userId, input, key, db = prisma, deps = {}) {
  if (!creationAdmissionEnabled(deps.env ?? await getCreationEnv(userId, { db }))) throw new AppError("CREATION_NOT_ENABLED", 503);
  const data = imageRunSchema.parse(input);
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key || "")) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  const requestId = createHash("sha256").update(`creation:${userId}:${key}`).digest("hex");
  const digest = digestJson({ ...data, documentVersion: undefined });
  const replay = await db.creationRun.findUnique({ where: { requestId }, include: { steps: { orderBy: { position: "asc" } } } });
  if (replay) {
    if (replay.userId !== userId || replay.digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
    return presentRun(replay);
  }
  await (deps.ensureWorkers || ensureWorkers)(db);
  const quote = await (deps.priceSteps || priceSteps)(data.steps, data.provider, db);
  if (data.expectedCosts && data.expectedCosts.some((cost, index) => cost !== quote.costs[index])) throw new AppError("PRICE_CHANGED", 409);
  if (quote.costs.reduce((sum, cost) => sum + cost, 0) > data.maxCredits) throw new AppError("CREATION_BUDGET_EXCEEDED", 409);
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const old = await tx.creationRun.findUnique({ where: { requestId }, include: { steps: { orderBy: { position: "asc" } } } });
    if (old) {
      if (old.digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return presentRun(old);
    }
    const document = await tx.studioDocument.findFirst({ where: { id: data.documentId, userId, deletedAt: null } });
    if (!document) throw new AppError("DOCUMENT_NOT_FOUND", 404);
    if (document.version !== data.documentVersion) throw new AppError("DOCUMENT_VERSION_CONFLICT", 409);
    if (data.source) {
      const layer = document.content.layers.find(layer => layer.id === data.source.targetId);
      if (layer?.type !== "image" || layer.assetId !== data.source.assetId) throw new AppError("TARGET_CHANGED", 409);
      const asset = await ownedAsset(userId, data.source.assetId, tx);
      if (!asset.contentType.startsWith("image/")) throw new AppError("INVALID_SOURCE");
    }
    for (const id of data.referenceAssetIds || []) {
      const reference = await ownedAsset(userId, id, tx);
      if (!reference.contentType.startsWith("image/")) throw new AppError("INVALID_SOURCE");
    }
    const occupying = [...RUN_ACTIVE, ...RUN_WAITING];
    if (await tx.creationRun.count({ where: { userId, documentId: data.documentId, status: { in: occupying } } }) >= 1) throw new AppError("CREATION_SCOPE_BUSY", 409);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('creation-admission', 0))::text`;
    if (await tx.creationRun.count({ where: { status: { in: RUN_ACTIVE } } }) >= 1000) throw new AppError("CREATION_QUEUE_FULL", 503);
    const stepIds = data.steps.map(() => randomUUID());
    const run = await tx.creationRun.create({ data: {
      userId, documentId: data.documentId, requestId, digest, kind: "image", maxCredits: data.maxCredits,
      input: { summary: data.summary, provider: quote.provider || data.provider || null, source: data.source || null, clientKey: key,
        ...(data.referenceAssetIds ? { referenceAssetIds: data.referenceAssetIds } : {}), ...(data.referenceRoles ? { referenceRoles: data.referenceRoles } : {}) },
      steps: { create: data.steps.map((step, position) => ({ id: stepIds[position], ...step, position, dependsOn: position ? [stepIds[position - 1]] : [], expectedCost: quote.costs[position], status: position ? "blocked" : "ready" })) },
    }, include: { steps: { orderBy: { position: "asc" } } } });
    if (data.source) await tx.assetReference.create({ data: { assetId: data.source.assetId, entityId: run.id, kind: "creation_input" } });
    for (const assetId of data.referenceAssetIds || []) await tx.assetReference.create({ data: { assetId, entityId: run.id, kind: "creation_input" } });
    const updated = await appendRunEvent(tx, run.id, "run.created", { stepCount: data.steps.length, maxCredits: data.maxCredits });
    await enqueueRun(tx, run.id, "initial");
    return presentRun({ ...updated, steps: run.steps });
  }, { maxWait: 10000, timeout: 15000 });
}

async function ensureWorkers(db) {
  const rows = await db.serviceHeartbeat.findMany({ where: { id: { in: ["worker", "creation-worker"] }, updatedAt: { gt: new Date(Date.now() - 90000) } }, select: { id: true } });
  if (rows.length !== 2) throw new AppError("CREATION_WORKER_UNAVAILABLE", 503);
}

export async function readRun(userId, id, db = prisma) {
  const run = await db.creationRun.findFirst({ where: { id, userId }, include: { steps: { orderBy: { position: "asc" } } } });
  if (!run) throw new AppError("CREATION_RUN_NOT_FOUND", 404);
  return presentRun(run);
}

export async function cancelRun(userId, id, db = prisma) {
  return db.$transaction(async tx => {
    const run = await lockRun(tx, userId, id);
    if (isRunTerminal(run.status) || run.cancelRequestedAt) return presentRun(run);
    const updated = await appendRunEvent(tx, id, "run.cancel_requested", {}, {
      status: "cancelling", cancelRequestedAt: new Date(), nextCheckAt: new Date(),
    });
    if (run.kind === "agent") for (const step of run.steps.filter(item => item.status !== "succeeded")) {
      if (step.result?.childRunId) {
        const child = await lockRun(tx, userId, step.result.childRunId);
        if (child.input?.agentParent?.runId !== run.id || child.input.agentParent.stepId !== step.id) throw new AppError("CREATION_AGENT_LINK_INVALID", 409);
        if (!isRunTerminal(child.status) && !child.cancelRequestedAt) {
          const stopped = await appendRunEvent(tx, child.id, "run.cancel_requested", { parentRunId: run.id }, { status: "cancelling", cancelRequestedAt: new Date(), nextCheckAt: new Date() });
          await enqueueRun(tx, child.id, `cancel:${stopped.eventSequence}`);
        }
      }
      if (step.result?.exportId) await tx.artifactExport.updateMany({ where: { id: step.result.exportId, userId, status: { in: ["queued", "running"] } }, data: { status: "cancelled", errorCode: null, leaseUntil: null } });
    }
    await enqueueRun(tx, id, `cancel:${updated.eventSequence}`);
    return presentRun({ ...updated, steps: run.steps });
  });
}

export async function resumeRun(userId, id, input, db = prisma, deps = {}) {
  const data = resumeRunSchema.parse(input);
  const current = await db.creationRun.findFirst({ where: { id, userId }, include: { steps: { orderBy: { position: "asc" } } } });
  if (!current) throw new AppError("CREATION_RUN_NOT_FOUND", 404);
  if (current.eventSequence !== data.expectedSequence) throw new AppError("CREATION_RUN_CHANGED", 409);
  if (current.kind !== "agent" && current.errorCode === "CREATION_OUTLINE_CONFIRMATION_REQUIRED") throw new AppError("CREATION_OUTLINE_CONFIRMATION_REQUIRED", 409);
  const remaining = current.steps.filter(step => step.status !== "succeeded");
  if (!remaining.length || current.cancelRequestedAt || ![...RUN_WAITING, "failed"].includes(current.status)) throw new AppError("CREATION_CANNOT_RESUME", 409);
  if (remaining.some(step => step.status === "failed") && !data.retryFailed) throw new AppError("CREATION_EXPLICIT_RETRY_REQUIRED", 409);
  if (current.kind === "agent") {
    const { resumeAgentRun } = await import("./agent-runs.js");
    return resumeAgentRun(userId, current, data, { ...deps, db });
  }
  if (["poster", "slides", "document", "sheet", "web"].includes(current.kind)) {
    const { resumeContentRun } = await import("./content-runs.js");
    return resumeContentRun(userId, current, data, { ...deps, db });
  }
  const accessEnv = deps.env ?? await getCreationEnv(userId, { db });
  if (!creationAdmissionEnabled(accessEnv)) throw new AppError("CREATION_NOT_ENABLED", 503);
  if (current.kind === "video") assertCreationAccess(accessEnv, { kind: "video", runs: true });
  if (current.kind === "storyboard") assertCreationAccess(accessEnv, { kind: "motion", runs: true });
  await (deps.ensureWorkers || ensureWorkers)(db);
  const priceRemaining = current.kind === "video" ? (await import("./video-runs.js")).priceVideoShots : current.kind === "storyboard" ? (await import("./storyboard-runs.js")).priceStoryboardSteps : priceSteps;
  const quote = await (deps.priceSteps || priceRemaining)(remaining, current.input.provider || undefined, db);
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const run = await lockRun(tx, userId, id);
    if (run.eventSequence !== data.expectedSequence) throw new AppError("CREATION_RUN_CHANGED", 409);
    if (await tx.creationRun.count({ where: { userId, documentId: run.documentId, id: { not: id }, status: { in: [...RUN_ACTIVE, ...RUN_WAITING] } } })) throw new AppError("CREATION_SCOPE_BUSY", 409);
    if (run.committedCredits + quote.costs.reduce((sum, cost) => sum + cost, 0) > data.maxCredits) throw new AppError("CREATION_BUDGET_EXCEEDED", 409);
    for (const [index, step] of remaining.entries()) await tx.creationStep.update({ where: { id: step.id }, data: {
      status: index ? "blocked" : "ready", expectedCost: quote.costs[index], errorCode: null,
      ...(current.kind === "video" ? { params: { ...step.params, provider: quote.providers[index] || undefined } } : {}),
      ...(step.jobId ? { attempt: { increment: 1 }, jobId: null } : {}),
    } });
    await appendRunEvent(tx, id, "run.resumed", { maxCredits: data.maxCredits, retryFailed: data.retryFailed }, {
      status: "queued", maxCredits: data.maxCredits, errorCode: null, nextCheckAt: new Date(),
    });
    await enqueueRun(tx, id, `resume:${data.expectedSequence}`);
    return readRun(userId, id, tx);
  });
}
