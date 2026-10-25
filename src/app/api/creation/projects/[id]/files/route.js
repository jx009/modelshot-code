import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { errorResponse } from "@/lib/http";
import { listProjectFiles } from "@/lib/domain/creation/project-files";

export async function GET(request, context) {
  try {
    const user = await requireUser({ resource: "project", id: (await context.params).id }), { id } = await context.params;
    const params = new URL(request.url).searchParams;
    return Response.json(await listProjectFiles(user.id, id, { cursor: params.get("cursor"), q: params.get("q") || "" }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
