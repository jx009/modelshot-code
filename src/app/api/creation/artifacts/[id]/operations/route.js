import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { modifyArtifactSchema } from "@/lib/creation/contracts/projects";
import { modifyLayoutArtifact } from "@/lib/domain/creation/artifacts";
import { rateLimit } from "@/lib/domain/identity/rate-limit";

export async function POST(request, context) {
  try {
    const user = await requireUser({ resource: "artifact", id: (await context.params).id }), { id } = await context.params;
    await rateLimit("creation-save", user.id, 120, 60);
    return Response.json(await modifyLayoutArtifact(user.id, id, await readJson(request, modifyArtifactSchema, 256 * 1024)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
