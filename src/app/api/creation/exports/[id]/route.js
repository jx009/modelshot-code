import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { errorResponse, sameOrigin } from "@/lib/http";
import { cancelArtifactExport, ownedExport, presentExport } from "@/lib/domain/creation/exports";
import { rateLimit } from "@/lib/domain/identity/rate-limit";

export async function GET(_request, context) {
  try {
    const user = await requireUser({ resource: "export", id: (await context.params).id }), { id } = await context.params;
    return Response.json(presentExport(await ownedExport(user.id, id)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request, context) {
  try {
    sameOrigin(request);
    // Stopping an owned in-flight job remains possible after access is closed.
    const user = await requireUser({ workspace: false }), { id } = await context.params;
    await rateLimit("creation-export-cancel", user.id, 30, 60);
    return Response.json(await cancelArtifactExport(user.id, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
