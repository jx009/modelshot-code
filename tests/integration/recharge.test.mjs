import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { epaySign, verifyEpaySign, fulfillEpay, moneyToMinor } from "../../src/lib/domain/billing/epay.js";
import { startRecharge } from "../../src/lib/domain/billing/recharge.js";
import { allocateInviteCode, findInviter, generateInviteCode } from "../../src/lib/domain/identity/invite-codes.js";
import { createRegisteredUser, registrationCredits } from "../../src/lib/domain/identity/registration.js";
import { ensureInviteCode, settleCommission } from "../../src/lib/invite-service.js";
import { DEFAULT_PACKAGES } from "../../src/lib/domain/billing/recharge-config.js";
import { billingOperation } from "../../src/lib/domain/billing/operations.js";

let f, original;
const settings = { payments_enabled: "true", epay_enabled: "true", epay_gateway: "https://pay.example.com", epay_merchant_id: "fixture", epay_methods: "alipay,wxpay", payment_public_url: "https://studio.example.com", credit_packages: JSON.stringify(DEFAULT_PACKAGES), registration_credits: "125" };
const cfg = { merchantKey: "fixture-merchant-key", merchantId: "fixture", enabled: false };
const bonusUsers = [];
beforeAll(async () => {
  f = await domainFixture();
  original = await f.db.systemConfig.findMany({ where: { key: { in: Object.keys(settings) } } });
  for (const [key, value] of Object.entries(settings)) await f.db.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
  // Encryption is tested separately; checkout uses an env fallback fixture key.
  process.env.EPAY_MERCHANT_KEY = cfg.merchantKey;
});
afterAll(async () => {
  await f.db.systemConfig.deleteMany({ where: { key: { in: Object.keys(settings) } } });
  for (const row of original) await f.db.systemConfig.create({ data: row });
  await f.db.user.deleteMany({ where: { id: { in: bonusUsers } } });
  delete process.env.EPAY_MERCHANT_KEY;
  await f.cleanup();
});
function signed(order, overrides = {}) {
  const params = { pid: "fixture", type: "alipay", out_trade_no: order.id, trade_no: `trade_${order.id}`, trade_status: "TRADE_SUCCESS", money: (order.amountMinor / 100).toFixed(2), ...overrides };
  return { ...params, sign: epaySign(params, cfg.merchantKey), sign_type: "MD5" };
}
async function pending(user) {
  const result = await startRecharge(user.id, { planId: "basic", locale: "zh", method: "alipay", expectedAmountMinor: 1990, expectedCredits: 1000 }, randomUUID(), { db: f.db });
  return f.db.order.findUniqueOrThrow({ where: { id: result.orderId } });
}
it("creates six-character codes and retries both live-code and alias collisions", async () => {
  expect(generateInviteCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  const user = await f.user(0);
  await f.db.user.update({ where: { id: user.id }, data: { inviteCode: "ABC234" } });
  await f.db.inviteCodeAlias.create({ data: { code: "DEF567", userId: user.id } });
  const choices = ["ABC234", "DEF567", "GHJ789"];
  expect(await f.db.$transaction(tx => allocateInviteCode(tx, () => choices.shift()))).toBe("GHJ789");
});
it("shortens an existing code once, retaining old shared links", async () => {
  const user = await f.user(0), old = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  await f.db.user.update({ where: { id: user.id }, data: { inviteCode: old } });
  const codes = await Promise.all(Array.from({ length: 4 }, () => ensureInviteCode(user.id, f.db)));
  expect(new Set(codes).size).toBe(1); expect(codes[0]).toHaveLength(6);
  expect(await findInviter(f.db, old.toLowerCase())).toMatchObject({ id: user.id });
  expect(await findInviter(f.db, codes[0])).toMatchObject({ id: user.id });
});
it("uses the configured registration bonus exactly once at account creation", async () => {
  const email = `${randomUUID()}@bonus.test`;
  const bonus = await registrationCredits(f.db);
  const user = await f.db.$transaction(tx => createRegisteredUser(tx, { email }, bonus)); bonusUsers.push(user.id);
  expect(user).toMatchObject({ credits: 125 }); expect(user.inviteCode).toHaveLength(6);
  await expect(f.db.$transaction(tx => createRegisteredUser(tx, { email }, bonus))).rejects.toThrow();
  expect(await f.db.creditTransaction.count({ where: { userId: user.id, type: "registration_bonus", amount: 125 } })).toBe(1);
});
it("builds signed CNY checkout and reuses its order on a double click", async () => {
  const user = await f.user(0), key = randomUUID(), input = { planId: "basic", locale: "zh", method: "alipay" };
  const [a, b] = await Promise.all([startRecharge(user.id, input, key, { db: f.db }), startRecharge(user.id, input, key, { db: f.db })]);
  expect(a.orderId).toBe(b.orderId); expect(a.params.money).toBe("19.90"); expect(a.url).toBe("https://pay.example.com/submit.php");
  expect(verifyEpaySign(a.params, cfg.merchantKey)).toBe(true);
  expect(await f.db.order.findUnique({ where: { id: a.orderId } })).toMatchObject({ currency: "cny", amountMinor: 1990 });
  await expect(startRecharge(user.id, { ...input, method: "wxpay" }, key, { db: f.db })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
});
it("rejects changed displayed prices and downlisted packages before creating orders", async () => {
  const user = await f.user(0);
  await expect(startRecharge(user.id, { planId: "basic", locale: "zh", method: "alipay", expectedAmountMinor: 1 }, randomUUID(), { db: f.db })).rejects.toThrow("PACKAGE_CHANGED");
  await f.db.systemConfig.update({ where: { key: "credit_packages" }, data: { value: JSON.stringify(DEFAULT_PACKAGES.map(p => ({ ...p, active: false }))) } });
  try { await expect(pending(user)).rejects.toThrow("PACKAGE_UNAVAILABLE"); }
  finally { await f.db.systemConfig.update({ where: { key: "credit_packages" }, data: { value: settings.credit_packages } }); }
  expect(await f.db.order.count({ where: { userId: user.id } })).toBe(0);
});
it("fulfills repeated concurrent callbacks once even after new checkout is disabled", async () => {
  const user = await f.user(0), row = await pending(user), params = signed(row);
  await Promise.all(Array.from({ length: 6 }, () => fulfillEpay(params, { db: f.db, cfg })));
  expect(await f.db.user.findUnique({ where: { id: user.id } })).toMatchObject({ credits: 1000 });
  expect(await f.db.creditTransaction.count({ where: { userId: user.id, type: "purchase" } })).toBe(1);
  expect(await f.db.creditLot.findUnique({ where: { orderId: row.id } })).toMatchObject({ remaining: 1000 });
});
it.each([{ money: "0.01" }, { currency: "USD" }, { type: "wxpay" }, { pid: "other" }])("rejects an otherwise signed mismatched callback %j", async override => {
  const user = await f.user(0), row = await pending(user);
  await expect(fulfillEpay(signed(row, override), { db: f.db, cfg })).rejects.toThrow();
  expect((await f.db.user.findUnique({ where: { id: user.id } })).credits).toBe(0);
});
it("rejects forged signatures and waiting payments, and parses decimal money exactly", async () => {
  const user = await f.user(0), row = await pending(user), params = signed(row);
  await expect(fulfillEpay({ ...params, money: "999" }, { db: f.db, cfg })).rejects.toThrow("INVALID_WEBHOOK_SIGNATURE");
  expect(await fulfillEpay(signed(row, { trade_status: "WAIT_BUYER_PAY" }), { db: f.db, cfg })).toMatchObject({ paid: false });
  expect(moneyToMinor("19.90")).toBe(1990); expect(moneyToMinor("0.29")).toBe(29); expect(() => moneyToMinor("1e2")).toThrow();
});
it("prevents the same provider trade from funding two orders", async () => {
  const user = await f.user(0), a = await pending(user), b = await pending(user);
  await fulfillEpay(signed(a), { db: f.db, cfg });
  await expect(fulfillEpay(signed(b, { trade_no: `trade_${a.id}` }), { db: f.db, cfg })).rejects.toThrow();
  expect((await f.db.user.findUnique({ where: { id: user.id } })).credits).toBe(1000);
});
it("keeps CNY commission settlements separate from USD and guards Stripe-only refunds", async () => {
  const agent = await f.user(0), root = await f.user(0), user = await f.user(0);
  await f.db.user.update({ where: { id: agent.id }, data: { role: "agent" } });
  await f.db.user.update({ where: { id: root.id }, data: { role: "root" } });
  await f.db.user.update({ where: { id: user.id }, data: { inviterId: agent.id } });
  const row = await pending(user); await fulfillEpay(signed(row), { db: f.db, cfg });
  await expect(settleCommission(agent.id, root.id, "verified payment", randomUUID(), f.db, "usd")).rejects.toThrow("NO_PAYABLE_COMMISSION");
  const result = await settleCommission(agent.id, root.id, "verified payment", randomUUID(), f.db, "cny");
  expect(result.amount).toBe(1.99);
  expect(await f.db.agentCommissionSettlementLog.findFirst({ where: { agentId: agent.id } })).toMatchObject({ currency: "cny", amountMinor: 199 });
  await expect(billingOperation(root.id, randomUUID(), { action: "refund", id: row.id, amountMinor: 100, reason: "refund request" }, f.db)).rejects.toThrow("EPAY_REFUND_REQUIRES_GATEWAY");
});
