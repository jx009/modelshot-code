import { randomUUID } from "node:crypto";
import { billingOperation } from "../../src/lib/domain/billing/operations.js";
import Stripe from "stripe";
import { afterAll, beforeAll, expect, it } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { CATALOG, proportionalMinor } from "../../src/lib/domain/billing/catalog.js";
import { acceptPaymentEvent, processPaymentEvent } from "../../src/lib/domain/billing/payments.js";
import { settleCommission } from "../../src/lib/invite-service.js";
import { administerUser } from "../../src/lib/domain/identity/administration.js";

let f;
const eventIds = [];
const subscriptionIds = [];
beforeAll(async () => { f = await domainFixture(); });
afterAll(async () => {
  await f.db.paymentEvent.deleteMany({ where: { id: { in: eventIds } } });
  await f.db.outboxEvent.deleteMany({ where: { entityId: { in: eventIds } } });
  await f.db.subscription.deleteMany({ where: { id: { in: subscriptionIds } } });
  await f.cleanup();
});

function event(type, object, created = Math.floor(Date.now() / 1000)) {
  const value = { id: `evt_${randomUUID()}`, type, created, data: { object } };
  eventIds.push(value.id);
  return value;
}
async function deliver(value, stripe) {
  await acceptPaymentEvent(value, f.db);
  await processPaymentEvent(value.id, { db: f.db, stripe });
}
async function order(user, planId = "basic") {
  const plan = CATALOG[planId];
  return f.db.order.create({ data: { userId: user.id, planId, type: plan.type, amountMinor: plan.amountMinor, currency: "usd", metadata: JSON.stringify(plan) } });
}
function session(row) {
  return { id: `cs_${row.id}`, payment_status: "paid", payment_intent: `pi_${row.id}`, amount_total: row.amountMinor, currency: row.currency,
    metadata: { orderId: row.id, userId: row.userId, planId: row.planId } };
}

it("validates signed fixtures and rejects altered webhook payloads", () => {
  const stripe = new Stripe("sk_test_fixture");
  const payload = JSON.stringify({ id: "evt_signed", object: "event" });
  const secret = "whsec_local_fixture_secret";
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  expect(stripe.webhooks.constructEvent(payload, signature, secret).id).toBe("evt_signed");
  expect(() => stripe.webhooks.constructEvent(`${payload} `, signature, secret)).toThrow();
});

it("keeps a newer resolved dispute when an older event arrives and freezes credits for review", async () => {
  const user = await f.user(0), row = await order(user);
  await deliver(event("checkout.session.completed", session(row)));
  const now = Math.floor(Date.now() / 1000);
  const object = { id: `dp_${row.id}`, payment_intent: `pi_${row.id}`, status: "won" };
  await deliver(event("charge.dispute.closed", object, now + 1));
  await deliver(event("charge.dispute.created", { ...object, status: "needs_response" }, now));
  expect((await f.db.order.findUnique({ where: { id: row.id } })).status).toBe("paid");
  expect((await f.db.creditLot.findUnique({ where: { orderId: row.id } })).frozen).toBe(true);
});

it("grants a paid credit package once across duplicate and distinct success events", async () => {
  const user = await f.user(0);
  const row = await order(user);
  const success = event("checkout.session.completed", session(row));
  await Promise.all(Array.from({ length: 5 }, () => acceptPaymentEvent(success, f.db)));
  await Promise.all(Array.from({ length: 5 }, () => processPaymentEvent(success.id, { db: f.db })));
  await deliver(event("checkout.session.async_payment_succeeded", session(row)));
  expect((await f.db.user.findUnique({ where: { id: user.id } })).credits).toBe(1000);
  expect(await f.db.creditTransaction.count({ where: { userId: user.id, type: "purchase" } })).toBe(1);
});

it("resolves a lost dispute once with source-linked entitlement recovery and audit", async () => {
  const user = await f.user(0), root = await f.user(0), row = await order(user);
  await f.db.user.update({ where: { id: root.id }, data: { role: "root" } });
  await deliver(event("checkout.session.completed", session(row)));
  await deliver(event("charge.dispute.closed", { id: `dp_${row.id}`, payment_intent: `pi_${row.id}`, status: "lost", amount: 500 }));
  const key = randomUUID(), input = { action: "resolve_review", id: row.id, reason: "Verified lost dispute" };
  await billingOperation(root.id, key, input, f.db);
  await billingOperation(root.id, key, input, f.db);
  expect((await f.db.user.findUnique({ where: { id: user.id } })).credits).toBe(0);
  expect(await f.db.order.findUnique({ where: { id: row.id } })).toMatchObject({ status: "chargeback", manualReview: false, refundedMinor: 500 });
  expect(await f.db.creditTransaction.count({ where: { userId: user.id, type: "payment_refund" } })).toBe(1);
});

it("does not grant unpaid checkout and rejects mismatched money", async () => {
  const user = await f.user(0);
  const row = await order(user);
  await deliver(event("checkout.session.completed", { ...session(row), payment_status: "unpaid" }));
  expect((await f.db.user.findUnique({ where: { id: user.id } })).credits).toBe(0);
  await expect(deliver(event("checkout.session.completed", { ...session(row), amount_total: 1 }))).rejects.toThrow("PAYMENT_AMOUNT_MISMATCH");
  expect((await f.db.order.findUnique({ where: { id: row.id } })).status).toBe("pending");
});

