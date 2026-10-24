import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson, sameOrigin } from "@/lib/http";
import { readProject, updateProject } from "@/lib/domain/creation/projects";
import { updateProjectSchema } from "@/lib/creation/contracts/projects";

export async function GET(_request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    return Response.json(await readProject(user.id, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    return Response.json(await updateProject(user.id, id, await readJson(request, updateProjectSchema)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request, context) {
  try {
    sameOrigin(request);
    const user = await requireUser(), { id } = await context.params;
    await updateProject(user.id, id, { remove: true });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
