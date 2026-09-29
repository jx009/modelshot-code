import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { addLibraryItem } from "@/lib/domain/assets/library";
export async function GET(request) {
  try {
    const user = await requireUser(), q = new URL(request.url).searchParams;
    const category = q.get("category"), search = (q.get("q") || "").slice(0, 160);
    const rows = await prisma.libraryItem.findMany({ where: { userId: user.id,
      deletedAt: category === "trash" ? { gte: new Date(Date.now() - 30 * 86400000) } : null,
      ...(category === "uncategorized" ? { categoryId: null } : category && !["all", "trash"].includes(category) ? { categoryId: category } : {}),
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
      ...(q.get("cursor") ? { id: { lt: q.get("cursor") } } : {}),
    }, orderBy: { id: "desc" }, take: 31, include: { asset: { select: { width: true, height: true, contentType: true } } } });
    return Response.json({ items: rows.slice(0, 30), nextCursor: rows.length > 30 ? rows[29].id : null });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request) {
  try { const user = await requireUser(); const input = await readJson(request, z.object({ assetId: z.string().min(1).max(128), name: z.string().trim().min(1).max(160), categoryId: z.string().max(128).nullable().optional() }).strict()); return Response.json(await addLibraryItem(user.id, input)); }
  catch (error) { return errorResponse(error); }
}
