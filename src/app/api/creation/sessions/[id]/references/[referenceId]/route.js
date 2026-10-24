import { requireUser } from "@/lib/require-user";
import { errorResponse, AppError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { objectStorage } from "@/lib/infra/storage/s3";
import { readReferenceBytes } from "@/lib/domain/creation/reference-read";
import { referenceType, referenceContentType } from "@/lib/creation/reference-policy";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { ConcurrencyGate } from "@/lib/infra/concurrency";

const downloads = new ConcurrencyGate(2);

export async function GET(request, context) {
  try {
    const user = await requireUser(), { id, referenceId } = await context.params;
    await rateLimit("creation-reference-download", user.id, 30, 60);
    const file = await prisma.creationReference.findFirst({ where: { id: referenceId, userId: user.id, sessionId: id, deletedAt: null, session: { project: { userId: user.id, deletedAt: null } } }, select: { name: true, fileType: true, contentType: true, bytes: true, checksum: true, objectKey: true } });
    if (!file) throw new AppError("CREATION_REFERENCE_NOT_FOUND", 404);
    const type = referenceType(file.fileType);
    if (!type || file.contentType !== referenceContentType(type)) throw new AppError("CREATION_REFERENCE_INVALID", 422);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
    const bytes = await downloads.run(() => readReferenceBytes(file, objectStorage(), signal));
    const name = encodeURIComponent(file.name.toWellFormed()).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(bytes, { headers: { "Content-Type": file.contentType, "Content-Length": String(bytes.length), "Content-Disposition": `attachment; filename="reference.${file.fileType}"; filename*=UTF-8''${name}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return errorResponse(error); }
}
