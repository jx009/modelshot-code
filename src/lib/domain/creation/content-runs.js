import { getCreationEnv } from "../../creation/access.js";
import { sheetGenerationCalls } from "../../creation/contracts/sheet-batch.js";
import { verifiedAgentParent, wakeAgentParent } from "./agent-links.js";
import { dependencyReferencesSchema } from "../../creation/contracts/dependency-references.js";
import { createHash, randomUUID } from "node:crypto";
import { isHtmlDocument, validateHtmlSelection } from "../../creation/html/document.js";
import { HTML_PIPELINE_VERSION, HTML_SCHEDULER_HEARTBEAT, HTML_LANGUAGE_HEARTBEAT } from "../../creation/contracts/html-runtime.js";
import { referenceType } from "../../creation/reference-policy.js";
import { requireOfficeReferences, requireReferenceAdmission } from "./reference-admission.js";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { lockUser } from "../billing/ledger.js";
import { creationInputDigest } from "./input-digest.js";
import { contentRunSchema } from "../../creation/contracts/content-runs.js";
import { RUN_ACTIVE, RUN_WAITING } from "../../creation/contracts/runs.js";
import { languageInputSchema } from "../../creation/contracts/language.js";
import { validateDocumentSelection } from "../../creation/contracts/document-language.js";
import { validateSheetSelection } from "../../creation/sheet-selection.js";
import { validateWebSelection } from "../../creation/web-selection.js";
import { validateNativeSheetSelection } from "../../creation/native-sheet-edit.js";
import { NATIVE_SHEET_EDIT_FORMAT } from "../../creation/contracts/native-sheet-edit.js";
import { NATIVE_DOCUMENT_EDIT_FORMAT } from "../../creation/contracts/native-document-edit.js";
import { validateNativeDocumentSelection } from "../../creation/native-document-edit.js";
import { WEB_PIPELINE_VERSION, WEB_SCHEDULER_HEARTBEAT, WEB_LANGUAGE_HEARTBEAT } from "../../creation/contracts/web-runtime.js";
import { DOCUMENT_PIPELINE_VERSION, DOCUMENT_SCHEDULER_HEARTBEAT, DOCUMENT_LANGUAGE_HEARTBEAT } from "../../creation/contracts/document-runtime.js";
import { SHEET_PIPELINE_VERSION, SHEET_SCHEDULER_HEARTBEAT, SHEET_LANGUAGE_HEARTBEAT } from "../../creation/contracts/sheet-runtime.js";
import { creationLanguageConfig } from "./language-jobs.js";
import { CREATION_REFERENCE_MAX_CONTEXT_BYTES } from "./reference-files.js";
import { readLayoutArtifact, ownedArtifact } from "./artifacts.js";
import { presentRun, lockRun } from "./runs.js";
import { appendRunEvent, enqueueRun } from "./events.js";
import { appendCreationMessage } from "./messages.js";
import { posterImageQuote } from "./poster-images.js";
import { POSTER_IMAGE_TOOL, posterImageStep } from "../../creation/contracts/poster-image.js";
import { POSTER_IMAGE_SCHEDULER_HEARTBEAT, POSTER_IMAGE_LANGUAGE_HEARTBEAT, posterImageWorkersReady } from "../../creation/contracts/poster-runtime.js";
import { newlyUnblockedSteps, validateRunDependencyGraph } from "../../creation/run-dependencies.js";

