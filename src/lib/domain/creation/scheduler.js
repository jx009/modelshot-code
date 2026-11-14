import { advanceAgentRun } from "./agent-runs.js";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { RUN_ACTIVE, isRunTerminal, nextImageSource, imageRunStepInputs } from "../../creation/contracts/runs.js";
import { TERMINAL } from "../generation/contracts.js";
import { cancelOutput } from "../generation/execution.js";
import { submitStudioJob, submitCreationPosterImageStep, submitCreationVideoStep } from "../studio/jobs.js";
import { POSTER_IMAGE_TOOL } from "../../creation/contracts/poster-image.js";
import { publishPosterImage } from "./poster-images.js";
import { studioConfig, capabilities } from "../studio/providers.js";
import { getTool } from "../../studio/tools.js";
import { lockRun } from "./runs.js";
import { appendRunEvent, enqueueRun } from "./events.js";
import { creationLanguageConfig, submitCreationLanguageStep } from "./language-jobs.js";
import { publishCreationLanguage, assembleCreationSlides } from "./publication.js";
import { nextReadyStep, newlyUnblockedSteps, runHasUnfinishedSteps, validateRunDependencyGraph } from "../../creation/run-dependencies.js";
import { isSlideGeneration, inFlightStep, nextSlideStep, slideRunProgress } from "../../creation/slide-scheduling.js";

const CHECK_INTERVAL = 30_000;
const BUDGET_ERRORS = ["PRICE_CHANGED", "CREATION_BUDGET_EXCEEDED", "INSUFFICIENT_CREDITS", "CREDITS_FROZEN"];
const CAPACITY_ERRORS = ["QUEUE_FULL", "USER_QUEUE_FULL", "CREATION_QUEUE_FULL", "EXPORT_QUEUE_FULL", "EXPORT_USER_QUEUE_FULL"];

async function snapshot(db, id) {
  return db.creationRun.findUnique({ where: { id }, include: { steps: { orderBy: { position: "asc" } } } });
}

