import { proportionalMinor } from "./catalog.js";

export async function recordPaidCommission(tx, order) {
  const user = await tx.user.findUnique({ where: { id: order.userId } });
  if (!user?.inviterId || order.amountMinor <= 0) return;
  const inviter = await tx.user.findUnique({ where: { id: user.inviterId } });
  if (!inviter || inviter.status !== "active") return;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`commission:${inviter.id}`}, 0))::text`;
  const rateBps = Math.max(0, Math.min(10000, Math.round((inviter.agentCommissionRate ?? 0.1) * 10000)));
  await tx.inviteCommission.upsert({ where: { orderId: order.id }, update: {}, create: {
    inviterId: inviter.id, inviteeId: user.id, orderId: order.id, orderAmountMinor: order.amountMinor, rateBps,
    amountMinor: proportionalMinor(order.amountMinor, rateBps, 10000), currency: order.currency,
  } });
}

export async function reverseCommission(tx, order, refundedMinor) {
  const commission = await tx.inviteCommission.findUnique({ where: { orderId: order.id } });
  if (!commission) return;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`commission:${commission.inviterId}`}, 0))::text`;
  const current = await tx.inviteCommission.findUnique({ where: { id: commission.id } });
  const target = Math.min(current.amountMinor, proportionalMinor(current.amountMinor, refundedMinor, order.amountMinor));
  const delta = target - current.reversedMinor;
  if (delta <= 0) return;
  await tx.inviteCommission.update({ where: { id: current.id }, data: { reversedMinor: target,
    ...(current.status !== "settled" && target === current.amountMinor ? { status: "cancelled" } : {}) } });
  if (current.status === "settled") await tx.commissionAdjustment.create({ data: { inviterId: current.inviterId, commissionId: current.id,
    businessKey: `commission-refund:${current.id}:${target}`, amountMinor: -delta, currency: current.currency, reason: "payment_refund" } });
}
