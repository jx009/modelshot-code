import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { copyDocumentArtifactSchema } from "@/lib/creation/contracts/document-artifacts";
import { copyDocumentArtifact } from "@/lib/domain/creation/document-artifacts";

export async function POST(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    await rateLimit("creation-document-copy", user.id, 10, 60);
    const data = await readJson(request, copyDocumentArtifactSchema, 2 * 1024 * 1024);
    return Response.json(await copyDocumentArtifact(user.id, id, data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
