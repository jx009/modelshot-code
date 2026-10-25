import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { errorResponse, AppError, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { createDocumentArtifactSchema } from "@/lib/creation/contracts/document-artifacts";
import { createDocumentArtifact } from "@/lib/domain/creation/document-artifacts";

export async function POST(request) {
  try {
    const user = await requireUser({ kind: "document" });
    await rateLimit("creation-document-create", user.id, 10, 60);
    if (user.creationEnv.CREATION_WORKSPACE_ENABLED !== "true" || user.creationEnv.CREATION_DOCUMENT_ENABLED !== "true") throw new AppError("CREATION_NOT_ENABLED", 503);
    const data = await readJson(request, createDocumentArtifactSchema, 2 * 1024 * 1024);
    if (!await prisma.creationProject.findFirst({ where: { id: data.projectId, userId: user.id, kind: "document", deletedAt: null }, select: { id: true } })) throw new AppError("CREATION_PROJECT_NOT_FOUND", 404);
    return Response.json(await createDocumentArtifact(user.id, data.projectId, data.content, data.saveKey), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
