import { z } from "zod";
import { prisma } from "../../../../lib/prisma.js";
import { requireAdmin } from "../../../../lib/admin-auth.js";
import { errorResponse, readJson } from "../../../../lib/http.js";
import { operationalSnapshot } from "../../../../lib/domain/operations.js";
import { billingOperation } from "../../../../lib/domain/billing/operations.js";

export async function GET(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;
    const [state, events, orders, refunds, audit, subscriptionChanges] = await Promise.all([
      operationalSnapshot(),
      prisma.paymentEvent.findMany({ where: { state: { not: "processed" } }, orderBy: { receivedAt: "desc" }, take: 50, select: { id: true, type: true, state: true, errorCode: true, attempts: true, receivedAt: true } }),
      prisma.order.findMany({ where: { OR: [{ manualReview: true }, { status: { in: ["paid", "partially_refunded"] } }] }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, amountMinor: true, refundedMinor: true, currency: true, status: true, manualReview: true } }),
      prisma.refundRequest.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 30, select: { id: true, adminId: true, action: true, detail: true, createdAt: true } }),
      prisma.subscriptionChange.findMany({ where: { state: { in: ["review", "pending", "failed"] } }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    return Response.json({ ...state, events, orders, refunds, audit, subscriptionChanges });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request) {
  try {
    const auth = await requireAdmin(request, "root");
    if (auth.response) return auth.response;
    const input = await readJson(request, z.object({ action: z.enum(["refund", "resolve_review", "replay_payment", "compensate", "resolve_refund_request", "resolve_subscription_change"]), id: z.string().min(1).max(128), amountMinor: z.number().int().positive().optional(), outcome: z.enum(["done", "failed"]).optional(), reference: z.string().min(3).max(500).optional(), reason: z.string().min(3).max(500) }).strict());
    return Response.json(await billingOperation(auth.user.id, request.headers.get("idempotency-key"), input));
  } catch (error) { return errorResponse(error); }
}
