import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { imageRunSchema } from "@/lib/creation/contracts/runs";
import { createImageRun, presentRun } from "@/lib/domain/creation/runs";

export async function POST(request) {
  try {
    const user = await requireUser();
    await rateLimit("creation-run", user.id, 30, 600);
    const body = await readJson(request, imageRunSchema, 131072);
    return Response.json(await createImageRun(user.id, body, request.headers.get("Idempotency-Key")), { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function GET(request) {
  try {
    const user = await requireUser();
    const query = new URL(request.url).searchParams, documentId = query.get("documentId"), sessionId = query.get("sessionId");
    if (Boolean(documentId) === Boolean(sessionId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(documentId || sessionId)) throw new AppError("CREATION_SCOPE_REQUIRED");
    const runs = await prisma.creationRun.findMany({ where: { userId: user.id, ...(sessionId ? { sessionId } : { documentId }) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10,
      include: { steps: { orderBy: { position: "asc" } } },
    });
    return Response.json({ items: runs.map(presentRun) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
