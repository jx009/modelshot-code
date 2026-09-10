import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { buildAuthOptions } from "@/lib/auth";
import { prisma } from "../../../lib/prisma";
import { ensureInviteCode, getAgentSummary } from "../../../lib/invite-service";

/**
 * 邀请中心（agent 及以上角色可见）
 * GET /api/invite          → 业绩汇总 + 邀请码 + 邀请明细
 * GET /api/invite?tab=commissions → 佣金明细
 */
export async function GET(req) {
  const session = await getServerSession(await buildAuthOptions());
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, status: true },
  });
  // 权限：agent / admin / root（user 不可见——制造升为流量手的动机）
  const LEVEL = { user: 0, agent: 1, admin: 2, root: 3 };
  if (!user || user.status === "banned" || (LEVEL[user.role] ?? 0) < 1) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const tab = searchParams.get("tab") || "overview";

  // 邀请码（懒生成）
  const inviteCode = await ensureInviteCode(session.user.id);

  if (tab === "commissions") {
    const commissions = await prisma.inviteCommission.findMany({
      where: { inviterId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, orderAmount: true, commissionRate: true, commissionAmount: true,
        status: true, settledAt: true, createdAt: true,
      },
    });
    return NextResponse.json({ inviteCode, commissions });
  }

  // 概览：业绩 + 邀请明细
  const [summary, invitees] = await Promise.all([
    getAgentSummary(session.user.id),
    prisma.user.findMany({
      where: { inviterId: session.user.id },
      orderBy: { invitedAt: "desc" },
      take: 50,
      select: {
        id: true, name: true, email: true, invitedAt: true,
        orders: { where: { status: "paid" }, select: { amount: true } },
      },
    }),
  ]);

  return NextResponse.json({
    inviteCode,
    summary,
    invitees: invitees.map(i => ({
      id: i.id,
      name: i.name,
      emailMasked: i.email ? i.email.replace(/^(.).*(@.*)$/, "$1***$2") : "",
      invitedAt: i.invitedAt,
      hasPaid: i.orders.length > 0,
      paidAmount: Number(i.orders.reduce((s, o) => s + o.amount, 0).toFixed(2)),
    })),
  });
}
