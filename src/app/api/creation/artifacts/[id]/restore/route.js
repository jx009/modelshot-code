import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { restoreArtifactSchema } from "@/lib/creation/contracts/projects";
import { restoreLayoutArtifact } from "@/lib/domain/creation/artifacts";
import { rateLimit } from "@/lib/domain/identity/rate-limit";

export async function POST(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    await rateLimit("creation-restore", user.id, 30, 600);
    return Response.json(await restoreLayoutArtifact(user.id, id, await readJson(request, restoreArtifactSchema)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
