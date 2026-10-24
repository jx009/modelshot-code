import { requireUser } from "@/lib/require-user";
import { errorResponse } from "@/lib/http";
import { listArtifactRevisions } from "@/lib/domain/creation/artifacts";

export async function GET(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    const before = new URL(request.url).searchParams.get("before");
    return Response.json(await listArtifactRevisions(user.id, id, before === null ? undefined : Number(before)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
