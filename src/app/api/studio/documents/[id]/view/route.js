import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse, readJson } from "@/lib/http";

async function owned(context) {
  const user = await requireUser(), { id } = await context.params;
  if (!await prisma.studioDocument.findFirst({ where: { id, userId: user.id, deletedAt: null }, select: { id: true } })) throw new AppError("DOCUMENT_NOT_FOUND", 404);
  return id;
}
export async function GET(_request, context) {
  try { const id = await owned(context); return Response.json(await prisma.studioDocumentView.findUnique({ where: { documentId: id } }) || { camera: null }); }
  catch (error) { return errorResponse(error); }
}
export async function PUT(request, context) {
  try {
    const id = await owned(context);
    const camera = await readJson(request, z.object({ x: z.number().finite().min(-1000000).max(1000000), y: z.number().finite().min(-1000000).max(1000000), scale: z.number().min(.08).max(4) }).strict());
    await prisma.studioDocumentView.upsert({ where: { documentId: id }, create: { documentId: id, camera }, update: { camera } });
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
