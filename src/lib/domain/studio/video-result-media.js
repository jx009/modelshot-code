import { prisma } from "../../prisma.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { ownedAsset, createImage } from "../assets/service.js";
import { AppError } from "../../http.js";
import { videoMediaProof } from "./video-media.js";

export async function inspectVideoResult(userId, id, { db = prisma, store = objectStorage(), bytes, config = {}, signal } = {}) {
  const asset = await ownedAsset(userId, id, db);
  if (!asset.contentType.startsWith("video/") || asset.bytes > 128 * 1024 * 1024) throw new AppError("VIDEO_MEDIA_INVALID", 422);
  const key = { entityId: id, kind: "video-media" };
  const cached = await db.processingStep.findUnique({ where: { entityId_kind: key } });
  let info = cached?.state === "complete" && cached.report?.checksum === asset.checksum ? cached.report : null;
  if (!info) {
    const url = config.toolsURL || process.env.STUDIO_TOOLS_URL, secret = config.toolsKey || process.env.STUDIO_TOOLS_KEY;
    if (!url || !secret) throw new AppError("MOTION_RENDER_UNAVAILABLE", 503);
    await db.processingStep.upsert({ where: { entityId_kind: key }, create: key, update: {} });
    const lease = await db.processingStep.updateMany({ where: { ...key, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { state: "running", fence: { increment: 1 }, leaseUntil: new Date(Date.now() + 120000) } });
    if (!lease.count) throw new AppError("MOTION_RENDER_BUSY", 429);
    const claim = await db.processingStep.findUnique({ where: { entityId_kind: key } });
    try {
    const form = new FormData(); form.append("file", new Blob([bytes || await store.get(asset.objectKey)], { type: asset.contentType }), "result.mp4");
    const response = await fetch(`${url}/motion/poster`, { method: "POST", headers: { Authorization: `Bearer ${secret}` }, body: form, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000) });
    if (!response.ok) throw new AppError(response.status === 429 ? "MOTION_RENDER_BUSY" : "VIDEO_MEDIA_INVALID", response.status);
    const value = await response.json();
    if (value.type !== "video" || !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > 1800 || !Number.isInteger(value.width) || !Number.isInteger(value.height) || Math.min(value.width, value.height) < 1 || Math.max(value.width, value.height) > 8192 || typeof value.poster !== "string" || value.poster.length > 1400000) throw new AppError("VIDEO_MEDIA_INVALID", 422);
    const poster = await createImage(userId, Buffer.from(value.poster, "base64"), { kind: "original", id: `${id}_poster` }, db, store);
    info = { type: "video", duration: value.duration, width: value.width, height: value.height, hasAudio: Boolean(value.hasAudio), posterAssetId: poster.id, checksum: asset.checksum };
    await db.asset.update({ where: { id }, data: { width: value.width, height: value.height } });
    await db.assetReference.createMany({ data: [{ assetId: poster.id, entityId: id, kind: "video_poster" }], skipDuplicates: true });
    await db.processingStep.updateMany({ where: { ...key, fence: claim.fence }, data: { state: "complete", report: info, leaseUntil: null } });
    } catch (error) {
      await db.processingStep.updateMany({ where: { ...key, fence: claim.fence }, data: { state: "pending", leaseUntil: null } }).catch(() => {});
      throw error;
    }
  }
  return { id, name: "视频片段.mp4", type: "video", bytes: asset.bytes, duration: info.duration, width: info.width, height: info.height, posterAssetId: info.posterAssetId, proof: videoMediaProof(userId, id, info) };
}
