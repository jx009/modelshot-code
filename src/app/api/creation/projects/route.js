import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { createProjectSchema } from "@/lib/creation/contracts/projects";
import { createProject, listProjects, requireCreationWorkspace } from "@/lib/domain/creation/projects";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { assertCreationAccess, allowedCreationKinds } from "@/lib/creation/access";

export async function POST(request) {
  try {
    const user = await requireUser(); requireCreationWorkspace(user.creationEnv);
    await rateLimit("creation-project", user.id, 30, 600);
    const body = await readJson(request, createProjectSchema);
    assertCreationAccess(user.creationEnv, { kind: body.kind });
    return Response.json(await createProject(user.id, body), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function GET(request) {
  try {
    const user = await requireUser(), query = new URL(request.url).searchParams;
    return Response.json(await listProjects(user.id, { cursor: query.get("cursor"), kind: query.get("kind"), allowedKinds: allowedCreationKinds(user.creationEnv) }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
