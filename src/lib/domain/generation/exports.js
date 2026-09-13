import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { readOwnedImage } from "../assets/service.js";
import { digestJson } from "./contracts.js";
import { claimStep, completeStep } from "./steps.js";

export const EXPORT_LIMITS = { outputs: 100, bytes: 128 * 1024 * 1024 };

export async function createExport(userId, outputIds, mode, idempotencyKey, db = prisma) {
  if (!Array.isArray(outputIds) || !outputIds.length || outputIds.length > EXPORT_LIMITS.outputs || !["original", "delivery"].includes(mode) || !/^[a-zA-Z0-9_-]{16,128}$/.test(idempotencyKey || "")) throw new AppError("INVALID_EXPORT");
  const ids = [...new Set(outputIds)].sort();
  const digest = digestJson({ ids, mode });
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const old = await tx.exportJob.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (old) {
      if (old.digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return old;
    }
    if (await tx.exportJob.count({ where: { userId, status: { in: ["queued", "running"] } } }) >= 3) throw new AppError("EXPORT_QUEUE_FULL", 429);
    const outputs = await tx.tryOn.findMany({ where: { id: { in: ids }, userId, status: "succeeded" } });
    if (outputs.length !== ids.length) throw new AppError("OUTPUT_NOT_FOUND", 404);
    const selection = outputs.map(output => ({ id: output.id, assetId: mode === "original" ? output.originalAssetId : output.deliveryAssetId,
      sku: output.snapshot.config.sku, productName: output.snapshot.config.productName, workflow: output.snapshot.workflow?.id || "single-shot", role: output.snapshot.task?.role || "hero", task: output.snapshot.task?.title || "Hero image",
      group: output.snapshot.task?.group || "main", sequence: output.snapshot.task?.sequence || 1, aspectRatio: output.aspectRatio,
      model: output.snapshot.modelPreset?.nameEn || (output.snapshot.person ? "custom" : "none"), scene: output.snapshot.scenePreset?.nameEn || "generated", variant: output.snapshot.variant, profile: mode === "delivery" ? output.snapshot.delivery : null }));
    if (selection.some(row => !row.assetId)) throw new AppError("DELIVERY_NOT_READY", 409, true);
    const assets = await tx.asset.findMany({ where: { id: { in: selection.map(row => row.assetId) }, userId, status: "active" } });
    if (assets.length !== new Set(selection.map(row => row.assetId)).size) throw new AppError("ASSET_NOT_FOUND", 404);
    if (assets.reduce((sum, asset) => sum + asset.bytes, 0) > EXPORT_LIMITS.bytes) throw new AppError("EXPORT_TOO_LARGE", 413);
    const job = await tx.exportJob.create({ data: { userId, idempotencyKey, digest, selection } });
    for (const asset of assets) await tx.assetReference.create({ data: { assetId: asset.id, entityId: job.id, kind: "export" } });
    await tx.outboxEvent.create({ data: { kind: "export", entityId: job.id, businessKey: `export:${job.id}` } });
    return job;
  });
}

