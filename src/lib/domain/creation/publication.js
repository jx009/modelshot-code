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
import { assembleDocumentContent } from "./document-assembly.js";
import { applyNativeSheetOperations } from "../../creation/native-sheet-edit.js";
import { applyNativeDocumentOperations } from "../../creation/native-document-edit.js";

async function guard(tx, initial, stepId, jobId) {
  const run = await lockRun(tx, initial.userId, initial.id), step = run.steps.find(step => step.id === stepId);
  if (run.cancelRequestedAt || !["queued", "running"].includes(run.status)) throw new AppError("CREATION_PUBLICATION_STOPPED", 409);
  if (run.eventSequence !== initial.eventSequence || !step || step.status === "succeeded" || (step.jobId || null) !== jobId) throw new AppError("CREATION_RUN_CHANGED", 409);
  if (jobId) {
    const job = await tx.tryOn.findFirst({ where: { id: jobId, userId: run.userId, status: "succeeded", executionQueue: "creation-language" }, select: { snapshot: true } });
    if (job?.snapshot?.creationStepId !== step.id || job.snapshot.creationAttempt !== step.attempt) throw new AppError("CREATION_STEP_CHANGED", 409);
  } else if (!["layout.assemble", "document.assemble"].includes(step.tool) || step.status !== "ready") throw new AppError("CREATION_STEP_NOT_READY", 409);
  if (run.steps.some(previous => previous.position < step.position && previous.status !== "succeeded")) throw new AppError("CREATION_DEPENDENCY_PENDING", 409);
  return { run, step };
}

async function complete(tx, run, step, result, message) {
  await tx.creationStep.update({ where: { id: step.id }, data: { status: "succeeded", result, errorCode: null } });
  if (message && run.sessionId) await appendCreationMessage(tx, run.sessionId, `result-${step.id}-${step.attempt}`, "assistant", message,
    [{ type: "run", runId: run.id }, ...(result.artifactId ? [{ type: "artifact", artifactId: result.artifactId, revision: result.revision, disposition: result.disposition }] : [])]);
  const next = await tx.creationStep.findUnique({ where: { runId_position: { runId: run.id, position: step.position + 1 } } });
  if (next) await tx.creationStep.update({ where: { id: next.id }, data: { status: "ready" } });
  const updated = await appendRunEvent(tx, run.id, "step.succeeded", { stepId: step.id, jobId: step.jobId, result }, {
    status: next ? "running" : "succeeded", errorCode: null, nextCheckAt: new Date(),
  });
  if (next) await enqueueRun(tx, run.id, `step:${updated.eventSequence}`);
  else await appendRunEvent(tx, run.id, "run.succeeded", { result }, { status: "succeeded" });
}
function publicationHooks(initial, step, jobId, disposition, extra = {}) {
  let locked;
  return {
    beforeCommit: async tx => { locked = await guard(tx, initial, step.id, jobId); },
    afterCommit: async (tx, saved) => {
      const result = { artifactId: saved.artifactId, revision: saved.revision, disposition, ...extra };
      const zh = initial.input.locale !== "en";
      const message = disposition === "conflict-copy" ? (zh ? "原作品已有新修改。我已将本次 AI 修改保存为单独的作品，保留了原作品的最新版本。" : "The original changed while I was working. I saved these AI edits as a separate artwork and kept the latest original.")
        : disposition === "updated" ? (zh ? "已按要求修改选定内容，其他页面和未涉及的对象保持不变。" : "Updated the requested content while preserving unrelated objects and pages.")
          : (zh ? "作品已生成，可以继续编辑，或在对话中提出修改要求。" : "Your artwork is ready to edit. You can also request changes in this conversation.");
      await complete(tx, locked.run, locked.step, result, message);
    },
  };
}

