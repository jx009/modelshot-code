import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { CATALOG, CATALOG_VERSION, proportionalMinor } from "./catalog.js";
import { recordPaidCommission, reverseCommission } from "./commissions.js";

const objectId = value => typeof value === "string" ? value : value?.id || null;
const date = value => new Date(value * 1000);

export async function startCheckout(userId, planId, idempotencyKey, stripe, db = prisma) {
  const plan = CATALOG[planId];
  if (!plan || !/^[a-zA-Z0-9_-]{16,128}$/.test(idempotencyKey || "")) throw new AppError("INVALID_CHECKOUT");
  const order = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const old = await tx.order.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (old) {
      if (old.planId !== planId) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return old;
    }
    if (plan.type === "subscription") {
      const active = await tx.subscription.findFirst({ where: { userId, status: { in: ["active", "trialing", "past_due", "incomplete"] } } });
      const pending = await tx.order.findFirst({ where: { userId, type: "subscription", status: "pending", createdAt: { gt: new Date(Date.now() - 86400_000) } } });
      if (active || pending) throw new AppError("SUBSCRIPTION_ALREADY_EXISTS", 409);
    }
    return tx.order.create({ data: { userId, planId, type: plan.type, amountMinor: plan.amountMinor, currency: plan.currency, idempotencyKey,
      metadata: JSON.stringify({ ...plan, catalogVersion: CATALOG_VERSION }) } });
  });
  if (order.status !== "pending") throw new AppError("ORDER_ALREADY_PROCESSED", 409);
  if (order.stripeSessionId) {
    const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
    if (!session.url || session.status === "expired") throw new AppError("CHECKOUT_EXPIRED", 409);
    return { orderId: order.id, url: session.url };
  }
  if (Date.now() - order.createdAt > 23 * 3600_000) throw new AppError("CHECKOUT_RECONCILIATION_REQUIRED", 409);
  const root = new URL(process.env.NEXTAUTH_URL);
  const metadata = { orderId: order.id, userId, planId };
  const session = await stripe.checkout.sessions.create({
    mode: plan.type === "subscription" ? "subscription" : "payment", client_reference_id: userId, metadata,
    ...(plan.type === "subscription" ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
    line_items: [{ quantity: 1, price_data: { currency: plan.currency, unit_amount: plan.amountMinor, product_data: { name: `ModelShot ${plan.name}` }, ...(plan.type === "subscription" ? { recurring: { interval: "month" } } : {}) } }],
    success_url: `${root.origin}/en/account?checkout=success`, cancel_url: `${root.origin}/en/account?checkout=cancelled`,
  }, { idempotencyKey: `checkout:${order.id}` });
  await db.order.update({ where: { id: order.id }, data: { stripeSessionId: session.id } });
  return { orderId: order.id, url: session.url };
}

export async function acceptPaymentEvent(event, db = prisma) {
  if (!event || typeof event.id !== "string" || event.id.length > 256 || typeof event.type !== "string" || !event.data?.object || !Number.isInteger(event.created)) throw new AppError("INVALID_PAYMENT_EVENT");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-inbox:${event.id}`}, 0))::text`;
    const stored = await tx.paymentEvent.upsert({ where: { id: event.id }, create: { id: event.id, type: event.type, payload: JSON.parse(JSON.stringify(event)) }, update: {} });
    await tx.outboxEvent.upsert({ where: { businessKey: `payment:${event.id}` }, create: { businessKey: `payment:${event.id}`, kind: "payment", entityId: event.id }, update: {} });
    return { received: true, eventId: stored.id };
  });
}

async function lockAccount(tx, userId) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  if (!await tx.user.findUnique({ where: { id: userId } })) throw new AppError("PAYMENT_ACCOUNT_MISSING", 409);
}

