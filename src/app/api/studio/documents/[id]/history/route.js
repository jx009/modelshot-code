import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse } from "@/lib/http";

export async function GET(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    if (!await prisma.studioDocument.findFirst({ where: { id, userId: user.id, deletedAt: null }, select: { id: true } })) throw new AppError("DOCUMENT_NOT_FOUND", 404);
    const query = new URL(request.url).searchParams;
    let before = query.get("before");
    if (!before && query.get("beforeId")) {
      const boundary = await prisma.studioMessage.findUnique({ where: { documentId_messageId: { documentId: id, messageId: query.get("beforeId") } }, select: { sequence: true } });
      before = boundary ? String(boundary.sequence) : null;
    }
    if (before && (!/^\d+$/.test(before) || !Number.isSafeInteger(Number(before)))) throw new AppError("INVALID_CURSOR");
    const rows = await prisma.studioMessage.findMany({ where: { documentId: id, ...(before ? { sequence: { lt: Number(before) } } : {}) }, orderBy: { sequence: "desc" }, take: 51 });
    return Response.json({ items: rows.slice(0, 50).map(({ messageId, role, text, assetId, sequence }) => ({ id: messageId, role, text, ...(assetId ? { assetId } : {}), sequence })), nextCursor: rows.length > 50 ? rows[49].sequence : null });
  } catch (error) { return errorResponse(error); }
}
