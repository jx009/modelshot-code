import { requireUser } from "@/lib/require-user";
import { errorResponse, sameOrigin } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { ownedOfficeImport, presentOfficeImport, cancelOfficeImport } from "@/lib/domain/creation/office-imports";

export async function GET(_request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    return Response.json(presentOfficeImport(await ownedOfficeImport(user.id, id)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request, context) {
  try {
    sameOrigin(request);
    const user = await requireUser(), { id } = await context.params;
    await rateLimit("creation-office-import-cancel", user.id, 30, 60);
    return Response.json(await cancelOfficeImport(user.id, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