async function processCheckout(tx, event) {
  const session = event.data.object;
  const candidate = await tx.order.findFirst({ where: { OR: [{ stripeSessionId: session.id }, ...(session.metadata?.orderId ? [{ id: session.metadata.orderId }] : [])] } });
  if (!candidate) throw new AppError("PAYMENT_ORDER_MISSING", 409, true);
  await lockAccount(tx, candidate.userId);
  const order = await tx.order.findUnique({ where: { id: candidate.id } });
  if (session.metadata?.userId !== order.userId || session.metadata?.planId !== order.planId) throw new AppError("PAYMENT_METADATA_MISMATCH", 409);
  if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    await tx.order.updateMany({ where: { id: order.id, status: "pending" }, data: { status: "failed" } });
    return;
  }
  if (session.payment_status !== "paid") return;
  if (session.amount_total !== order.amountMinor || session.currency !== order.currency) throw new AppError("PAYMENT_AMOUNT_MISMATCH", 409);
  await tx.order.update({ where: { id: order.id }, data: { stripeSessionId: session.id, stripePaymentIntentId: objectId(session.payment_intent) } });
  if (order.type === "subscription") return; // Only a paid invoice grants a subscription cycle.
  const businessKey = `purchase:${order.id}`;
  if (await tx.creditTransaction.findUnique({ where: { businessKey } })) return;
  const snapshot = JSON.parse(order.metadata);
  await tx.user.update({ where: { id: order.userId }, data: { credits: { increment: snapshot.credits } } });
  await tx.creditTransaction.create({ data: { userId: order.userId, type: "purchase", channel: "credits", amount: snapshot.credits, businessKey, reason: order.id } });
  await tx.creditLot.create({ data: { userId: order.userId, orderId: order.id, remaining: snapshot.credits } });
  await tx.order.update({ where: { id: order.id }, data: { status: "paid", paidAt: date(event.created) } });
  await recordPaidCommission(tx, order);
}

export function subscriptionSnapshot(subscription) {
  const item = subscription.items?.data?.[0];
  const start = subscription.current_period_start ?? item?.current_period_start;
  const end = subscription.current_period_end ?? item?.current_period_end;
  const planId = subscription.metadata?.planId;
  if (!CATALOG[planId] || CATALOG[planId].type !== "subscription" || !Number.isInteger(start) || !Number.isInteger(end) || end <= start || !subscription.metadata?.userId) throw new AppError("INVALID_SUBSCRIPTION", 409);
  return { id: subscription.id, userId: subscription.metadata.userId, customerId: objectId(subscription.customer), planId, status: subscription.status,
    periodStart: date(start), periodEnd: date(end), cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end) };
}

async function updateSubscription(tx, subscription, eventAt) {
  const data = subscriptionSnapshot(subscription);
  await lockAccount(tx, data.userId);
  const old = await tx.subscription.findUnique({ where: { id: data.id } });
  if (old && old.latestEventAt > eventAt) return old;
  const updated = await tx.subscription.upsert({ where: { id: data.id }, create: { ...data, latestEventAt: eventAt }, update: { ...data, latestEventAt: eventAt } });
  // Paid cycles retain their recorded interval; an old cancellation cannot erase a newer cycle.
  if (data.status === "canceled" && data.periodEnd <= new Date()) await tx.user.updateMany({ where: { id: data.userId, planExpiresAt: { lte: new Date() } }, data: { plan: "free", planExpiresAt: null } });
  return updated;
}

