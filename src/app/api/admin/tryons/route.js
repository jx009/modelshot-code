import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/admin-auth";
import { z } from "zod";
import { readJson, AppError, errorResponse } from "../../../../lib/http.js";
import { auditedOperation } from "../../../../lib/domain/identity/admin-operation.js";

/**
 * 生成记录审计
 * GET /api/admin/tryons?page=1&limit=20&status=needs_review|completed|failed|processing&provider=xxx&q=邮箱
 * needs_review 默认排最前
 */
export async function GET(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
    const status = searchParams.get("status");
    const provider = searchParams.get("provider");
    const q = searchParams.get("q")?.trim();

    const where = {
      ...(status === "needs_review" ? { qaStatus: "needs_review", reviewDecision: null } : status === "processing" ? { status: { in: ["queued", "running", "provider_pending", "reconciling"] } } : status ? { status: status === "completed" ? "succeeded" : status } : {}),
      ...(provider && { provider }),
      ...(q && { User: { OR: [{ email: { contains: q } }, { name: { contains: q } }] } }),
    };

    const [tryons, total, statusCounts, costAgg, avgDuration, succeeded, reviews] = await Promise.all([
      prisma.tryOn.findMany({
        where,
        include: {
          User: { select: { email: true, name: true } },
        },
        orderBy: [{ createTime: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.tryOn.count({ where }),
      prisma.tryOn.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.tryOn.aggregate({ where, _sum: { costUsd: true } }),
      prisma.tryOn.aggregate({ where: { ...where, status: "succeeded" }, _avg: { durationMs: true } }),
      prisma.tryOn.count({ where: { AND: [where, { status: "succeeded" }] } }),
      prisma.tryOn.count({ where: { qaStatus: "needs_review", reviewDecision: null } }),
    ]);

    // needs_review 优先排序（内存排序，MVP 数据量够用）
    const priority = { reconciling: 0, running: 1, queued: 2, failed: 3, succeeded: 4 };
    tryons.sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));

    return NextResponse.json({
      tryons: tryons.map(t => ({
        id: t.id,
        userEmail: t.User?.email,
        userName: t.User?.name,
        resultImage: t.deliveryAssetId || t.originalAssetId ? `/api/admin/assets/${t.deliveryAssetId || t.originalAssetId}` : null,
        clothesImage: t.snapshot?.garment?.id ? `/api/admin/assets/${t.snapshot.garment.id}` : null,
        prompt: t.prompt.slice(0, 200),
        status: t.status,
        qaStatus: t.qaStatus,
        provider: t.provider,
        costUsd: t.costUsd,
        qaScore: t.qaScore,
        qaFlags: t.qaFlags,
        platformSpec: t.platformSpec,
        pose: t.pose,
        camera: t.camera,
        lighting: t.lighting,
        durationMs: t.durationMs,
        createTime: t.createTime,
      })),
      total,
      // 当前筛选口径的聚合（成本/成功率/平均耗时）
      summary: {
        totalCostUsd: costAgg._sum.costUsd || 0,
        successRate: total > 0
          ? Math.round(succeeded / total * 100)
          : 0,
        avgDurationMs: Math.round(avgDuration._avg.durationMs || 0),
      },
      page,
      limit,
      statusCounts: [...statusCounts.map(s => ({ status: s.status, count: s._count._all })), { status: "needs_review", count: reviews }, { status: "completed", count: statusCounts.find(s => s.status === "succeeded")?._count._all || 0 }, { status: "processing", count: statusCounts.filter(s => ["queued", "running", "provider_pending", "reconciling", "cancel_requested"].includes(s.status)).reduce((sum, s) => sum + s._count._all, 0) }],
    });
  } catch (error) {
    console.error("[ADMIN_TRYONS_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

/**
 * 失败重试（管理员）— 用原始参数重跑，不重复计费（audit 留痕）
 * POST /api/admin/tryons { id }
 */
export async function POST(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;
  try {
    const input = await readJson(req, z.object({ id: z.string().min(1).max(128), reason: z.string().min(3).max(500) }).strict());
    const { id } = input;
    const output = await prisma.tryOn.findUnique({ where: { id } });
    if (!output) throw new AppError("JOB_NOT_FOUND", 404);
    if (!["queued", "reconciling", "provider_pending", "running"].includes(output.status)) throw new AppError("NEW_QUOTE_REQUIRED", 409);
    const key = req.headers.get("idempotency-key");
    await auditedOperation(auth.user.id, key, "RECOVER_JOB", input, async tx => {
      await tx.outboxEvent.create({ data: { kind: "generate", entityId: id, businessKey: `admin-recover:${auth.user.id}:${key}` } });
      return { audit: { outputId: id } };
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
