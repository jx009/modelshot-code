import { randomUUID } from "node:crypto";
import { slidePublishedMessage, slideCompletionMessage } from "../../creation/slide-publication-message.js";
import { slideDesignMarkdown } from "../../creation/contracts/slide-design.js";
import { isSlideGeneration, slideRunProgress, slideInsertionIndex } from "../../creation/slide-scheduling.js";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { languageInputSchema, validateLanguageResult } from "../../creation/contracts/language.js";
import { layoutDocumentSchema } from "../../creation/contracts/layout.js";
import { applyArtworkOperations as applyLayoutOperations } from "../../creation/artwork-codec.js";
import { htmlDocumentSchema } from "../../creation/html/document.js";
import { readCreationLanguageResult } from "./language-execution.js";
import { createLayoutArtifact, modifyLayoutArtifact, readLayoutArtifact } from "./artifacts.js";
import { lockRun } from "./runs.js";
import { appendRunEvent, enqueueRun } from "./events.js";
import { OUTLINE_CONFIRMATION_REQUIRED, readApprovedOutline } from "./outline-review.js";
import { appendCreationMessage } from "./messages.js";
import { outlineForKind } from "../../creation/outline-plan.js";
import { dependenciesFor, newlyUnblockedSteps, nextReadyStep, runHasUnfinishedSteps, validateRunDependencyGraph } from "../../creation/run-dependencies.js";

async function guard(tx, initial, stepId, jobId) {
  const run = await lockRun(tx, initial.userId, initial.id), step = run.steps.find(step => step.id === stepId);
  if (run.cancelRequestedAt || !["queued", "running"].includes(run.status)) throw new AppError("CREATION_PUBLICATION_STOPPED", 409);
  if (run.eventSequence !== initial.eventSequence || !step || step.status === "succeeded" || (step.jobId || null) !== jobId) throw new AppError("CREATION_RUN_CHANGED", 409);
  if (jobId) {
    const job = await tx.tryOn.findFirst({ where: { id: jobId, userId: run.userId, status: "succeeded", executionQueue: "creation-language" }, select: { snapshot: true } });
    if (job?.snapshot?.creationStepId !== step.id || job.snapshot.creationAttempt !== step.attempt) throw new AppError("CREATION_STEP_CHANGED", 409);
  } else if (step.tool !== "layout.assemble" || step.status !== "ready") throw new AppError("CREATION_STEP_NOT_READY", 409);
  if (!validateRunDependencyGraph(run.steps)) throw new AppError("CREATION_DEPENDENCY_GRAPH_INVALID", 409);
  if (dependenciesFor(step, run.steps).some(id => run.steps.find(previous => previous.id === id)?.status !== "succeeded")) throw new AppError("CREATION_DEPENDENCY_PENDING", 409);
  return { run, step };
}

async function complete(tx, run, step, result, message) {
  await tx.creationStep.update({ where: { id: step.id }, data: { status: "succeeded", result, errorCode: null } });
  if (message && run.sessionId) await appendCreationMessage(tx, run.sessionId, `result-${step.id}-${step.attempt}`, "assistant", message,
    [{ type: "run", runId: run.id }, ...(result.artifactId ? [{ type: "artifact", artifactId: result.artifactId, revision: result.revision, disposition: result.disposition }] : [])]);
  // Position is display order, not execution order. Publishing one branch
  // must not release its neighbour before that neighbour's inputs exist.
  const completed = run.steps.map(item => item.id === step.id ? { ...item, status: "succeeded" } : item);
  if (isSlideGeneration(run)) {
    const progress = slideRunProgress(completed);
    for (const ready of progress.released) await tx.creationStep.update({ where: { id: ready.id }, data: { status: "ready" } });
    const updated = await appendRunEvent(tx, run.id, "step.succeeded", { stepId: step.id, jobId: step.jobId, result }, { status: progress.status, errorCode: progress.errorCode, nextCheckAt: new Date() });
    if (progress.status === "running") await enqueueRun(tx, run.id, `step:${updated.eventSequence}`);
    else if (progress.status === "succeeded") await appendRunEvent(tx, run.id, "run.succeeded", { result }, { status: "succeeded" });
    return;
  }
  const released = newlyUnblockedSteps(completed), readyIds = new Set(released.map(item => item.id));
  for (const ready of released) await tx.creationStep.update({ where: { id: ready.id }, data: { status: "ready" } });
  const next = nextReadyStep(completed.map(item => readyIds.has(item.id) ? { ...item, status: "ready" } : item));
  const blocked = !next && runHasUnfinishedSteps(completed);
  const updated = await appendRunEvent(tx, run.id, "step.succeeded", { stepId: step.id, jobId: step.jobId, result }, {
    status: next ? "running" : blocked ? "awaiting_input" : "succeeded", errorCode: blocked ? "CREATION_DEPENDENCY_BLOCKED" : null, ...(next ? { nextCheckAt: new Date() } : {}),
  });
  if (next) await enqueueRun(tx, run.id, `step:${updated.eventSequence}`);
  else if (!blocked) await appendRunEvent(tx, run.id, "run.succeeded", { result }, { status: "succeeded" });
}
function publicationHooks(initial, step, jobId, disposition, extra = {}, customMessage) {
  let locked;
  return {
    beforeCommit: async tx => { locked = await guard(tx, initial, step.id, jobId); },
    afterCommit: async (tx, saved) => {
      const result = { artifactId: saved.artifactId, revision: saved.revision, disposition, ...extra };
      const zh = initial.input.locale !== "en";
      const message = disposition === "conflict-copy" ? (zh ? "原作品已有新修改。我已将本次 AI 修改保存为单独的作品，保留了原作品的最新版本。" : "The original changed while I was working. I saved these AI edits as a separate artwork and kept the latest original.")
        : disposition === "updated" ? (zh ? "已按要求修改选定内容，其他页面和未涉及的对象保持不变。" : "Updated the requested content while preserving unrelated objects and pages.")
          : (zh ? "作品已生成，可以继续编辑，或在对话中提出修改要求。" : "Your artwork is ready to edit. You can also request changes in this conversation.");
      await complete(tx, locked.run, locked.step, result, customMessage || message);
    },
  };
}

