import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { AppError, errorResponse, readBytes, readJson } from "@/lib/http";
import { auditedOperation } from "@/lib/domain/identity/admin-operation";
import { objectStorage } from "@/lib/infra/storage/s3";
import { inspectMediaBytes } from "@/lib/domain/studio/media-inspect";
import { MUSIC_EXTENSIONS, MUSIC_MAX_BYTES, createTrackRecords, presentTrack, storeTrackFile } from "@/lib/domain/studio/music-library";

const headers = { "Cache-Control": "private, no-store" };
const text = (max, min = 0) => z.string().trim().min(min).max(max);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const reason = text(500, 3);

export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  try {
    const tracks = await prisma.musicTrack.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], take: 500 });
    return Response.json({ tracks: tracks.map(track => presentTrack(track, { admin: true })), canManage: auth.user.role === "root" }, { headers });
  } catch (error) { return errorResponse(error); }
}

// 上传：请求体为音频原始字节，名称、情绪标签、扩展名与操作原因放在查询参数。
export async function POST(request) {
  const auth = await requireAdmin(request, "root");
  if (auth.response) return auth.response;
  try {
    const params = new URL(request.url).searchParams;
    const input = z.object({ name: text(60, 1), mood: text(20).default(""), extension: z.string(), reason }).strict().parse({ name: params.get("name") ?? "", mood: params.get("mood") ?? "", extension: params.get("extension") ?? "", reason: params.get("reason") ?? "" });
    if (!MUSIC_EXTENSIONS.has(input.extension)) throw new AppError("VIDEO_MEDIA_FORMAT_INVALID", 415);
    const bytes = await readBytes(request, MUSIC_MAX_BYTES);
    if (!bytes.length) throw new AppError("VIDEO_MEDIA_EMPTY", 422);
    const info = await inspectMediaBytes(bytes, input.extension);
    if (info.type !== "audio") throw new AppError("VIDEO_MEDIA_INVALID", 422);
    const file = await storeTrackFile(auth.user.id, bytes, input.extension, info.contentType, objectStorage());
    const result = await auditedOperation(auth.user.id, request.headers.get("idempotency-key"), "CREATE_MUSIC_TRACK", { ...input, bytes: bytes.length }, async tx => {
      const track = await createTrackRecords(tx, auth.user.id, { file, name: input.name, mood: input.mood, bytes, info });
      return { response: presentTrack(track, { admin: true }), audit: { trackId: track.id, name: track.name, duration: track.duration } };
    }, prisma, "root");
    return Response.json(result, { status: 201, headers });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request) {
  const auth = await requireAdmin(request, "root");
  if (auth.response) return auth.response;
  try {
    const input = await readJson(request, z.object({ id, name: text(60, 1).optional(), mood: text(20).optional(), isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).max(100000).optional(), reason }).strict());
    const result = await auditedOperation(auth.user.id, request.headers.get("idempotency-key"), "UPDATE_MUSIC_TRACK", input, async tx => {
      const existing = await tx.musicTrack.findFirst({ where: { id: input.id, deletedAt: null } });
      if (!existing) throw new AppError("MUSIC_TRACK_NOT_FOUND", 404);
      const track = await tx.musicTrack.update({ where: { id: input.id }, data: { name: input.name, mood: input.mood, isActive: input.isActive, sortOrder: input.sortOrder } });
      return { response: presentTrack(track, { admin: true }), audit: { trackId: track.id, fields: Object.keys(input).filter(key => !["id", "reason"].includes(key)) } };
    }, prisma, "root");
    return Response.json(result, { headers });
  } catch (error) { return errorResponse(error); }
}

// 下架并软删除。已导出的成片不受影响；引用该曲目的工程再次导出时会提示更换配乐。
export async function DELETE(request) {
  const auth = await requireAdmin(request, "root");
  if (auth.response) return auth.response;
  try {
    const input = await readJson(request, z.object({ id, reason }).strict());
    const result = await auditedOperation(auth.user.id, request.headers.get("idempotency-key"), "DELETE_MUSIC_TRACK", input, async tx => {
      const existing = await tx.musicTrack.findFirst({ where: { id: input.id, deletedAt: null } });
      if (!existing) throw new AppError("MUSIC_TRACK_NOT_FOUND", 404);
      await tx.musicTrack.update({ where: { id: input.id }, data: { deletedAt: new Date(), isActive: false } });
      return { response: { ok: true }, audit: { trackId: existing.id, name: existing.name } };
    }, prisma, "root");
    return Response.json(result, { headers });
  } catch (error) { return errorResponse(error); }
}