export function requireContentCreation(kind, env = process.env) {
  const flag = { poster: "CREATION_POSTER_ENABLED", slides: "CREATION_SLIDES_ENABLED", document: "CREATION_DOCUMENT_ENABLED", sheet: "CREATION_SHEET_ENABLED", web: "CREATION_WEB_ENABLED" }[kind];
  if (!flag || env.CREATION_RUNS_ENABLED !== "true" || env.CREATION_WORKSPACE_ENABLED !== "true" || env[flag] !== "true") throw new AppError("CREATION_NOT_ENABLED", 503);
}
export async function ensureContentWorkers(db = prisma, { language = true, kind, posterImage = false } = {}) {
  const document = kind === "document", sheet = kind === "sheet", web = kind === "web";
  const version = document ? DOCUMENT_PIPELINE_VERSION : sheet ? SHEET_PIPELINE_VERSION : web ? WEB_PIPELINE_VERSION : null;
  const ids = ["worker", document ? DOCUMENT_SCHEDULER_HEARTBEAT : sheet ? SHEET_SCHEDULER_HEARTBEAT : web ? WEB_SCHEDULER_HEARTBEAT : "creation-worker", ...(language ? [document ? DOCUMENT_LANGUAGE_HEARTBEAT : sheet ? SHEET_LANGUAGE_HEARTBEAT : web ? WEB_LANGUAGE_HEARTBEAT : "creation-language-worker"] : [])];
  if (posterImage) ids.push(POSTER_IMAGE_SCHEDULER_HEARTBEAT, POSTER_IMAGE_LANGUAGE_HEARTBEAT);
  const html = ["poster", "slides"].includes(kind);
  if (html) ids.push(HTML_SCHEDULER_HEARTBEAT, ...(language ? [HTML_LANGUAGE_HEARTBEAT] : []));
  const rows = await db.serviceHeartbeat.findMany({ where: { id: { in: ids }, updatedAt: { gt: new Date(Date.now() - 90000) } }, select: { id: true, details: true } });
  if (ids.some(id => !rows.some(row => row.id === id)) || version !== null && rows.some(row => row.id !== "worker" && row.details?.version !== version)) throw new AppError("CREATION_WORKER_UNAVAILABLE", 503);
  if (posterImage && !posterImageWorkersReady(rows)) throw new AppError("CREATION_WORKER_UNAVAILABLE", 503);
  if (html && rows.some(row => [HTML_SCHEDULER_HEARTBEAT, HTML_LANGUAGE_HEARTBEAT].includes(row.id) && row.details?.version !== HTML_PIPELINE_VERSION)) throw new AppError("CREATION_WORKER_UNAVAILABLE", 503);
}

