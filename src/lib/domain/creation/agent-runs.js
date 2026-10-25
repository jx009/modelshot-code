import { getCreationEnv } from "../../creation/access.js";
import { POSTER_IMAGE_TOOL, posterImageStepSchema } from "../../creation/contracts/poster-image.js";
import { posterImageQuote } from "./poster-images.js";
import { submitCreationPosterImageStep } from "../studio/jobs.js";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../prisma.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { AppError } from "../../http.js";
import { lockUser } from "../billing/ledger.js";
import { agentRequestSchema, agentPlanCalls, AGENT_PLAN_CONFIRMATION_REQUIRED, AGENT_PIPELINE_VERSION, AGENT_SCHEDULER_HEARTBEAT, AGENT_LANGUAGE_HEARTBEAT } from "../../creation/contracts/agent.js";
import { RUN_ACTIVE, RUN_WAITING, isRunTerminal } from "../../creation/contracts/runs.js";
import { languageInputSchema, validateLanguageResult } from "../../creation/contracts/language.js";
import { nextReadyStep, newlyUnblockedSteps } from "../../creation/run-dependencies.js";
import { creationInputDigest } from "./input-digest.js";
import { creationLanguageConfig, submitCreationLanguageStep } from "./language-jobs.js";
import { readCreationLanguageResult } from "./language-execution.js";
import { requireReferenceAdmission } from "./reference-admission.js";
import { createContentRun, requireContentCreation } from "./content-runs.js";
import { cancelRun, lockRun, presentRun, resumeRun } from "./runs.js";
import { appendRunEvent, enqueueRun } from "./events.js";
import { appendCreationMessage } from "./messages.js";
import { cancelOutput } from "../generation/execution.js";
import { requestArtifactExport, ownedExport, presentExport, cancelArtifactExport } from "./exports.js";

