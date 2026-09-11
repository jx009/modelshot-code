import { z } from "zod";
import { AppError, readJson, errorResponse } from "../../../../lib/http.js";
import { auditedOperation } from "../../../../lib/domain/identity/admin-operation.js";
import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/admin-auth";
import { settleCommission, commissionView } from "../../../../lib/invite-service";

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
      return NextResponse.json({ commissions: commissions.map(commissionView), logs: logs.map(row => ({ ...row, amount: row.amountMinor / 100, pendingCommissionAfter: row.pendingMinorAfter / 100 })) });
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
      _sum: { amountMinor: true, reversedMinor: true },
      _count: { _all: true },
    });

    const adjustments = await prisma.commissionAdjustment.groupBy({ by: ["inviterId"], where: { inviterId: { in: agentIds }, settledAt: null }, _sum: { amountMinor: true } });
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
        pendingCommission: ((get("pending")?._sum.amountMinor || 0) - (get("pending")?._sum.reversedMinor || 0) + (adjustments.find(row => row.inviterId === a.id)?._sum.amountMinor || 0)) / 100,
        settledCommission: (get("settled")?._sum.amountMinor || 0) / 100,
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
  try {
    const auth = await requireAdmin(req);
    if (auth.response) return auth.response;
    const input = await readJson(req, z.object({ agentId: z.string().min(1).max(128), agentCommissionRate: z.number().min(0).max(1).optional(), agentNote: z.string().max(500).optional(), reason: z.string().min(3).max(500) }).strict());
    return Response.json(await auditedOperation(auth.user.id, req.headers.get("idempotency-key"), "UPDATE_AGENT", input, async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.agentId} FOR UPDATE`;
      const target = await tx.user.findUnique({ where: { id: input.agentId } });
      if (!target || !["user", "agent"].includes(target.role)) throw new AppError("ADMIN_SCOPE_DENIED", 403);
      await tx.user.update({ where: { id: target.id }, data: { agentCommissionRate: input.agentCommissionRate, agentNote: input.agentNote } });
      return { audit: { targetId: target.id, before: { rate: target.agentCommissionRate, note: target.agentNote }, after: input } };
    }));
  } catch (error) { return errorResponse(error); }
}

export async function POST(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const { agentId, remark } = await req.json();
    if (!agentId) return new NextResponse("Missing agentId", { status: 400 });

    const result = await settleCommission(agentId, auth.user.id, remark, req.headers.get("idempotency-key") || undefined);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[ADMIN_COMMISSIONS_SETTLE]", error);
    return new NextResponse(error.message || "Internal Error", { status: 500 });
  }
}
