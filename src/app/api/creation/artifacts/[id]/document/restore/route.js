import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { restoreArtifactSchema } from "@/lib/creation/contracts/projects";
import { restoreDocumentArtifact } from "@/lib/domain/creation/document-artifacts";

export async function POST(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    await rateLimit("creation-document-restore", user.id, 20, 60);
    const data = await readJson(request, restoreArtifactSchema);
    return Response.json(await restoreDocumentArtifact(user.id, id, data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
