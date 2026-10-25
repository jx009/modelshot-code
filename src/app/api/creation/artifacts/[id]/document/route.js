import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { modifyDocumentArtifactSchema } from "@/lib/creation/contracts/document-artifacts";
import { readDocumentArtifact, modifyDocumentArtifact } from "@/lib/domain/creation/document-artifacts";

export async function GET(request, context) {
  try {
    const user = await requireUser({ resource: "artifact", id: (await context.params).id }), { id } = await context.params;
    const revision = new URL(request.url).searchParams.get("revision");
    return Response.json(await readDocumentArtifact(user.id, id, revision === null ? undefined : Number(revision)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request, context) {
  try {
    const user = await requireUser({ resource: "artifact", id: (await context.params).id }), { id } = await context.params;
    await rateLimit("creation-document-save", user.id, 120, 60);
    const data = await readJson(request, modifyDocumentArtifactSchema, 256 * 1024);
    return Response.json(await modifyDocumentArtifact(user.id, id, data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
