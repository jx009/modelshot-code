import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/admin-auth";

/**
 * 数据看板统计
 * GET /api/admin/stats
 */
export async function GET(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const day14Start = new Date(todayStart.getTime() - 13 * 24 * 3600 * 1000);
    const day14End = new Date(todayStart.getTime() + 24 * 3600 * 1000);

    const [totalUsers, totalTryons, todayTryons, providerDist, statusDist, costAgg,
           todayNewUsers, todayRevenue, todayCost, trendRaw, providerHealthRaw] = await Promise.all([
      prisma.user.count(),
      prisma.tryOn.count(),
      prisma.tryOn.count({ where: { createTime: { gte: todayStart } } }),
      prisma.tryOn.groupBy({
        by: ["provider"],
        where: { provider: { not: null } },
        _count: { _all: true },
      }),
      prisma.tryOn.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.tryOn.aggregate({ _sum: { costUsd: true } }),
      // 今日新增用户（User 模型无注册时间字段——P1 补 createdAt 后启用，先占位 0）
      0,
      // 今日收入（paid 订单）
      prisma.order.aggregate({ where: { status: "paid", paidAt: { gte: todayStart } }, _sum: { amount: true } }),
      // 今日成本
      prisma.tryOn.aggregate({ where: { createTime: { gte: todayStart } }, _sum: { costUsd: true } }),
      // 14 天趋势（按天聚合成功/失败）
      prisma.tryOn.findMany({
        where: { createTime: { gte: day14Start, lt: day14End } },
        select: { createTime: true, status: true },
      }),
      // 通道健康（近 24h：调用量/失败数/平均耗时）
      prisma.tryOn.groupBy({
        by: ["provider", "status"],
        where: { provider: { not: null }, createTime: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
        _count: { _all: true },
        _avg: { durationMs: true },
      }),
    ]);

    const needsReview = statusDist.find(s => s.status === "needs_review")?._count?._all || 0;

    // 14 天趋势整理
    const trend = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(day14Start.getTime() + i * 24 * 3600 * 1000);
      const next = new Date(d.getTime() + 24 * 3600 * 1000);
      const rows = trendRaw.filter(t => t.createTime >= d && t.createTime < next);
      trend.push({
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        success: rows.filter(t => t.status === "completed" || t.status === "needs_review").length,
        failed: rows.filter(t => t.status === "failed").length,
      });
    }

    // 通道健康整理
    const providerMap = {};
    for (const row of providerHealthRaw) {
      const p = providerMap[row.provider] || (providerMap[row.provider] = { provider: row.provider, count: 0, failed: 0, avgDurationMs: 0 });
      p.count += row._count._all;
      if (row.status === "failed") p.failed += row._count._all;
      if (row._avg.durationMs) p.avgDurationMs = Math.round(row._avg.durationMs);
    }

    return NextResponse.json({
      totalUsers,
      todayNewUsers,
      totalTryons,
      todayTryons,
      todayRevenue: todayRevenue._sum.amount || 0,
      todayCostUsd: Number((todayCost._sum.costUsd || 0).toFixed(4)),
      totalCostUsd: Number((costAgg._sum.costUsd || 0).toFixed(4)),
      needsReview,
      providerDistribution: providerDist.map(p => ({ provider: p.provider, count: p._count._all })),
      statusDistribution: statusDist.map(s => ({ status: s.status, count: s._count._all })),
      trend,
      providerHealth: Object.values(providerMap),
    });
  } catch (error) {
    console.error("[ADMIN_STATS]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
