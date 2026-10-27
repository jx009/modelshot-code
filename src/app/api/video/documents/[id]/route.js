import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse } from "@/lib/http";
import { assertCreationAccess, getCreationEnv } from "@/lib/creation/access";
import { prisma } from "@/lib/prisma";
export async function GET(_request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    const row = await prisma.studioDocument.findFirst({ where: { id, userId: user.id, deletedAt: null, kind: { in: ["video", "motion"] } } });
    if (!row) throw new AppError("DOCUMENT_NOT_FOUND", 404);
    assertCreationAccess(await getCreationEnv(user.id), { kind: row.kind });
    return Response.json(row, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
