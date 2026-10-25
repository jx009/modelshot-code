import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { copyArtifactSchema } from "@/lib/creation/contracts/projects";
import { copyLayoutArtifact } from "@/lib/domain/creation/artifacts";
import { rateLimit } from "@/lib/domain/identity/rate-limit";

export async function POST(request, context) {
  try {
    const user = await requireUser({ resource: "artifact", id: (await context.params).id }), { id } = await context.params;
    await rateLimit("creation-copy", user.id, 30, 600);
    const body = await readJson(request, copyArtifactSchema, 2 * 1024 * 1024);
    return Response.json(await copyLayoutArtifact(user.id, id, body), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
