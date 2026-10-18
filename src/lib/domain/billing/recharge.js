import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { getCreditPackages, getPaymentConfig, localizePackage, paymentMethods, validateGateway } from "./recharge-config.js";
import { createEpayPurchase } from "./epay.js";
import { getStripe } from "../../stripe.js";

export async function startRecharge(userId, input, key, { db = prisma, stripe } = {}) {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key || "")) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  const cfg = await getPaymentConfig(db);
  if (!cfg.enabled) throw new AppError("CHECKOUT_UNAVAILABLE", 503);
  const locale = input.locale === "en" ? "en" : "zh";
  const currency = locale === "zh" ? "cny" : "usd";
  const method = paymentMethods(cfg, currency).find(row => row.id === input.method);
  if (!method) throw new AppError("PAYMENT_METHOD_UNAVAILABLE", 503);
  const order = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const old = await tx.order.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: key } } });
    if (old) {
      const snapshot = JSON.parse(old.metadata || "{}");
      if (old.planId !== input.planId || old.currency !== currency || snapshot.method !== input.method) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return old;
    }
    const row = (await getCreditPackages(db)).find(plan => plan.id === input.planId && plan.active);
    if (!row) throw new AppError("PACKAGE_UNAVAILABLE", 409);
    const plan = localizePackage(row, locale);
    if ((input.expectedAmountMinor != null && input.expectedAmountMinor !== plan.amountMinor) || (input.expectedCredits != null && input.expectedCredits !== plan.credits)) throw new AppError("PACKAGE_CHANGED", 409);
    return tx.order.create({ data: { userId, planId: plan.id, type: "credits", amountMinor: plan.amountMinor, currency, idempotencyKey: key,
      metadata: JSON.stringify({ ...plan, provider: method.provider, method: input.method, merchantId: method.provider === "epay" ? cfg.merchantId : undefined, version: "dynamic-credits-v1" }) } });
  });
  if (order.status !== "pending") throw new AppError("ORDER_ALREADY_PROCESSED", 409);
  if (Date.now() - order.createdAt.getTime() > 23 * 3600_000) throw new AppError("CHECKOUT_EXPIRED", 409);
  if (method.provider === "epay") {
    if (JSON.parse(order.metadata).merchantId !== cfg.merchantId) throw new AppError("PAYMENT_CONFIGURATION_CHANGED", 409);
    return createEpayPurchase(order, cfg, locale);
  }
  stripe ||= await getStripe();
  if (order.stripeSessionId) {
    const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
    if (!session.url || session.status === "expired") throw new AppError("CHECKOUT_EXPIRED", 409);
    return { orderId: order.id, provider: "stripe", url: session.url };
  }
  const root = validateGateway(cfg.publicUrl);
  const metadata = { orderId: order.id, userId, planId: order.planId };
  const session = await stripe.checkout.sessions.create({ mode: "payment", client_reference_id: userId, metadata, payment_intent_data: { metadata },
    line_items: [{ quantity: 1, price_data: { currency, unit_amount: order.amountMinor, product_data: { name: `来塔绘梦 · ${JSON.parse(order.metadata).name}` } } }],
    success_url: `${root}/${locale}/pricing?orderId=${encodeURIComponent(order.id)}`, cancel_url: `${root}/${locale}/pricing?checkout=cancelled`,
  }, { idempotencyKey: `checkout:${order.id}` });
  await db.order.update({ where: { id: order.id }, data: { stripeSessionId: session.id } });
  return { orderId: order.id, provider: "stripe", url: session.url };
}
