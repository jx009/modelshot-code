import { prisma } from "../../../lib/prisma.js";
import { requireUser } from "../../../lib/require-user.js";
import { AppError, errorResponse } from "../../../lib/http.js";
import { batchState } from "../../../lib/domain/generation/contracts.js";
export { POST } from "../tryon/route.js";

export async function GET(request) {
  try {
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const batch = await prisma.batchJob.findFirst({ where: { id, userId: user.id }, include: { tryons: { orderBy: { createTime: "asc" } } } });
      if (!batch) throw new AppError("JOB_NOT_FOUND", 404);
      return Response.json({ ...batch, ...batchState(batch.tryons) });
    }
    return Response.json(await prisma.batchJob.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }));
  } catch (error) { return errorResponse(error); }
}