export async function createContentRun(userId, sessionId, input, key, { db = prisma, store, env, configFor = creationLanguageConfig, ensureWorkers = ensureContentWorkers, quoteImage = posterImageQuote, agentLink, dependencyRefs } = {}) {
  env ??= await getCreationEnv(userId, { db });
  const data = contentRunSchema.parse(input);
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key || "")) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  const requestId = createHash("sha256").update(`creation-content:${userId}:${sessionId}:${key}`).digest("hex"), digest = creationInputDigest(data);
  const old = await db.creationRun.findUnique({ where: { requestId }, include: { steps: { orderBy: { position: "asc" } } } });
  if (old) { if (old.userId !== userId || old.digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409); return presentRun(old); }
  requireContentCreation(data.kind, env);
  const nativeSheet = data.kind === "sheet" && data.target?.format === NATIVE_SHEET_EDIT_FORMAT;
  const nativeDocument = data.kind === "document" && data.target?.format === NATIVE_DOCUMENT_EDIT_FORMAT, nativeOffice = nativeSheet || nativeDocument;
  if (nativeOffice && env.CREATION_NATIVE_OFFICE_ENABLED !== "true") throw new AppError("CREATION_NOT_ENABLED", 503);
  const session = await db.creationSession.findFirst({ where: { id: sessionId, project: { userId, deletedAt: null } }, include: { project: { select: { kind: true } } } });
  if (!session) throw new AppError("CREATION_SESSION_NOT_FOUND", 404);
  await ensureWorkers(db, { kind: data.kind, posterImage: Boolean(data.image) });
  const config = await configFor(db);
  if (!config.visionApiKey || !config.chatModel) throw new AppError("VISION_NOT_CONFIGURED", 503);
  const cost = config.plannerCreditCost ?? 1, count = data.target ? 1 : data.kind === "sheet" ? sheetGenerationCalls(data.sheetCount, data.targetRows) : ["poster", "web"].includes(data.kind) ? 1 : (data.kind === "document" ? data.sectionCount : data.pageCount) + 1;
  if (!Number.isSafeInteger(cost) || cost < 0) throw new AppError("INVALID_PRICE", 503);
  const imageQuote = data.image ? await quoteImage(db, data.image.provider) : null;
  const imageCost = imageQuote?.prices[data.image?.size] ?? (data.image ? null : 0);
  if (imageCost === null) throw new AppError("IMAGE_SIZE_UNSUPPORTED", 422);
  if (data.image && data.image.expectedCost !== imageCost) throw new AppError("PRICE_CHANGED", 409);
  if (cost * count + imageCost > data.maxCredits) throw new AppError("CREATION_BUDGET_EXCEEDED", 409);
  let sourceFormat = ["poster", "slides"].includes(data.kind) && !data.target ? "html" : undefined;
  if (data.target) {
    const nativeService = nativeOffice ? await import("./native-office-artifacts.js") : null;
    const reader = nativeOffice ? (user, id, revision, options) => nativeService.readNativeOfficeArtifact(user, id, data.kind, revision, options) : data.kind === "document" ? (await import("./document-artifacts.js")).readDocumentArtifact : data.kind === "sheet" ? (await import("./sheet-artifacts.js")).readSheetArtifact : data.kind === "web" ? (await import("./web-artifacts.js")).readWebArtifact : readLayoutArtifact;
    const source = await reader(userId, data.target.artifactId, data.target.baseRevision, { db, store });
    if (source.projectId !== session.projectId || source.kind !== data.kind) throw new AppError("LANGUAGE_SOURCE_MISMATCH", 409);
    if (data.kind === "document" || data.kind === "sheet" || data.kind === "web") {
      try { (nativeDocument ? validateNativeDocumentSelection : nativeSheet ? validateNativeSheetSelection : data.kind === "document" ? validateDocumentSelection : data.kind === "sheet" ? validateSheetSelection : validateWebSelection)(data.target, source.content); }
      catch (error) { throw new AppError(error.code || "LANGUAGE_SELECTION_CHANGED", 409); }
    } else if (isHtmlDocument(source.content)) {
      validateHtmlSelection(data.target, source.content); sourceFormat = "html";
    } else {
      const page = source.content.pages.find(page => page.id === data.target.pageId);
      if (!page || data.target.nodeIds.some(id => !page.nodes.some(node => node.id === id && !node.locked))) throw new AppError("LANGUAGE_SELECTION_CHANGED", 409);
    }
  }
  const fixedRefs = dependencyRefs ? dependencyReferencesSchema.parse(dependencyRefs) : undefined;
  const common = { ...(fixedRefs ? { dependencyRefs: fixedRefs } : {}), prompt: data.prompt, locale: data.locale, assetIds: [...new Set(data.assetIds)], referenceIds: [...new Set(data.referenceIds)], ...(sourceFormat ? { sourceFormat } : {}) };
  const params = languageInputSchema.parse(data.target ? { ...common, purpose: `${data.kind}.${nativeOffice ? "native.edit" : "edit"}`, ...data.target }
    : data.kind === "poster" ? { ...common, purpose: "poster.generate", width: data.width, height: data.height }
      : data.kind === "document" ? { ...common, purpose: "document.outline", sectionCount: data.sectionCount, audience: data.audience }
        : data.kind === "sheet" ? { ...common, purpose: count > 1 ? "sheet.outline" : "sheet.generate", sheetCount: data.sheetCount, targetRows: data.targetRows }
          : data.kind === "web" ? { ...common, purpose: "web.generate", pageCount: data.pageCount }
        : { ...common, purpose: "slides.outline", pageCount: data.pageCount });
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const replay = await tx.creationRun.findUnique({ where: { requestId }, include: { steps: { orderBy: { position: "asc" } } } });
    if (replay) { if (replay.digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409); return presentRun(replay); }
    if (!await tx.creationSession.findFirst({ where: { id: sessionId, project: { userId, deletedAt: null } }, select: { id: true } })) throw new AppError("CREATION_SESSION_NOT_FOUND", 404);
    if (data.target) {
      const artifact = await ownedArtifact(userId, data.target.artifactId, tx);
      if (artifact.currentRevision !== data.target.baseRevision) throw new AppError("ARTIFACT_VERSION_CONFLICT", 409);
    }
    if (params.assetIds.length && await tx.asset.count({ where: { id: { in: params.assetIds }, userId, status: "active", contentType: { in: ["image/png", "image/jpeg", "image/webp"] } } }) !== params.assetIds.length) throw new AppError("ASSET_NOT_FOUND", 404);
    const references = params.referenceIds.length ? await tx.creationReference.findMany({ where: { id: { in: params.referenceIds }, userId, sessionId, deletedAt: null }, select: { id: true, name: true, fileType: true, contentType: true, bytes: true } }) : [];
    if (references.length !== params.referenceIds.length) throw new AppError("CREATION_REFERENCE_NOT_FOUND", 404);
    if (references.some(file => referenceType(file.fileType)?.office)) await requireOfficeReferences(tx, { env });
    if (references.filter(file => !referenceType(file.fileType)?.office).reduce((sum, file) => sum + file.bytes, 0) > CREATION_REFERENCE_MAX_CONTEXT_BYTES) throw new AppError("CREATION_REFERENCE_CONTEXT_LIMIT", 413);
    let parent = null, parentStep = null;
    if (agentLink) {
      parent = await lockRun(tx, userId, agentLink.runId);
      parentStep = parent.steps.find(step => step.id === agentLink.stepId);
      if (parent.kind !== "agent" || parent.projectId !== session.projectId || parent.sessionId !== sessionId || parent.cancelRequestedAt
        || !["queued", "running"].includes(parent.status) || parentStep?.status !== "ready" || parentStep.result?.childRunId
        || parent.eventSequence !== agentLink.sequence || parent.committedCredits + data.maxCredits > parent.maxCredits) throw new AppError("CREATION_RUN_CHANGED", 409);
    }
    if (await tx.creationRun.count({ where: { userId, ...(parent ? { id: { not: parent.id } } : {}), status: { in: [...RUN_ACTIVE, ...RUN_WAITING] } } })) throw new AppError("CREATION_USER_QUEUE_FULL", 429);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('creation-admission', 0))::text`;
    if (await tx.creationRun.count({ where: { status: { in: RUN_ACTIVE } } }) >= 1000) throw new AppError("CREATION_QUEUE_FULL", 503);
    const stepIds = Array.from({ length: data.image ? 2 : 1 }, () => randomUUID());
    const run = await tx.creationRun.create({ data: { userId, projectId: session.projectId, sessionId, requestId, digest, kind: data.kind, maxCredits: data.maxCredits,
      input: { ...(parent ? { agentParent: { runId: parent.id, stepId: parentStep.id } } : {}), summary: data.prompt.slice(0, 1000), clientKey: key, locale: data.locale, languageProvider: config.plannerProvider || null,
        languageUnitCost: cost, assetIds: params.assetIds, referenceIds: params.referenceIds, ...(data.image ? { posterImage: { ...data.image, provider: imageQuote.provider } } : {}), ...(data.kind === "document" ? { sectionCount: data.sectionCount, audience: data.audience } : data.kind === "sheet" ? { sheetCount: data.sheetCount, targetRows: data.targetRows } : data.kind === "web" ? { pageCount: data.pageCount } : { width: data.width, height: data.height, pageCount: data.pageCount }) },
      steps: { create: [
        ...(data.image ? [{ id: stepIds[0], position: 0, dependsOn: [], tool: POSTER_IMAGE_TOOL, params: posterImageStep(data, imageQuote.provider), explanation: data.locale === "zh" ? "生成海报视觉素材" : "Generate poster artwork", expectedCost: imageCost, status: "ready" }] : []),
        { id: stepIds.at(-1), position: data.image ? 1 : 0, dependsOn: data.image ? [stepIds[0]] : [], tool: params.purpose, params, explanation: data.locale === "zh" ? (data.target ? "修改选定内容" : data.kind === "poster" ? "设计海报" : data.kind === "document" ? "规划文档大纲" : data.kind === "sheet" ? "制作工作簿" : data.kind === "web" ? "创建网页" : "规划演示文稿大纲") : (data.target ? "Edit selected content" : data.kind === "poster" ? "Design poster" : data.kind === "document" ? "Plan document outline" : data.kind === "sheet" ? "Create workbook" : data.kind === "web" ? "Create website" : "Plan presentation outline"), expectedCost: cost, status: data.image ? "blocked" : "ready" },
      ] },
    }, include: { steps: { orderBy: { position: "asc" } } } });
    if (params.assetIds.length) await tx.assetReference.createMany({ data: params.assetIds.map(assetId => ({ assetId, entityId: run.id, kind: "creation_input" })) });
    await appendCreationMessage(tx, sessionId, key, "user", data.prompt, [...params.assetIds.map(assetId => ({ type: "asset", assetId })), ...references.map(({ id, name, fileType, contentType, bytes }) => ({ type: "reference", referenceId: id, name, fileType, contentType, bytes })), ...(data.target ? [{ type: "selection", ...data.target }] : []), { type: "run", runId: run.id }]);
    const updated = await appendRunEvent(tx, run.id, "run.created", { stepCount: count + (data.image ? 1 : 0) + (!data.target && ["slides", "document"].includes(data.kind) ? 1 : 0), maxCredits: data.maxCredits });
    await enqueueRun(tx, run.id, "initial");
    if (parent) {
      await tx.creationStep.update({ where: { id: parentStep.id }, data: { status: "running", result: { childRunId: run.id, accountedCredits: 0 } } });
      await appendRunEvent(tx, parent.id, "agent.child_started", { stepId: parentStep.id, childRunId: run.id }, { status: "running", nextCheckAt: new Date() });
    }
    return presentRun({ ...updated, steps: run.steps });
  }, { timeout: 15000 });
}

export async function resumeContentRun(userId, current, data, { db = prisma, env, configFor = creationLanguageConfig, ensureWorkers = ensureContentWorkers, quoteImage = posterImageQuote } = {}) {
  env ??= await getCreationEnv(userId, { db });
  if (!validateRunDependencyGraph(current.steps)) throw new AppError("CREATION_DEPENDENCY_GRAPH_INVALID", 409);
  const remaining = current.steps.filter(step => step.status !== "succeeded");
  const jobs = await db.tryOn.findMany({ where: { id: { in: remaining.map(step => step.jobId).filter(Boolean) }, userId }, select: { id: true, status: true } });
  const jobStatus = new Map(jobs.map(job => [job.id, job.status]));
  if (remaining.some(step => step.jobId && !["succeeded", "failed", "cancelled"].includes(jobStatus.get(step.jobId)))) throw new AppError("CREATION_DEPENDENCY_PENDING", 409);
  const isAssembly = step => ["layout.assemble", "document.assemble", "sheet.assemble"].includes(step.tool);
  const needsInvocation = step => !isAssembly(step) && (!step.jobId || jobStatus.get(step.jobId) !== "succeeded");
  const outlineNotExpanded = current.steps.length === 1 && ["slides.outline", "document.outline", "sheet.outline"].includes(remaining[0]?.tool);
  const futureCalls = outlineNotExpanded ? (current.kind === "sheet" ? sheetGenerationCalls(current.input.sheetCount, current.input.targetRows) - 1 : current.kind === "document" ? current.input.sectionCount : current.input.pageCount) : 0;
  const imageSteps = remaining.filter(step => step.tool === POSTER_IMAGE_TOOL && needsInvocation(step));
  const calls = remaining.filter(step => step.tool !== POSTER_IMAGE_TOOL && needsInvocation(step)).length + futureCalls;
  const imageQuotes = new Map();
  for (const step of imageSteps) {
    const quote = await quoteImage(db, step.params.provider), price = quote.prices[step.params.params.size];
    if (price === undefined) throw new AppError("IMAGE_SIZE_UNSUPPORTED", 422);
    if ((quote.provider || null) !== (step.params.provider || null)) throw new AppError("PROVIDER_CONFIGURATION_CHANGED", 409);
    imageQuotes.set(step.id, price);
  }
  await ensureWorkers(db, { language: calls > 0, kind: current.kind, posterImage: remaining.some(step => step.tool === POSTER_IMAGE_TOOL) || remaining.some(step => step.params?.visualAssetId) });
  if (calls || imageSteps.length) requireContentCreation(current.kind, env);
  if (remaining.some(step => ["sheet.native.edit", "document.native.edit"].includes(step.tool) && needsInvocation(step)) && env.CREATION_NATIVE_OFFICE_ENABLED !== "true") throw new AppError("CREATION_NOT_ENABLED", 503);
  const config = calls ? await configFor(db, current.input.languageProvider) : null;
  if (config && (!config.visionApiKey || !config.chatModel)) throw new AppError("VISION_NOT_CONFIGURED", 503);
  const cost = config?.plannerCreditCost ?? current.input.languageUnitCost;
  if (!Number.isSafeInteger(cost) || cost < 0) throw new AppError("INVALID_PRICE", 503);
  return db.$transaction(async tx => {
    const run = await lockRun(tx, userId, current.id);
    if (run.eventSequence !== data.expectedSequence || run.cancelRequestedAt) throw new AppError("CREATION_RUN_CHANGED", 409);
    if (calls) await requireReferenceAdmission(tx, userId, run.sessionId, [
      ...remaining.filter(needsInvocation).flatMap(step => step.params?.referenceIds || []),
      ...(futureCalls ? run.input.referenceIds || [] : []),
    ], { env });
    const parent = await verifiedAgentParent(tx, run);
    if (parent && parent.committedCredits - (parent.steps.find(step => step.id === run.input.agentParent.stepId)?.result?.accountedCredits || 0) + data.maxCredits > parent.maxCredits) throw new AppError("CREATION_BUDGET_EXCEEDED", 409);
    if (await tx.creationRun.count({ where: { userId, id: { notIn: [run.id, ...(parent ? [parent.id] : [])] }, status: { in: [...RUN_ACTIVE, ...RUN_WAITING] } } })) throw new AppError("CREATION_USER_QUEUE_FULL", 429);
    if (run.committedCredits + calls * cost + [...imageQuotes.values()].reduce((sum, price) => sum + price, 0) > data.maxCredits) throw new AppError("CREATION_BUDGET_EXCEEDED", 409);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('creation-admission', 0))::text`;
    if (await tx.creationRun.count({ where: { status: { in: RUN_ACTIVE } } }) >= 1000) throw new AppError("CREATION_QUEUE_FULL", 503);
    for (const step of remaining) {
      const keepResult = step.jobId && jobStatus.get(step.jobId) === "succeeded";
      await tx.creationStep.update({ where: { id: step.id }, data: {
        status: keepResult ? "running" : "blocked", errorCode: null,
        expectedCost: keepResult ? step.expectedCost : isAssembly(step) ? 0 : step.tool === POSTER_IMAGE_TOOL ? imageQuotes.get(step.id) : cost,
        // A succeeded model call is never discarded when publication failed.
        // Only an explicitly retried failed attempt gets a new billable job.
        ...(!keepResult && step.jobId ? { jobId: null, attempt: { increment: 1 } } : {}),
      } });
    }
    const resumableSteps = run.steps.map(step => {
      const remainingStep = remaining.find(candidate => candidate.id === step.id);
      if (!remainingStep) return step;
      const keepResult = remainingStep.jobId && jobStatus.get(remainingStep.jobId) === "succeeded";
      return { ...step, status: keepResult ? "running" : "blocked", ...(remainingStep.jobId && !keepResult ? { jobId: null } : {}) };
    });
    const ready = newlyUnblockedSteps(resumableSteps)[0];
    if (ready) await tx.creationStep.update({ where: { id: ready.id }, data: { status: "ready" } });
    else if (!resumableSteps.some(step => step.status === "running" && step.jobId)) throw new AppError("CREATION_DEPENDENCY_BLOCKED", 409);
    await appendRunEvent(tx, run.id, "run.resumed", { maxCredits: data.maxCredits, retryFailed: data.retryFailed }, {
      status: "queued", maxCredits: data.maxCredits, errorCode: null, nextCheckAt: new Date(),
      ...(outlineNotExpanded ? { input: { ...run.input, languageUnitCost: cost } } : {}),
    });
    await enqueueRun(tx, run.id, `resume:${data.expectedSequence}`);
    await wakeAgentParent(tx, run);
    return presentRun(await tx.creationRun.findUnique({ where: { id: run.id }, include: { steps: { orderBy: { position: "asc" } } } }));
  }, { timeout: 15000 });
}
