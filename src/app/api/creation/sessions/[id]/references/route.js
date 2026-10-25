import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { AppError, errorResponse, readBytes, sameOrigin } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { listCreationReferences, uploadCreationReference } from "@/lib/domain/creation/reference-files";
import { officeReferencesAvailable } from "@/lib/domain/creation/reference-admission";
import { REFERENCE_OFFICE_BYTES } from "@/lib/creation/reference-policy";
import { prisma } from "@/lib/prisma";
import { ConcurrencyGate } from "@/lib/infra/concurrency";

const REQUEST_LIMIT = REFERENCE_OFFICE_BYTES + 8192;
const uploads = new ConcurrencyGate(2);

export async function GET(_request, context) {
  try {
    const user = await requireUser({ resource: "session", id: (await context.params).id }), { id } = await context.params;
    const items = await listCreationReferences(user.id, id);
    return Response.json({ items, officeEnabled: await officeReferencesAvailable(prisma) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request, context) {
  try {
    sameOrigin(request);
    const user = await requireUser({ resource: "session", id: (await context.params).id }), { id } = await context.params;
    await rateLimit("creation-reference-upload", user.id, 30, 600);
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw new AppError("MULTIPART_REQUIRED", 415);
    return await uploads.run(async () => {
      request.signal.throwIfAborted();
      const bytes = await readBytes(request, REQUEST_LIMIT);
      let form;
      try { form = await new Response(bytes, { headers: { "content-type": contentType } }).formData(); }
      catch { throw new AppError("INVALID_MULTIPART", 400); }
      const file = form.get("file");
      if (!(file instanceof File)) throw new AppError("FILE_REQUIRED", 400);
      const reference = await uploadCreationReference(user.id, id, file);
      return Response.json({ item: { id: reference.id, name: reference.name, fileType: reference.fileType, contentType: reference.contentType, bytes: reference.bytes, createdAt: reference.createdAt } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    });
  } catch (error) { return errorResponse(error); }
}
