import { prepareDependencyContext } from "./dependency-context.js";
import { languageFailure, languageFailureDiagnostic } from "../../creation/language-failure.js";
import { createHash } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { claimOutput, finishOutput, deferOutput } from "../generation/execution.js";
import { ACTIVE, TERMINAL, LIMITS } from "../generation/contracts.js";
import { readLayoutArtifact } from "./artifacts.js";
import { creationLanguageConfig } from "./language-jobs.js";
import { invokeCreationLanguage } from "./language-provider.js";
import { prepareCreationReferenceImages } from "./reference-images.js";
import { prepareCreationReferenceFiles } from "./reference-reader.js";
import { languageInputSchema, validateLanguageResult, LANGUAGE_MAX_RESULT_BYTES } from "../../creation/contracts/language.js";

const blobIdFor = id => `language-${id}`;
function checkBlob(blob, output) {
  if (!blob || blob.userId !== output.userId || blob.id !== blobIdFor(output.id) || blob.objectKey !== `${output.userId}/creation-language/${output.id}.json` || blob.bytes > LANGUAGE_MAX_RESULT_BYTES || !["ready", "staging"].includes(blob.state)) throw new AppError("LANGUAGE_RESULT_INVALID", 502);
}
async function decodeBlob(blob, output, store) {
  checkBlob(blob, output);
  const bytes = await store.get(blob.objectKey);
  if (bytes.length !== blob.bytes || createHash("sha256").update(bytes).digest("hex") !== blob.checksum) throw new AppError("LANGUAGE_RESULT_INTEGRITY_FAILED", 502);
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new AppError("LANGUAGE_RESULT_INVALID", 502); }
}
export async function readCreationLanguageResult(userId, id, { db = prisma, store = objectStorage() } = {}) {
  const output = await db.tryOn.findFirst({ where: { id, userId, executionQueue: "creation-language", status: "succeeded" }, include: { creationResultBlob: true } });
  if (!output || output.creationResultBlob?.state !== "ready") throw new AppError("LANGUAGE_RESULT_NOT_FOUND", 404);
  return decodeBlob(output.creationResultBlob, output, store);
}
async function attachResult(output, blob, db) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${output.userId} FOR UPDATE`;
    const updated = await tx.tryOn.updateMany({ where: { id: output.id, fence: output.fence, status: { in: ACTIVE } }, data: {
      creationResultBlobId: blob.id, resultData: { creationLanguage: { schemaVersion: 1, purpose: output.snapshot.purpose, blobId: blob.id } },
    } });
    if (!updated.count) return false;
    const ready = await tx.creationBlob.updateMany({ where: { id: blob.id, state: { in: ["staging", "ready"] } }, data: { state: "ready" } });
    if (!ready.count) throw new AppError("ARTIFACT_UPLOAD_EXPIRED", 409);
    return true;
  });
}

// A provider call is never repeated merely because its lease expired. A
// recoverable object checkpoint can finish settlement without another call.
export async function executeCreationLanguage(id, { db = prisma, store = objectStorage(), invoke = invokeCreationLanguage, configFor = creationLanguageConfig, prepareReferences = prepareCreationReferenceImages, timeoutMs = 180000 } = {}) {
  const row = await db.tryOn.findUnique({ where: { id }, select: { executionQueue: true } });
  if (row?.executionQueue !== "creation-language") throw new AppError("INVALID_LANGUAGE_JOB", 422);
  const claim = await claimOutput(id, db);
  if (!claim) return;
  const { output, attempt } = claim, started = Date.now(), controller = new AbortController();
  let heartbeating = false, deadline;
  const heartbeat = setInterval(async () => {
    if (heartbeating) return;
    heartbeating = true;
    try {
      const owned = await db.tryOn.updateMany({ where: { id, fence: output.fence, status: { in: ACTIVE } }, data: { heartbeatAt: new Date(), leaseUntil: new Date(Date.now() + LIMITS.leaseMs) } });
      if (!owned.count) controller.abort(new AppError("LANGUAGE_LEASE_LOST", 409));
    } catch { controller.abort(new AppError("LANGUAGE_LEASE_UNCERTAIN", 503)); }
    finally { heartbeating = false; }
  }, 20000);
  heartbeat.unref();
  let blob;
  try {
    if (output.snapshot?.executionVersion !== 1) throw new AppError("LANGUAGE_JOB_VERSION_UNSUPPORTED", 422);
    const input = languageInputSchema.parse(output.snapshot.input);
    blob = await db.creationBlob.findUnique({ where: { id: blobIdFor(id) } });
    if (output.creationResultBlobId && output.resultData?.creationLanguage && blob?.state === "ready") {
      checkBlob(blob, output);
      // The pointer was committed only after validation and upload. Settlement
      // recovery must not require a second model or object-store read.
      await finishOutput(id, output.fence, { resultData: output.resultData }, db);
      return;
    }
    const source = input.artifactId ? (await readLayoutArtifact(output.userId, input.artifactId, input.baseRevision, { db, store })).content : null;
    if (blob) {
      const result = await decodeBlob(blob, output, store);
      validateLanguageResult(input, result, source);
      if (await attachResult(output, blob, db)) await finishOutput(id, output.fence, { resultData: { creationLanguage: { schemaVersion: 1, purpose: input.purpose, blobId: blob.id } } }, db);
      return;
    }
    const submitted = await db.processingStep.findUnique({ where: { entityId_kind: { entityId: id, kind: "creation-language-submit" } }, select: { id: true } });
    if (submitted) { await finishOutput(id, output.fence, { errorCode: "LANGUAGE_RESULT_UNAVAILABLE", cancelled: Boolean(output.cancelRequestedAt) }, db); return; }
    if (output.cancelRequestedAt) { await finishOutput(id, output.fence, { cancelled: true }, db); return; }
    const selected = await configFor(db, output.snapshot.provider);
    if ((selected.plannerProvider || null) !== output.snapshot.provider || (selected.plannerKind || "openai") !== output.snapshot.providerKind || (selected.visionBaseURL || null) !== output.snapshot.providerBaseURL || selected.chatModel !== output.snapshot.model) throw new AppError("PROVIDER_CONFIGURATION_CHANGED", 422);
    // Read/decode before marking the paid invocation as submitted. A bad or
    // unavailable reference must not consume a provider call or user credits.
    const { assets, images } = await prepareReferences(output.userId, input.assetIds, { db, store, signal: controller.signal });
    let referenceFiles = [];
    if (input.referenceIds.length) {
      const runSession = await db.creationRun.findFirst({ where: { id: output.snapshot.creationRunId, userId: output.userId }, select: { sessionId: true } });
      if (!runSession?.sessionId) throw new AppError("CREATION_REFERENCE_NOT_FOUND", 404);
      referenceFiles = await prepareCreationReferenceFiles(output.userId, runSession.sessionId, input.referenceIds, { db, store, signal: controller.signal });
    }
    const dependencyFiles = await prepareDependencyContext(output.userId, output.snapshot.creationRunId, input.dependencyRefs, { db, store });
    controller.signal.throwIfAborted();
    const authorized = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${output.userId} FOR UPDATE`;
      const current = await tx.tryOn.findUnique({ where: { id } });
      if (current.fence !== output.fence || TERMINAL.includes(current.status)) return "lost";
      if (current.cancelRequestedAt) return "cancelled";
      // This marker survives attempt state changes during reconciliation.
      // There is deliberately no retry that clears it or calls the model again.
      await tx.processingStep.create({ data: { entityId: id, kind: "creation-language-submit", state: "submitted", fence: output.fence } });
      await tx.generationAttempt.update({ where: { id: attempt.id }, data: { state: "submitted" } });
      return "authorized";
    });
    if (authorized === "lost") return;
    if (authorized === "cancelled") { await finishOutput(id, output.fence, { cancelled: true }, db); return; }
    // Even injected/compatible providers that ignore AbortSignal cannot keep
    // this worker lease alive forever. The promise has a rejection handler.
    const response = await Promise.race([invoke(selected, { input, source, assets, images, referenceFiles, dependencyFiles, signal: controller.signal }), new Promise((_, reject) => {
      deadline = setTimeout(() => { const error = new AppError("LANGUAGE_TIMEOUT", 504); controller.abort(error); reject(error); }, Math.min(180000, Math.max(1000, timeoutMs)));
    })]);
    clearTimeout(deadline);
    if (controller.signal.aborted) throw controller.signal.reason;
    const result = validateLanguageResult(input, response, source), bytes = Buffer.from(JSON.stringify(result));
    if (bytes.length > LANGUAGE_MAX_RESULT_BYTES) throw new AppError("LANGUAGE_RESULT_TOO_LARGE", 502);
    // Deterministic checkpoint identity enables recovery after upload but
    // before publishing the result pointer. It is never a public URL.
    blob = await db.creationBlob.create({ data: { id: blobIdFor(id), userId: output.userId, objectKey: `${output.userId}/creation-language/${id}.json`,
      checksum: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, expiresAt: new Date(Date.now() + 86400000) } });
    await store.put(blob.objectKey, bytes, "application/json");
    if (await attachResult(output, blob, db)) await finishOutput(id, output.fence, { resultData: { creationLanguage: { schemaVersion: 1, purpose: input.purpose, blobId: blob.id } }, durationMs: Date.now() - started }, db);
  } catch (error) {
    const invalidResult = ["ZodError", "HtmlDocumentError", "LanguageResultError"].includes(error.name);
    console.error(JSON.stringify({ code: "CREATION_LANGUAGE_FAILED", jobId: id, purpose: output.snapshot?.purpose, ...languageFailureDiagnostic(error) }));
    // Preserve uncertainty on storage/settlement failure; the same result can
    // be recovered. No retry path resubmits a previously submitted request.
    if (blob && !invalidResult && !["NoSuchKey", "NotFound"].includes(error.name) && error.$metadata?.httpStatusCode !== 404 && !["LANGUAGE_RESULT_INVALID", "LANGUAGE_RESULT_INTEGRITY_FAILED"].includes(error.code)) {
      const persisted = await db.tryOn.findUnique({ where: { id }, select: { creationResultBlobId: true } });
      if (!persisted?.creationResultBlobId && output.reconcileUntil && output.reconcileUntil <= new Date()) await finishOutput(id, output.fence, { errorCode: "LANGUAGE_RESULT_RECOVERY_EXPIRED" }, db);
      else await deferOutput(claim, "LANGUAGE_RESULT_RECOVERY_PENDING", false, db);
    } else {
      const code = languageFailure(error);
      await finishOutput(id, output.fence, { errorCode: code }, db);
    }
  } finally { clearInterval(heartbeat); clearTimeout(deadline); }
}
