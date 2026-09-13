import { createHash } from "node:crypto";
import sharp from "sharp";
import { prisma } from "../../prisma.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { readOwnedImage, assetUrl } from "../assets/service.js";
import { injectMetadataBuffer } from "../../compliance.js";
import { runQA } from "../../qa-pipeline.js";
import { claimStep, completeStep } from "./steps.js";

export async function renderDelivery(original, profile) {
  if (!Number.isInteger(profile.width) || !Number.isInteger(profile.height) || profile.width < 64 || profile.height < 64 || profile.width > 4096 || profile.height > 4096 || profile.fit !== "contain") throw new Error("Unsupported delivery profile");
  return sharp(original).rotate().resize(profile.width, profile.height, { fit: "contain", background: "#ffffff", withoutEnlargement: false }).png().toBuffer();
}

export async function processDelivery(id, { db = prisma, store = objectStorage(), annotate = injectMetadataBuffer } = {}) {
  const output = await db.tryOn.findUnique({ where: { id } });
  if (output?.status !== "succeeded") return;
  const step = await claimStep(id, "delivery", db);
  if (!step) return;
  try {
    const original = await readOwnedImage(output.userId, output.originalAssetId, db, store);
    const profile = output.snapshot.delivery;
    const rendered = await renderDelivery(original, profile);
    const annotated = await annotate(rendered, { provider: output.provider });
    const assetId = `${id}_delivery_${step.fence}`;
    const objectKey = `${output.userId}/delivery/${assetId}.png`;
    // Persist final bytes directly: re-encoding after signing would invalidate C2PA.
    await store.put(objectKey, annotated.buffer, "image/png");
    await completeStep(step, { state: "done", report: { profile, metadata: annotated.status } }, async tx => {
      await tx.asset.create({ data: { id: assetId, userId: output.userId, objectKey, kind: "delivery", contentType: "image/png", width: profile.width, height: profile.height,
        bytes: annotated.buffer.length, checksum: createHash("sha256").update(annotated.buffer).digest("hex") } });
      await tx.assetReference.create({ data: { assetId, entityId: id, kind: "delivery" } });
      await tx.tryOn.update({ where: { id }, data: { deliveryAssetId: assetId, resultImage: assetUrl(assetId), exportStatus: "ready", metadataStatus: annotated.status } });
    }, db);
  } catch (error) {
    await completeStep(step, { state: "error", errorCode: "DELIVERY_ERROR" }, tx => tx.tryOn.update({ where: { id }, data: { exportStatus: "error", metadataStatus: "error" } }), db);
    throw error;
  }
}

export async function processQuality(id, { db = prisma, store = objectStorage(), review = runQA } = {}) {
  const output = await db.tryOn.findUnique({ where: { id } });
  if (output?.status !== "succeeded") return;
  const step = await claimStep(id, "qa", db);
  if (!step) return;
  try {
    const [original, product] = await Promise.all([readOwnedImage(output.userId, output.originalAssetId, db, store), readOwnedImage(output.userId, output.snapshot.garment.id, db, store)]);
    const report = await review(original, product, { skip: output.snapshot.qaPolicy === "skip" });
    await completeStep(step, { state: report.status === "error" ? "error" : "done", report, errorCode: report.errorCode || null }, tx => tx.tryOn.update({ where: { id }, data: { qaStatus: report.status, qaScore: report.score, qaFlags: JSON.stringify(report.flags) } }), db);
    if (report.status === "error") throw new Error("QA_ERROR");
  } catch (error) {
    await completeStep(step, { state: "error", errorCode: "QA_ERROR" }, tx => tx.tryOn.update({ where: { id }, data: { qaStatus: "error", qaScore: null, qaFlags: "[]" } }), db);
    throw error;
  }
}
