import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin, auditLog, ROLE_LEVEL } from "../../../../lib/admin-auth";
import { settleCommission } from "../../../../lib/invite-service";

/**
 * 分销佣金管理（admin 及以上）
 * GET   /api/admin/commissions                → 流量手列表（业绩汇总）
 * GET   /api/admin/commissions?agentId=xxx    → 单个流量手的佣金明细
 * PATCH /api/admin/commissions { agentId, agentCommissionRate?, agentNote? } → 改比例/备注
 * POST  /api/admin/commissions { agentId, remark? } → 结算（pending → settled + 日志）
 */
export async function GET(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get("agentId");

    // 单个流量手：佣金明细
    if (agentId) {
      const [commissions, logs] = await Promise.all([
        prisma.inviteCommission.findMany({
          where: { inviterId: agentId },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        prisma.agentCommissionSettlementLog.findMany({
          where: { agentId },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
      ]);
      return NextResponse.json({ commissions, logs });
    }

    // 列表：正式流量手（role=agent）或有邀请下线的用户（inviterId 标量聚合，无 self-relation）
    const [agentsRaw, inviteeCounts] = await Promise.all([
      prisma.user.findMany({
        where: { role: "agent" },
        select: { id: true, email: true, name: true, role: true, agentCommissionRate: true, agentNote: true },
        orderBy: { id: "desc" },
        take: 200,
      }),
      prisma.user.groupBy({ by: ["inviterId"], where: { inviterId: { not: null } }, _count: { _all: true } }),
    ]);
    const inviteeCountMap = Object.fromEntries(inviteeCounts.map(r => [r.inviterId, r._count._all]));

    // 每人佣金聚合
    const agentIds = agentsRaw.map(a => a.id);
    const commissionAgg = await prisma.inviteCommission.groupBy({
      by: ["inviterId", "status"],
      where: { inviterId: { in: agentIds } },
      _sum: { commissionAmount: true },
      _count: { _all: true },
    });

    const agents = agentsRaw.map(a => {
      const rows = commissionAgg.filter(c => c.inviterId === a.id);
      const get = (status) => rows.find(r => r.status === status);
      return {
        id: a.id,
        email: a.email,
        name: a.name,
        role: a.role,
        agentCommissionRate: a.agentCommissionRate,
        agentNote: a.agentNote,
        inviteeCount: inviteeCountMap[a.id] || 0,
        pendingCommission: Number((get("pending")?._sum.commissionAmount || 0).toFixed(2)),
        settledCommission: Number((get("settled")?._sum.commissionAmount || 0).toFixed(2)),
        cancelledCount: get("cancelled")?._count._all || 0,
      };
    }); // role=agent 已过滤

    return NextResponse.json({ agents });
  } catch (error) {
    console.error("[ADMIN_COMMISSIONS_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function PATCH(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const { agentId, agentCommissionRate, agentNote } = await req.json();
    if (!agentId) return new NextResponse("Missing agentId", { status: 400 });

    // 全局成本结构变更（个人比例）放 admin；比例范围 0-1
    if (agentCommissionRate !== undefined) {
      const r = parseFloat(agentCommissionRate);
      if (isNaN(r) || r < 0 || r > 1) return new NextResponse("Invalid rate (0-1)", { status: 400 });
      await prisma.user.update({ where: { id: agentId }, data: { agentCommissionRate: r } });
      await auditLog(auth.user.id, "SET_AGENT_RATE", agentId, { rate: r });
    }
    if (agentNote !== undefined) {
      await prisma.user.update({ where: { id: agentId }, data: { agentNote: agentNote || null } });
      await auditLog(auth.user.id, "SET_AGENT_NOTE", agentId, {});
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ADMIN_COMMISSIONS_PATCH]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function POST(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const { agentId, remark } = await req.json();
    if (!agentId) return new NextResponse("Missing agentId", { status: 400 });

    const result = await settleCommission(agentId, auth.user.id, remark);
    await auditLog(auth.user.id, "SETTLE_COMMISSION", agentId, { amount: result.amount, count: result.count, remark });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[ADMIN_COMMISSIONS_SETTLE]", error);
    return new NextResponse(error.message || "Internal Error", { status: 500 });
  }
}
