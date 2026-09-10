import crypto from "crypto";
import { prisma } from "./prisma";

/**
 * 分销服务（照搬 LetAiCode invite.service 机制）
 * - 邀请码：6 位随机，注册时生成，碰撞重试
 * - 绑定：?ref= 参数一次性绑定 inviterId，不可改绑
 * - 佣金：比例三级解析（个人 > 全局配置 > 兜底 0.10），记佣金时快照
 * - 结算：管理员手动，写 SettlementLog 快照
 */

const DEFAULT_COMMISSION_RATE = 0.1;

/** 生成 6 位随机邀请码（去掉易混淆字符） */
export function generateInviteCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(0, chars.length)];
  return code;
}

/** 确保用户有邀请码（懒生成，碰撞重试） */
export async function ensureInviteCode(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { inviteCode: true } });
  if (user?.inviteCode) return user.inviteCode;
  for (let i = 0; i < 5; i++) {
    const code = generateInviteCode();
    try {
      const updated = await prisma.user.update({ where: { id: userId }, data: { inviteCode: code }, select: { inviteCode: true } });
      return updated.inviteCode;
    } catch {
      // 碰撞重试
    }
  }
  throw new Error("Failed to generate unique invite code");
}

/** 邀请码绑定（一次性，不可改绑；防自我邀请） */
export async function bindInviter(inviteeId, refCode) {
  if (!refCode) return false;
  const invitee = await prisma.user.findUnique({ where: { id: inviteeId }, select: { inviterId: true } });
  if (invitee?.inviterId) return false; // 已绑定，不可改

  const inviter = await prisma.user.findUnique({ where: { inviteCode: String(refCode).trim().toUpperCase() }, select: { id: true, status: true } });
  if (!inviter || inviter.id === inviteeId || inviter.status === "banned") return false;

  await prisma.user.update({
    where: { id: inviteeId },
    data: { inviterId: inviter.id, invitedAt: new Date() },
  });
  return true;
}

/** 佣金比例三级解析：个人 > 全局 Option 表 > 兜底 */
export async function resolveCommissionRate(inviterId) {
  const inviter = await prisma.user.findUnique({ where: { id: inviterId }, select: { agentCommissionRate: true } });
  if (inviter?.agentCommissionRate != null) return inviter.agentCommissionRate;
  try {
    const opt = await prisma.option.findUnique({ where: { key: "commission_rate" } });
    if (opt) return parseFloat(opt.value);
  } catch { /* Option 表可能不存在，忽略 */ }
  return DEFAULT_COMMISSION_RATE;
}

/**
 * 记佣金（webhook checkout.session.completed 调用）
 * - 被邀请人无邀请人 → 跳过
 * - orderId unique 约束防重复（webhook 重放安全）
 * - 比例在记录时快照
 */
export async function recordCommission(inviteeId, orderId, orderAmount) {
  try {
    const invitee = await prisma.user.findUnique({ where: { id: inviteeId }, select: { inviterId: true } });
    if (!invitee?.inviterId) return null;

    const rate = await resolveCommissionRate(invitee.inviterId);
    const amount = Number((orderAmount * rate).toFixed(2));

    const commission = await prisma.inviteCommission.create({
      data: {
        inviterId: invitee.inviterId,
        inviteeId,
        orderId,
        orderAmount,
        commissionRate: rate,
        commissionAmount: amount,
        status: "pending",
      },
    });
    return commission;
  } catch (err) {
    // unique 冲突（重复 webhook）静默；其他记日志
    if (!String(err.message).includes("Unique constraint")) {
      console.error("[RecordCommission]", err.message);
    }
    return null;
  }
}

/** 流量手业绩汇总（邀请中心/管理页共用） */
export async function getAgentSummary(agentId) {
  const [invitees, paidInviteeIds, commissions] = await Promise.all([
    prisma.user.count({ where: { inviterId: agentId } }),
    prisma.user.findMany({ where: { inviterId: agentId }, select: { id: true } }),
    prisma.inviteCommission.findMany({
      where: { inviterId: agentId },
      select: { status: true, commissionAmount: true, orderAmount: true },
    }),
  ]);

  // 付费人数：有 paid 订单的被邀请人
  const paidCount = paidInviteeIds.length > 0
    ? (await prisma.order.groupBy({ by: ["userId"], where: { status: "paid", userId: { in: paidInviteeIds.map(u => u.id) } } })).length
    : 0;

  return {
    inviteeCount: invitees,
    paidInviteeCount: paidCount,
    totalOrderAmount: Number(commissions.reduce((s, c) => s + c.orderAmount, 0).toFixed(2)),
    pendingCommission: Number(commissions.filter(c => c.status === "pending").reduce((s, c) => s + c.commissionAmount, 0).toFixed(2)),
    settledCommission: Number(commissions.filter(c => c.status === "settled").reduce((s, c) => s + c.commissionAmount, 0).toFixed(2)),
  };
}

/**
 * 结算（管理员手动）：把某流量手全部 pending → settled，写结算日志快照
 * @returns 结算结果（金额/条数/结算后余额）
 */
export async function settleCommission(agentId, operatorId, remark) {
  const pending = await prisma.inviteCommission.findMany({
    where: { inviterId: agentId, status: "pending" },
    select: { id: true, commissionAmount: true },
  });
  if (pending.length === 0) throw new Error("No pending commissions");

  const amount = Number(pending.reduce((s, c) => s + c.commissionAmount, 0).toFixed(2));
  const ids = pending.map(c => c.id);

  // 结算人快照（邮箱/昵称）
  const agent = await prisma.user.findUnique({ where: { id: agentId }, select: { email: true, name: true } });

  await prisma.$transaction([
    // 批量置 settled
    prisma.inviteCommission.updateMany({
      where: { id: { in: ids } },
      data: { status: "settled", settledAt: new Date() },
    }),
    // 结算日志快照（邮箱/昵称定格，人走了账还在）
    prisma.agentCommissionSettlementLog.create({
      data: {
        agentId,
        agentEmail: agent?.email || "",
        agentName: agent?.name || null,
        amount,
        pendingCommissionAfter: 0, // 全部 pending 结清
        settledRecordCount: ids.length,
        remark: remark || null,
        operatorId,
      },
    }),
  ]);

  return { amount, count: ids.length, pendingAfter: 0 };
}
