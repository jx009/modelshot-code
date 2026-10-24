import { requireUser } from "@/lib/require-user";
import { errorResponse, AppError, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { createWebArtifactSchema } from "@/lib/creation/contracts/web-artifacts";
import { createWebArtifact } from "@/lib/domain/creation/web-artifacts";
export async function POST(request) {
  try {
    const user = await requireUser(); await rateLimit("creation-web-create", user.id, 10, 60);
    if (process.env.CREATION_WORKSPACE_ENABLED !== "true" || process.env.CREATION_WEB_ENABLED !== "true") throw new AppError("CREATION_NOT_ENABLED", 503);
    const data = await readJson(request, createWebArtifactSchema, 2 * 1024 * 1024);
    if (!await prisma.creationProject.findFirst({ where: { id: data.projectId, userId: user.id, kind: "web", deletedAt: null }, select: { id: true } })) throw new AppError("CREATION_PROJECT_NOT_FOUND", 404);
    return Response.json(await createWebArtifact(user.id, data.projectId, data.content, data.saveKey), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
