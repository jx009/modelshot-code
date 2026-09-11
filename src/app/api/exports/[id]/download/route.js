import { prisma } from "../../../../../lib/prisma.js";
import { requireUser } from "../../../../../lib/require-user.js";
import { AppError, errorResponse } from "../../../../../lib/http.js";
import { objectStorage } from "../../../../../lib/infra/storage/s3.js";

export async function GET(_request, context) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const job = await prisma.exportJob.findFirst({ where: { id, userId: user.id } });
    if (!job) throw new AppError("EXPORT_NOT_FOUND", 404);
    if (!job.objectKey || !["succeeded", "partial_success"].includes(job.status)) throw new AppError("EXPORT_NOT_READY", 409);
    if (job.expiresAt <= new Date()) throw new AppError("EXPORT_EXPIRED", 410);
    return new Response(await objectStorage().get(job.objectKey), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="modelshot-${id}.zip"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return errorResponse(error); }
}
