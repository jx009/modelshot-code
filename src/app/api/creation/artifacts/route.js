import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { createArtifactSchema } from "@/lib/creation/contracts/projects";
import { createLayoutArtifact } from "@/lib/domain/creation/artifacts";
import { requireCreationWorkspace } from "@/lib/domain/creation/projects";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { assertCreationAccess, assertCreationResource } from "@/lib/creation/access";

export async function POST(request) {
  try {
    const user = await requireUser(); requireCreationWorkspace(user.creationEnv);
    await rateLimit("creation-artifact", user.id, 60, 600);
    const { projectId, content } = await readJson(request, createArtifactSchema, 2 * 1024 * 1024);
    assertCreationAccess(user.creationEnv, { kind: content.kind });
    await assertCreationResource(user.id, user.creationEnv, "project", projectId);
    return Response.json(await createLayoutArtifact(user.id, projectId, content, request.headers.get("Idempotency-Key")), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
