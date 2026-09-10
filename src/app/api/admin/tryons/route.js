import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin, auditLog } from "../../../../lib/admin-auth";

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
      ...(status && { status }),
      ...(provider && { provider }),
      ...(q && { User: { OR: [{ email: { contains: q } }, { name: { contains: q } }] } }),
    };

    const [tryons, total, statusCounts, costAgg, avgDuration] = await Promise.all([
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
      prisma.tryOn.aggregate({ where: { ...where, status: "completed" }, _avg: { durationMs: true } }),
    ]);

    // needs_review 优先排序（内存排序，MVP 数据量够用）
    const priority = { needs_review: 0, processing: 1, failed: 2, completed: 3 };
    tryons.sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));

    return NextResponse.json({
      tryons: tryons.map(t => ({
        id: t.id,
        userEmail: t.User?.email,
        userName: t.User?.name,
        resultImage: t.resultImage,
        clothesImage: t.clothesImage,
        prompt: t.prompt.slice(0, 200),
        status: t.status,
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
          ? Math.round(((statusCounts.find(c => c.status === "completed")?._count._all || 0) + (statusCounts.find(c => c.status === "needs_review")?._count._all || 0)) / total * 100)
          : 0,
        avgDurationMs: Math.round(avgDuration._avg.durationMs || 0),
      },
      page,
      limit,
      statusCounts: statusCounts.map(s => ({ status: s.status, count: s._count._all })),
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
    const { id } = await req.json();
    const t = await prisma.tryOn.findUnique({ where: { id } });
    if (!t) return new NextResponse("Not found", { status: 404 });
    if (t.status !== "failed") {
      return new NextResponse("Only failed tryons can be retried", { status: 400 });
    }

    const { generateOne } = await import("../../../../lib/generation");
    // 重置状态并后台重跑（原始 prompt/图/通道参数）
    await prisma.tryOn.update({ where: { id }, data: { status: "processing" } });
    generateOne(id, {
      garmentImage: t.clothesImage,
      modelRef: t.personImage || null,
      prompt: t.prompt,
      size: "1024x1536",
      quality: "high",
    }).catch(err => console.error(`[Retry ${id}]`, err));

    await auditLog(auth.user.id, "RETRY_TRYON", t.userId, { tryonId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ADMIN_TRYONS_RETRY]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
