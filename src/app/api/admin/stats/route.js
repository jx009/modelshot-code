import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/admin-auth";
import { readAdminStats } from "@/lib/server/admin-stats-cache";

/**
 * 数据看板统计
 * GET /api/admin/stats
 */
export async function GET(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const data = await readAdminStats(loadStats);
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[ADMIN_STATS]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

async function loadStats() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const day14Start = new Date(todayStart.getTime() - 13 * 24 * 3600 * 1000);
  const day14End = new Date(todayStart.getTime() + 24 * 3600 * 1000);

  const [totalUsers, totalTryonsCost, providerDist, statusDist,
         todayNewUsers, todayRevenue, todayTryonsCost, trendRaw, providerHealthRaw, needsReview] = await Promise.all([
    prisma.user.count(),
    prisma.tryOn.aggregate({ _count: { _all: true }, _sum: { costUsd: true } }),
    prisma.tryOn.groupBy({
      by: ["provider"],
      where: { provider: { not: null } },
      _count: { _all: true },
    }),
    prisma.tryOn.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.order.aggregate({ where: { currency: "usd", paidAt: { gte: todayStart } }, _sum: { amountMinor: true, refundedMinor: true } }),
    prisma.tryOn.aggregate({ where: { createTime: { gte: todayStart } }, _count: { _all: true }, _sum: { costUsd: true } }),
    prisma.$queryRaw`
      SELECT FLOOR((EXTRACT(EPOCH FROM "createTime") * 1000 - ${day14Start.getTime()}) / 86400000)::int AS "day",
        COUNT(*) FILTER (WHERE status = 'succeeded')::int AS success,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM "TryOn"
      WHERE "createTime" >= ${day14Start.toISOString()}::timestamp
        AND "createTime" < ${day14End.toISOString()}::timestamp
      GROUP BY 1
    `,
    prisma.tryOn.groupBy({
      by: ["provider", "status"],
      where: { provider: { not: null }, createTime: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
      _count: { _all: true },
      _avg: { durationMs: true },
    }),
    prisma.tryOn.count({ where: { qaStatus: "needs_review", reviewDecision: null } }),
  ]);

  const trendByDay = new Map(trendRaw.map(row => [row.day, row]));
  const trend = [];
  for (let i = 0; i < 14; i++) {
    const day = new Date(day14Start.getTime() + i * 24 * 3600 * 1000);
    const totals = trendByDay.get(i);
    trend.push({
      date: `${day.getMonth() + 1}/${day.getDate()}`,
      success: totals?.success ?? 0,
      failed: totals?.failed ?? 0,
    });
  }

  const providerMap = {};
  for (const row of providerHealthRaw) {
    const provider = providerMap[row.provider] || (providerMap[row.provider] = { provider: row.provider, count: 0, failed: 0, avgDurationMs: 0 });
    provider.count += row._count._all;
    if (row.status === "failed") provider.failed += row._count._all;
    provider.avgDurationMs += (row._avg.durationMs || 0) * row._count._all;
  }

  return {
    totalUsers,
    todayNewUsers,
    totalTryons: totalTryonsCost._count._all,
    todayTryons: todayTryonsCost._count._all,
    todayRevenue: ((todayRevenue._sum.amountMinor || 0) - (todayRevenue._sum.refundedMinor || 0)) / 100,
    todayCostUsd: Number((todayTryonsCost._sum.costUsd || 0).toFixed(4)),
    totalCostUsd: Number((totalTryonsCost._sum.costUsd || 0).toFixed(4)),
    needsReview,
    providerDistribution: providerDist.map(provider => ({ provider: provider.provider, count: provider._count._all })),
    statusDistribution: statusDist.map(status => ({ status: status.status, count: status._count._all })),
    trend,
    providerHealth: Object.values(providerMap).map(provider => ({ ...provider, avgDurationMs: Math.round(provider.avgDurationMs / provider.count) })),
  };
}
