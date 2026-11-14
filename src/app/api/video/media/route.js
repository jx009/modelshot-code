import { createHash, randomUUID } from "node:crypto";
import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse, readBytes, sameOrigin } from "@/lib/http";
import { assertCreationAccess, getCreationEnv } from "@/lib/creation/access";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { objectStorage } from "@/lib/infra/storage/s3";
import { prisma } from "@/lib/prisma";
import { videoMediaProof } from "@/lib/domain/studio/video-media";
import { inspectMediaBytes } from "@/lib/domain/studio/media-inspect";

const extensions = new Set(["mp4", "mov", "mp3", "wav", "m4a", "aac", "flac", "ogg"]);
export async function POST(request) {
  try {
    sameOrigin(request); const user = await requireUser();
    const kind = new URL(request.url).searchParams.get("kind") === "video" ? "video" : "motion";
    assertCreationAccess(await getCreationEnv(user.id), { kind });
    await rateLimit("video-media", user.id, 30, 600);
    const extension = new URL(request.url).searchParams.get("extension");
    if (!extensions.has(extension)) throw new AppError("VIDEO_MEDIA_FORMAT_INVALID", 415);
    if (!process.env.STUDIO_TOOLS_URL || !process.env.STUDIO_TOOLS_KEY) throw new AppError("MOTION_RENDER_UNAVAILABLE", 503);
    const bytes = await readBytes(request, 64 * 1024 * 1024);
    if (!bytes.length) throw new AppError("VIDEO_MEDIA_EMPTY", 422);
    const info = await inspectMediaBytes(bytes, extension);
    const id = randomUUID(), objectKey = `${user.id}/upload/${id}.${extension}`;
    await objectStorage().put(objectKey, bytes, info.contentType);
    await prisma.asset.create({ data: { id, userId: user.id, objectKey, kind: "upload", contentType: info.contentType, width: info.width || 0, height: info.height || 0, bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") } });
    return Response.json({ id, type: info.type, duration: info.duration, proof: videoMediaProof(user.id, id, info), contentType: info.contentType }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
