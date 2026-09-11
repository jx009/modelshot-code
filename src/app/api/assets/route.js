import { prisma } from "../../../lib/prisma.js";
import { requireUser } from "../../../lib/require-user.js";
import { errorResponse } from "../../../lib/http.js";

export async function GET(request) {
  try {
    const user = await requireUser();
    const cursor = new URL(request.url).searchParams.get("cursor");
    const items = await prisma.asset.findMany({ where: { userId: user.id, kind: "upload", status: "active", ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: "desc" }, take: 31, select: { id: true, width: true, height: true, bytes: true, _count: { select: { references: true } } } });
    return Response.json({ items: items.slice(0, 30), nextCursor: items.length > 30 ? items[29].id : null });
  } catch (error) { return errorResponse(error); }
}
