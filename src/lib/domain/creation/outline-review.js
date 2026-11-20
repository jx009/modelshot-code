import { getCreationEnv } from "../../creation/access.js";
import { verifiedAgentParent, wakeAgentParent } from "./agent-links.js";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../prisma.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { AppError } from "../../http.js";
import { digestJson } from "../generation/contracts.js";
import { languageInputSchema, LANGUAGE_MAX_RESULT_BYTES } from "../../creation/contracts/language.js";
import { outlineForKind, outlineChildren } from "../../creation/outline-plan.js";
import { confirmOutlineSchema } from "../../creation/contracts/outline-review.js";
import { RUN_ACTIVE, RUN_WAITING } from "../../creation/contracts/runs.js";
import { lockRun, presentRun } from "./runs.js";
import { readCreationLanguageResult } from "./language-execution.js";
import { requireContentCreation, ensureContentWorkers } from "./content-runs.js";
import { creationLanguageConfig } from "./language-jobs.js";
import { appendRunEvent, enqueueRun } from "./events.js";
import { appendCreationMessage } from "./messages.js";
import { posterImageQuote, posterImageModels } from "./poster-images.js";
import { plannedSlideVisuals } from "../../creation/contracts/slide-design.js";
import { posterImageSize } from "../../creation/poster-image-choice.js";

export const OUTLINE_CONFIRMATION_REQUIRED = "CREATION_OUTLINE_CONFIRMATION_REQUIRED";

function reviewStep(run) {
  const step = run.steps[0];
  if (!["slides", "document"].includes(run.kind) || step?.tool !== `${run.kind}.outline` || step.status !== "succeeded") throw new AppError("CREATION_OUTLINE_NOT_READY", 409);
  return step;
}
async function ownedRun(userId, id, db) {
  const run = await db.creationRun.findFirst({ where: { id, userId, project: { deletedAt: null } }, include: { steps: { orderBy: { position: "asc" } } } });
  if (!run) throw new AppError("CREATION_RUN_NOT_FOUND", 404);
  return run;
}
function replay(run, key, digest) {
  const accepted = reviewStep(run).result?.confirmation;
  if (!accepted) return null;
  if (accepted.key !== key || accepted.digest !== digest) throw new AppError("CREATION_OUTLINE_ALREADY_CONFIRMED", 409);
  return presentRun(run);
}

export async function readApprovedOutline(userId, run, { db = prisma, store = objectStorage() } = {}) {
  const step = reviewStep(run), blobId = step.result?.confirmation?.blobId;
  const outlineSchema = outlineForKind(run.kind).schema;
  if (!blobId) return outlineSchema.parse(await readCreationLanguageResult(userId, step.jobId, { db, store }));
  const blob = await db.creationBlob.findFirst({ where: { id: blobId, userId, state: "ready" } });
  if (!blob || blob.bytes <= 0 || blob.bytes > LANGUAGE_MAX_RESULT_BYTES || !blob.objectKey.startsWith(`${userId}/creation-outline/${run.id}/`)) throw new AppError("CREATION_OUTLINE_NOT_READY", 409);
  const bytes = await store.get(blob.objectKey);
  if (bytes.length !== blob.bytes || createHash("sha256").update(bytes).digest("hex") !== blob.checksum) throw new AppError("ARTIFACT_INTEGRITY_FAILED", 502);
  return outlineSchema.parse(JSON.parse(bytes.toString("utf8")));
}

