import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { digestJson } from "../generation/contracts.js";
import { CATALOG } from "./catalog.js";
import { claimStep, completeStep } from "../generation/steps.js";

export async function requestSubscriptionChange(userId, input, key, db = prisma) {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key || "")) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const digest = digestJson(input);
    const old = await tx.subscriptionChange.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } } });
    if (old) { if (old.digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409); return old; }
    const sub = await tx.subscription.findFirst({ where: { id: input.subscriptionId, userId, status: { in: ["active", "trialing", "past_due"] } } });
    if (!sub) throw new AppError("SUBSCRIPTION_NOT_FOUND", 404);
    if (input.action === "change" && (!CATALOG[input.planId] || CATALOG[input.planId].type !== "subscription" || input.planId === sub.planId)) throw new AppError("INVALID_PLAN");
    if (await tx.subscriptionChange.count({ where: { subscriptionId: sub.id, state: { in: ["pending", "review"] } } })) throw new AppError("SUBSCRIPTION_CHANGE_PENDING", 409);
    const operation = await tx.subscriptionChange.create({ data: { userId, subscriptionId: sub.id, idempotencyKey: key, digest, input } });
    await tx.outboxEvent.create({ data: { kind: "subscription", entityId: operation.id, businessKey: `subscription:${operation.id}` } });
    return operation;
  });
}

export async function processSubscriptionChange(id, { db = prisma, stripe } = {}) {
  const operation = await db.subscriptionChange.findUnique({ where: { id } });
  if (!operation || operation.state !== "pending") return;
  if (Date.now() - operation.createdAt > 23 * 3600_000) {
    await db.subscriptionChange.updateMany({ where: { id, state: "pending" }, data: { state: "review", errorCode: "SUBSCRIPTION_RECONCILIATION_REQUIRED" } });
    return;
  }
  const step = await claimStep(id, "subscription", db);
  if (!step) return;
  const input = operation.input, key = `subscription:${operation.id}`;
  const sub = await db.subscription.findUniqueOrThrow({ where: { id: operation.subscriptionId } });
  try {
    const current = await stripe.subscriptions.retrieve(sub.id);
    if (input.action === "change") {
      const plan = CATALOG[input.planId];
      const schedule = current.schedule ? await stripe.subscriptionSchedules.retrieve(typeof current.schedule === "string" ? current.schedule : current.schedule.id) : await stripe.subscriptionSchedules.create({ from_subscription: sub.id }, { idempotencyKey: `${key}:schedule` });
      const price = await stripe.prices.create({ currency: plan.currency, unit_amount: plan.amountMinor, recurring: { interval: "month" }, product_data: { name: `ModelShot ${plan.name}` }, metadata: { planId: plan.id } }, { idempotencyKey: `${key}:price` });
      await stripe.subscriptionSchedules.update(schedule.id, { end_behavior: "release", phases: [
        { start_date: schedule.current_phase.start_date, end_date: schedule.current_phase.end_date, items: current.items.data.map(item => ({ price: item.price.id, quantity: item.quantity || 1 })), proration_behavior: "none", metadata: current.metadata },
        { items: [{ price: price.id, quantity: 1 }], iterations: 1, proration_behavior: "none", metadata: { ...current.metadata, planId: input.planId } },
      ] }, { idempotencyKey: `${key}:change` });
    } else {
      if (current.schedule) await stripe.subscriptionSchedules.release(typeof current.schedule === "string" ? current.schedule : current.schedule.id, {}, { idempotencyKey: `${key}:release` });
      await stripe.subscriptions.update(sub.id, { cancel_at_period_end: input.action === "cancel" }, { idempotencyKey: `${key}:update` });
    }
    await completeStep(step, { state: "done" }, async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${operation.userId} FOR UPDATE`;
      await tx.subscription.update({ where: { id: sub.id }, data: input.action === "change" ? { scheduledPlanId: input.planId } : { cancelAtPeriodEnd: input.action === "cancel", scheduledPlanId: null } });
      await tx.subscriptionChange.update({ where: { id }, data: { state: "done", errorCode: null } });
    }, db);
  } catch (error) {
    await completeStep(step, { state: "error", errorCode: "SUBSCRIPTION_CHANGE_ERROR" }, async tx => {
      await tx.subscriptionChange.updateMany({ where: { id, state: "pending" }, data: { errorCode: "SUBSCRIPTION_CHANGE_ERROR", ...([400, 404].includes(error.statusCode) ? { state: "failed" } : {}) } });
    }, db);
    throw error;
  }
}
