import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse, sameOrigin } from "@/lib/http";
export async function GET(_request, context) {
  try { const user = await requireUser(); const { id } = await context.params;
    const document = await prisma.studioDocument.findFirst({ where: { id, userId: user.id } });
    if (!document) throw new AppError("DOCUMENT_NOT_FOUND", 404);
    return Response.json(document);
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request, context) {
  try { sameOrigin(request); const user = await requireUser(); const { id } = await context.params;
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      const deleted = await tx.studioDocument.deleteMany({ where: { id, userId: user.id } });
      if (!deleted.count) throw new AppError("DOCUMENT_NOT_FOUND", 404);
      await tx.assetReference.deleteMany({ where: { entityId: id, kind: "studio" } });
    });
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}

