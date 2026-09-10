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
      prisma.order.aggregate({ where: { status: "paid" }, _sum: { amount: true } }),
      prisma.order.aggregate({
        where: { status: "paid", paidAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } },
        _sum: { amount: true },
      }),
      prisma.order.aggregate({ where: { status: "refunded" }, _sum: { amount: true } }),
    ]);

    // 漏单提示：pending 超过 24h（webhook 没吃到的）
    const stalePending = await prisma.order.count({
      where: { status: "pending", createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } },
    });

    return NextResponse.json({
      orders,
      total,
      page,
      pageSize,
      summary: {
        totalRevenue: aggAll._sum.amount || 0,
        monthRevenue: aggMonth._sum.amount || 0,
        totalRefunded: aggRefund._sum.amount || 0,
        stalePending,
      },
    });
  } catch (error) {
    console.error("[ADMIN_ORDERS_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