// One wake performs one short transition. It never waits for a provider or for
// an entire plan, and it never submits a second billable job outside the same
// transaction that records the first job's identity.
export async function advanceRun(id, { db = prisma, store, configFor = studioConfig, capabilitiesFor = capabilities, submit = submitStudioJob, cancel = cancelOutput,
  submitPosterImage = submitCreationPosterImageStep, publishImage = publishPosterImage,
  languageConfigFor = creationLanguageConfig, submitLanguage = submitCreationLanguageStep, publishLanguage = publishCreationLanguage, assembleSlides = assembleCreationSlides, now = new Date() } = {}) {
  const initial = await snapshot(db, id);
  if (!initial || isRunTerminal(initial.status) || !RUN_ACTIVE.includes(initial.status)) return;
  if (!validateRunDependencyGraph(initial.steps)) throw new AppError("CREATION_DEPENDENCY_GRAPH_INVALID", 409);
  const parallelSlides = isSlideGeneration(initial);
  const slideJobs = parallelSlides ? await db.tryOn.findMany({ where: { id: { in: initial.steps.filter(inFlightStep).map(step => step.jobId) }, userId: initial.userId }, select: { id: true, status: true } }) : [];
  const pending = parallelSlides ? nextSlideStep(initial, slideJobs) : initial.steps.find(step => step.jobId && step.status !== "succeeded") || nextReadyStep(initial.steps);
  if (initial.cancelRequestedAt) {
    const cancelSteps = parallelSlides ? initial.steps.filter(inFlightStep) : pending?.jobId ? [pending] : [];
    for (const step of cancelSteps) await cancel(initial.userId, step.jobId, db);
  }
  let config, caps;
  try {
    if (initial.kind === "agent") return await advanceAgentRun(initial, { db, store });
    if (!initial.cancelRequestedAt && pending && ["poster", "slides"].includes(initial.kind)) {
      if (pending.tool === "layout.assemble") return await assembleSlides(initial, pending, { db, store });
      if (pending.jobId) {
        const job = await db.tryOn.findFirst({ where: { id: pending.jobId, userId: initial.userId }, select: { status: true } });
        if (job?.status === "succeeded") return await (pending.tool === POSTER_IMAGE_TOOL ? publishImage : publishLanguage)(initial, pending, { db, store });
      }
    }
    if (!initial.cancelRequestedAt && pending && !pending.jobId) {
      if (initial.kind === "video") return await submitCreationVideoStep(initial.userId, id, pending.id, initial.eventSequence, db);
      if (["poster", "slides"].includes(initial.kind)) {
        if (pending.tool === POSTER_IMAGE_TOOL) return await submitPosterImage(initial.userId, id, pending.id, initial.eventSequence, { db, now });
        const languageConfig = await languageConfigFor(db, initial.input.languageProvider);
        return await submitLanguage(initial.userId, id, pending.id, initial.eventSequence, { db, config: languageConfig, now });
      }
      if (initial.kind !== "image") throw new AppError("CREATION_KIND_UNSUPPORTED", 422);
      config = await configFor(db, initial.input.provider || undefined, "image", pending.tool);
      caps = await capabilitiesFor(db, config);
    }
    return await db.$transaction(async tx => {
      const run = await lockRun(tx, initial.userId, id);
      if (run.eventSequence !== initial.eventSequence || isRunTerminal(run.status) || !RUN_ACTIVE.includes(run.status)) return;
      const step = parallelSlides ? run.steps.find(step => step.id === pending?.id) : run.steps.find(step => step.jobId && step.status !== "succeeded") || nextReadyStep(run.steps);
      const job = step?.jobId ? await tx.tryOn.findFirst({ where: { id: step.jobId, userId: run.userId } }) : null;
      if (step?.jobId && !job) throw new AppError("CREATION_JOB_MISSING", 409);
      if (job && !TERMINAL.includes(job.status)) {
        if (step.status === "queued" && job.status !== "queued") {
          await tx.creationStep.update({ where: { id: step.id }, data: { status: "running" } });
          await appendRunEvent(tx, id, "step.started", { stepId: step.id, jobId: job.id });
        }
        await tx.creationRun.update({ where: { id }, data: { nextCheckAt: new Date(+now + CHECK_INTERVAL) } });
        return;
      }
      if (run.cancelRequestedAt) {
        if (job && step.status !== "succeeded") {
          await tx.creationStep.update({ where: { id: step.id }, data: { status: job.status, errorCode: job.errorCode } });
          if (job.status !== "succeeded") await tx.creationRun.update({ where: { id }, data: { committedCredits: { decrement: job.creditCost } } });
        }
        await tx.creationStep.updateMany({ where: { runId: id, jobId: null, status: { in: ["blocked", "ready"] } }, data: { status: "cancelled" } });
        if (parallelSlides && run.steps.some(item => item.id !== step?.id && inFlightStep(item))) {
          const updated = await appendRunEvent(tx, id, "step.cancelled", { stepId: step?.id, jobId: job?.id }, { status: "cancelling", nextCheckAt: now });
          await enqueueRun(tx, id, `cancel-settle:${updated.eventSequence}`);
          return;
        }
        await appendRunEvent(tx, id, "run.cancelled", { completedStepIds: run.steps.filter(row => row.status === "succeeded").map(row => row.id), settledJobId: job?.id || null }, { status: "cancelled", errorCode: null });
        return;
      }
      if (!step) {
        if (parallelSlides) {
          const progress = slideRunProgress(run.steps);
          for (const ready of progress.released) await tx.creationStep.update({ where: { id: ready.id }, data: { status: "ready" } });
          const updated = await appendRunEvent(tx, id, progress.status === "running" ? "run.ready" : `run.${progress.status}`, {}, { status: progress.status, errorCode: progress.errorCode, nextCheckAt: now });
          if (progress.status === "running") await enqueueRun(tx, id, `ready:${updated.eventSequence}`);
          return;
        }
        if (runHasUnfinishedSteps(run.steps)) {
          await appendRunEvent(tx, id, "run.blocked", { unfinishedStepIds: run.steps.filter(row => row.status !== "succeeded").map(row => row.id) }, {
            status: "awaiting_input", errorCode: "CREATION_DEPENDENCY_BLOCKED",
          });
          return;
        }
        await appendRunEvent(tx, id, "run.succeeded", {}, { status: "succeeded", errorCode: null });
        return;
      }
      if (job) {
        await tx.creationStep.update({ where: { id: step.id }, data: { status: job.status, errorCode: job.errorCode } });
        if (job.status !== "succeeded") {
          if (parallelSlides) {
            const progress = slideRunProgress(run.steps.map(item => item.id === step.id ? { ...item, status: job.status, errorCode: job.errorCode } : item));
            for (const ready of progress.released) await tx.creationStep.update({ where: { id: ready.id }, data: { status: "ready" } });
            const updated = await appendRunEvent(tx, id, "step.failed", { stepId: step.id, jobId: job.id, code: job.errorCode || job.status }, {
              status: progress.status, errorCode: progress.errorCode, committedCredits: { decrement: job.creditCost }, nextCheckAt: now,
            });
            if (progress.status === "running") await enqueueRun(tx, id, `settled:${updated.eventSequence}`);
            return;
          }
          await appendRunEvent(tx, id, "step.failed", { stepId: step.id, jobId: job.id, code: job.errorCode || job.status }, {
            status: "failed", errorCode: job.errorCode || job.status, committedCredits: { decrement: job.creditCost },
          });
          return;
        }
        const unblocked = newlyUnblockedSteps(run.steps, new Set([step.id]));
        const next = unblocked[0] || nextReadyStep(run.steps, new Set([step.id]));
        for (const ready of unblocked) await tx.creationStep.update({ where: { id: ready.id }, data: { status: ready.id === next?.id ? "ready" : "blocked" } });
        const blocked = !next && run.steps.some(row => row.id !== step.id && row.status !== "succeeded");
        const updated = await appendRunEvent(tx, id, "step.succeeded", { stepId: step.id, jobId: job.id }, {
          status: next ? "running" : blocked ? "awaiting_input" : "succeeded",
          errorCode: blocked ? "CREATION_DEPENDENCY_BLOCKED" : null, ...(next ? { nextCheckAt: now } : {}),
        });
        if (next) await enqueueRun(tx, id, `step:${updated.eventSequence}`);
        else if (!blocked) await appendRunEvent(tx, id, "run.succeeded", {}, { status: "succeeded" });
        return;
      }
      if (step.status !== "ready") throw new AppError("CREATION_STEP_NOT_READY", 409);
      const previous = step.position ? run.steps[step.position - 1] : null;
      const previousJob = previous?.jobId ? await tx.tryOn.findUnique({ where: { id: previous.jobId } }) : null;
      const source = nextImageSource(run, previous, previousJob);
      if (getTool(step.tool).source && !source) throw new AppError("CREATION_SOURCE_MISSING", 409);
      const document = await tx.studioDocument.findFirst({ where: { id: run.documentId, userId: run.userId, deletedAt: null }, select: { id: true, version: true } });
      if (!document) throw new AppError("DOCUMENT_NOT_FOUND", 404);
      const output = await submit(run.userId, {
        origin: "chat", tool: step.tool, documentId: document.id, documentVersion: document.version,
        expectedCost: step.expectedCost, ...(run.input.provider ? { provider: run.input.provider } : {}),
        ...(source || {}), ...imageRunStepInputs(run, step),
      }, `creation-${step.id}-${step.attempt}`, db, { config, capabilities: caps, transaction: tx, creationStepId: step.id });
      await tx.creationStepAttempt.create({ data: { stepId: step.id, number: step.attempt, jobId: output.id, cost: output.cost } });
      await tx.creationStep.update({ where: { id: step.id }, data: { jobId: output.id, status: "queued", errorCode: null } });
      await appendRunEvent(tx, id, "step.queued", { stepId: step.id, jobId: output.id, cost: output.cost }, {
        status: "running", errorCode: null, committedCredits: { increment: output.cost }, nextCheckAt: new Date(+now + CHECK_INTERVAL),
      });
    }, { maxWait: 10000, timeout: 30000 });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    // The failed submission transaction has already rolled back (including its
    // reservation). Record a pause separately; DB failures still retry the wake.
    await db.$transaction(async tx => {
      const run = await lockRun(tx, initial.userId, id);
      // Ignore a stale wake only after checking the locked state. A persistent
      // step mismatch at the same sequence must not retry forever.
      if (run.eventSequence !== initial.eventSequence || run.cancelRequestedAt || !RUN_ACTIVE.includes(run.status)) return;
      // A terminal job with an unpublishable result must not monopolize every
      // wake. Preserve its paid checkpoint for explicit resume and drain the
      // other pages; never refund or regenerate an already successful call.
      if (parallelSlides && pending?.jobId) {
        const failed = run.steps.find(item => item.id === pending.id);
        await tx.creationStep.update({ where: { id: failed.id }, data: { status: "failed", errorCode: error.code } });
        const progress = slideRunProgress(run.steps.map(item => item.id === failed.id ? { ...item, status: "failed", errorCode: error.code } : item));
        for (const ready of progress.released) await tx.creationStep.update({ where: { id: ready.id }, data: { status: "ready" } });
        const updated = await appendRunEvent(tx, id, "step.failed", { stepId: failed.id, jobId: failed.jobId, code: error.code }, { status: progress.status, errorCode: progress.errorCode, nextCheckAt: now });
        if (progress.status === "running") await enqueueRun(tx, id, `publication-failed:${updated.eventSequence}`);
        return;
      }
      if (CAPACITY_ERRORS.includes(error.code) || parallelSlides && run.steps.some(inFlightStep)) {
        const nextCheckAt = new Date(+now + CHECK_INTERVAL);
        if (run.errorCode !== error.code) await appendRunEvent(tx, id, "run.waiting_capacity", { code: error.code }, { errorCode: error.code, nextCheckAt });
        else await tx.creationRun.update({ where: { id }, data: { nextCheckAt } });
        return;
      }
      const status = BUDGET_ERRORS.includes(error.code) ? "awaiting_budget" : "awaiting_input";
      await appendRunEvent(tx, id, "run.paused", { code: error.code }, { status, errorCode: error.code });
    });
  }
}

// Indexed, bounded recovery. Advancing nextCheckAt prevents the same first page
// of long-running jobs from starving other runs during recovery scans.
export async function recoverRuns(db = prisma, now = new Date()) {
  const rows = await db.creationRun.findMany({
    where: { status: { in: RUN_ACTIVE }, nextCheckAt: { lte: now } },
    orderBy: [{ nextCheckAt: "asc" }, { id: "asc" }], take: 100,
    select: { id: true, userId: true },
  });
  for (const row of rows) await db.$transaction(async tx => {
    const run = await lockRun(tx, row.userId, row.id);
    if (!RUN_ACTIVE.includes(run.status) || run.nextCheckAt > now) return;
    await enqueueRun(tx, row.id, `recover:${Math.floor(+now / CHECK_INTERVAL)}`);
    await tx.creationRun.update({ where: { id: row.id }, data: { nextCheckAt: new Date(+now + CHECK_INTERVAL) } });
  });
  return rows.length;
}
