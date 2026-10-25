import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { AppError, errorResponse, readBytes, sameOrigin } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { ConcurrencyGate } from "@/lib/infra/concurrency";
import { OFFICE_IMPORT_BYTES, listOfficeImports, requestOfficeImport } from "@/lib/domain/creation/office-imports";

const uploads = new ConcurrencyGate(2);
export async function GET(_request, context) {
  try {
    const user = await requireUser({ resource: "project", id: (await context.params).id }), { id } = await context.params;
    return Response.json(await listOfficeImports(user.id, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request, context) {
  try {
    sameOrigin(request);
    const user = await requireUser({ resource: "project", id: (await context.params).id }), { id } = await context.params;
    await rateLimit("creation-office-import", user.id, 20, 600);
    const type = request.headers.get("content-type") || "";
    if (!type.toLowerCase().startsWith("multipart/form-data;")) throw new AppError("MULTIPART_REQUIRED", 415);
    return await uploads.run(async () => {
      const bytes = await readBytes(request, OFFICE_IMPORT_BYTES + 8192);
      let form;
      try { form = await new Response(bytes, { headers: { "content-type": type } }).formData(); }
      catch { throw new AppError("INVALID_MULTIPART", 400); }
      const file = form.get("file");
      if (!(file instanceof File)) throw new AppError("FILE_REQUIRED", 400);
      const item = await requestOfficeImport(user.id, id, file, request.headers.get("idempotency-key"));
      return Response.json(item, { status: 202, headers: { "Cache-Control": "private, no-store" } });
    });
  } catch (error) { return errorResponse(error); }
}
