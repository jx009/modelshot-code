import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { saveDraft } from "../../src/lib/domain/generation/drafts.js";
import { createImage } from "../../src/lib/domain/assets/service.js";
import { deleteAsset, cleanupStorage } from "../../src/lib/domain/assets/lifecycle.js";
import { executeOutput } from "../../src/lib/domain/generation/execution.js";
import { recoverWork } from "../../src/lib/domain/generation/recovery.js";
import { reconcileLedger } from "../../src/lib/domain/billing/reconciliation.js";
import { billingOperation, processRefundRequest } from "../../src/lib/domain/billing/operations.js";
import { acceptPaymentEvent, processPaymentEvent } from "../../src/lib/domain/billing/payments.js";
import { CATALOG } from "../../src/lib/domain/billing/catalog.js";
import { operationalSnapshot } from "../../src/lib/domain/operations.js";
import { FakeProvider } from "../support/fake-provider.mjs";
import { requestSubscriptionChange, processSubscriptionChange } from "../../src/lib/domain/billing/subscription-changes.js";

let f;
const events = [], requests = [];
const subscriptions = [], changes = [];
beforeAll(async () => { f = await domainFixture(); });
afterAll(async () => {
  await f.db.outboxEvent.deleteMany({ where: { entityId: { in: [...events, ...requests, ...changes] } } });
  await f.db.processingStep.deleteMany({ where: { entityId: { in: changes } } });
  await f.db.subscriptionChange.deleteMany({ where: { id: { in: changes } } });
  await f.db.subscription.deleteMany({ where: { id: { in: subscriptions } } });
  await f.db.paymentEvent.deleteMany({ where: { id: { in: events } } });
  await f.db.refundRequest.deleteMany({ where: { id: { in: requests } } });
  await f.cleanup();
});

it("rejects cross-owner drafts and assets, and preserves the newer draft on conflict", async () => {
  const user = await f.user(), stranger = await f.user();
  const reference = await createImage(user.id, f.image, {}, f.db, f.store);
  const data = { name: "SKU draft", config: { images: [user.asset.id], referenceImages: [{ id: reference.id, role: "style" }] } };
  const draft = await saveDraft(user.id, data, f.db);
  expect(await f.db.assetReference.count({ where: { assetId: reference.id, entityId: draft.id, kind: "draft" } })).toBe(1);
  await expect(saveDraft(stranger.id, { ...data, id: draft.id, version: 1, config: { images: [] } }, f.db)).rejects.toMatchObject({ code: "DRAFT_NOT_FOUND" });
  await expect(saveDraft(stranger.id, data, f.db)).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
  await expect(deleteAsset(stranger.id, user.asset.id, f.db)).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
  await expect(deleteAsset(user.id, user.asset.id, f.db)).rejects.toMatchObject({ code: "ASSET_IN_USE" });
  const outcomes = await Promise.allSettled([1, 2].map(() => saveDraft(user.id, { ...data, id: draft.id, version: 1 }, f.db)));
  expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect((await f.db.draft.findUnique({ where: { id: draft.id } })).version).toBe(2);
});

it("marks unreferenced assets before deleting bytes after the retention interval", async () => {
  const user = await f.user();
  await deleteAsset(user.id, user.asset.id, f.db);
  const deleted = [];
  const store = { delete: async key => deleted.push(key) };
  await cleanupStorage({ db: f.db, store });
  expect(deleted).not.toContain(user.asset.objectKey);
  await cleanupStorage({ db: f.db, store, now: new Date(Date.now() + 8 * 86400_000) });
  expect(deleted).toContain(user.asset.objectKey);
  expect((await f.db.asset.findUnique({ where: { id: user.asset.id } })).status).toBe("purged");
});

