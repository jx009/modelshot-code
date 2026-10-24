import { requireUser } from "@/lib/require-user";
import { errorResponse, AppError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { ownedExport } from "@/lib/domain/creation/exports";
import { exportFormat, EXPORT_MAX_BYTES } from "@/lib/creation/contracts/exports";
import { objectStorage } from "@/lib/infra/storage/s3";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { createHash } from "node:crypto";

export async function GET(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    await rateLimit("creation-export-download", user.id, 30, 60);
    const row = await ownedExport(user.id, id);
    const descriptor = exportFormat(row.format);
    if (!descriptor) throw new AppError("EXPORT_VERSION_UNSUPPORTED", 422);
    if (row.status !== "succeeded" || !row.blobId) throw new AppError("EXPORT_NOT_READY", 409);
    const blob = await prisma.creationBlob.findFirst({ where: { id: row.blobId, userId: user.id, state: "ready" } });
    if (!blob || blob.bytes <= 0 || blob.bytes > EXPORT_MAX_BYTES) throw new AppError("EXPORT_RESULT_INVALID", 422);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(120000)]);
    const stream = await objectStorage().stream(blob.objectKey, undefined, signal);
    let bytes = 0;
    const hash = createHash("sha256");
    const bounded = new TransformStream({ transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > blob.bytes) throw new Error("EXPORT_RESULT_INVALID");
      hash.update(chunk);
      controller.enqueue(chunk);
    }, flush() { if (bytes !== blob.bytes || hash.digest("hex") !== blob.checksum) throw new Error("EXPORT_RESULT_INVALID"); } });
    return new Response(stream.pipeThrough(bounded), { headers: { "Content-Type": descriptor.contentType, "Content-Length": String(blob.bytes),
      "Content-Disposition": `attachment; filename="${({ slides: "presentation", poster: "poster", document: "document", sheet: "workbook", web: "website" })[descriptor.kind] || "artwork"}-v${row.revision.revision}.${descriptor.extension}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return errorResponse(error); }
}
