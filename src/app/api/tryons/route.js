import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { requireUser } from "../../../lib/require-user.js";
import { AppError, errorResponse, readJson, sameOrigin } from "../../../lib/http.js";
import { ACTIVE, TERMINAL } from "../../../lib/domain/generation/contracts.js";

export async function GET(request) {
  try {
    const user = await requireUser();
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (id) {
      const item = await prisma.tryOn.findFirst({ where: { id, userId: user.id } });
      if (!item) throw new AppError("JOB_NOT_FOUND", 404);
      const quality = await prisma.processingStep.findUnique({ where: { entityId_kind: { entityId: id, kind: "qa" } } });
      return Response.json({ ...item, qualityReport: quality?.report || null });
    }
    const ids = params.get("ids")?.split(",").filter(Boolean).slice(0, 100);
    if (ids?.length) return Response.json(await prisma.tryOn.findMany({ where: { id: { in: ids }, userId: user.id } }));
    const status = params.get("status");
    const cursor = params.get("cursor");
    const limit = Math.max(1, Math.min(50, Number(params.get("limit")) || 24));
    const search = params.get("q")?.trim().slice(0, 100);
    const base = { userId: user.id, archivedAt: null,
      ...(params.get("projectId") ? { projectId: params.get("projectId") } : {}),
      ...(params.get("batchId") ? { batchJobId: params.get("batchId") } : {}),
      ...(search ? { OR: [{ sku: { contains: search, mode: "insensitive" } }, { id: { contains: search } }, { prompt: { contains: search, mode: "insensitive" } }] } : {}),
    };
    const where = { ...base, ...(status === "active" ? { status: { in: ACTIVE } } : status === "needs_review" ? { qaStatus: "needs_review" } : TERMINAL.includes(status) ? { status } : {}) };
    if (cursor && !await prisma.tryOn.findFirst({ where: { id: cursor, userId: user.id }, select: { id: true } })) throw new AppError("INVALID_CURSOR");
    const [rows, total, counts] = await Promise.all([
      prisma.tryOn.findMany({ where, orderBy: [{ createTime: "desc" }, { id: "desc" }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
      prisma.tryOn.count({ where }), prisma.tryOn.groupBy({ by: ["status"], where: base, _count: true }),
    ]);
    const items = rows.slice(0, limit);
    return Response.json({ items, total, counts, nextCursor: rows.length > limit ? items.at(-1).id : null });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request) {
  try {
    const user = await requireUser();
    const { id, decision } = await readJson(request, z.object({ id: z.string().max(128), decision: z.enum(["approved", "rejected", "unreviewed"]) }).strict());
    const changed = await prisma.tryOn.updateMany({ where: { id, userId: user.id, status: "succeeded" }, data: { reviewDecision: decision === "unreviewed" ? null : decision } });
    if (!changed.count) throw new AppError("OUTPUT_NOT_FOUND", 404);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request) {
  try {
    const user = await requireUser();
    sameOrigin(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new AppError("JOB_ID_REQUIRED");
    const changed = await prisma.tryOn.updateMany({ where: { id, userId: user.id, status: { in: TERMINAL } }, data: { archivedAt: new Date() } });
    if (!changed.count) throw new AppError("JOB_NOT_ARCHIVABLE", 409);
    return Response.json({ success: true });
  } catch (error) { return errorResponse(error); }
}
