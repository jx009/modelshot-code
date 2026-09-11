import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";

export const CREDIT_PRICE = 18;
export const PRICE_VERSION = "2026-09-v1";

export async function lockUser(tx, userId) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "active") throw new AppError("ACCOUNT_UNAVAILABLE", 403);
  return user;
}

export function freeCycle(userId, now = new Date()) {
  const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { id: `free:${userId}:${startsAt.toISOString().slice(0, 7)}`, userId, plan: "free", startsAt, endsAt, quota: 10 };
}

export async function activeCycle(tx, userId, now = new Date(), create = false) {
  const paid = await tx.billingCycle.findFirst({ where: { userId, plan: { not: "free" }, status: "active", startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { startsAt: "desc" } });
  if (paid) return paid;
  const free = freeCycle(userId, now);
  if (create) return tx.billingCycle.upsert({ where: { id: free.id }, create: free, update: {} });
  return await tx.billingCycle.findUnique({ where: { id: free.id } }) || { ...free, used: 0, reserved: 0 };
}

export async function usageSummary(userId, db = prisma) {
  const [user, cycle, held, frozen] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { credits: true } }),
    activeCycle(db, userId),
    db.creditReservation.aggregate({ where: { userId, state: "held", channel: "credits" }, _sum: { amount: true } }),
    db.creditLot.aggregate({ where: { userId, frozen: true }, _sum: { remaining: true, reserved: true } }),
  ]);
  const reservedCredits = held._sum.amount || 0;
  const frozenCredits = (frozen._sum.remaining || 0) - (frozen._sum.reserved || 0);
  return { plan: cycle.plan, planName: cycle.plan, monthlyQuota: cycle.quota, monthUsage: cycle.used, reservedQuota: cycle.reserved,
    remaining: Math.max(0, cycle.quota - cycle.used - cycle.reserved), credits: (user?.credits || 0) - reservedCredits - frozenCredits, frozenCredits,
    totalCredits: user?.credits || 0, reservedCredits, cycleId: cycle.id, cycleStartsAt: cycle.startsAt, cycleEndsAt: cycle.endsAt };
}

export async function settleReservation(tx, output, action) {
  const reservation = await tx.creditReservation.findUnique({ where: { tryOnId: output.id } });
  if (!reservation || reservation.state !== "held") return false;
  const capture = action === "capture";
  const changed = await tx.creditReservation.updateMany({ where: { id: reservation.id, state: "held" }, data: { state: capture ? "captured" : "released" } });
  if (!changed.count) return false;
  for (const allocation of reservation.allocations || []) {
    await tx.creditLot.update({ where: { id: allocation.lotId }, data: { reserved: { decrement: allocation.amount }, ...(capture ? { remaining: { decrement: allocation.amount } } : {}) } });
  }
  if (reservation.channel === "subscription") {
    await tx.billingCycle.update({ where: { id: reservation.cycleId }, data: { reserved: { decrement: 1 }, ...(capture ? { used: { increment: 1 } } : {}) } });
  } else if (capture && reservation.channel === "credits") {
    const changedBalance = await tx.user.updateMany({ where: { id: output.userId, credits: { gte: reservation.amount } }, data: { credits: { decrement: reservation.amount } } });
    if (!changedBalance.count) throw new Error("Reservation conservation failure");
  }
  const transaction = await tx.creditTransaction.create({ data: {
    userId: output.userId, tryOnId: output.id, type: capture ? "consume" : "release", channel: reservation.channel,
    amount: capture ? -reservation.amount : 0, cycleId: reservation.cycleId, businessKey: `${action}:${reservation.id}`, reason: action,
  } });
  if (capture) await tx.creditReservation.update({ where: { id: reservation.id }, data: { sourceTransactionId: transaction.id } });
  return true;
}

export async function compensateOutput(userId, outputId, reason, db = prisma) {
  return db.$transaction(tx => compensateInTransaction(tx, userId, outputId, reason));
}

export async function compensateInTransaction(tx, userId, outputId, reason) {
    await lockUser(tx, userId);
    const reservation = await tx.creditReservation.findFirst({ where: { tryOnId: outputId, userId } });
    if (!reservation || reservation.state !== "captured") throw new AppError("NOT_CAPTURED", 409);
    const businessKey = `refund:${reservation.id}`;
    const old = await tx.creditTransaction.findUnique({ where: { businessKey } });
    if (old) return old;
    if (reservation.channel === "credits") await tx.user.update({ where: { id: userId }, data: { credits: { increment: reservation.amount } } });
    for (const allocation of reservation.allocations || []) await tx.creditLot.update({ where: { id: allocation.lotId }, data: { remaining: { increment: allocation.amount } } });
    if (reservation.channel === "subscription") await tx.billingCycle.update({ where: { id: reservation.cycleId }, data: { used: { decrement: 1 } } });
    return tx.creditTransaction.create({ data: { userId, tryOnId: outputId, type: "refund", channel: reservation.channel, amount: reservation.amount,
      cycleId: reservation.cycleId, sourceTransactionId: reservation.sourceTransactionId, businessKey, reason } });
}

export async function reserveCreditLots(tx, user, amount) {
  if (!amount) return [];
  const lots = await tx.creditLot.findMany({ where: { userId: user.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const unassigned = user.credits - lots.reduce((sum, lot) => sum + lot.remaining, 0);
  if (unassigned > 0) lots.push(await tx.creditLot.create({ data: { userId: user.id, remaining: unassigned } }));
  const allocations = [];
  let need = amount;
  for (const lot of lots) {
    if (lot.frozen) continue;
    const take = Math.min(need, lot.remaining - lot.reserved);
    if (take <= 0) continue;
    await tx.creditLot.update({ where: { id: lot.id }, data: { reserved: { increment: take } } });
    allocations.push({ lotId: lot.id, amount: take });
    need -= take;
    if (!need) break;
  }
  if (need) throw new AppError("INSUFFICIENT_CREDITS", 402);
  return allocations;
}