function segment(value) { return String(value || "item").normalize("NFKC").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40); }
function csv(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function processExport(id, { db = prisma, store = objectStorage() } = {}) {
  const job = await db.exportJob.findUnique({ where: { id } });
  if (!job || ["succeeded", "partial_success", "cancelled", "expired"].includes(job.status)) return;
  const step = await claimStep(id, "export", db);
  if (!step) return;
  const heartbeat = setInterval(() => { db.processingStep.updateMany({ where: { id: step.id, fence: step.fence, state: "running" }, data: { leaseUntil: new Date(Date.now() + 120_000) } }).catch(() => {}); }, 20_000);
  heartbeat.unref();
  try {
    await db.exportJob.update({ where: { id }, data: { status: "running", completedCount: 0 } });
    const zip = new JSZip();
    const manifest = [];
    const failures = [];
    let bytes = 0;
    for (const row of job.selection) {
      const current = await db.exportJob.findUnique({ where: { id }, select: { cancelRequestedAt: true } });
      if (current.cancelRequestedAt) {
        await completeStep(step, { state: "cancelled" }, tx => tx.exportJob.update({ where: { id }, data: { status: "cancelled" } }), db);
        return;
      }
      try {
        const image = await readOwnedImage(job.userId, row.assetId, db, store);
        bytes += image.length;
        if (bytes > EXPORT_LIMITS.bytes) throw new AppError("EXPORT_TOO_LARGE", 413);
        const filename = `${segment(row.group)}/${String(row.sequence).padStart(2, "0")}_${segment(row.sku || row.productName || "product")}_${segment(row.role)}_v${row.variant + 1}_${row.id.slice(-12)}.png`;
        zip.file(filename, image);
        manifest.push({ ...row, filename });
      } catch (error) {
        if (error.code === "EXPORT_TOO_LARGE") throw error;
        failures.push({ id: row.id, code: "ASSET_UNAVAILABLE" });
      }
      await db.$transaction(async tx => {
        const active = await tx.processingStep.findFirst({ where: { id: step.id, fence: step.fence, state: "running" } });
        if (active) await tx.exportJob.update({ where: { id }, data: { completedCount: manifest.length } });
      });
    }
    if (!manifest.length) throw new AppError("EXPORT_NO_FILES", 409);
    zip.file("manifest.json", JSON.stringify({ version: 1, exportId: id, images: manifest, failures }, null, 2));
    zip.file("manifest.csv", ["outputId,filename,sku,productName,workflow,group,sequence,role,task,aspectRatio,model,scene,variant", ...manifest.map(row => [row.id, row.filename, row.sku, row.productName, row.workflow, row.group, row.sequence, row.role, row.task, row.aspectRatio, row.model, row.scene, row.variant + 1].map(csv).join(","))].join("\r\n"));
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    const objectKey = `${job.userId}/exports/${id}_${step.fence}.zip`;
    await store.put(objectKey, buffer, "application/zip");
    await completeStep(step, { state: "done" }, async tx => {
      const current = await tx.exportJob.findUnique({ where: { id } });
      await tx.exportJob.update({ where: { id }, data: current.cancelRequestedAt ? { status: "cancelled" } : {
        status: failures.length ? "partial_success" : "succeeded", objectKey, bytes: buffer.length, failures, completedCount: manifest.length, expiresAt: new Date(Date.now() + 86400_000),
      } });
    }, db);
  } catch (error) {
    await completeStep(step, { state: "error", errorCode: "EXPORT_ERROR" }, tx => tx.exportJob.update({ where: { id }, data: { status: "failed" } }), db);
    throw error;
  } finally { clearInterval(heartbeat); }
}

export async function retryStep(userId, id, kind, db = prisma) {
  if (!["qa", "delivery"].includes(kind)) throw new AppError("INVALID_STEP");
  return db.$transaction(async tx => {
    const output = await tx.tryOn.findFirst({ where: { id, userId, status: "succeeded" } });
    if (!output) throw new AppError("OUTPUT_NOT_FOUND", 404);
    const step = await tx.processingStep.findUnique({ where: { entityId_kind: { entityId: id, kind } } });
    if (step?.state === "running" && step.leaseUntil > new Date()) throw new AppError("STEP_RUNNING", 409);
    if (step?.state === "done") return { ok: true };
    await tx.processingStep.upsert({ where: { entityId_kind: { entityId: id, kind } }, create: { entityId: id, kind }, update: { state: "pending", leaseUntil: null } });
    await tx.outboxEvent.create({ data: { kind, entityId: id, businessKey: `${kind}:${id}:${randomUUID()}` } });
    await tx.tryOn.update({ where: { id }, data: kind === "qa" ? { qaStatus: "pending" } : { exportStatus: "pending" } });
    return { ok: true };
  });
}
