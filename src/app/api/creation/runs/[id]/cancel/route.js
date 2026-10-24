import { requireUser } from "@/lib/require-user";
import { errorResponse, sameOrigin } from "@/lib/http";
import { cancelRun } from "@/lib/domain/creation/runs";

export async function POST(request, context) {
  try {
    sameOrigin(request);
    const user = await requireUser(), { id } = await context.params;
    return Response.json(await cancelRun(user.id, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