export async function publishCreationLanguage(initial, step, { db = prisma, store = objectStorage() } = {}) {
  const input = languageInputSchema.parse(step.params), raw = await readCreationLanguageResult(initial.userId, step.jobId, { db, store });
  const source = input.artifactId ? await readLayoutArtifact(initial.userId, input.artifactId, input.baseRevision, { db, store }) : null;
  const result = validateLanguageResult(input, raw, source?.content);
  if (input.purpose === "slides.outline") {
    const spec = outlineForKind(initial.kind), count = result[spec.items].length;
    return db.$transaction(async tx => {
      const locked = await guard(tx, initial, step.id, step.jobId);
      if (locked.run.steps.length !== 1 || count !== initial.input[spec.count]) throw new AppError("CREATION_OUTLINE_CHANGED", 409);
      await tx.creationStep.update({ where: { id: locked.step.id }, data: { status: "succeeded", result: { [spec.count]: count, awaitingConfirmation: true }, errorCode: null } });
      await appendCreationMessage(tx, locked.run.sessionId, `outline-review-${step.id}-${step.attempt}`, "assistant",
        input.locale === "zh" ? `大纲已完成，共 ${count} 页。请检查或修改大纲，确认内容和预算后继续生成。` : `The ${count}-slide outline is ready. Review the content and budget before generation.`, [{ type: "outline", runId: initial.id }]);
      await appendRunEvent(tx, initial.id, "outline.ready", { stepId: step.id, [spec.count]: count }, {
        status: "awaiting_input", errorCode: OUTLINE_CONFIRMATION_REQUIRED,
      });
    }, { timeout: 15000 });
  }
  if (input.purpose === "slides.page") {
    if (input.sourceFormat === "html") return publishHtmlSlide(initial, step, result, { db, store });
    return db.$transaction(async tx => {
      const locked = await guard(tx, initial, step.id, step.jobId);
      await complete(tx, locked.run, locked.step, { pageId: result.id, jobId: step.jobId });
    });
  }
  const options = { db, store, sourceRunId: initial.id };
  if (input.purpose === "poster.generate") return createLayoutArtifact(initial.userId, initial.projectId, result, `generated-${step.jobId}`, {
    ...options, hooks: publicationHooks(initial, step, step.jobId, "created"),
  });
  try {
    return await modifyLayoutArtifact(initial.userId, input.artifactId, { baseRevision: input.baseRevision, operations: result.operations, saveKey: `edited-${step.jobId}` }, {
      ...options, hooks: publicationHooks(initial, step, step.jobId, "updated"),
    });
  } catch (error) {
    if (error.code !== "ARTIFACT_VERSION_CONFLICT") throw error;
    // Apply only to the fixed source revision. Rebase onto the user's newer
    // document would silently overwrite edits; re-running the model costs again.
    const copy = applyLayoutOperations(source.content, result.operations);
    copy.title = `${copy.title.slice(0, 140)}${input.locale === "zh" ? "（AI 修改副本）" : " (AI edit copy)"}`;
    return createLayoutArtifact(initial.userId, initial.projectId, copy, `conflict-${step.jobId}`, {
      ...options, hooks: publicationHooks(initial, step, step.jobId, "conflict-copy"),
    });
  }
}