async function processInvoice(tx, event, subscription) {
  const invoice = event.data.object;
  const sub = await updateSubscription(tx, subscription, event.created);
  if (event.type === "invoice.payment_failed") return;
  if (invoice.status !== "paid" || invoice.paid === false) return;
  const line = invoice.lines?.data?.find(row => row.period && (row.type === "subscription" || row.parent?.subscription_item_details));
  if (!line || !Number.isInteger(line.period.start) || !Number.isInteger(line.period.end) || line.period.end <= line.period.start) throw new AppError("INVOICE_PERIOD_MISSING", 409);
  const plan = Object.values(CATALOG).find(candidate => candidate.type === "subscription" && candidate.amountMinor === line.price?.unit_amount && candidate.currency === line.price?.currency);
  if (!plan) throw new AppError("INVOICE_PRICE_UNRECOGNIZED", 409);
  if (invoice.currency !== plan.currency || !Number.isSafeInteger(invoice.amount_paid) || invoice.amount_paid < 0) throw new AppError("INVOICE_AMOUNT_INVALID", 409);
  const cycleId = `invoice:${invoice.id}`;
  if (await tx.billingCycle.findUnique({ where: { id: cycleId } })) return;
  const initialId = subscription.metadata?.orderId;
  const initial = initialId ? await tx.order.findUnique({ where: { id: initialId } }) : null;
  const paymentIntent = objectId(invoice.payment_intent) || objectId(invoice.payments?.data?.[0]?.payment?.payment_intent);
  const orderData = { status: "paid", paidAt: date(event.created), amountMinor: invoice.amount_paid, stripeInvoiceId: invoice.id, stripePaymentIntentId: paymentIntent, receiptUrl: invoice.hosted_invoice_url || null };
  const order = initial && initial.userId === sub.userId && !initial.stripeInvoiceId
    ? await tx.order.update({ where: { id: initial.id }, data: { ...orderData, planId: plan.id, metadata: JSON.stringify({ ...plan, catalogVersion: CATALOG_VERSION }) } })
    : await tx.order.create({ data: { userId: sub.userId, type: "subscription", planId: plan.id, currency: plan.currency, metadata: JSON.stringify({ ...plan, catalogVersion: CATALOG_VERSION }), ...orderData } });
  await tx.billingCycle.create({ data: { id: cycleId, userId: sub.userId, plan: plan.plan, quota: plan.quota, startsAt: date(line.period.start), endsAt: date(line.period.end), subscriptionId: sub.id } });
  const user = await tx.user.findUnique({ where: { id: sub.userId } });
  if (!user.planExpiresAt || user.planExpiresAt < date(line.period.end)) await tx.user.update({ where: { id: sub.userId }, data: { plan: plan.plan, planExpiresAt: date(line.period.end) } });
  await recordPaidCommission(tx, order);
}

export async function processRefund(tx, event) {
  const charge = event.data.object;
  const paymentIntent = objectId(charge.payment_intent);
  if (!paymentIntent) throw new AppError("PAYMENT_REFERENCE_MISSING", 409);
  const candidate = await tx.order.findUnique({ where: { stripePaymentIntentId: paymentIntent } });
  if (!candidate) throw new AppError("PAYMENT_ORDER_MISSING", 409, true);
  await lockAccount(tx, candidate.userId);
  const order = await tx.order.findUnique({ where: { id: candidate.id } });
  const amount = charge.amount_refunded;
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > order.amountMinor || charge.currency !== order.currency) throw new AppError("REFUND_AMOUNT_INVALID", 409);
  const refundIds = charge.refunds?.data?.map(row => row.id) || [];
  const requestIds = charge.refunds?.data?.map(row => row.metadata?.requestId).filter(Boolean) || [];
  await tx.refundRequest.updateMany({ where: { orderId: order.id, OR: [{ stripeRefundId: { in: refundIds } }, { id: { in: requestIds } }] }, data: { status: "confirmed" } });
  if (amount <= order.refundedMinor) return;
  let manualReview = false;
  let reclaimedCredits = order.reclaimedCredits;
  if (order.type === "credits") {
    const snapshot = JSON.parse(order.metadata);
    const target = proportionalMinor(snapshot.credits, amount, order.amountMinor);
    const delta = Math.max(0, target - reclaimedCredits);
    const lot = await tx.creditLot.findUnique({ where: { orderId: order.id } });
    const reclaim = lot ? Math.min(delta, lot.remaining - lot.reserved) : 0;
    manualReview = reclaim < delta;
    if (lot) await tx.creditLot.update({ where: { id: lot.id }, data: { remaining: { decrement: reclaim }, frozen: manualReview } });
    if (reclaim > 0) {
      await tx.user.update({ where: { id: order.userId }, data: { credits: { decrement: reclaim } } });
      await tx.creditTransaction.create({ data: { userId: order.userId, type: "payment_refund", channel: "credits", amount: -reclaim, businessKey: `payment-refund:${order.id}:${amount}`, reason: order.id } });
      reclaimedCredits += reclaim;
    }
  } else {
    const cycle = await tx.billingCycle.findUnique({ where: { id: `invoice:${order.stripeInvoiceId}` } });
    if (cycle) {
      const plan = JSON.parse(order.metadata);
      const newQuota = plan.quota - proportionalMinor(plan.quota, amount, order.amountMinor);
      manualReview = cycle.used + cycle.reserved > newQuota;
      await tx.billingCycle.update({ where: { id: cycle.id }, data: { quota: Math.max(newQuota, cycle.used + cycle.reserved) } });
    }
  }
  await tx.order.update({ where: { id: order.id }, data: { refundedMinor: amount, reclaimedCredits, manualReview, status: amount === order.amountMinor ? "refunded" : "partially_refunded", refundedAt: date(event.created) } });
  await reverseCommission(tx, order, amount);
}

