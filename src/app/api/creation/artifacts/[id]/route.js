import { requireUser } from "@/lib/require-user";
import { errorResponse } from "@/lib/http";
import { readLayoutArtifact } from "@/lib/domain/creation/artifacts";

export async function GET(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    const version = new URL(request.url).searchParams.get("revision");
    return Response.json(await readLayoutArtifact(user.id, id, version === null ? undefined : Number(version)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
