import { readDocumentPage } from "@/lib/domain/studio/document-read";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse, sameOrigin, readJson } from "@/lib/http";
import { z } from "zod";
export async function GET(_request, context) {
  try { const user = await requireUser(); const { id } = await context.params;
    const document = new URL(_request.url).searchParams.get("pagedLayers") === "1" ? await readDocumentPage(user.id, id) : await prisma.studioDocument.findFirst({ where: { id, userId: user.id, deletedAt: null } });
    if (!document) throw new AppError("DOCUMENT_NOT_FOUND", 404);
    const applied = await prisma.studioAppliedResult.findMany({ where: { documentId: id }, select: { jobId: true } });
    document.content.appliedJobs = [...new Set([...(document.content.appliedJobs || []), ...applied.map(row => row.jobId)])];
    return Response.json(document);
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request, context) {
  try { sameOrigin(request); const user = await requireUser(); const { id } = await context.params;
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      const deleted = await tx.studioDocument.updateMany({ where: { id, userId: user.id, deletedAt: null }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      if (!deleted.count) throw new AppError("DOCUMENT_NOT_FOUND", 404);
      // Retain references while the project is recoverable.
    });
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    const input = await readJson(request, z.union([z.object({ name: z.string().trim().min(1).max(100), version: z.number().int().positive() }).strict(), z.object({ restore: z.literal(true) }).strict()]));
    if (input.restore) {
      const restored = await prisma.studioDocument.updateMany({ where: { id, userId: user.id, deletedAt: { not: null } }, data: { deletedAt: null, version: { increment: 1 } } });
      if (!restored.count) throw new AppError("DOCUMENT_NOT_FOUND", 404);
      return Response.json({ ok: true });
    }
    const changed = await prisma.studioDocument.updateMany({ where: { id, userId: user.id, deletedAt: null, version: input.version }, data: { name: input.name, nameSource: "manual", version: { increment: 1 } } });
    if (!changed.count) throw new AppError("DOCUMENT_VERSION_CONFLICT", 409);
    return Response.json({ name: input.name, version: input.version + 1 });
  } catch (error) { return errorResponse(error); }
}
