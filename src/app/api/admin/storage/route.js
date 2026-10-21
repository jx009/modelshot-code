import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { AppError, readJson, errorResponse } from "@/lib/http";
import { setSiteConfig, invalidateSiteConfig } from "@/lib/site-config";
import { auditedOperation } from "@/lib/domain/identity/admin-operation";
import { cosConfigSchema, cosConfigView, cosTargetId, getCosConfig, mergeCosConfig, requireCosCredentials } from "@/lib/infra/storage/cos-config";
import { cosError, testCosConnection } from "@/lib/infra/storage/cos";
import { cosPrimaryKeyFilters } from "@/lib/infra/storage/cos-primary";

const schema = z.object({ config: cosConfigSchema, reason: z.string().trim().min(3).max(500) }).strict();
const headers = { "Cache-Control": "private, no-store" };

export async function GET(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  try {
    const config = await getCosConfig();
    const mirrored = await prisma.asset.count({ where: { status: "active", OR: [
      ...cosPrimaryKeyFilters(),
      { deliveries: { some: { targetId: cosTargetId(config), variant: 0 } } },
    ] } });
    return Response.json({ config: cosConfigView(config), canManage: auth.user.role === "root", mirrored }, { headers });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(req) {
  const auth = await requireAdmin(req, "root");
  if (auth.response) return auth.response;
  try {
    const input = await readJson(req, schema);
    const result = await auditedOperation(auth.user.id, req.headers.get("idempotency-key"), "UPDATE_COS_DELIVERY", input, async tx => {
      // Read inside the transaction so blank secret fields preserve stored values.
      const previous = await getCosConfig(tx);
      const config = mergeCosConfig(input.config, previous);
      if (previous.bucket !== config.bucket || previous.region !== config.region) {
        const originals = await tx.asset.count({ where: { OR: cosPrimaryKeyFilters(), status: { not: "purged" } } });
        const uploads = await tx.assetUpload.count({ where: { OR: cosPrimaryKeyFilters() } });
        if (originals || uploads) throw new AppError("COS_PRIMARY_MIGRATION_REQUIRED", 409);
      }
      await setSiteConfig("cos_delivery", JSON.stringify(config), tx);
      return { audit: { ...cosConfigView(config), credentialsChanged: Boolean(input.config.secretId || input.config.secretKey) } };
    }, prisma, "root");
    invalidateSiteConfig();
    return Response.json(result, { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(req) {
  const auth = await requireAdmin(req, "root");
  if (auth.response) return auth.response;
  try {
    const input = await readJson(req, schema);
    const config = requireCosCredentials(mergeCosConfig(input.config, await getCosConfig()));
    await auditedOperation(auth.user.id, req.headers.get("idempotency-key"), "TEST_COS_DELIVERY", input, async () => ({ audit: { bucket: config.bucket, region: config.region, prefix: config.prefix } }), prisma, "root");
    return Response.json(await testCosConnection(config), { headers });
  } catch (error) { return errorResponse(error?.code ? cosError(error) : error); }
}
