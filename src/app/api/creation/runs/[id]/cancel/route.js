import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { errorResponse, sameOrigin } from "@/lib/http";
import { cancelRun } from "@/lib/domain/creation/runs";

export async function POST(request, context) {
  try {
    sameOrigin(request);
    // Stopping an owned in-flight job remains possible after access is closed.
    const user = await requireUser({ workspace: false }), { id } = await context.params;
    return Response.json(await cancelRun(user.id, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