it("bounds a hung supplier and keeps its reservation for reconciliation", async () => {
  const user = await f.user(), submitted = await f.submit(user);
  await executeOutput(submitted.tryonId, { db: f.db, store: f.store, timeoutMs: 20, adapterFactory: async () => ({ generateTryOn: () => new Promise(() => {}) }) });
  expect((await f.db.tryOn.findUnique({ where: { id: submitted.tryonId } })).status).toBe("reconciling");
  expect((await f.db.creditReservation.findUnique({ where: { tryOnId: submitted.tryonId } })).state).toBe("held");
});

it("rebuilds missing postprocessing dispatch records concurrently without duplicate business keys", async () => {
  const user = await f.user(), submitted = await f.submit(user);
  await executeOutput(submitted.tryonId, { db: f.db, store: f.store, adapterFactory: async () => new FakeProvider() });
  await f.db.outboxEvent.deleteMany({ where: { entityId: submitted.tryonId } });
  const now = new Date();
  await Promise.all([recoverWork(f.db, now), recoverWork(f.db, now)]);
  const rows = await f.db.outboxEvent.findMany({ where: { entityId: submitted.tryonId } });
  expect(rows.map(row => row.kind).sort()).toEqual(["delivery", "qa"]);
  expect((await reconcileLedger(f.db)).ok).toBe(true);
});

