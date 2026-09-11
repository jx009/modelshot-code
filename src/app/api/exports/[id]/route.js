import { prisma } from "../../../../lib/prisma.js";
import { requireUser } from "../../../../lib/require-user.js";
import { AppError, errorResponse, sameOrigin } from "../../../../lib/http.js";

export async function GET(_request, context) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const job = await prisma.exportJob.findFirst({ where: { id, userId: user.id } });
    if (!job) throw new AppError("EXPORT_NOT_FOUND", 404);
    return Response.json(job);
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request, context) {
  try {
    const user = await requireUser();
    sameOrigin(request);
    const { id } = await context.params;
    const result = await prisma.exportJob.updateMany({ where: { id, userId: user.id, status: { in: ["queued", "running", "failed"] } }, data: { cancelRequestedAt: new Date() } });
    if (!result.count) throw new AppError("EXPORT_NOT_CANCELLABLE", 409);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