export async function assembleCreationSlides(initial, step, { db = prisma, store = objectStorage() } = {}) {
  const outlineStep = initial.steps[0];
  if (outlineStep?.tool !== "slides.outline" || initial.kind !== "slides") throw new AppError("CREATION_OUTLINE_CHANGED", 409);
  const outline = await readApprovedOutline(initial.userId, initial, { db, store });
  const pageSteps = initial.steps.filter(item => item.tool === "slides.page");
  if (pageSteps.length !== outline.pages.length || pageSteps.some(item => item.status !== "succeeded")) throw new AppError("CREATION_DEPENDENCY_PENDING", 409);
  if (outlineStep.params.sourceFormat === "html" && pageSteps[0]?.result?.artifactId) {
    const artifactId = pageSteps[0].result.artifactId;
    if (pageSteps.some(item => item.result?.artifactId !== artifactId)) throw new AppError("CREATION_OUTLINE_CHANGED", 409);
    const source = await readLayoutArtifact(initial.userId, artifactId, undefined, { db, store });
    return db.$transaction(async tx => {
      const locked = await guard(tx, initial, step.id, null);
      await complete(tx, locked.run, locked.step, { artifactId, revision: source.revision, disposition: "created" }, slideCompletionMessage(outline, initial.input.locale));
    });
  }
  const pages = [];
  let bytes = 0, nodes = 0;
  for (const [index, item] of pageSteps.entries()) {
    const input = languageInputSchema.parse(item.params), page = validateLanguageResult(input, await readCreationLanguageResult(initial.userId, item.jobId, { db, store }));
    if (page.id !== outline.pages[index].id) throw new AppError("CREATION_OUTLINE_CHANGED", 409);
    // User-approved notes are authoritative, including an intentionally empty
    // field. Legacy automatically expanded runs retain their previous fallback.
    if (outlineStep.result?.confirmation || !page.notes) page.notes = outline.pages[index].notes;
    bytes += Buffer.byteLength(JSON.stringify(page)); nodes += page.nodes?.length || 0;
    if (bytes > 2 * 1024 * 1024 || nodes > 5000) throw new AppError("ARTIFACT_TOO_LARGE", 413);
    pages.push(page);
  }
  const html = outlineStep.params.sourceFormat === "html";
  const document = html ? htmlDocumentSchema.parse({ schemaVersion: 3, format: "html-slides", kind: "slides", title: outline.title, theme: outline.theme, pages, metadata: { statistics: { total_pages: pages.length }, ...(outline.design ? { design: outline.design, designMarkdown: slideDesignMarkdown(outline) } : {}) }, templates: [] }) : layoutDocumentSchema.parse({ schemaVersion: 1, kind: "slides", title: outline.title, theme: outline.theme, pages });
  return createLayoutArtifact(initial.userId, initial.projectId, document, `assembled-${initial.id}`, {
    db, store, sourceRunId: initial.id, hooks: publicationHooks(initial, step, null, "created"),
  });
}

async function publishHtmlSlide(initial, step, generated, { db, store }) {
  const outline = await readApprovedOutline(initial.userId, initial, { db, store });
  const approved = outline.pages.find(page => page.id === generated.id);
  if (!approved) throw new AppError("CREATION_OUTLINE_CHANGED", 409);
  const page = { ...generated, notes: approved.notes };
  const prior = initial.steps.find(item => item.tool === "slides.page" && item.status === "succeeded" && item.result?.artifactId);
  const hooks = publicationHooks(initial, step, step.jobId, prior ? "updated" : "created", { pageId: page.id, jobId: step.jobId }, slidePublishedMessage(outline, page.id, initial.input.locale));
  if (!prior) {
    const content = htmlDocumentSchema.parse({ schemaVersion: 3, kind: "slides", format: "html-slides", title: outline.title, theme: outline.theme, metadata: { plannedPages: outline.pages.length, ...(outline.design ? { design: outline.design, designMarkdown: slideDesignMarkdown(outline) } : {}) }, pages: [page] });
    return createLayoutArtifact(initial.userId, initial.projectId, content, `generated-${step.jobId}`, { db, store, sourceRunId: initial.id, hooks });
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const source = await readLayoutArtifact(initial.userId, prior.result.artifactId, undefined, { db, store });
    try {
      return await modifyLayoutArtifact(initial.userId, source.id, { baseRevision: source.revision, saveKey: `append-${step.jobId}-${source.revision}`, operations: [{ op: "insertHtmlPage", page, index: slideInsertionIndex(source.content.pages, outline, page.id) }] }, { db, store, sourceRunId: initial.id, hooks });
    } catch (error) { if (error.code !== "ARTIFACT_VERSION_CONFLICT" || attempt === 2) throw error; }
  }
}
