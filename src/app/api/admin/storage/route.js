import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { AppError, readJson, errorResponse } from "@/lib/http";
import { setSiteConfig, invalidateSiteConfig } from "@/lib/site-config";
import { auditedOperation } from "@/lib/domain/identity/admin-operation";
import { cosConfigSchema, cosConfigView, cosTargetId, getCosConfig, mergeCosConfig, requireCosCredentials } from "@/lib/infra/storage/cos-config";
import { cosError, testCosConnection } from "@/lib/infra/storage/cos";
import { cosPrimaryKeyFilters } from "@/lib/infra/storage/cos-primary";
import { cancelMigration, getMigrationState, migrationView, startMigration } from "@/lib/domain/assets/cos-migration";

const schema = z.object({ config: cosConfigSchema, reason: z.string().trim().min(3).max(500) }).strict();
const migrationSchema = z.object({
  action: z.enum(["start", "cancel"]),
  bucket: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,61}-\d{5,20}$/).optional(),
  region: z.string().trim().regex(/^[a-z]{2}-[a-z]+(?:-[a-z]+)?(?:-\d)?$/).max(50).optional(),
  reason: z.string().trim().min(3).max(500),
}).strict();
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
    const migration = migrationView(await getMigrationState(), config);
    return Response.json({ config: cosConfigView(config), canManage: auth.user.role === "root", mirrored, migration }, { headers });
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
        // 有对象落在当前桶时不允许直接改配置：key 里的桶会被 primaryCos 判定为失效。
        // 界面应改用 /api/admin/storage/migration 启动在线迁移，由后台搬完再切换。
        if (originals || uploads) throw new AppError("COS_PRIMARY_MIGRATION_REQUIRED", 409);
      }
      await setSiteConfig("cos_delivery", JSON.stringify(config), tx);
      return { audit: { ...cosConfigView(config), credentialsChanged: Boolean(input.config.secretId || input.config.secretKey) } };
    }, prisma, "root");
    invalidateSiteConfig();
    return Response.json(result, { headers });
  } catch (error) { return errorResponse(error); }
}

/** 启动/取消换桶迁移。迁移期间线上配置不变，读路径继续走旧桶。 */
export async function PUT(req) {
  const auth = await requireAdmin(req, "root");
  if (auth.response) return auth.response;
  try {
    const input = await readJson(req, migrationSchema);
    if (input.action === "cancel") {
      const view = await cancelMigration();
      return Response.json({ migration: view }, { headers });
    }
    if (!input.bucket || !input.region) throw new AppError("COS_MIGRATION_TARGET_REQUIRED", 422);
    // 只登记迁移任务，复制由 worker 分批完成（数秒内开始），请求本身不做耗时的对象传输。
    const view = await startMigration({ bucket: input.bucket, region: input.region });
    return Response.json({ migration: view }, { headers });
  } catch (error) { return errorResponse(error?.code ? cosError(error) : error); }
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