export async function publishCreationLanguage(initial, step, { db = prisma, store = objectStorage() } = {}) {
  const input = languageInputSchema.parse(step.params), raw = await readCreationLanguageResult(initial.userId, step.jobId, { db, store });
  const document = initial.kind === "document", sheet = initial.kind === "sheet", web = initial.kind === "web";
  const nativeSheet = input.purpose === "sheet.native.edit";
  const nativeDocument = input.purpose === "document.native.edit", nativeOffice = nativeSheet || nativeDocument;
  if (nativeSheet && !sheet || nativeDocument && !document) throw new AppError("LANGUAGE_SOURCE_MISMATCH", 422);
  const service = nativeOffice ? await import("./native-office-artifacts.js") : document ? await import("./document-artifacts.js") : sheet ? await import("./sheet-artifacts.js") : web ? await import("./web-artifacts.js") : null;
  const reader = nativeOffice ? (user, id, revision, options) => service.readNativeOfficeArtifact(user, id, initial.kind, revision, options) : service ? (document ? service.readDocumentArtifact : sheet ? service.readSheetArtifact : service.readWebArtifact) : readLayoutArtifact;
  const source = input.artifactId ? await reader(initial.userId, input.artifactId, input.baseRevision, { db, store }) : null;
  const result = validateLanguageResult(input, raw, source?.content);
  if (["slides.outline", "document.outline"].includes(input.purpose)) {
    const spec = outlineForKind(initial.kind), count = result[spec.items].length;
    return db.$transaction(async tx => {
      const locked = await guard(tx, initial, step.id, step.jobId);
      if (locked.run.steps.length !== 1 || count !== initial.input[spec.count]) throw new AppError("CREATION_OUTLINE_CHANGED", 409);
      await tx.creationStep.update({ where: { id: locked.step.id }, data: { status: "succeeded", result: { [spec.count]: count, awaitingConfirmation: true }, errorCode: null } });
      await appendCreationMessage(tx, locked.run.sessionId, `outline-review-${step.id}-${step.attempt}`, "assistant",
        input.locale === "zh" ? `大纲已完成，共 ${count} ${document ? "节" : "页"}。请检查或修改大纲，确认内容和预算后继续生成。` : `The ${count}-${document ? "section" : "slide"} outline is ready. Review the content and budget before generation.`, [{ type: "outline", runId: initial.id }]);
      await appendRunEvent(tx, initial.id, "outline.ready", { stepId: step.id, [spec.count]: count }, {
        status: "awaiting_input", errorCode: OUTLINE_CONFIRMATION_REQUIRED,
      });
    }, { timeout: 15000 });
  }
  if (["slides.page", "document.section"].includes(input.purpose)) {
    if (input.purpose === "slides.page" && input.sourceFormat === "html") return publishHtmlSlide(initial, step, result, { db, store });
    return db.$transaction(async tx => {
      const locked = await guard(tx, initial, step.id, step.jobId);
      await complete(tx, locked.run, locked.step, { [document ? "sectionId" : "pageId"]: result.id, jobId: step.jobId });
    });
  }
  if (input.purpose === "sheet.generate" || input.purpose === "web.generate") {
    const create = sheet ? service.createSheetArtifact : service.createWebArtifact;
    return create(initial.userId, initial.projectId, result, `generated-${step.jobId}`, { db, store, sourceRunId: initial.id, hooks: publicationHooks(initial, step, step.jobId, "created") });
  }
  const options = { db, store, sourceRunId: initial.id };
  if (input.purpose === "poster.generate") return createLayoutArtifact(initial.userId, initial.projectId, result, `generated-${step.jobId}`, {
    ...options, hooks: publicationHooks(initial, step, step.jobId, "created"),
  });
  try {
    const modify = nativeDocument ? service.modifyNativeDocumentArtifact : nativeSheet ? service.modifyNativeSheetArtifact : document ? service.modifyDocumentArtifact : sheet ? service.modifySheetArtifact : web ? service.modifyWebArtifact : modifyLayoutArtifact;
    return await modify(initial.userId, input.artifactId, { baseRevision: input.baseRevision, operations: result.operations, saveKey: `edited-${step.jobId}` }, {
      ...options, hooks: publicationHooks(initial, step, step.jobId, "updated"),
    });
  } catch (error) {
    if (error.code !== "ARTIFACT_VERSION_CONFLICT") throw error;
    // Apply only to the fixed source revision. Rebase onto the user's newer
    // document would silently overwrite edits; re-running the model costs again.
    const apply = nativeDocument ? applyNativeDocumentOperations : nativeSheet ? applyNativeSheetOperations : document ? (await import("../../creation/document-operations.js")).applyDocumentOperations : sheet ? (await import("../../creation/sheet-operations.js")).applySheetOperations : web ? (await import("../../creation/web-operations.js")).applyWebOperations : applyLayoutOperations;
    const copy = apply(source.content, result.operations);
    copy.title = `${copy.title.slice(0, 140)}${input.locale === "zh" ? "（AI 修改副本）" : " (AI edit copy)"}`;
    if (nativeSheet) copy.snapshot.name = copy.title;
    if (nativeDocument) copy.snapshot.title = copy.title;
    const create = nativeOffice ? service.createNativeOfficeArtifact : document ? service.createDocumentArtifact : sheet ? service.createSheetArtifact : web ? service.createWebArtifact : createLayoutArtifact;
    return create(initial.userId, initial.projectId, copy, `conflict-${step.jobId}`, {
      ...options, hooks: publicationHooks(initial, step, step.jobId, "conflict-copy"),
    });
  }
}

