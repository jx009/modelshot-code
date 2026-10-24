import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { createProjectSchema } from "@/lib/creation/contracts/projects";
import { createProject, listProjects, requireCreationWorkspace } from "@/lib/domain/creation/projects";
import { rateLimit } from "@/lib/domain/identity/rate-limit";

export async function POST(request) {
  try {
    const user = await requireUser(); requireCreationWorkspace();
    await rateLimit("creation-project", user.id, 30, 600);
    return Response.json(await createProject(user.id, await readJson(request, createProjectSchema)), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function GET(request) {
  try {
    const user = await requireUser(), query = new URL(request.url).searchParams;
    return Response.json(await listProjects(user.id, { cursor: query.get("cursor"), kind: query.get("kind") }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
