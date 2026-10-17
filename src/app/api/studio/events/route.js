import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse } from "@/lib/http";
import { presentJob } from "@/lib/domain/studio/jobs";
import { createJobStream } from "@/lib/domain/studio/job-stream";
import { ACTIVE } from "@/lib/domain/generation/contracts";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request) {
  try {
    const user = await requireUser();
    const documentId = new URL(request.url).searchParams.get("documentId");
    const whereDocument = { id: documentId || "", userId: user.id, deletedAt: null };
    if (!documentId || !await prisma.studioDocument.findFirst({ where: whereDocument, select: { id: true } })) throw new AppError("DOCUMENT_NOT_FOUND", 404);
    await rateLimit("studio-events", user.id, 120, 600);
    const stream = createJobStream(async () => {
      if (!await prisma.studioDocument.findFirst({ where: whereDocument, select: { id: true } })) throw new Error("DOCUMENT_NOT_FOUND");
      const where = { userId: user.id, AND: [{ snapshot: { path: ["kind"], equals: "studio" } }, { snapshot: { path: ["documentId"], equals: documentId } }] };
      const [recent, active] = await Promise.all([
        prisma.tryOn.findMany({ where, orderBy: [{ createTime: "desc" }, { id: "desc" }], take: 100 }),
        prisma.tryOn.findMany({ where: { ...where, status: { in: ACTIVE } }, orderBy: [{ createTime: "desc" }, { id: "desc" }], take: 100 }),
      ]);
      return [...recent, ...active.filter(row => !recent.some(item => item.id === row.id))].map(presentJob);
    }, request.signal);
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive" } });
  } catch (error) { return errorResponse(error); }
}
