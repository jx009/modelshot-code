import { createHash, randomUUID } from "node:crypto";
import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse, readBytes, sameOrigin } from "@/lib/http";
import { assertCreationAccess, getCreationEnv } from "@/lib/creation/access";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { objectStorage } from "@/lib/infra/storage/s3";
import { prisma } from "@/lib/prisma";

const extensions = new Set(["mp4", "mov", "mp3", "wav", "m4a", "aac", "flac", "ogg"]);
export async function POST(request) {
  try {
    sameOrigin(request); const user = await requireUser();
    assertCreationAccess(await getCreationEnv(user.id), { kind: "motion" });
    await rateLimit("video-media", user.id, 30, 600);
    const extension = new URL(request.url).searchParams.get("extension");
    if (!extensions.has(extension)) throw new AppError("VIDEO_MEDIA_FORMAT_INVALID", 415);
    if (!process.env.STUDIO_TOOLS_URL || !process.env.STUDIO_TOOLS_KEY) throw new AppError("MOTION_RENDER_UNAVAILABLE", 503);
    const bytes = await readBytes(request, 64 * 1024 * 1024);
    if (!bytes.length) throw new AppError("VIDEO_MEDIA_EMPTY", 422);
    const form = new FormData(); form.append("file", new Blob([bytes]), `input.${extension}`);
    const response = await fetch(`${process.env.STUDIO_TOOLS_URL}/motion/inspect`, { method: "POST", headers: { Authorization: `Bearer ${process.env.STUDIO_TOOLS_KEY}` }, body: form, signal: AbortSignal.timeout(40000) });
    if (!response.ok) throw new AppError(response.status === 429 ? "MOTION_RENDER_BUSY" : response.status === 503 ? "MOTION_RENDER_UNAVAILABLE" : "VIDEO_MEDIA_INVALID", response.status);
    const info = await response.json();
    if (!["audio", "video"].includes(info.type) || !info.contentType?.startsWith(`${info.type}/`) || !Number.isFinite(info.duration) || info.duration <= 0 || info.duration > 1800) throw new AppError("VIDEO_MEDIA_INVALID", 422);
    const id = randomUUID(), objectKey = `${user.id}/upload/${id}.${extension}`;
    await objectStorage().put(objectKey, bytes, info.contentType);
    await prisma.asset.create({ data: { id, userId: user.id, objectKey, kind: "upload", contentType: info.contentType, width: info.width || 0, height: info.height || 0, bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") } });
    return Response.json({ id, type: info.type, duration: info.duration, contentType: info.contentType }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
