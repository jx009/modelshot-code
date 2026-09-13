import { randomUUID } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { createImage, assetUrl, readOwnedImage, readPreset } from "../assets/service.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { downloadProviderImage } from "../../infra/storage/download.js";
import { settleReservation } from "../billing/ledger.js";
import { providerAdapter } from "./providers.js";
import { ACTIVE, TERMINAL, LIMITS, batchState } from "./contracts.js";

function safeProviderError(error, fallback) {
  if (error instanceof AppError) return error.code;
  const status = error?.status || error?.statusCode || error?.response?.status;
  const providerCode = error?.code || error?.error?.code;
  const message = error?.error?.message || error?.message;
  const detail = [status && `HTTP ${status}`, providerCode && providerCode !== "Error" && providerCode, message]
    .filter(Boolean)
    .join(": ")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
  return detail ? `${fallback}: ${detail}` : fallback;
}

async function lockOutput(tx, id) {
  const row = await tx.tryOn.findUnique({ where: { id }, select: { userId: true } });
  if (!row) return null;
  // All balance mutations take locks in user -> output order, including workers.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${row.userId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "TryOn" WHERE id = ${id} FOR UPDATE`;
  return tx.tryOn.findUnique({ where: { id } });
}

async function aggregateBatch(tx, batchJobId) {
  if (!batchJobId) return;
  const outputs = await tx.tryOn.findMany({ where: { batchJobId }, select: { status: true } });
  const { counts: _counts, ...data } = batchState(outputs);
  await tx.batchJob.update({ where: { id: batchJobId }, data });
}

export async function claimOutput(id, db = prisma, now = new Date()) {
  return db.$transaction(async tx => {
    const output = await lockOutput(tx, id);
    if (!output || TERMINAL.includes(output.status) || output.leaseUntil && output.leaseUntil > now || output.nextAttemptAt && output.nextAttemptAt > now) return null;
    const previous = await tx.generationAttempt.findFirst({ where: { tryOnId: id }, orderBy: { fence: "desc" } });
    const reconcile = output.status !== "queued";
    const fence = output.fence + 1;
    const attempt = await tx.generationAttempt.create({ data: { tryOnId: id, fence, provider: output.provider, requestId: reconcile ? previous?.requestId : null, state: reconcile ? "reconciling" : "claimed" } });
    const updated = await tx.tryOn.update({ where: { id }, data: {
      fence, status: reconcile ? "reconciling" : "running", leaseUntil: new Date(+now + LIMITS.leaseMs), heartbeatAt: now, nextAttemptAt: null,
      ...(reconcile && !output.reconcileUntil ? { reconcileUntil: new Date(+now + LIMITS.reconcileMs) } : {}),
    } });
    await aggregateBatch(tx, output.batchJobId);
    return { output: updated, attempt, reconcile };
  });
}

export async function finishOutput(id, fence, { asset, errorCode, cancelled = false, costUsd, durationMs }, db = prisma) {
  return db.$transaction(async tx => {
    const output = await lockOutput(tx, id);
    if (!output || output.fence !== fence || TERMINAL.includes(output.status)) {
      if (asset && output && TERMINAL.includes(output.status) && output.originalAssetId !== asset.id) await tx.asset.updateMany({ where: { id: asset.id }, data: { status: "quarantined" } });
      return false;
    }
    const status = asset ? "succeeded" : cancelled ? "cancelled" : "failed";
    if (asset) {
      const stored = await tx.asset.findFirst({ where: { id: asset.id, userId: output.userId, status: "active" } });
      if (!stored) throw new Error("Deliverable asset unavailable");
      await tx.assetReference.upsert({ where: { assetId_entityId_kind: { assetId: asset.id, entityId: id, kind: "generation_output" } }, create: { assetId: asset.id, entityId: id, kind: "generation_output" }, update: {} });
    }
    await settleReservation(tx, output, asset ? "capture" : "release");
    await tx.tryOn.update({ where: { id }, data: {
      status, leaseUntil: null, errorCode: errorCode || null,
      ...(Number.isFinite(costUsd) && costUsd >= 0 ? { costUsd } : {}),
      ...(Number.isSafeInteger(durationMs) ? { durationMs } : {}),
      ...(asset ? { originalAssetId: asset.id, resultImage: assetUrl(asset.id), qaStatus: "pending", exportStatus: "pending" } : { qaStatus: "skipped", exportStatus: "skipped" }),
    } });
    await tx.generationAttempt.updateMany({ where: { tryOnId: id, fence }, data: { state: status, errorCode, endedAt: new Date() } });
    if (asset) {
      for (const kind of ["delivery", "qa"]) await tx.outboxEvent.upsert({ where: { businessKey: `${kind}:${id}:initial` }, create: { businessKey: `${kind}:${id}:initial`, kind, entityId: id }, update: {} });
    }
    await aggregateBatch(tx, output.batchJobId);
    return true;
  });
}

