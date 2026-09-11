import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/admin-auth";

/**
 * 订单管理
 * GET /api/admin/orders?status=&type=&userId=&q=&page=
 * 返回：订单列表（含用户信息）+ 汇总（总收入/本月/退款合计）
 */
export async function GET(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "";
    const type = searchParams.get("type") || "";
    const userId = searchParams.get("userId") || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = 20;

    const where = {
      ...(status && { status }),
      ...(type && { type }),
      ...(userId && { userId }),
    };

    const [orders, total, aggAll, aggMonth, aggRefund] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          User: { select: { email: true, name: true, image: true } },
        },
      }),
      prisma.order.count({ where }),
      prisma.order.aggregate({ where: { currency: "usd", paidAt: { not: null } }, _sum: { amountMinor: true, refundedMinor: true } }),
      prisma.order.aggregate({
        where: { currency: "usd", paidAt: { gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)) } },
        _sum: { amountMinor: true, refundedMinor: true },
      }),
      prisma.order.aggregate({ where: { currency: "usd" }, _sum: { refundedMinor: true } }),
    ]);

    // 漏单提示：pending 超过 24h（webhook 没吃到的）
    const stalePending = await prisma.order.count({
      where: { status: "pending", createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } },
    });

    return NextResponse.json({
      orders: orders.map(order => ({ ...order, amount: order.amountMinor / 100 })),
      total,
      page,
      pageSize,
      summary: {
        totalRevenue: ((aggAll._sum.amountMinor || 0) - (aggAll._sum.refundedMinor || 0)) / 100,
        monthRevenue: ((aggMonth._sum.amountMinor || 0) - (aggMonth._sum.refundedMinor || 0)) / 100,
        totalRefunded: (aggRefund._sum.refundedMinor || 0) / 100,
        stalePending,
      },
    });
  } catch (error) {
    console.error("[ADMIN_ORDERS_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