export async function processPaymentEvent(id, { db = prisma, stripe } = {}) {
  const stored = await db.paymentEvent.findUnique({ where: { id } });
  if (!stored || stored.state === "processed") return;
  const event = stored.payload;
  await db.paymentEvent.update({ where: { id }, data: { attempts: { increment: 1 } } });
  try {
    let subscription;
    let dispute;
    if (event.type.startsWith("charge.dispute.") && stripe?.disputes) dispute = await stripe.disputes.retrieve(event.data.object.id);
    if (event.type.startsWith("customer.subscription.")) subscription = await stripe.subscriptions.retrieve(event.data.object.id);
    if (event.type.startsWith("invoice.")) {
      const invoice = event.data.object;
      for (const line of invoice.lines?.data || []) {
        const priceId = objectId(line.pricing?.price_details?.price);
        if (!line.price && priceId) line.price = await stripe.prices.retrieve(priceId);
      }
      const subscriptionId = objectId(invoice.subscription) || objectId(invoice.parent?.subscription_details?.subscription);
      if (subscriptionId) subscription = await stripe.subscriptions.retrieve(subscriptionId);
    }
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PaymentEvent" WHERE id = ${id} FOR UPDATE`;
      if ((await tx.paymentEvent.findUnique({ where: { id } })).state === "processed") return;
      if (event.type.startsWith("checkout.session.")) await processCheckout(tx, event);
      else if (["invoice.paid", "invoice.payment_succeeded", "invoice.payment_failed"].includes(event.type) && subscription) await processInvoice(tx, event, subscription);
      else if (event.type.startsWith("customer.subscription.") && subscription) await updateSubscription(tx, subscription, event.created);
      else if (event.type === "charge.refunded") await processRefund(tx, event);
      else if (event.type.startsWith("charge.dispute.")) {
        const current = dispute || event.data.object;
        const reference = objectId(current.payment_intent);
        const order = reference ? await tx.order.findUnique({ where: { stripePaymentIntentId: reference } }) : null;
        if (!order) throw new AppError("DISPUTE_ORDER_MISSING", 409, true);
        await lockAccount(tx, order.userId);
        const later = await tx.paymentEvent.findMany({ where: { state: "processed", type: { startsWith: "charge.dispute." }, payload: { path: ["data", "object", "payment_intent"], equals: reference } }, select: { payload: true } });
        if (!later.some(row => row.payload.created > event.created)) {
          const updated = await tx.order.findUnique({ where: { id: order.id } });
          const resolvedStatus = updated.refundedMinor >= updated.amountMinor ? "refunded" : updated.refundedMinor > 0 ? "partially_refunded" : "paid";
          await tx.order.update({ where: { id: order.id }, data: { manualReview: true, status: current.status === "won" ? resolvedStatus : "disputed" } });
          await tx.creditLot.updateMany({ where: { orderId: order.id }, data: { frozen: true } });
        }
      }
      await tx.paymentEvent.update({ where: { id }, data: { state: "processed", processedAt: new Date(), errorCode: null } });
    }, { timeout: 30_000 });
  } catch (error) {
    await db.paymentEvent.updateMany({ where: { id, state: { not: "processed" } }, data: { state: "error", errorCode: error instanceof AppError ? error.code : "PAYMENT_PROCESSING_ERROR" } });
    throw error;
  }
}
