import { requireAdmin } from "@/lib/admin-auth";
import { errorResponse } from "@/lib/http";
import { generationAuditDetail } from "@/lib/domain/identity/generation-audit";

export async function GET(request, context) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  try {
    const { id } = await context.params;
    return Response.json(await generationAuditDetail(id, auth.user.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