export async function assembleCreationDocument(initial, step, { db = prisma, store = objectStorage() } = {}) {
  if (initial.kind !== "document" || initial.steps[0]?.tool !== "document.outline" || !initial.steps[0].result?.confirmation) throw new AppError("CREATION_OUTLINE_CHANGED", 409);
  const outline = await readApprovedOutline(initial.userId, initial, { db, store });
  const parts = initial.steps.filter(item => item.tool === "document.section");
  if (parts.length !== outline.sections.length || parts.some(item => item.status !== "succeeded")) throw new AppError("CREATION_DEPENDENCY_PENDING", 409);
  const sections = []; let bytes = 0;
  for (const [index, item] of parts.entries()) {
    const input = languageInputSchema.parse(item.params), approved = outline.sections[index];
    if (input.sectionId !== approved.id || input.title !== approved.title || input.brief !== approved.brief || input.documentTitle !== outline.title) throw new AppError("CREATION_OUTLINE_CHANGED", 409);
    const section = validateLanguageResult(input, await readCreationLanguageResult(initial.userId, item.jobId, { db, store }));
    bytes += Buffer.byteLength(JSON.stringify(section));
    if (bytes > 2 * 1024 * 1024) throw new AppError("ARTIFACT_TOO_LARGE", 413);
    sections.push(section);
  }
  const content = assembleDocumentContent(outline, sections, initial.input.locale);
  const { createDocumentArtifact } = await import("./document-artifacts.js");
  return createDocumentArtifact(initial.userId, initial.projectId, content, `assembled-${initial.id}`, {
    db, store, sourceRunId: initial.id, hooks: publicationHooks(initial, step, null, "created"),
  });
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
      await complete(tx, locked.run, locked.step, { artifactId, revision: source.revision, disposition: "created" }, initial.input.locale === "en" ? "All slides are ready. Your edits to completed slides have been preserved." : "全部页面已生成，你对已完成页面的修改也已保留。");
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
  const document = html ? htmlDocumentSchema.parse({ schemaVersion: 3, format: "html-slides", kind: "slides", title: outline.title, theme: outline.theme, pages, metadata: { statistics: { total_pages: pages.length } }, templates: [] }) : layoutDocumentSchema.parse({ schemaVersion: 1, kind: "slides", title: outline.title, theme: outline.theme, pages });
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
  const hooks = publicationHooks(initial, step, step.jobId, prior ? "updated" : "created", { pageId: page.id, jobId: step.jobId });
  if (!prior) {
    const content = htmlDocumentSchema.parse({ schemaVersion: 3, kind: "slides", format: "html-slides", title: outline.title, theme: outline.theme, metadata: { plannedPages: outline.pages.length }, pages: [page] });
    return createLayoutArtifact(initial.userId, initial.projectId, content, `generated-${step.jobId}`, { db, store, sourceRunId: initial.id, hooks });
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const source = await readLayoutArtifact(initial.userId, prior.result.artifactId, undefined, { db, store });
    try {
      return await modifyLayoutArtifact(initial.userId, source.id, { baseRevision: source.revision, saveKey: `append-${step.jobId}-${source.revision}`, operations: [{ op: "insertHtmlPage", page, index: source.content.pages.length }] }, { db, store, sourceRunId: initial.id, hooks });
    } catch (error) { if (error.code !== "ARTIFACT_VERSION_CONFLICT" || attempt === 2) throw error; }
  }
}
