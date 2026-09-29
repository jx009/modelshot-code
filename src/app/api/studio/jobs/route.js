import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse, readJson } from "@/lib/http";
import { jobSchema } from "@/lib/studio/tools";
import { submitStudioJob, presentJob } from "@/lib/domain/studio/jobs";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { ACTIVE } from "@/lib/domain/generation/contracts";
export async function POST(request) {
  try {
    const user = await requireUser();
    await rateLimit("studio-jobs", user.id, 60, 600);
    return Response.json(await submitStudioJob(user.id, await readJson(request, jobSchema), request.headers.get("Idempotency-Key")), { status: 202 });
  } catch (error) { return errorResponse(error); }
}
export async function GET(request) {
  try {
    const user = await requireUser();
    const query = new URL(request.url).searchParams, documentId = query.get("documentId");
    const where = { userId: user.id, AND: [{ snapshot: { path: ["kind"], equals: "studio" } }, ...(documentId ? [{ snapshot: { path: ["documentId"], equals: documentId } }] : [])] };
    if (query.get("paged") === "1") {
      let cursor;
      if (query.get("cursor")) {
        try { cursor = JSON.parse(Buffer.from(query.get("cursor"), "base64url").toString()); } catch { throw new AppError("INVALID_CURSOR"); }
        if (typeof cursor?.id !== "string" || !Number.isFinite(Date.parse(cursor.date))) throw new AppError("INVALID_CURSOR");
      }
      const rows = await prisma.tryOn.findMany({ where: { ...where, ...(cursor ? { OR: [{ createTime: { lt: new Date(cursor.date) } }, { createTime: new Date(cursor.date), id: { lt: cursor.id } }] } : {}) }, orderBy: [{ createTime: "desc" }, { id: "desc" }], take: 31 });
      const items = rows.slice(0, 30), last = items.at(-1);
      return Response.json({ items: items.map(presentJob), nextCursor: rows.length > 30 ? Buffer.from(JSON.stringify({ date: last.createTime, id: last.id })).toString("base64url") : null });
    }
    const [recent, active] = await Promise.all([
      prisma.tryOn.findMany({ where, orderBy: { createTime: "desc" }, take: 100 }),
      prisma.tryOn.findMany({ where: { ...where, status: { in: ACTIVE } }, orderBy: { createTime: "desc" }, take: 100 }),
    ]);
    const jobs = [...recent, ...active.filter(row => !recent.some(job => job.id === row.id))];
    if (documentId && new URL(request.url).searchParams.get("recover") === "1") {
      const applied = await prisma.studioAppliedResult.findMany({ where: { documentId, document: { userId: user.id, deletedAt: null } }, select: { jobId: true } });
      const missing = await prisma.tryOn.findMany({ where: { ...where, status: "succeeded", id: { notIn: applied.map(row => row.jobId) } }, orderBy: { createTime: "asc" }, take: 100 });
      return Response.json([...jobs, ...missing.filter(row => !jobs.some(job => job.id === row.id))].map(presentJob));
    }
    return Response.json(jobs.map(presentJob));
  } catch (error) { return errorResponse(error); }
}
