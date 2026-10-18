import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse, readJson } from "@/lib/http";
import { documentSchema } from "@/lib/studio/tools";
import { saveDocument } from "@/lib/domain/studio/documents";
export async function GET(request) {
  try {
    const user = await requireUser(), query = new URL(request.url).searchParams;
    const paged = query.get("paged") === "1", search = (query.get("q") || "").trim().slice(0, 100);
    let cursor;
    if (query.get("cursor")) {
      try { cursor = JSON.parse(Buffer.from(query.get("cursor"), "base64url").toString()); } catch { throw new AppError("INVALID_CURSOR"); }
      if (typeof cursor?.id !== "string" || !Number.isFinite(Date.parse(cursor?.date))) throw new AppError("INVALID_CURSOR");
    }
    const limit = paged ? 24 : 100;
    const rows = await prisma.studioDocument.findMany({
      where: { userId: user.id, deletedAt: query.get("kind") === "trash" ? { not: null } : null, ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
        ...(["commerce", "canvas"].includes(query.get("kind")) ? { kind: query.get("kind") } : {}),
        ...(cursor ? { OR: [{ updatedAt: { lt: new Date(cursor.date) } }, { updatedAt: new Date(cursor.date), id: { lt: cursor.id } }] } : {}),
      }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: limit + 1,
      select: { id: true, name: true, version: true, nameSource: true, updatedAt: true, kind: true, coverAssetId: true, itemCount: true },
    });
    const items = rows.slice(0, limit).map(({ itemCount, ...row }) => ({ ...row, count: itemCount })), last = items.at(-1);
    return Response.json(paged ? { items, nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ date: last.updatedAt, id: last.id })).toString("base64url") : null } : items);
  } catch (error) { return errorResponse(error); }
}
export async function POST(request) {
  const started = Date.now();
  try { const user = await requireUser(); return Response.json(await saveDocument(user.id, await readJson(request, documentSchema, 4194304))); }
  catch (error) {
    const response = errorResponse(error);
    const { traceId } = await response.clone().json();
    // Correlate the browser error with server logs without logging canvas content or credentials.
    console.warn(JSON.stringify({ event: "studio.document.save.failed", traceId, status: response.status, durationMs: Date.now() - started,
      errorType: error?.name, databaseCode: /^P\d{4}$/.test(error?.code || "") ? error.code : undefined }));
    return response;
  }
}
