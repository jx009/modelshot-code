import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { auditedOperation } from "../identity/admin-operation.js";
import { proportionalMinor } from "./catalog.js";
import { compensateInTransaction } from "./ledger.js";
import { processRefund } from "./payments.js";

export async function billingOperation(adminId, key, input, db = prisma) {
  return auditedOperation(adminId, key, input.action, input, async tx => {
    if (["resolve_refund_request", "resolve_subscription_change"].includes(input.action)) {
      if (!input.reference?.trim() || !["done", "failed"].includes(input.outcome)) throw new AppError("PROVIDER_EVIDENCE_REQUIRED", 400);
      if (input.action === "resolve_refund_request") {
        if (input.outcome !== "failed") throw new AppError("REFUND_REQUIRES_WEBHOOK_CONFIRMATION", 409);
        const request = await tx.refundRequest.findUnique({ where: { id: input.id } });
        if (!request) throw new AppError("REFUND_REQUEST_NOT_FOUND", 404);
        const order = await tx.order.findUniqueOrThrow({ where: { id: request.orderId } });
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${order.userId} FOR UPDATE`;
        const changed = await tx.refundRequest.updateMany({ where: { id: input.id, status: "review" }, data: { status: "failed", errorCode: "PROVIDER_CONFIRMED_NOT_APPLIED" } });
        if (!changed.count) throw new AppError("REVIEW_NOT_PENDING", 409);
      } else {
        const operation = await tx.subscriptionChange.findUnique({ where: { id: input.id } });
        if (!operation) throw new AppError("SUBSCRIPTION_CHANGE_NOT_FOUND", 404);
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${operation.userId} FOR UPDATE`;
        const changed = await tx.subscriptionChange.updateMany({ where: { id: input.id, state: "review" }, data: { state: input.outcome, errorCode: null } });
        if (!changed.count) throw new AppError("REVIEW_NOT_PENDING", 409);
        await tx.processingStep.updateMany({ where: { entityId: operation.id, kind: "subscription" }, data: { state: "done", fence: { increment: 1 }, leaseUntil: null } });
        if (input.outcome === "done") await tx.subscription.update({ where: { id: operation.subscriptionId }, data: operation.input.action === "change" ? { scheduledPlanId: operation.input.planId } : { cancelAtPeriodEnd: operation.input.action === "cancel", scheduledPlanId: null } });
      }
      return { audit: { operationId: input.id, outcome: input.outcome, providerReference: input.reference } };
    }
    if (input.action === "compensate") {
      const output = await tx.tryOn.findUnique({ where: { id: input.id } });
      if (!output) throw new AppError("OUTPUT_NOT_FOUND", 404);
      const transaction = await compensateInTransaction(tx, output.userId, output.id, input.reason);
      return { audit: { outputId: output.id, transactionId: transaction.id, amount: transaction.amount, channel: transaction.channel } };
    }
    if (input.action === "replay_payment") {
      const event = await tx.paymentEvent.findUnique({ where: { id: input.id } });
      if (!event) throw new AppError("PAYMENT_EVENT_NOT_FOUND", 404);
      if (event.state !== "processed") {
        await tx.paymentEvent.update({ where: { id: event.id }, data: { state: "pending", attempts: 0 } });
        await tx.outboxEvent.create({ data: { kind: "payment", entityId: event.id, businessKey: `admin-replay:${adminId}:${key}` } });
      }
      return { audit: { eventId: event.id } };
    }
    const candidate = await tx.order.findUnique({ where: { id: input.id } });
    if (!candidate) throw new AppError("ORDER_NOT_FOUND", 404);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${candidate.userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${candidate.id} FOR UPDATE`;
    let order = await tx.order.findUnique({ where: { id: input.id } });
    if (input.action === "refund") {
      if (!order.stripePaymentIntentId || !["paid", "partially_refunded"].includes(order.status)) throw new AppError("ORDER_NOT_REFUNDABLE", 409);
      const requests = await tx.refundRequest.aggregate({ where: { orderId: order.id, status: { in: ["pending", "submitted", "review"] } }, _sum: { amountMinor: true } });
      const claimed = order.refundedMinor + (requests._sum.amountMinor || 0);
      if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || input.amountMinor > order.amountMinor - claimed) throw new AppError("REFUND_AMOUNT_INVALID", 409);
      const request = await tx.refundRequest.create({ data: { orderId: order.id, amountMinor: input.amountMinor } });
      await tx.outboxEvent.create({ data: { kind: "refund", entityId: request.id, businessKey: `refund:${request.id}` } });
      return { audit: { orderId: order.id, amountMinor: input.amountMinor }, response: { requestId: request.id } };
    }
    if (input.action !== "resolve_review" || !order.manualReview) throw new AppError("REVIEW_NOT_PENDING", 409);
    if (order.status === "disputed") {
      const events = await tx.paymentEvent.findMany({ where: { state: "processed", type: "charge.dispute.closed", payload: { path: ["data", "object", "payment_intent"], equals: order.stripePaymentIntentId } }, select: { payload: true } });
      const latest = events.sort((a, b) => b.payload.created - a.payload.created)[0]?.payload;
      if (latest?.data.object.status !== "lost" || !Number.isSafeInteger(latest.data.object.amount)) throw new AppError("DISPUTE_REQUIRES_PROVIDER_RESOLUTION", 409);
      await processRefund(tx, { created: latest.created, data: { object: { payment_intent: order.stripePaymentIntentId, currency: order.currency, amount_refunded: Math.min(order.amountMinor, order.refundedMinor + latest.data.object.amount) } } });
      await tx.order.update({ where: { id: order.id }, data: { status: "chargeback" } });
      order = await tx.order.findUnique({ where: { id: order.id } });
    }
    const lot = await tx.creditLot.findUnique({ where: { orderId: order.id } });
    if (order.type === "subscription") {
      const cycle = await tx.billingCycle.findUnique({ where: { id: `invoice:${order.stripeInvoiceId}` } });
      if (cycle?.reserved) throw new AppError("RESERVATIONS_PENDING", 409);
      if (cycle) {
        const quota = JSON.parse(order.metadata).quota;
        await tx.billingCycle.update({ where: { id: cycle.id }, data: { quota: Math.max(cycle.used, quota - proportionalMinor(quota, order.refundedMinor, order.amountMinor)) } });
      }
    }
    if (lot) {
      if (lot.reserved) throw new AppError("RESERVATIONS_PENDING", 409);
      const target = proportionalMinor(JSON.parse(order.metadata).credits, order.refundedMinor, order.amountMinor);
      const reclaim = Math.min(Math.max(0, target - order.reclaimedCredits), lot.remaining);
      await tx.creditLot.update({ where: { id: lot.id }, data: { remaining: { decrement: reclaim }, frozen: false } });
      if (reclaim) {
        await tx.user.update({ where: { id: order.userId }, data: { credits: { decrement: reclaim } } });
        await tx.creditTransaction.create({ data: { userId: order.userId, type: "payment_refund", channel: "credits", amount: -reclaim, businessKey: `review:${order.id}:${key}`, reason: order.id } });
        await tx.order.update({ where: { id: order.id }, data: { reclaimedCredits: { increment: reclaim } } });
      }
    }
    await tx.order.update({ where: { id: order.id }, data: { manualReview: false } });
    return { audit: { orderId: order.id, decision: "reclaim_available_and_write_off_consumed", refundedMinor: order.refundedMinor } };
  }, db, "root");
}

export async function processRefundRequest(id, { db = prisma, stripe } = {}) {
  const request = await db.refundRequest.findUnique({ where: { id } });
  if (!request || ["submitted", "confirmed", "failed"].includes(request.status)) return;
  const order = await db.order.findUniqueOrThrow({ where: { id: request.orderId } });
  try {
    if (Date.now() - request.createdAt > 23 * 3600_000) {
      const refunds = await stripe.refunds.list({ payment_intent: order.stripePaymentIntentId, limit: 100 });
      const existing = refunds.data.find(row => row.metadata?.requestId === id);
      await db.refundRequest.update({ where: { id }, data: { status: existing ? "submitted" : "review", stripeRefundId: existing?.id, errorCode: existing ? null : "REFUND_RECONCILIATION_REQUIRED" } });
      return;
    }
    const refund = await stripe.refunds.create({ payment_intent: order.stripePaymentIntentId, amount: request.amountMinor, metadata: { requestId: id, orderId: order.id } }, { idempotencyKey: `modelshot-refund:${id}` });
    await db.refundRequest.updateMany({ where: { id, status: "pending" }, data: { stripeRefundId: refund.id, status: refund.status === "failed" ? "failed" : "submitted", errorCode: null } });
  } catch (error) {
    const rejected = [400, 402, 404].includes(error.statusCode);
    await db.refundRequest.update({ where: { id }, data: { status: rejected ? "failed" : "pending", errorCode: "REFUND_PROVIDER_ERROR" } });
    throw error;
  }
}