export async function readOutlineReview(userId, id, { db = prisma, store = objectStorage(), configFor = creationLanguageConfig, quoteImage = posterImageQuote, modelsFor = posterImageModels } = {}) {
  const run = await ownedRun(userId, id, db), step = reviewStep(run);
  const outline = await readApprovedOutline(userId, run, { db, store });
  let unitCost = null;
  try {
    const config = await configFor(db, run.input.languageProvider);
    if (config.visionApiKey && config.chatModel && Number.isSafeInteger(config.plannerCreditCost ?? 1) && (config.plannerCreditCost ?? 1) >= 0) unitCost = config.plannerCreditCost ?? 1;
  } catch { /* A temporarily unavailable model must not prevent reading the outline. */ }
  let image = null, imageModels = [];
  if (run.kind === "slides" && plannedSlideVisuals(outline).length && (step.params.assetIds || []).length < 8) {
    try {
      const quote = await quoteImage(db, run.input.imageProvider), preferred = posterImageSize(run.input.width, run.input.height);
      const size = Number.isSafeInteger(quote.prices[preferred]) ? preferred : ["1024x1024", "1536x1024", "1024x1536"].find(candidate => Number.isSafeInteger(quote.prices[candidate]));
      if (Number.isSafeInteger(quote.prices[size])) image = { size, expectedCost: quote.prices[size], ...(quote.provider ? { provider: quote.provider } : {}) };
    } catch { /* Illustrations are optional; text/layout generation remains available. */ }
    const models = await modelsFor(db).catch(() => []), preferred = posterImageSize(run.input.width, run.input.height);
    imageModels = models.flatMap(model => {
      const size = [preferred, "1024x1024", "1536x1024", "1024x1536"].find(candidate => Number.isSafeInteger(model.prices[candidate]));
      return size ? [{ id: model.id, label: model.label, image: { provider: model.provider, size, expectedCost: model.prices[size] } }] : [];
    });
  }
  return { kind: run.kind, outline, image, imageModels, imageProvider: run.input.imageProvider || image?.provider || null, expectedSequence: run.eventSequence, unitCost, committedCredits: run.committedCredits, maxCredits: run.maxCredits,
    confirmed: Boolean(step.result?.confirmation), canConfirm: run.status === "awaiting_input" && run.errorCode === OUTLINE_CONFIRMATION_REQUIRED && !run.cancelRequestedAt };
}

