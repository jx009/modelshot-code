import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse, sameOrigin } from "@/lib/http";
import { presentJob } from "@/lib/domain/studio/jobs";
import { cancelOutput } from "@/lib/domain/generation/execution";
async function owned(userId, id) {
  const job = await prisma.tryOn.findFirst({ where: { id, userId, snapshot: { path: ["kind"], equals: "studio" } } });
  if (!job) throw new AppError("JOB_NOT_FOUND", 404);
  return job;
}
export async function GET(_request, context) {
  try { const user = await requireUser(); const { id } = await context.params; return Response.json(presentJob(await owned(user.id, id))); }
  catch (error) { return errorResponse(error); }
}
export async function DELETE(request, context) {
  try { sameOrigin(request); const user = await requireUser(); const { id } = await context.params; await owned(user.id, id); return Response.json(await cancelOutput(user.id, id)); }
  catch (error) { return errorResponse(error); }
}