it("persists bounded refund requests, retries with supplier idempotency, and records webhook confirmation", async () => {
  const user = await f.user(0), root = await f.user(0);
  await f.db.user.update({ where: { id: root.id }, data: { role: "root" } });
  const plan = CATALOG.basic;
  const order = await f.db.order.create({ data: { userId: user.id, planId: plan.id, type: "credits", amountMinor: plan.amountMinor, currency: plan.currency, metadata: JSON.stringify(plan) } });
  async function deliver(type, object) { const id = `evt_${randomUUID()}`; events.push(id); await acceptPaymentEvent({ id, type, created: Math.floor(Date.now() / 1000), data: { object } }, f.db); await processPaymentEvent(id, { db: f.db }); }
  await deliver("checkout.session.completed", { id: `cs_${order.id}`, payment_status: "paid", payment_intent: `pi_${order.id}`, amount_total: 500, currency: "usd", metadata: { userId: user.id, orderId: order.id, planId: plan.id } });
  const key = randomUUID(), input = { action: "refund", id: order.id, amountMinor: 200, reason: "Fixture partial refund" };
  const result = await billingOperation(root.id, key, input, f.db); requests.push(result.requestId);
  expect((await billingOperation(root.id, key, input, f.db)).replayed).toBe(true);
  await expect(billingOperation(root.id, key, { ...input, amountMinor: 201 }, f.db)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(billingOperation(root.id, randomUUID(), { ...input, amountMinor: 400 }, f.db)).rejects.toMatchObject({ code: "REFUND_AMOUNT_INVALID" });
  const calls = [];
  const stripe = { refunds: { create: async (body, options) => { calls.push(options.idempotencyKey); return { id: "re_fixture", status: "succeeded" }; } } };
  await processRefundRequest(result.requestId, { db: f.db, stripe });
  await processRefundRequest(result.requestId, { db: f.db, stripe });
  expect(calls).toHaveLength(1);
  await deliver("charge.refunded", { payment_intent: `pi_${order.id}`, amount_refunded: 200, currency: "usd", refunds: { data: [{ id: "re_fixture" }] } });
  expect((await f.db.refundRequest.findUnique({ where: { id: result.requestId } })).status).toBe("confirmed");
  expect((await f.db.user.findUnique({ where: { id: user.id } })).credits).toBe(600);
});

it("reports stale service heartbeats and exposes only operational counts", async () => {
  const result = await operationalSnapshot(f.db, new Date(Date.now() + 86400_000));
  expect(result.alerts).toContain("WORKER_STALE");
  expect(result.metrics).toHaveProperty("staleReservations");
});

it("atomically audits generation compensation and rejects unauthorized operators", async () => {
  const user = await f.user(), root = await f.user(0), submitted = await f.submit(user);
  await f.db.user.update({ where: { id: root.id }, data: { role: "root" } });
  await executeOutput(submitted.tryonId, { db: f.db, store: f.store, adapterFactory: async () => new FakeProvider() });
  const key = randomUUID(), input = { action: "compensate", id: submitted.tryonId, reason: "Quality compensation" };
  await expect(billingOperation(user.id, key, input, f.db)).rejects.toMatchObject({ code: "ADMIN_SCOPE_DENIED" });
  await Promise.all([billingOperation(root.id, key, input, f.db), billingOperation(root.id, key, input, f.db)]);
  expect((await f.db.user.findUnique({ where: { id: user.id } })).credits).toBe(100);
  const refunds = await f.db.creditTransaction.findMany({ where: { tryOnId: submitted.tryonId, type: "refund" } });
  expect(refunds).toHaveLength(1);
  expect(refunds[0].sourceTransactionId).toBeTruthy();
  expect(await f.db.adminAuditLog.count({ where: { businessKey: `operation:${root.id}:${key}` } })).toBe(1);
});

it("serializes subscription changes and recovers a lost response with the original idempotency key", async () => {
  const user = await f.user(0);
  const id = `sub_${randomUUID()}`; subscriptions.push(id);
  await f.db.subscription.create({ data: { id, userId: user.id, customerId: "cus_fixture", planId: "sub_standard", status: "active", periodStart: new Date(), periodEnd: new Date(Date.now() + 86400_000) } });
  const input = { subscriptionId: id, action: "cancel" }, key = randomUUID();
  const operation = await requestSubscriptionChange(user.id, input, key, f.db); changes.push(operation.id);
  expect((await requestSubscriptionChange(user.id, input, key, f.db)).id).toBe(operation.id);
  await expect(requestSubscriptionChange(user.id, { ...input, action: "resume" }, key, f.db)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(requestSubscriptionChange(user.id, { ...input, action: "resume" }, randomUUID(), f.db)).rejects.toMatchObject({ code: "SUBSCRIPTION_CHANGE_PENDING" });
  const calls = []; let fail = true;
  const stripe = { subscriptions: { retrieve: async () => ({ id }), update: async (_id, body, options) => { calls.push(options.idempotencyKey); if (fail) { fail = false; throw new Error("Lost response"); } return body; } } };
  await expect(processSubscriptionChange(operation.id, { db: f.db, stripe })).rejects.toThrow("Lost response");
  await processSubscriptionChange(operation.id, { db: f.db, stripe });
  expect(new Set(calls).size).toBe(1);
  expect((await f.db.subscription.findUnique({ where: { id } })).cancelAtPeriodEnd).toBe(true);
  expect((await f.db.subscriptionChange.findUnique({ where: { id: operation.id } })).state).toBe("done");
  const review = await requestSubscriptionChange(user.id, { subscriptionId: id, action: "resume" }, randomUUID(), f.db); changes.push(review.id);
  await f.db.subscriptionChange.update({ where: { id: review.id }, data: { createdAt: new Date(Date.now() - 24 * 3600_000) } });
  await processSubscriptionChange(review.id, { db: f.db, stripe });
  expect((await f.db.subscriptionChange.findUnique({ where: { id: review.id } })).state).toBe("review");
  const root = await f.user(0);
  await f.db.user.update({ where: { id: root.id }, data: { role: "root" } });
  const resolution = { action: "resolve_subscription_change", id: review.id, reason: "Provider investigation", outcome: "failed", reference: "fixture-provider-check-123" };
  await expect(billingOperation(root.id, randomUUID(), { ...resolution, reference: "" }, f.db)).rejects.toMatchObject({ code: "PROVIDER_EVIDENCE_REQUIRED" });
  const resolutionKey = randomUUID();
  await billingOperation(root.id, resolutionKey, resolution, f.db);
  expect((await billingOperation(root.id, resolutionKey, resolution, f.db)).replayed).toBe(true);
  expect((await f.db.subscriptionChange.findUnique({ where: { id: review.id } })).state).toBe("failed");
});
