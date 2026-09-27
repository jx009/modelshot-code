import { prisma } from "../../../lib/prisma.js";
import { requireUser } from "../../../lib/require-user.js";
import { errorResponse } from "../../../lib/http.js";
import { usageSummary } from "../../../lib/domain/billing/ledger.js";

export async function GET(request) {
  try {
    const user = await requireUser();
    const page = Math.max(1, Math.min(10000, Number(new URL(request.url).searchParams.get("page")) || 1));
    const [usage, orders, transactions, subscriptions, subscriptionChanges] = await Promise.all([
      usageSummary(user.id),
      prisma.order.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20, skip: (page - 1) * 20, select: { id: true, planId: true, amountMinor: true, refundedMinor: true, currency: true, status: true, manualReview: true, receiptUrl: true, createdAt: true } }),
      prisma.creditTransaction.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30, skip: (page - 1) * 30, select: { id: true, type: true, channel: true, amount: true, tryOnId: true, reason: true, createdAt: true } }),
      prisma.subscription.findMany({ where: { userId: user.id }, orderBy: { periodEnd: "desc" }, take: 5, select: { id: true, planId: true, status: true, periodEnd: true, cancelAtPeriodEnd: true, scheduledPlanId: true } }),
      prisma.subscriptionChange.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, state: true, errorCode: true } }),
    ]);
    return Response.json({ usage, orders, transactions, subscriptions, subscriptionChanges, page }, { headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=15" } });
  } catch (error) { return errorResponse(error); }
}
