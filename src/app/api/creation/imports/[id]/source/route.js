import { createHash } from "node:crypto";
import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { AppError, errorResponse } from "@/lib/http";
import { ownedOfficeImport, OFFICE_IMPORT_BYTES } from "@/lib/domain/creation/office-imports";
import { objectStorage } from "@/lib/infra/storage/s3";

export async function GET(_request, context) {
  try {
    const user = await requireUser({ resource: "import", id: (await context.params).id }), { id } = await context.params;
    const row = await ownedOfficeImport(user.id, id), blob = row.sourceBlob;
    if (blob.userId !== user.id || blob.state !== "ready" || blob.bytes > OFFICE_IMPORT_BYTES) throw new AppError("OFFICE_SOURCE_INVALID", 422);
    const bytes = await objectStorage().get(blob.objectKey);
    if (bytes.length !== blob.bytes || createHash("sha256").update(bytes).digest("hex") !== blob.checksum) throw new AppError("OFFICE_SOURCE_INVALID", 422);
    return new Response(bytes, { headers: { "Cache-Control": "private, no-store", "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff", "Content-Disposition": "attachment; filename=original." + row.format + "; filename*=UTF-8''" + encodeURIComponent(row.name) } });
  } catch (error) { return errorResponse(error); }
}
