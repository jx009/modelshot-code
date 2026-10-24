import { requireUser } from "@/lib/require-user";
import { errorResponse, AppError, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { createSheetArtifactSchema } from "@/lib/creation/contracts/sheet-artifacts";
import { createSheetArtifact } from "@/lib/domain/creation/sheet-artifacts";
export async function POST(request) {
  try { const user = await requireUser(); await rateLimit("creation-sheet-create", user.id, 10, 60); if (process.env.CREATION_WORKSPACE_ENABLED !== "true" || process.env.CREATION_SHEET_ENABLED !== "true") throw new AppError("CREATION_NOT_ENABLED", 503); const data = await readJson(request, createSheetArtifactSchema, 2 * 1024 * 1024); if (!await prisma.creationProject.findFirst({ where: { id: data.projectId, userId: user.id, kind: "sheet", deletedAt: null }, select: { id: true } })) throw new AppError("CREATION_PROJECT_NOT_FOUND", 404); return Response.json(await createSheetArtifact(user.id, data.projectId, data.content, data.saveKey), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