it("reclaims partial refunds once in integer units and keeps a settled commission adjustment", async () => {
  const inviter = await f.user(0);
  const admin = await f.user(0);
  const user = await f.user(0);
  await f.db.user.update({ where: { id: inviter.id }, data: { role: "agent" } });
  await f.db.user.update({ where: { id: admin.id }, data: { role: "admin" } });
  await f.db.user.update({ where: { id: user.id }, data: { inviterId: inviter.id } });
  const row = await order(user);
  await deliver(event("checkout.session.completed", session(row)));
  const settled = await settleCommission(inviter.id, admin.id, "Fixture settlement", randomUUID(), f.db);
  expect(settled.amount).toBe(0.5);
  const refund = { payment_intent: `pi_${row.id}`, amount_refunded: 125, currency: "usd" };
  await deliver(event("charge.refunded", refund));
  await deliver(event("charge.refunded", refund));
  expect((await f.db.user.findUnique({ where: { id: user.id } })).credits).toBe(750);
  const commission = await f.db.inviteCommission.findUnique({ where: { orderId: row.id } });
  expect([commission.amountMinor, commission.reversedMinor, commission.status]).toEqual([50, 13, "settled"]);
  expect((await f.db.commissionAdjustment.findMany({ where: { inviterId: inviter.id } }))).toHaveLength(1);
});

it("sends consumed or reserved refund entitlements to review instead of taking another purchase", async () => {
  const user = await f.user(0);
  const row = await order(user);
  await deliver(event("checkout.session.completed", session(row)));
  await f.submit(user);
  await deliver(event("charge.refunded", { payment_intent: `pi_${row.id}`, amount_refunded: 500, currency: "usd" }));
  const refunded = await f.db.order.findUnique({ where: { id: row.id } });
  expect(refunded.manualReview).toBe(true);
  expect((await f.db.user.findUnique({ where: { id: user.id } })).credits).toBeGreaterThanOrEqual(18);
});

it("grants actual invoice periods once and ignores older subscription state", async () => {
  const user = await f.user(0);
  const row = await order(user, "sub_standard");
  const startsAt = Math.floor(Date.now() / 1000) - 3600;
  const endsAt = startsAt + 31 * 86400;
  const subscription = { id: `sub_${randomUUID()}`, customer: "cus_fixture", status: "active", current_period_start: startsAt, current_period_end: endsAt, metadata: { userId: user.id, orderId: row.id, planId: row.planId } };
  subscriptionIds.push(subscription.id);
  const stripe = { subscriptions: { retrieve: async () => subscription }, prices: { retrieve: async () => ({ unit_amount: 2900, currency: "usd" }) } };
  const invoice = { id: `in_${randomUUID()}`, subscription: subscription.id, status: "paid", paid: true, amount_paid: 2900, currency: "usd", payment_intent: `pi_${row.id}`, lines: { data: [{ parent: { subscription_item_details: {} }, period: { start: startsAt, end: endsAt }, pricing: { price_details: { price: "price_fixture" } } }] } };
  await deliver(event("invoice.paid", invoice, startsAt + 100), stripe);
  await deliver(event("invoice.payment_succeeded", invoice, startsAt + 200), stripe);
  const cycles = await f.db.billingCycle.findMany({ where: { userId: user.id, plan: "standard" } });
  expect(cycles).toHaveLength(1);
  expect(cycles[0].endsAt.toISOString()).toBe(new Date(endsAt * 1000).toISOString());
  await deliver(event("customer.subscription.updated", subscription, startsAt + 500), stripe);
  subscription.status = "canceled";
  await deliver(event("customer.subscription.deleted", subscription, startsAt + 50), stripe);
  expect((await f.db.subscription.findUnique({ where: { id: subscription.id } })).status).toBe("active");
});

it("audits and deduplicates admin credit adjustments and blocks peers or elevation", async () => {
  const admin = await f.user(0);
  const target = await f.user(0);
  const peer = await f.user(0);
  await f.db.user.update({ where: { id: admin.id }, data: { role: "admin" } });
  await f.db.user.update({ where: { id: peer.id }, data: { role: "admin" } });
  const input = { id: target.id, creditsDelta: 100, reason: "Customer compensation" };
  const key = randomUUID();
  await Promise.all(Array.from({ length: 4 }, () => administerUser(admin.id, input, key, f.db)));
  expect((await f.db.user.findUnique({ where: { id: target.id } })).credits).toBe(100);
  expect(await f.db.creditTransaction.count({ where: { userId: target.id, type: "adjustment", amount: 100 } })).toBe(1);
  expect((await f.db.creditLot.aggregate({ where: { userId: target.id }, _sum: { remaining: true } }))._sum.remaining).toBe(100);

  const debit = { id: target.id, creditsDelta: -40, reason: "Correct duplicate compensation" };
  const debitKey = randomUUID();
  await administerUser(admin.id, debit, debitKey, f.db);
  await administerUser(admin.id, debit, debitKey, f.db);
  expect((await f.db.user.findUnique({ where: { id: target.id } })).credits).toBe(60);
  expect(await f.db.creditTransaction.count({ where: { userId: target.id, type: "adjustment", amount: -40 } })).toBe(1);
  expect((await f.db.creditLot.aggregate({ where: { userId: target.id }, _sum: { remaining: true, reserved: true } }))._sum).toEqual({ remaining: 60, reserved: 0 });

  await expect(administerUser(admin.id, { id: target.id, creditsDelta: -61, reason: "Reject excessive debit" }, randomUUID(), f.db)).rejects.toThrow("INSUFFICIENT_CREDITS");
  expect((await f.db.user.findUnique({ where: { id: target.id } })).credits).toBe(60);
  await expect(administerUser(admin.id, { ...input, id: peer.id }, randomUUID(), f.db)).rejects.toThrow("ADMIN_SCOPE_DENIED");
  await expect(administerUser(admin.id, { id: target.id, role: "root", reason: "Invalid role change" }, randomUUID(), f.db)).rejects.toThrow("ADMIN_ROLE_DENIED");
  expect(proportionalMinor(50, 125, 500)).toBe(13);
});
