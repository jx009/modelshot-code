import { prisma } from "../../../../../lib/prisma.js";
import { requireAdmin } from "../../../../../lib/admin-auth.js";
import { AppError, errorResponse } from "../../../../../lib/http.js";
import { objectStorage } from "../../../../../lib/infra/storage/s3.js";

export async function GET(request, context) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;
    const { id } = await context.params;
    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset || asset.status !== "active") throw new AppError("ASSET_NOT_FOUND", 404);
    await prisma.adminAuditLog.create({ data: { adminId: auth.user.id, action: "READ_ASSET", targetUserId: asset.userId, detail: JSON.stringify({ assetId: id, reason: "generation_audit" }) } });
    return new Response(await objectStorage().get(asset.objectKey), { headers: { "Content-Type": asset.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return errorResponse(error); }
}
