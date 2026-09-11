import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/admin-auth";

/**
 * 成本利润（P1 方案 4.7）— 转售生图赚差价的定价决策依据
 * GET /api/admin/cost
 * - 月指标：本月收入（Order paid）/ 本月成本（costUsd）/ 毛利率 / 单张平均成本 vs 收入
 * - 30 天趋势：每日收入/成本/毛利率
 * - 通道对比：每 provider 调用量/成本占比/失败率
 * - 异常预警：单日成本环比 +50% 标记
 */
export async function GET(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const day30Start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 3600 * 1000);

    const [
      monthRevenue, monthCost, monthTryons, monthOrders,
      trendOrders, trendTryons,
      providerRaw, yesterdayCost, todayCost,
    ] = await Promise.all([
      // 本月收入（paid）
      prisma.order.aggregate({ where: { currency: "usd", paidAt: { gte: monthStart } }, _sum: { amountMinor: true, refundedMinor: true }, _count: true }),
      // 本月成本
      prisma.tryOn.aggregate({ where: { createTime: { gte: monthStart } }, _sum: { costUsd: true } }),
      // 本月生成量（计费口径：完成+待复查）
      prisma.tryOn.count({ where: { createTime: { gte: monthStart }, status: { in: ["succeeded"] } } }),
      // 本月订单数
      prisma.order.count({ where: { currency: "usd", paidAt: { gte: monthStart } } }),
      // 30 天订单（按天收入）
      prisma.order.findMany({ where: { currency: "usd", paidAt: { gte: day30Start } }, select: { paidAt: true, amountMinor: true, refundedMinor: true } }),
      // 30 天生成（按天成本）
      prisma.tryOn.findMany({ where: { createTime: { gte: day30Start } }, select: { createTime: true, costUsd: true, status: true, provider: true } }),
      // 通道对比（30 天）
      prisma.tryOn.groupBy({
        by: ["provider", "status"],
        where: { provider: { not: null }, createTime: { gte: day30Start } },
        _count: { _all: true },
        _sum: { costUsd: true },
      }),
      // 异常检测：昨日 vs 今日成本
      prisma.tryOn.aggregate({ where: { createTime: { gte: yesterdayStart, lt: todayStart } }, _sum: { costUsd: true } }),
      prisma.tryOn.aggregate({ where: { createTime: { gte: todayStart } }, _sum: { costUsd: true } }),
    ]);

    // ── 月指标 ──
    const revenue = ((monthRevenue._sum.amountMinor || 0) - (monthRevenue._sum.refundedMinor || 0)) / 100;
    const cost = Number((monthCost._sum.costUsd || 0).toFixed(4));
    const margin = revenue > 0 ? Number((((revenue - cost) / revenue) * 100).toFixed(1)) : null;
    // 单张口径：成本按实际生成张；收入按付费成功张（估算：收入/订单平均张数不可知，用 收入/生成张 为上界口径）
    const perImageCost = monthTryons > 0 ? Number((cost / monthTryons).toFixed(4)) : 0;
    const perImageRevenue = monthTryons > 0 ? Number((revenue / monthTryons).toFixed(4)) : 0;

    // ── 30 天趋势 ──
    const trend = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(day30Start.getTime() + i * 24 * 3600 * 1000);
      const next = new Date(d.getTime() + 24 * 3600 * 1000);
      const dayRevenue = trendOrders.filter(o => o.paidAt >= d && o.paidAt < next).reduce((s, o) => s + (o.amountMinor - o.refundedMinor) / 100, 0);
      const dayRows = trendTryons.filter(t => t.createTime >= d && t.createTime < next);
      const dayCost = Number(dayRows.reduce((s, t) => s + (t.costUsd || 0), 0).toFixed(4));
      trend.push({
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        revenue: Number(dayRevenue.toFixed(2)),
        cost: dayCost,
        margin: dayRevenue > 0 ? Number((((dayRevenue - dayCost) / dayRevenue) * 100).toFixed(1)) : null,
      });
    }

    // ── 通道对比 ──
    const providerMap = {};
    for (const row of providerRaw) {
      const p = providerMap[row.provider] || (providerMap[row.provider] = { provider: row.provider, count: 0, failed: 0, cost: 0 });
      p.count += row._count._all;
      if (row.status === "failed") p.failed += row._count._all;
      p.cost = Number(((p.cost || 0) + (row._sum.costUsd || 0)).toFixed(4));
    }
    const providers = Object.values(providerMap).map(p => ({
      ...p,
      costShare: cost > 0 ? Number(((p.cost / cost) * 100).toFixed(1)) : 0,
      failRate: p.count > 0 ? Number(((p.failed / p.count) * 100).toFixed(1)) : 0,
    })).sort((a, b) => b.cost - a.cost);

    // ── 异常预警：今日成本环比昨日 +50% ──
    const yCost = yesterdayCost._sum.costUsd || 0;
    const tCost = todayCost._sum.costUsd || 0;
    const costSurge = yCost > 0 && tCost > yCost * 1.5
      ? { level: "warn", message: `今日成本 $${tCost.toFixed(2)} 环比昨日 $${yCost.toFixed(2)} 上涨 ${Math.round(((tCost - yCost) / yCost) * 100)}%（检查 key 泄露/滥用）` }
      : null;

    return NextResponse.json({
      month: {
        revenue: Number(revenue.toFixed(2)),
        cost,
        margin,
        orderCount: monthRevenue._count,
        paidOrders: monthOrders,
        generatedImages: monthTryons,
        perImageCost,
        perImageRevenue,
      },
      trend,
      providers,
      costSurge,
    });
  } catch (error) {
    console.error("[ADMIN_COST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