export async function confirmOutline(userId, id, input, { db = prisma, store = objectStorage(), env, configFor = creationLanguageConfig, ensureWorkers = ensureContentWorkers, quoteImage = posterImageQuote } = {}) {
  env ??= await getCreationEnv(userId, { db });
  const data = confirmOutlineSchema.parse(input), digest = digestJson(data);
  const current = await ownedRun(userId, id, db), old = replay(current, data.saveKey, digest);
  if (old) return old;
  const spec = outlineForKind(current.kind);
  const approved = spec.schema.safeParse(data.outline);
  if (!approved.success) throw new AppError("CREATION_OUTLINE_CHANGED", 409);
  function check(run) {
    reviewStep(run);
    if (run.eventSequence !== data.expectedSequence || run.status !== "awaiting_input" || run.errorCode !== OUTLINE_CONFIRMATION_REQUIRED || run.cancelRequestedAt || run.steps.length !== 1) throw new AppError("CREATION_RUN_CHANGED", 409);
  }
  check(current); requireContentCreation(current.kind, env); await ensureWorkers(db, { kind: current.kind, posterImage: Boolean(data.image) });
  const config = await configFor(db, current.input.languageProvider), cost = config.plannerCreditCost ?? 1;
  if (!config.visionApiKey || !config.chatModel) throw new AppError("VISION_NOT_CONFIGURED", 503);
  if ((config.plannerProvider || null) !== (current.input.languageProvider || null)) throw new AppError("PROVIDER_CONFIGURATION_CHANGED", 409);
  if (!Number.isSafeInteger(cost) || cost < 0 || cost !== data.expectedUnitCost) throw new AppError("PRICE_CHANGED", 409);
  const count = data.outline[spec.items].length, visuals = current.kind === "slides" ? plannedSlideVisuals(data.outline) : [];
  if (data.image) {
    if (current.kind !== "slides" || !visuals.length || (current.steps[0].params.assetIds || []).length >= 8) throw new AppError("CREATION_REFERENCE_INVALID", 422);
    const quote = await quoteImage(db, data.image.provider);
    if ((quote.provider || null) !== (data.image.provider || null)) throw new AppError("PROVIDER_CONFIGURATION_CHANGED", 409);
    if (quote.prices[data.image.size] !== data.image.expectedCost) throw new AppError("PRICE_CHANGED", 409);
  }
  if (current.committedCredits + count * cost + (data.image ? visuals.length * data.image.expectedCost : 0) > data.maxCredits) throw new AppError("CREATION_BUDGET_EXCEEDED", 409);
  const planned = outlineChildren(current, data.outline, cost, data.image);
  if (Buffer.byteLength(JSON.stringify(planned)) > 2 * 1024 * 1024) throw new AppError("CREATION_PLAN_TOO_LARGE", 413);
  const bytes = Buffer.from(JSON.stringify(data.outline));
  if (bytes.length > LANGUAGE_MAX_RESULT_BYTES) throw new AppError("ARTIFACT_TOO_LARGE", 413);
  // Private immutable approved content is uploaded before acquiring user/run
  // locks. Lost responses replay the accepted key; abandoned staging expires.
  const blob = await db.creationBlob.create({ data: { userId, objectKey: `${userId}/creation-outline/${id}/${randomUUID()}.json`,
    checksum: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, expiresAt: new Date(Date.now() + 86400000) } });
  await store.put(blob.objectKey, bytes, "application/json");
  return db.$transaction(async tx => {
    const run = await lockRun(tx, userId, id), duplicate = replay(run, data.saveKey, digest);
    if (duplicate) return duplicate;
    check(run);
    if (!await tx.creationProject.findFirst({ where: { id: run.projectId, userId, deletedAt: null }, select: { id: true } })) throw new AppError("CREATION_PROJECT_NOT_FOUND", 404);
    const parent = await verifiedAgentParent(tx, run);
    if (parent && parent.committedCredits - (parent.steps.find(step => step.id === run.input.agentParent.stepId)?.result?.accountedCredits || 0) + data.maxCredits > parent.maxCredits) throw new AppError("CREATION_BUDGET_EXCEEDED", 409);
    if (await tx.creationRun.count({ where: { userId, sessionId: run.sessionId, id: { notIn: [id, ...(parent ? [parent.id] : [])] }, status: { in: [...RUN_ACTIVE, ...RUN_WAITING] } } })) throw new AppError("CREATION_SCOPE_BUSY", 409);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('creation-admission', 0))::text`;
    if (await tx.creationRun.count({ where: { status: { in: RUN_ACTIVE } } }) >= 1000) throw new AppError("CREATION_QUEUE_FULL", 503);
    const first = run.steps[0], source = languageInputSchema.parse(first.params);
    const children = planned, document = run.kind === "document";
    await tx.creationStep.createMany({ data: [...children, { runId: id, position: children.length + 1, dependsOn: children.map(child => child.id), tool: spec.assemble, expectedCost: 0, status: "blocked", params: {},
      explanation: source.locale === "zh" ? (document ? "整理章节并保存文档" : "整理页面并保存演示文稿") : (document ? "Assemble and save the document" : "Assemble and save the presentation") }] });
    const ready = await tx.creationBlob.updateMany({ where: { id: blob.id, state: "staging" }, data: { state: "ready" } });
    if (ready.count !== 1) throw new AppError("ARTIFACT_UPLOAD_EXPIRED", 409);
    await tx.creationStep.update({ where: { id: first.id }, data: { result: { [spec.count]: count, confirmation: { key: data.saveKey, digest, blobId: blob.id } } } });
    const unit = document ? (source.locale === "zh" ? "节文档" : "sections") : (source.locale === "zh" ? "页演示文稿" : "slides");
    await appendCreationMessage(tx, run.sessionId, `outline-confirmed-${first.id}`, "user", source.locale === "zh" ? `确认大纲，开始生成 ${count} ${unit}。` : `Outline confirmed. Generate ${count} ${unit}.`, [{ type: "run", runId: id }]);
    await appendRunEvent(tx, id, "outline.confirmed", { [spec.count]: count, maxCredits: data.maxCredits }, {
      status: "queued", errorCode: null, maxCredits: data.maxCredits, nextCheckAt: new Date(),
      input: { ...run.input, [spec.count]: count, languageUnitCost: cost },
    });
    await enqueueRun(tx, id, `outline:${data.expectedSequence}`);
    await wakeAgentParent(tx, run);
    return presentRun(await tx.creationRun.findUnique({ where: { id }, include: { steps: { orderBy: { position: "asc" } } } }));
  }, { timeout: 15000 });
}
