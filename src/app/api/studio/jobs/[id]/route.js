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
  try {
    const user = await requireUser(), { id } = await context.params, row = await owned(user.id, id);
    const snapshot = row.snapshot;
    // Only caller-owned, user-supplied input is exposed. Provider credentials,
    // base URLs and private adapter parameters remain server-only.
    const input = new URL(_request.url).searchParams.get("inputs") === "1" ? { tool: snapshot.tool, provider: snapshot.tool === "video" ? snapshot.videoProvider : snapshot.provider, assetId: snapshot.assetId, referenceAssetIds: snapshot.referenceAssetIds || [], params: snapshot.params } : undefined;
    if (input && input.tool !== "video") input.referenceAssets = await prisma.asset.findMany({ where: { id: { in: [input.assetId, ...input.referenceAssetIds].filter(Boolean) }, userId: user.id, status: "active", contentType: { startsWith: "image/" } }, select: { id: true, width: true, height: true } });
    return Response.json({ ...presentJob(row), ...(input ? { input } : {}) }, { headers: { "Cache-Control": "private, no-store" } });
  }
  catch (error) { return errorResponse(error); }
}
export async function DELETE(request, context) {
  try { sameOrigin(request); const user = await requireUser(); const { id } = await context.params; await owned(user.id, id); return Response.json(await cancelOutput(user.id, id)); }
  catch (error) { return errorResponse(error); }
}

