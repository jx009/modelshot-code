import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { ownedAsset } from "../assets/service.js";
import { lockUser, reserveCreditLots } from "../billing/ledger.js";
import { jobSchema, getTool } from "../../studio/tools.js";
import { capabilities, studioConfig } from "./providers.js";
import { ACTIVE, LIMITS, digestJson } from "../generation/contracts.js";

export async function submitStudioJob(userId, input, key, db = prisma, deps = {}) {
  const data = jobSchema.parse(input);
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key || "")) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  const config = deps.config || await studioConfig(db, data.provider, data.tool === "split" ? "split" : "image");
  const caps = deps.capabilities || await capabilities(db, config);
  const requestId = createHash("sha256").update(`studio:${userId}:${key}`).digest("hex");
  // A replay may follow an unrelated document save; the immutable source and
  // actual operation still must match. Document version is an admission check.
  const digest = digestJson({ ...data, documentVersion: undefined });
  return db.$transaction(async tx => {
    const user = await lockUser(tx, userId);
    const old = await tx.tryOn.findUnique({ where: { requestId } });
    if (old) {
      if (old.snapshot?.digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return presentJob(old);
    }
    const tool = caps.tools.find(t => t.id === data.tool);
    // Preview availability only gates choosing an object. Once a valid owned
    // mask exists, an outage of the preview service must not block image editing.
    if (!tool?.available && !(tool?.reason === "SEGMENTATION_NOT_CONFIGURED" && data.maskId)) throw new AppError(tool?.reason || "TOOL_UNAVAILABLE", 503);
    const document = await tx.studioDocument.findFirst({ where: { id: data.documentId, userId } });
    if (!document) throw new AppError("DOCUMENT_NOT_FOUND", 404);
    if (document.version !== data.documentVersion) throw new AppError("DOCUMENT_VERSION_CONFLICT", 409);
    if (data.sectionId) {
      const commerce = document.content.commerce;
      const section = commerce?.sections.find(s => s.id === data.sectionId);
      if (!section || data.tool !== "edit" || section.attempt !== data.sectionAttempt || commerce.productAssetId !== data.assetId || section.prompt !== data.params.prompt || JSON.stringify(data.referenceAssetIds || []) !== JSON.stringify(commerce.referenceAssetId ? [commerce.referenceAssetId] : [])) throw new AppError("STORYBOARD_CHANGED", 409);
    }
    for (const ref of data.referenceAssetIds || []) {
      const asset = await ownedAsset(userId, ref, tx);
      if (asset.contentType !== "image/png") throw new AppError("INVALID_SOURCE");
    }
    const target = document.content.layers.find(l => l.id === data.targetId);
    if (getTool(data.tool).source && (!target || target.assetId !== data.assetId || target.type !== "image")) throw new AppError("TARGET_CHANGED", 409);
    const inputAsset = data.assetId ? await ownedAsset(userId, data.assetId, tx) : null;
    if (inputAsset && inputAsset.contentType !== "image/png") throw new AppError("INVALID_SOURCE");
    if (data.maskId) {
      const mask = await ownedAsset(userId, data.maskId, tx);
      if (mask.width !== inputAsset.width || mask.height !== inputAsset.height) throw new AppError("MASK_SIZE_MISMATCH");
    }
    if (data.moveBundle) {
      const { objectAssetId, holeAssetId, bounds } = data.moveBundle;
      const object = await ownedAsset(userId, objectAssetId, tx), hole = await ownedAsset(userId, holeAssetId, tx);
      if (object.contentType !== "image/png" || hole.contentType !== "image/png" || object.width !== bounds.width || object.height !== bounds.height || hole.width !== inputAsset.width || hole.height !== inputAsset.height || bounds.left + bounds.width > inputAsset.width || bounds.top + bounds.height > inputAsset.height) throw new AppError("INVALID_MOVE_BUNDLE", 422);
    }
    if (data.tool === "crop" && (data.params.rect.left + data.params.rect.width > inputAsset.width || data.params.rect.top + data.params.rect.height > inputAsset.height)) throw new AppError("CROP_OUT_OF_BOUNDS");
    if (data.tool === "upscale" && (inputAsset.width * inputAsset.height * data.params.scale ** 2 > 40000000 || Math.max(inputAsset.width, inputAsset.height) * data.params.scale > 8192)) throw new AppError("IMAGE_TOO_LARGE", 413);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('queue-admission', 0))::text`;
    if (await tx.tryOn.count({ where: { status: { in: ACTIVE } } }) >= LIMITS.queue) throw new AppError("QUEUE_FULL", 503);
    if (await tx.tryOn.count({ where: { userId, status: { in: ACTIVE } } }) >= 20) throw new AppError("USER_QUEUE_FULL", 429);
    const channel = data.tool === "split" ? config.splitChannel : null;
    const output = await tx.tryOn.create({ data: { id: randomUUID(), userId, requestId, personImage: "", clothesImage: inputAsset ? `/api/assets/${inputAsset.id}` : "", prompt: data.params.prompt, provider: data.tool === "video" ? "ark" : channel?.name || config.imageProvider || "studio", creditCost: tool.cost, billingType: "credits",
      snapshot: { kind: "studio", ...data, provider: channel?.name || config.imageProvider, providerKind: channel?.kind || config.imageKind || "openai", providerBaseURL: (data.tool === "split" ? channel?.baseURL : config.baseURL) || null, digest, checksum: inputAsset?.checksum || null, price: tool.cost, priceVersion: "studio-2026-09-v1", imageModel: channel?.model || config.imageModel, chatModel: config.chatModel || null, videoModel: config.videoModel || null } } });
    if (tool.cost) {
      const allocations = await reserveCreditLots(tx, user, tool.cost);
      await tx.creditReservation.create({ data: { userId, tryOnId: output.id, channel: "credits", amount: tool.cost, allocations } });
    }
    for (const assetId of new Set([data.assetId, data.maskId, data.moveBundle?.objectAssetId, data.moveBundle?.holeAssetId, ...(data.referenceAssetIds || [])].filter(Boolean))) await tx.assetReference.create({ data: { assetId, entityId: output.id, kind: "generation_input" } });
    await tx.outboxEvent.create({ data: { businessKey: `generate:${output.id}:0`, kind: "generate", entityId: output.id } });
    return presentJob(output);
  }, { timeout: 30000 });
}

export function presentJob(row) {
  return { id: row.id, status: row.status, tool: row.snapshot.tool, targetId: row.snapshot.targetId, documentId: row.snapshot.documentId,
    assetId: row.snapshot.assetId, moveBundle: row.snapshot.moveBundle,
    sectionId: row.snapshot.sectionId, sectionAttempt: row.snapshot.sectionAttempt,
    cost: row.creditCost, errorCode: row.errorCode, resultData: row.resultData, createdAt: row.createTime, cancelRequested: Boolean(row.cancelRequestedAt) };
}
