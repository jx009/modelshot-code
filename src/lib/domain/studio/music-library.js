import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";

// 平台曲库：管理员上传、所有用户可选用的背景音乐。
// 分镜工程以 audio.libraryTrackId 引用曲目，服务端据此解析到平台素材，
// 用户端无法借此读取或渲染其他任何非本人素材。
export const MUSIC_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "flac", "ogg"]);
export const MUSIC_MAX_BYTES = 32 * 1024 * 1024;

export function presentTrack(track, { admin = false } = {}) {
  return { id: track.id, name: track.name, mood: track.mood, duration: track.duration, assetId: track.assetId, previewUrl: `/api/video/music/${track.id}/audio`,
    ...(admin ? { isActive: track.isActive, sortOrder: track.sortOrder, createdAt: track.createdAt } : {}) };
}

export async function listActiveTracks(db = prisma) {
  return db.musicTrack.findMany({ where: { deletedAt: null, isActive: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], take: 200 });
}

export async function activeTrack(id, db = prisma) {
  const track = await db.musicTrack.findFirst({ where: { id, deletedAt: null, isActive: true }, include: { asset: true } });
  if (!track || track.asset.status !== "active" || track.asset.deletedAt) throw new AppError("MUSIC_TRACK_NOT_FOUND", 404);
  return track;
}

// 工程里的曲库引用必须指向仍在上架的曲目，且资源 ID 与曲目一致。
export async function assertLibraryAudio(composition, db = prisma) {
  const audio = composition?.audio;
  if (!audio?.libraryTrackId) return null;
  const track = await activeTrack(audio.libraryTrackId, db);
  if (track.assetId !== audio.assetId) throw new AppError("MUSIC_TRACK_CHANGED", 409);
  if (audio.trimStart >= track.duration) throw new AppError("MOTION_TRIM_INVALID", 422);
  return track;
}

// 文件先写入对象存储，再在管理员审计事务内创建素材与曲目记录。
export async function storeTrackFile(adminId, bytes, extension, contentType, store) {
  const id = randomUUID(), objectKey = `${adminId}/music/${id}.${extension}`;
  await store.put(objectKey, bytes, contentType);
  return { id, objectKey };
}

export async function createTrackRecords(tx, adminId, { file, name, mood = "", bytes, info }) {
  const max = (await tx.musicTrack.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
  await tx.asset.create({ data: { id: file.id, userId: adminId, objectKey: file.objectKey, kind: "upload", contentType: info.contentType, width: 0, height: 0, bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") } });
  const track = await tx.musicTrack.create({ data: { assetId: file.id, name, mood, duration: info.duration, sortOrder: max + 1 } });
  // 引用记录让素材清理流程识别该文件仍在曲库中使用。
  await tx.assetReference.create({ data: { assetId: file.id, entityId: track.id, kind: "music_track" } });
  return track;
}
