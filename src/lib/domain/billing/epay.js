// Adapted from LetAiCodeWeb2/backend/src/services/epay.service.ts.
// Same submit.php protocol; fulfillment uses this app's locked order snapshots.
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { getPaymentConfig, validateGateway } from "./recharge-config.js";
import { recordPaidCommission } from "./commissions.js";

export function epaySign(params, key) {
  const text = Object.keys(params).filter(k => !["sign", "sign_type"].includes(k) && params[k] != null && params[k] !== "")
    .sort().map(k => `${k}=${params[k]}`).join("&");
  return createHash("md5").update(text + key, "utf8").digest("hex");
}
export function verifyEpaySign(params, key) {
  if (!key || !/^[a-f0-9]{32}$/i.test(params.sign || "") || (params.sign_type && params.sign_type !== "MD5")) return false;
  return timingSafeEqual(Buffer.from(epaySign(params, key), "hex"), Buffer.from(params.sign, "hex"));
}
export function moneyToMinor(value) {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value || "")) throw new AppError("PAYMENT_AMOUNT_MISMATCH", 400);
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function createEpayPurchase(order, cfg, locale) {
  const snapshot = JSON.parse(order.metadata);
  const root = validateGateway(cfg.publicUrl);
  const params = { pid: cfg.merchantId, type: snapshot.method, out_trade_no: order.id,
    notify_url: `${root}/api/payment/epay/callback`,
    return_url: `${root}/api/payment/epay/return?locale=${locale}&orderId=${encodeURIComponent(order.id)}`,
    name: `来塔绘梦 · ${snapshot.name}`, money: (order.amountMinor / 100).toFixed(2), sitename: "来塔绘梦" };
  params.sign = epaySign(params, cfg.merchantKey);
  params.sign_type = "MD5";
  return { orderId: order.id, provider: "epay", url: `${validateGateway(cfg.gateway)}/submit.php`, params };
}

export async function fulfillEpay(params, { db = prisma, cfg } = {}) {
  cfg ||= await getPaymentConfig(db);
  // Switches only stop new purchases; already paid orders can still settle.
  if (!verifyEpaySign(params, cfg.merchantKey) || params.pid !== cfg.merchantId) throw new AppError("INVALID_WEBHOOK_SIGNATURE", 400);
  if (params.trade_status !== "TRADE_SUCCESS") return { received: true, paid: false };
  if (!params.out_trade_no || !params.trade_no || params.trade_no.length > 120) throw new AppError("INVALID_PAYMENT_EVENT");
  const amountMinor = moneyToMinor(params.money);
  return db.$transaction(async tx => {
    const candidate = await tx.order.findUnique({ where: { id: params.out_trade_no } });
    if (!candidate) throw new AppError("PAYMENT_ORDER_MISSING", 404);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${candidate.userId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: candidate.id } });
    const snapshot = JSON.parse(order.metadata || "{}");
    if (snapshot.provider !== "epay" || snapshot.merchantId !== params.pid || snapshot.method !== params.type ||
        order.currency !== "cny" || (params.currency && params.currency.toUpperCase() !== "CNY") || order.type !== "credits" ||
        order.amountMinor !== amountMinor || !Number.isSafeInteger(snapshot.credits) || snapshot.credits <= 0) throw new AppError("PAYMENT_AMOUNT_MISMATCH", 409);
    const paymentId = `epay:${params.pid}:${params.trade_no}`;
    if (order.stripePaymentIntentId && order.stripePaymentIntentId !== paymentId) throw new AppError("PAYMENT_REFERENCE_MISMATCH", 409);
    const businessKey = `purchase:${order.id}`;
    if (await tx.creditTransaction.findUnique({ where: { businessKey } })) return { received: true, paid: true };
    if (order.status !== "pending") throw new AppError("ORDER_ALREADY_PROCESSED", 409);
    await tx.user.update({ where: { id: order.userId }, data: { credits: { increment: snapshot.credits } } });
    await tx.creditTransaction.create({ data: { userId: order.userId, type: "purchase", channel: "credits", amount: snapshot.credits, businessKey, reason: order.id } });
    await tx.creditLot.create({ data: { userId: order.userId, orderId: order.id, remaining: snapshot.credits } });
    await tx.order.update({ where: { id: order.id }, data: { status: "paid", paidAt: new Date(), stripePaymentIntentId: paymentId } });
    await recordPaidCommission(tx, order);
    return { received: true, paid: true };
  });
}
