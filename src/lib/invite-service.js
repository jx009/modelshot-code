import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "./prisma.js";
import { AppError } from "./http.js";

export function generateInviteCode() { return randomBytes(6).toString("hex").toUpperCase(); }
export async function ensureInviteCode(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { inviteCode: true } });
  if (user?.inviteCode) return user.inviteCode;
  const code = generateInviteCode();
  await prisma.user.updateMany({ where: { id: userId, inviteCode: null }, data: { inviteCode: code } });
  return (await prisma.user.findUnique({ where: { id: userId }, select: { inviteCode: true } })).inviteCode;
}

export async function bindInviter(inviteeId, refCode) {
  if (!refCode) return false;
  const inviter = await prisma.user.findUnique({ where: { inviteCode: String(refCode).trim().toUpperCase() }, select: { id: true, status: true } });
  if (!inviter || inviter.id === inviteeId || inviter.status !== "active") return false;
  const updated = await prisma.user.updateMany({ where: { id: inviteeId, inviterId: null }, data: { inviterId: inviter.id, invitedAt: new Date() } });
  return updated.count > 0;
}

export async function getAgentSummary(agentId) {
  const [invitees, paidCount, commissions, adjustments] = await Promise.all([
    prisma.user.count({ where: { inviterId: agentId } }),
    prisma.user.count({ where: { inviterId: agentId, orders: { some: { status: { in: ["paid", "partially_refunded"] } } } } }),
    prisma.inviteCommission.findMany({ where: { inviterId: agentId, currency: "usd" } }),
    prisma.commissionAdjustment.aggregate({ where: { inviterId: agentId, currency: "usd", settledAt: null }, _sum: { amountMinor: true } }),
  ]);
  return {
    inviteeCount: invitees, paidInviteeCount: paidCount, currency: "usd",
    totalOrderAmount: commissions.reduce((sum, row) => sum + row.orderAmountMinor, 0) / 100,
    pendingCommission: (commissions.filter(row => row.status === "pending").reduce((sum, row) => sum + row.amountMinor - row.reversedMinor, 0) + (adjustments._sum.amountMinor || 0)) / 100,
    settledCommission: commissions.filter(row => row.status === "settled").reduce((sum, row) => sum + row.amountMinor, 0) / 100,
  };
}

export async function settleCommission(agentId, operatorId, remark, key, db = prisma) {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key || "")) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  if (typeof remark !== "string" || remark.trim().length < 3 || remark.length > 500) throw new AppError("SETTLEMENT_REASON_REQUIRED");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`commission:${agentId}`}, 0))::text`;
    const actor = await tx.user.findUnique({ where: { id: operatorId } });
    const agent = await tx.user.findUnique({ where: { id: agentId } });
    if (!actor || actor.status !== "active" || !["admin", "root"].includes(actor.role) || !agent || ["admin", "root"].includes(agent.role)) throw new AppError("ADMIN_SCOPE_DENIED", 403);
    const businessKey = `settlement:${operatorId}:${key}`;
    const old = await tx.agentCommissionSettlementLog.findUnique({ where: { businessKey } });
    if (old) {
      if (old.agentId !== agentId || old.remark !== remark) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return { amount: old.amountMinor / 100, count: old.settledRecordCount, pendingAfter: old.pendingMinorAfter / 100 };
    }
    const pending = await tx.inviteCommission.findMany({ where: { inviterId: agentId, status: "pending", currency: "usd" } });
    const adjustments = await tx.commissionAdjustment.findMany({ where: { inviterId: agentId, currency: "usd", settledAt: null } });
    const amountMinor = pending.reduce((sum, row) => sum + row.amountMinor - row.reversedMinor, 0) + adjustments.reduce((sum, row) => sum + row.amountMinor, 0);
    if (amountMinor <= 0) throw new AppError("NO_PAYABLE_COMMISSION", 409);
    const settledAt = new Date();
    await tx.inviteCommission.updateMany({ where: { id: { in: pending.map(row => row.id) }, status: "pending" }, data: { status: "settled", settledAt } });
    await tx.commissionAdjustment.updateMany({ where: { id: { in: adjustments.map(row => row.id) }, settledAt: null }, data: { settledAt } });
    await tx.agentCommissionSettlementLog.create({ data: { agentId, agentEmail: agent.email || "", agentName: agent.name, operatorId, remark, amountMinor, pendingMinorAfter: 0, settledRecordCount: pending.length, businessKey } });
    await tx.adminAuditLog.create({ data: { adminId: operatorId, action: "SETTLE_COMMISSION", targetUserId: agentId, detail: JSON.stringify({ amountMinor, currency: "usd", reason: remark, key }) } });
    return { amount: amountMinor / 100, count: pending.length, pendingAfter: 0 };
  });
}

export function commissionView(row) {
  return { ...row, orderAmount: row.orderAmountMinor / 100, commissionRate: row.rateBps / 10000, commissionAmount: (row.amountMinor - row.reversedMinor) / 100 };
}