async function deferOutput(claim, errorCode, retry, db) {
  return db.$transaction(async tx => {
    const output = await lockOutput(tx, claim.output.id);
    if (!output || output.fence !== claim.output.fence || TERMINAL.includes(output.status)) return;
    const until = output.reconcileUntil || new Date(Date.now() + LIMITS.reconcileMs);
    const availableAt = new Date(Date.now() + (retry ? 5000 * output.fence : 15_000));
    await tx.tryOn.update({ where: { id: output.id }, data: {
      status: retry ? "queued" : "reconciling", errorCode, leaseUntil: null,
      reconcileUntil: retry ? null : until,
      nextAttemptAt: availableAt,
    } });
    await tx.generationAttempt.update({ where: { id: claim.attempt.id }, data: { state: retry ? "retryable" : "reconciling", errorCode } });
    await tx.outboxEvent.upsert({ where: { businessKey: `generate:${output.id}:${output.fence}` },
      create: { businessKey: `generate:${output.id}:${output.fence}`, kind: "generate", entityId: output.id, availableAt }, update: {} });
  });
}

export async function cancelOutput(userId, id, db = prisma) {
  const result = await db.$transaction(async tx => {
    const output = await lockOutput(tx, id);
    if (!output || output.userId !== userId) throw new AppError("JOB_NOT_FOUND", 404);
    if (TERMINAL.includes(output.status)) return { status: output.status, cancelled: output.status === "cancelled" };
    if (output.status === "queued") {
      await settleReservation(tx, output, "release");
      await tx.tryOn.update({ where: { id }, data: { status: "cancelled", cancelRequestedAt: new Date(), leaseUntil: null, fence: { increment: 1 }, qaStatus: "skipped", exportStatus: "skipped" } });
      await aggregateBatch(tx, output.batchJobId);
      return { status: "cancelled", cancelled: true };
    }
    await tx.tryOn.update({ where: { id }, data: { cancelRequestedAt: new Date() } });
    return { status: "cancel_requested", cancelled: false };
  });
  return result;
}