const include = { steps: { orderBy: { position: "asc" } } };
const nextCheck = () => new Date(Date.now() + 30000);
const activeChild = step => step.status !== "succeeded" && (step.result?.childRunId || step.result?.exportId || step.jobId);
export async function ensureAgentWorkers(db, env = process.env) {
  if (env.CREATION_AGENT_ENABLED !== "true" || env.CREATION_RUNS_ENABLED !== "true" || env.CREATION_WORKSPACE_ENABLED !== "true") throw new AppError("CREATION_NOT_ENABLED", 503);
  const ids = [AGENT_SCHEDULER_HEARTBEAT, AGENT_LANGUAGE_HEARTBEAT];
  const rows = await db.serviceHeartbeat.findMany({ where: { id: { in: ids }, updatedAt: { gt: new Date(Date.now() - 90000) } } });
  if (ids.some(id => !rows.some(row => row.id === id && row.details?.version === AGENT_PIPELINE_VERSION))) throw new AppError("CREATION_WORKER_UNAVAILABLE", 503);
}
export async function createAgentRun(userId, sessionId, input, key, { db = prisma, env, configFor = creationLanguageConfig, ensureWorkers = ensureAgentWorkers, quoteImage = posterImageQuote } = {}) {
  env ??= await getCreationEnv(userId, { db });
  const data = agentRequestSchema.parse(input), digest = creationInputDigest(data);
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key || "")) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  const requestId = createHash("sha256").update(`creation-agent:${userId}:${sessionId}:${key}`).digest("hex");
  const replay = run => { if (run.digest !== digest || run.userId !== userId) throw new AppError("IDEMPOTENCY_CONFLICT", 409); return presentRun(run); };
  const old = await db.creationRun.findUnique({ where: { requestId }, include }); if (old) return replay(old);
  await ensureWorkers(db, env);
  const config = await configFor(db), cost = config.plannerCreditCost ?? 1;
  if (!config.visionApiKey || !config.chatModel) throw new AppError("VISION_NOT_CONFIGURED", 503);
  if (!Number.isSafeInteger(cost) || cost < 0) throw new AppError("INVALID_PRICE", 503);
  if (cost > data.maxCredits) throw new AppError("CREATION_BUDGET_EXCEEDED", 409);
  const allowedKinds = ["poster", "slides", "document", "sheet", "web"].filter(kind => { try { requireContentCreation(kind, env); return true; } catch { return false; } });
  const imageQuote = await quoteImage(db).catch(() => null);
  const params = languageInputSchema.parse({ ...(data.editRequest ? { editRequest: data.editRequest } : {}), imageSizes: Object.keys(imageQuote?.prices || {}), purpose: "agent.plan", prompt: data.prompt, locale: data.locale, assetIds: data.assetIds, referenceIds: data.referenceIds, allowedKinds });
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const duplicate = await tx.creationRun.findUnique({ where: { requestId }, include }); if (duplicate) return replay(duplicate);
    const session = await tx.creationSession.findFirst({ where: { id: sessionId, project: { userId, deletedAt: null } }, select: { projectId: true } });
    if (!session) throw new AppError("CREATION_SESSION_NOT_FOUND", 404);
    await requireReferenceAdmission(tx, userId, sessionId, data.referenceIds, { env });
    if (data.assetIds.length && await tx.asset.count({ where: { id: { in: data.assetIds }, userId, status: "active", contentType: { in: ["image/png", "image/jpeg", "image/webp"] } } }) !== data.assetIds.length) throw new AppError("ASSET_NOT_FOUND", 404);
    if (await tx.creationRun.count({ where: { userId, status: { in: [...RUN_ACTIVE, ...RUN_WAITING] } } })) throw new AppError("CREATION_USER_QUEUE_FULL", 429);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('creation-admission', 0))::text`;
    if (await tx.creationRun.count({ where: { status: { in: RUN_ACTIVE } } }) >= 1000) throw new AppError("CREATION_QUEUE_FULL", 503);
    const run = await tx.creationRun.create({ data: { userId, projectId: session.projectId, sessionId, kind: "agent", requestId, digest, maxCredits: data.maxCredits,
      input: { imageQuote, summary: data.prompt.slice(0, 1000), clientKey: key, locale: data.locale, languageProvider: config.plannerProvider || null, languageUnitCost: cost, assetIds: data.assetIds, referenceIds: data.referenceIds },
      steps: { create: [{ id: randomUUID(), position: 0, dependsOn: [], tool: "agent.plan", params, explanation: data.locale === "zh" ? "规划跨类型创作步骤" : "Plan creative workflow", status: "ready", expectedCost: cost }] },
    }, include });
    if (data.assetIds.length) await tx.assetReference.createMany({ data: data.assetIds.map(assetId => ({ assetId, entityId: run.id, kind: "creation_input" })) });
    await appendCreationMessage(tx, sessionId, key, "user", data.prompt, [{ type: "run", runId: run.id }], { type: "run", runId: run.id });
    const updated = await appendRunEvent(tx, run.id, "run.created", { stepCount: 1, maxCredits: data.maxCredits });
    await enqueueRun(tx, run.id, "initial");
    return presentRun({ ...updated, steps: run.steps });
  }, { timeout: 15000 });
}

async function guard(tx, initial) {
  const run = await lockRun(tx, initial.userId, initial.id);
  if (run.kind !== "agent" || run.eventSequence !== initial.eventSequence || !RUN_ACTIVE.includes(run.status)) throw new AppError("CREATION_RUN_CHANGED", 409);
  return run;
}
async function complete(tx, run, step, result) {
  await tx.creationStep.update({ where: { id: step.id }, data: { status: "succeeded", result, errorCode: null } });
  const steps = run.steps.map(item => item.id === step.id ? { ...item, status: "succeeded" } : item);
  const ready = newlyUnblockedSteps(steps);
  for (const item of ready) await tx.creationStep.update({ where: { id: item.id }, data: { status: "ready" } });
  const done = steps.every(item => item.status === "succeeded");
  const updated = await appendRunEvent(tx, run.id, done ? "run.succeeded" : "step.succeeded", { stepId: step.id, result }, { status: done ? "succeeded" : "running", errorCode: null, ...(!done ? { nextCheckAt: new Date() } : {}) });
  if (!done) await enqueueRun(tx, run.id, `agent:${updated.eventSequence}`);
}
async function publishPlan(initial, step, { db, store }) {
  const input = languageInputSchema.parse(step.params), plan = validateLanguageResult(input, await readCreationLanguageResult(initial.userId, step.jobId, { db, store }));
  const ids = new Map(plan.steps.map(item => [item.id, randomUUID()]));
  return db.$transaction(async tx => {
    const run = await guard(tx, initial); if (run.cancelRequestedAt) return;
    if (run.steps.length !== 1) throw new AppError("CREATION_RUN_CHANGED", 409);
    const children = plan.steps.map((item, index) => ({ id: ids.get(item.id), runId: run.id, position: index + 1,
      tool: item.tool === "reference.read" ? "agent.read" : item.tool === "image.generate" ? POSTER_IMAGE_TOOL : item.tool, explanation: item.explanation,
      dependsOn: [...new Set([step.id, ...item.dependsOn.map(key => ids.get(key))])], status: "blocked",
      expectedCost: item.tool === "image.generate" ? run.input.imageQuote.prices[item.size] : item.request ? agentPlanCalls(item.request) * run.input.languageUnitCost : item.tool === "reference.read" ? run.input.languageUnitCost : 0,
      params: item.tool === "image.generate" ? posterImageStepSchema.parse({ provider: run.input.imageQuote.provider || undefined, referenceAssetIds: run.input.assetIds.slice(0, 2), params: { prompt: item.prompt, size: item.size } }) : item.tool === "reference.read" ? { purpose: "agent.read", prompt: run.input.summary, locale: run.input.locale, assetIds: [], referenceIds: item.referenceIds }
        : { ...item, ...(item.sourceStepId ? { sourceStepId: ids.get(item.sourceStepId) } : {}) },
    }));
    await tx.creationStep.createMany({ data: children });
    await tx.creationStep.update({ where: { id: step.id }, data: { status: "succeeded", result: { title: plan.title } } });
    await appendCreationMessage(tx, run.sessionId, `plan-${step.id}`, "assistant", run.input.locale === "zh" ? "创作计划已生成。确认步骤与总预算后继续；演示文稿和文档生成前仍可审核大纲。" : "Review the steps and total budget, then confirm. Presentation and document outlines remain available for review.", [{ type: "run", runId: run.id }]);
    await appendRunEvent(tx, run.id, "agent.plan_ready", { estimatedCredits: run.committedCredits + children.reduce((sum, item) => sum + item.expectedCost, 0) }, { status: "awaiting_input", errorCode: AGENT_PLAN_CONFIRMATION_REQUIRED });
  }, { timeout: 15000 });
}

export async function advanceAgentRun(initial, { db = prisma, store = objectStorage(), createChild = createContentRun, submitLanguage = submitCreationLanguageStep, configFor = creationLanguageConfig, requestExport = requestArtifactExport, submitImage = submitCreationPosterImageStep } = {}) {
  const step = initial.steps.find(activeChild) || nextReadyStep(initial.steps);
  if (initial.cancelRequestedAt) {
    if (step?.result?.childRunId) {
      await cancelRun(initial.userId, step.result.childRunId, db);
      const child = await db.creationRun.findFirst({ where: { id: step.result.childRunId, userId: initial.userId }, include });
      if (!child || !isRunTerminal(child.status)) return postpone(db, initial);
      return settleChild(initial, step, child, { db, cancelling: true });
    }
    if (step?.result?.exportId) await cancelArtifactExport(initial.userId, step.result.exportId, db);
    if (step?.jobId) {
      await cancelOutput(initial.userId, step.jobId, db);
      const job = await db.tryOn.findFirst({ where: { id: step.jobId, userId: initial.userId } });
      if (!job || !["failed", "cancelled", "succeeded"].includes(job.status)) return postpone(db, initial);
      return db.$transaction(async tx => {
        const run = await guard(tx, initial);
        if (job.status !== "succeeded") await tx.creationRun.update({ where: { id: run.id }, data: { committedCredits: { decrement: job.creditCost } } });
        await finishCancellation(tx, run);
      });
    }
    return db.$transaction(async tx => finishCancellation(tx, await guard(tx, initial)));
  }
  if (!step) throw new AppError("CREATION_DEPENDENCY_BLOCKED", 409);
  if (step.tool.startsWith("agent.") || step.tool === POSTER_IMAGE_TOOL) {
    if (!step.jobId && step.tool === POSTER_IMAGE_TOOL) return submitImage(initial.userId, initial.id, step.id, initial.eventSequence, { db });
    if (!step.jobId) return submitLanguage(initial.userId, initial.id, step.id, initial.eventSequence, { db, config: await configFor(db, initial.input.languageProvider) });
    const job = await db.tryOn.findFirst({ where: { id: step.jobId, userId: initial.userId } });
    if (!job) throw new AppError("CREATION_JOB_MISSING", 409);
    if (job.status === "succeeded") {
      if (step.tool === POSTER_IMAGE_TOOL) {
        const assetId = job.resultData?.assets?.length === 1 ? job.resultData.assets[0].id : null;
        if (!assetId || job.snapshot?.creationStepId !== step.id || job.snapshot.creationRunId !== initial.id || job.snapshot.creationAttempt !== step.attempt) throw new AppError("CREATION_IMAGE_RESULT_INVALID", 409);
        return db.$transaction(async tx => {
          const run = await guard(tx, initial); if (run.cancelRequestedAt) return;
          if (!await tx.asset.findFirst({ where: { id: assetId, userId: run.userId, status: "active", contentType: { in: ["image/png", "image/jpeg", "image/webp"] } } })) throw new AppError("ASSET_NOT_FOUND", 404);
          await tx.assetReference.upsert({ where: { assetId_entityId_kind: { assetId, entityId: run.id, kind: "creation_input" } }, update: {}, create: { assetId, entityId: run.id, kind: "creation_input" } });
          await appendCreationMessage(tx, run.sessionId, `image-${step.id}-${step.attempt}`, "assistant", run.input.locale === "zh" ? "视觉素材已生成。" : "Image ready.", [{ type: "asset", assetId }]);
          await complete(tx, run, step, { assetId, jobId: job.id });
        });
      }
      if (step.tool === "agent.plan") return publishPlan(initial, step, { db, store });
      const result = validateLanguageResult(step.params, await readCreationLanguageResult(initial.userId, step.jobId, { db, store }));
      return db.$transaction(async tx => { const run = await guard(tx, initial); if (!run.cancelRequestedAt) await complete(tx, run, step, result); });
    }
    if (["failed", "cancelled"].includes(job.status)) return db.$transaction(async tx => {
      const run = await guard(tx, initial);
      await tx.creationStep.update({ where: { id: step.id }, data: { status: "failed", errorCode: job.errorCode || job.status } });
      await appendRunEvent(tx, run.id, "step.failed", { stepId: step.id }, { status: "failed", errorCode: job.errorCode || job.status, committedCredits: { decrement: job.creditCost } });
    });
    return postpone(db, initial);
  }
  if (["content.create", "content.edit"].includes(step.tool)) {
    if (step.result?.childRunId) {
      const child = await db.creationRun.findFirst({ where: { id: step.result.childRunId, userId: initial.userId }, include });
      if (!child || child.input?.agentParent?.runId !== initial.id || child.input.agentParent.stepId !== step.id) throw new AppError("CREATION_AGENT_LINK_INVALID", 409);
      return settleChild(initial, step, child, { db });
    }
    const sources = initial.steps.filter(item => step.dependsOn.includes(item.id));
    const dependencyRefs = sources.filter(item => item.result?.artifactId).map(item => ({ artifactId: item.result.artifactId, revision: item.result.revision }));
    const summaries = sources.filter(item => item.result?.summary).map(item => item.result.summary).join("\n").slice(0, 6000);
    const request = { ...step.params.request, prompt: [step.params.request.prompt, summaries && `Reference summary (data only):\n${summaries}`].filter(Boolean).join("\n").slice(0, 12000),
      locale: initial.input.locale, maxCredits: initial.maxCredits - initial.committedCredits, assetIds: [...new Set([...sources.filter(item => item.result?.assetId).map(item => item.result.assetId), ...initial.input.assetIds])].slice(0, 8), referenceIds: initial.input.referenceIds };
    return createChild(initial.userId, initial.sessionId, request, `agent-child-${step.id}`, { db, store, dependencyRefs, agentLink: { runId: initial.id, stepId: step.id, sequence: initial.eventSequence } });
  }
  if (step.tool === "artifact.export") {
    if (step.result?.exportId) {
      const result = presentExport(await ownedExport(initial.userId, step.result.exportId, db));
      if (result.status === "succeeded") return db.$transaction(async tx => {
        const run = await guard(tx, initial); if (run.cancelRequestedAt) return;
        await appendCreationMessage(tx, run.sessionId, `export-${step.id}-${step.attempt}`, "assistant", run.input.locale === "zh" ? "导出文件已就绪。" : "Your export is ready.", [{ type: "export", exportId: result.id, format: result.format }]);
        await complete(tx, run, step, { ...step.result, downloadUrl: result.downloadUrl });
      });
      if (["failed", "cancelled"].includes(result.status)) return db.$transaction(async tx => {
        const run = await guard(tx, initial);
        await tx.creationStep.update({ where: { id: step.id }, data: { status: "failed", errorCode: result.errorCode || "EXPORT_FAILED" } });
        await appendRunEvent(tx, run.id, "step.failed", { stepId: step.id }, { status: "failed", errorCode: result.errorCode || "EXPORT_FAILED" });
      });
      return postpone(db, initial);
    }
    const source = initial.steps.find(item => item.id === step.params.sourceStepId)?.result;
    if (!source?.artifactId || !source.revision) throw new AppError("CREATION_DEPENDENCY_PENDING", 409);
    let locked;
    return requestExport(initial.userId, source.artifactId, { revision: source.revision, format: step.params.format, ...(step.result?.retryExport ? { retryKey: `agent-export-${step.id}-${step.attempt}`, retryAttempt: step.result.retryExport.attempt } : {}) }, { db, store, hooks: {
      beforeCommit: async tx => { locked = await guard(tx, initial); if (locked.cancelRequestedAt) throw new AppError("CREATION_PUBLICATION_STOPPED", 409); },
      afterCommit: async (tx, result) => {
        await tx.creationStep.update({ where: { id: step.id }, data: { status: "running", result: { exportId: result.id, artifactId: source.artifactId, revision: source.revision } } });
        await appendRunEvent(tx, locked.id, "agent.export_started", { stepId: step.id, exportId: result.id }, { nextCheckAt: nextCheck() });
      },
    } });
  }
  throw new AppError("CREATION_KIND_UNSUPPORTED", 422);
}
async function postpone(db, initial) {
  return db.$transaction(async tx => { const run = await guard(tx, initial); await tx.creationRun.update({ where: { id: run.id }, data: { nextCheckAt: nextCheck() } }); });
}
async function finishCancellation(tx, run) {
  await tx.creationStep.updateMany({ where: { runId: run.id, status: { not: "succeeded" } }, data: { status: "cancelled" } });
  await appendRunEvent(tx, run.id, "run.cancelled", {}, { status: "cancelled", errorCode: null });
}
async function settleChild(initial, step, child, { db, cancelling = false }) {
  return db.$transaction(async tx => {
    const run = await guard(tx, initial), current = run.steps.find(item => item.id === step.id);
    const delta = child.committedCredits - (current.result?.accountedCredits || 0);
    const result = { ...current.result, accountedCredits: child.committedCredits };
    await tx.creationRun.update({ where: { id: run.id }, data: { committedCredits: { increment: delta }, nextCheckAt: nextCheck() } });
    await tx.creationStep.update({ where: { id: step.id }, data: { result } });
    if (cancelling || child.status === "cancelled") return finishCancellation(tx, run);
    if (child.status === "succeeded") {
      const output = [...child.steps].reverse().find(item => item.result?.artifactId)?.result;
      if (!output) throw new AppError("CREATION_CHILD_RESULT_MISSING", 409);
      return complete(tx, run, current, { ...result, artifactId: output.artifactId, revision: output.revision });
    }
    if ([...RUN_WAITING, "failed", "cancelled"].includes(child.status)) {
      await tx.creationStep.update({ where: { id: step.id }, data: { status: child.status === "failed" || child.status === "cancelled" ? "failed" : "running", errorCode: child.errorCode } });
      await appendRunEvent(tx, run.id, "agent.child_waiting", { childRunId: child.id }, { status: child.status === "cancelled" ? "failed" : child.status, errorCode: child.errorCode || "CREATION_CHILD_STOPPED" });
    }
  });
}

export async function resumeAgentRun(userId, current, data, { db = prisma, ensureWorkers = ensureAgentWorkers, env, configFor = creationLanguageConfig, quoteImage = posterImageQuote } = {}) {
  env ??= await getCreationEnv(userId, { db });
  await ensureWorkers(db, env);
  const config = await configFor(db, current.input.languageProvider), unitCost = config.plannerCreditCost ?? 1;
  if (!config.visionApiKey || !config.chatModel) throw new AppError("VISION_NOT_CONFIGURED", 503);
  if (!Number.isSafeInteger(unitCost) || unitCost < 0) throw new AppError("INVALID_PRICE", 503);
  if ((config.plannerProvider || null) !== (current.input.languageProvider || null)) throw new AppError("PROVIDER_CONFIGURATION_CHANGED", 409);
  const prices = new Map();
  for (const step of current.steps.filter(item => item.status !== "succeeded")) {
    if (step.jobId && step.status !== "failed" || step.result?.childRunId) continue;
    if (step.tool === POSTER_IMAGE_TOOL) {
      const quote = await quoteImage(db, step.params.provider), cost = quote.prices[step.params.params.size];
      if ((quote.provider || null) !== (step.params.provider || null)) throw new AppError("PROVIDER_CONFIGURATION_CHANGED", 409);
      if (!Number.isSafeInteger(cost)) throw new AppError("IMAGE_SIZE_UNSUPPORTED", 422);
      prices.set(step.id, cost);
    } else prices.set(step.id, step.tool.startsWith("agent.") ? unitCost : step.params.request ? agentPlanCalls(step.params.request) * unitCost : 0);
  }
  // First reserve the parent's new envelope. Child admission rechecks this
  // envelope under the same user lock before increasing a child's budget.
  const run = await db.$transaction(async tx => {
    const run = await lockRun(tx, userId, current.id);
    if (run.eventSequence !== data.expectedSequence || run.cancelRequestedAt || ![...RUN_WAITING, "failed"].includes(run.status)) throw new AppError("CREATION_RUN_CHANGED", 409);
    const linkedIds = run.steps.filter(step => step.status !== "succeeded" && step.result?.childRunId).map(step => step.result.childRunId);
    if (await tx.creationRun.count({ where: { userId, id: { notIn: [run.id, ...linkedIds] }, status: { in: [...RUN_ACTIVE, ...RUN_WAITING] } } })) throw new AppError("CREATION_USER_QUEUE_FULL", 429);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('creation-admission', 0))::text`;
    if (await tx.creationRun.count({ where: { status: { in: RUN_ACTIVE } } }) >= 1000) throw new AppError("CREATION_QUEUE_FULL", 503);
    const remaining = run.steps.filter(step => step.status !== "succeeded");
    if (run.errorCode === AGENT_PLAN_CONFIRMATION_REQUIRED && run.committedCredits + remaining.reduce((sum, step) => sum + (prices.get(step.id) ?? step.expectedCost), 0) > data.maxCredits || data.maxCredits < run.committedCredits) throw new AppError("CREATION_BUDGET_EXCEEDED", 409);
    for (const step of remaining) {
      if (prices.has(step.id)) await tx.creationStep.update({ where: { id: step.id }, data: { expectedCost: prices.get(step.id) } });
      if (step.status === "failed" && !data.retryFailed) throw new AppError("CREATION_EXPLICIT_RETRY_REQUIRED", 409);
      if (step.result?.childRunId) continue;
      if (step.result?.exportId) {
        const value = await ownedExport(userId, step.result.exportId, tx);
        if (["failed", "cancelled"].includes(value.status)) await tx.creationStep.update({ where: { id: step.id }, data: { status: "ready", attempt: { increment: 1 }, errorCode: null, result: { retryExport: { attempt: value.attempt } } } });
      } else if (step.jobId && step.status === "failed") {
        await tx.creationStep.update({ where: { id: step.id }, data: { status: "ready", jobId: null, attempt: { increment: 1 }, errorCode: null } });
      }
    }
    for (const step of newlyUnblockedSteps(run.steps)) await tx.creationStep.update({ where: { id: step.id }, data: { status: "ready" } });
    const updated = await appendRunEvent(tx, run.id, "run.resumed", { maxCredits: data.maxCredits }, { maxCredits: data.maxCredits, status: "queued", errorCode: null, nextCheckAt: new Date() });
    await enqueueRun(tx, run.id, `resume:${updated.eventSequence}`);
    return { ...run, maxCredits: data.maxCredits };
  });
  const step = run.steps.find(item => item.status !== "succeeded" && item.result?.childRunId);
  if (step) {
    const child = await db.creationRun.findFirst({ where: { id: step.result.childRunId, userId }, include });
    if (child && [...RUN_WAITING, "failed"].includes(child.status) && child.errorCode !== "CREATION_OUTLINE_CONFIRMATION_REQUIRED") {
      await resumeRun(userId, child.id, { expectedSequence: child.eventSequence, maxCredits: run.maxCredits - run.committedCredits + (step.result.accountedCredits || 0), retryFailed: data.retryFailed }, db, { env });
    }
  }
  return presentRun(await db.creationRun.findFirst({ where: { id: current.id, userId }, include }));
}