export async function executeOutput(id, { db = prisma, store = objectStorage(), adapterFactory = providerAdapter, timeoutMs = 150_000 } = {}) {
  const claim = await claimOutput(id, db);
  if (!claim) return;
  const { output, attempt, reconcile } = claim;
  const originalId = `${output.id}_original`;
  const objectKey = `${output.userId}/original/${originalId}.png`;
  const started = Date.now();
  const controller = new AbortController();
  let deadline;
  const bounded = promise => Promise.race([promise, new Promise((_, reject) => {
    deadline = setTimeout(() => { controller.abort(); reject(new AppError("PROVIDER_TIMEOUT", 504, true)); }, timeoutMs);
  })]).finally(() => clearTimeout(deadline));
  const heartbeat = setInterval(() => {
    db.tryOn.updateMany({ where: { id, fence: output.fence, status: { in: ACTIVE } }, data: { heartbeatAt: new Date(), leaseUntil: new Date(Date.now() + LIMITS.leaseMs) } }).catch(() => {});
  }, 20_000);
  heartbeat.unref();
  try {
    let recovered = await db.asset.findUnique({ where: { id: originalId } });
    if (!recovered && reconcile) {
      try {
        const bytes = await store.get(objectKey);
        recovered = await createImage(output.userId, bytes, { id: originalId, kind: "original" }, db, store);
      } catch (error) {
        if (!['NoSuchKey', 'NotFound'].includes(error.name) && error.$metadata?.httpStatusCode !== 404) throw error;
      }
    }
    if (recovered?.status === "active") { await finishOutput(id, output.fence, { asset: recovered }, db); return; }
    if (reconcile && output.reconcileUntil <= new Date()) {
      await finishOutput(id, output.fence, { errorCode: "RECONCILIATION_EXPIRED", cancelled: Boolean(output.cancelRequestedAt) }, db);
      return;
    }
    const adapter = await adapterFactory(output, db);
    let result;
    if (reconcile) {
      if (!adapter.query || !attempt.requestId) { await deferOutput(claim, "PROVIDER_RESULT_UNKNOWN", false, db); return; }
      result = await bounded(adapter.query(attempt.requestId, { signal: controller.signal }));
      if (result.state === "pending") { await deferOutput(claim, "PROVIDER_PENDING", false, db); return; }
      if (result.state === "failed" || result.state === "cancelled") { await finishOutput(id, output.fence, { errorCode: "PROVIDER_FAILED", cancelled: result.state === "cancelled" }, db); return; }
    } else {
      const snapshot = output.snapshot;
      const garmentImage = await readOwnedImage(output.userId, snapshot.garment.id, db, store);
      const references = snapshot.task?.references || ["product", "model", "scene"];
      const modelRef = !references.includes("model") ? null : snapshot.person ? await readOwnedImage(output.userId, snapshot.person.id, db, store) : await readPreset(snapshot.modelPreset.referenceImage);
      const sceneRef = references.includes("scene") && snapshot.scenePreset?.referenceImage ? await readPreset(snapshot.scenePreset.referenceImage) : null;
      const referenceImages = await Promise.all((snapshot.references || [])
        .filter(reference => references.includes(reference.role))
        .map(async reference => ({ role: reference.role, image: await readOwnedImage(output.userId, reference.id, db, store) })));
      const authorized = await db.$transaction(async tx => {
        const current = await lockOutput(tx, id);
        if (!current || current.fence !== output.fence || TERMINAL.includes(current.status)) return false;
        if (current.cancelRequestedAt) return false;
        await tx.generationAttempt.update({ where: { id: attempt.id }, data: { state: "submitted" } });
        return true;
      });
      if (!authorized) { await finishOutput(id, output.fence, { cancelled: true }, db); return; }
      result = await bounded(adapter.generateTryOn({ garmentImage, modelRef, sceneRef, referenceImages, prompt: snapshot.task?.prompt || snapshot.prompt, signal: controller.signal,
        // Keep the gateway-compatible default used by the documented curl
        // request. Providers can still return a higher-resolution image.
        size: snapshot.nativeSize || undefined, quality: process.env.OPENAI_IMAGE_QUALITY || "medium", category: { top: "tops", outerwear: "tops", bottom: "bottoms", dress: "one-pieces" }[snapshot.config.garmentType],
        idempotencyKey: output.requestId,
        onSubmitted: async requestId => {
          if (typeof requestId !== "string" || requestId.length > 256) throw new Error("Invalid supplier request ID");
          await db.generationAttempt.update({ where: { id: attempt.id }, data: { requestId, state: "provider_pending" } });
        },
      }));
      if (result.state === "pending") { await deferOutput(claim, "PROVIDER_PENDING", false, db); return; }
    }
    const bytes = result.imageBase64 ? Buffer.from(result.imageBase64, "base64") : await downloadProviderImage(result.imageUrl);
    const asset = await createImage(output.userId, bytes, { id: originalId, kind: "original" }, db, store);
    await finishOutput(id, output.fence, { asset, costUsd: result.costUsd, durationMs: Date.now() - started }, db);
  } catch (error) {
    const storedAttempt = await db.generationAttempt.findUnique({ where: { id: attempt.id } });
    const status = error.status || error.statusCode;
    const notSubmitted = storedAttempt?.state === "claimed";
    if (notSubmitted || [400, 401, 403, 404, 413, 415, 422].includes(status) || error.code === "INVALID_IMAGE") {
      await finishOutput(id, output.fence, { errorCode: safeProviderError(error, "PROVIDER_REJECTED") }, db);
    } else if (status === 429 && output.fence < 4 && !attempt.requestId) {
      await deferOutput(claim, "PROVIDER_RATE_LIMITED", true, db);
    } else {
      await deferOutput(claim, safeProviderError(error, "PROVIDER_RESULT_UNKNOWN"), false, db);
    }
  } finally { clearInterval(heartbeat); }
}

export async function recoverLeases(db = prisma) {
  const expired = await db.tryOn.findMany({ where: { status: { in: ACTIVE }, OR: [{ leaseUntil: { lt: new Date() } }, { leaseUntil: null }] }, select: { id: true, fence: true }, take: 200 });
  for (const row of expired) {
    // A new durable dispatch record also repairs Redis data loss after earlier delivery.
    const key = `recovery:${row.id}:${row.fence}:${Math.floor(Date.now() / 60_000)}`;
    await db.outboxEvent.createMany({ data: [{ id: randomUUID(), businessKey: key, kind: "generate", entityId: row.id }], skipDuplicates: true });
  }
  return expired.length;
}
