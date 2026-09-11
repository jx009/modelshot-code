import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import Redis from "ioredis";
import { Queue } from "bullmq";
import { domainFixture } from "../support/domain-fixture.mjs";
import { FakeProvider } from "../support/fake-provider.mjs";
import { submitGeneration } from "../../src/lib/domain/generation/submission.js";
import { usageSummary, compensateOutput } from "../../src/lib/domain/billing/ledger.js";
import { executeOutput, claimOutput, finishOutput, cancelOutput } from "../../src/lib/domain/generation/execution.js";
import { createImage } from "../../src/lib/domain/assets/service.js";
import { dispatchOutbox } from "../../src/lib/infra/queue/index.js";

let f;
async function run(id, options) {
  await f.db.tryOn.update({ where: { id }, data: { nextAttemptAt: null } });
  return executeOutput(id, options);
}
beforeAll(async () => { f = await domainFixture(); });
afterAll(async () => { await f?.cleanup(); });

it("allows exactly one of 20 concurrent submissions when balance covers one output", async () => {
  const user = await f.user(18);
  const quotes = await Promise.all(Array.from({ length: 20 }, () => f.quote(user)));
  const results = await Promise.allSettled(quotes.map(quote => submitGeneration(user.id, quote.quoteId, quote.digest, randomUUID(), f.db)));
  expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect(await f.db.creditReservation.count({ where: { userId: user.id, state: "held" } })).toBe(1);
  expect((await usageSummary(user.id, f.db)).credits).toBe(0);
  expect((await f.db.user.findUnique({ where: { id: user.id } })).credits).toBe(18);
});

it("rolls back the entire batch when total funds are insufficient", async () => {
  const user = await f.user(18);
  await expect(f.submit(user, { variants: 2 })).rejects.toThrow("INSUFFICIENT_CREDITS");
  expect(await f.db.tryOn.count({ where: { userId: user.id } })).toBe(0);
  expect(await f.db.batchJob.count({ where: { userId: user.id } })).toBe(0);
  expect(await f.db.creditReservation.count({ where: { userId: user.id } })).toBe(0);
});

it("deduplicates simultaneous identical submission keys and rejects changed intent", async () => {
  const user = await f.user();
  const quote = await f.quote(user);
  const key = randomUUID();
  const results = await Promise.all(Array.from({ length: 10 }, () => submitGeneration(user.id, quote.quoteId, quote.digest, key, f.db)));
  expect(new Set(results.map(row => row.tryonId)).size).toBe(1);
  await expect(submitGeneration(user.id, quote.quoteId, "0".repeat(64), key, f.db)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
});

it("captures only the delivered output in a partially failed batch, once", async () => {
  const user = await f.user(36);
  const batch = await f.submit(user, { variants: 2 });
  const provider = new FakeProvider(["success", "failure"]);
  for (const id of batch.tryonIds) await run(id, { db: f.db, store: f.store, adapterFactory: async () => provider });
  await run(batch.tryonIds[0], { db: f.db, store: f.store, adapterFactory: async () => provider });
  expect((await f.db.batchJob.findUnique({ where: { id: batch.batchJobId } })).status).toBe("partial_success");
  const usage = await usageSummary(user.id, f.db);
  expect([usage.totalCredits, usage.reservedCredits, usage.credits]).toEqual([18, 0, 18]);
  expect(await f.db.creditTransaction.count({ where: { userId: user.id, type: "consume" } })).toBe(1);
  expect(await f.db.creditTransaction.count({ where: { userId: user.id, type: "release" } })).toBe(1);
  expect(provider.requests.size).toBe(1);
});

it("cancels queued work without calling a supplier and rejects cross-owner cancellation", async () => {
  const user = await f.user(18);
  const batch = await f.submit(user);
  await expect(cancelOutput("someone-else", batch.tryonId, f.db)).rejects.toThrow("JOB_NOT_FOUND");
  await cancelOutput(user.id, batch.tryonId, f.db);
  await cancelOutput(user.id, batch.tryonId, f.db);
  expect((await usageSummary(user.id, f.db)).credits).toBe(18);
  expect(await claimOutput(batch.tryonId, f.db)).toBeNull();
});

it("rejects an expired worker completion, recovers a saved original and confirms once", async () => {
  const user = await f.user(18);
  const batch = await f.submit(user);
  const first = await claimOutput(batch.tryonId, f.db);
  await f.db.tryOn.update({ where: { id: batch.tryonId }, data: { leaseUntil: new Date(0) } });
  const second = await claimOutput(batch.tryonId, f.db);
  const asset = await createImage(user.id, f.image, { id: `${batch.tryonId}_original`, kind: "original" }, f.db, f.store);
  expect(await finishOutput(batch.tryonId, first.output.fence, { asset }, f.db)).toBe(false);
  expect(await finishOutput(batch.tryonId, second.output.fence, { asset }, f.db)).toBe(true);
  expect(await finishOutput(batch.tryonId, first.output.fence, { errorCode: "late" }, f.db)).toBe(false);
  expect((await f.db.tryOn.findUnique({ where: { id: batch.tryonId } })).status).toBe("succeeded");
  expect(await f.db.creditTransaction.count({ where: { userId: user.id, type: "consume" } })).toBe(1);
});

it("reconciles lost submission responses without calling the supplier again and quarantines late output", async () => {
  const user = await f.user(18);
  const batch = await f.submit(user);
  const provider = new FakeProvider(["lost_response"]);
  await run(batch.tryonId, { db: f.db, store: f.store, adapterFactory: async () => provider });
  expect((await f.db.tryOn.findUnique({ where: { id: batch.tryonId } })).status).toBe("reconciling");
  await run(batch.tryonId, { db: f.db, store: f.store, adapterFactory: async () => provider });
  expect(provider.requests.size).toBe(1);
  await f.db.tryOn.update({ where: { id: batch.tryonId }, data: { reconcileUntil: new Date(0) } });
  await run(batch.tryonId, { db: f.db, store: f.store, adapterFactory: async () => provider });
  expect((await usageSummary(user.id, f.db)).credits).toBe(18);
  const asset = await createImage(user.id, f.image, { kind: "original" }, f.db, f.store);
  expect(await finishOutput(batch.tryonId, 1, { asset }, f.db)).toBe(false);
  expect((await f.db.asset.findUnique({ where: { id: asset.id } })).status).toBe("quarantined");
});

it("queries delayed requests and bills a completed output despite a concurrent cancellation request", async () => {
  const user = await f.user(18);
  const batch = await f.submit(user);
  const provider = new FakeProvider(["delayed"]);
  await run(batch.tryonId, { db: f.db, store: f.store, adapterFactory: async () => provider });
  await cancelOutput(user.id, batch.tryonId, f.db);
  provider.complete([...provider.requests.keys()][0]);
  await run(batch.tryonId, { db: f.db, store: f.store, adapterFactory: async () => provider });
  expect((await f.db.tryOn.findUnique({ where: { id: batch.tryonId } })).status).toBe("succeeded");
  expect((await usageSummary(user.id, f.db)).credits).toBe(0);
});

it("retries explicit rate limiting without double reserving and releases invalid images", async () => {
  const user = await f.user(36);
  const batch = await f.submit(user, { variants: 2 });
  const provider = new FakeProvider(["rate_limit", "success", "invalid_image"]);
  const opts = { db: f.db, store: f.store, adapterFactory: async () => provider };
  await run(batch.tryonIds[0], opts);
  expect((await f.db.tryOn.findUnique({ where: { id: batch.tryonIds[0] } })).status).toBe("queued");
  await run(batch.tryonIds[0], opts);
  await run(batch.tryonIds[1], opts);
  expect((await usageSummary(user.id, f.db)).credits).toBe(18);
});

it("refunds the original cycle once, without increasing a new billing cycle", async () => {
  const user = await f.user(0, 1);
  const batch = await f.submit(user);
  await run(batch.tryonId, { db: f.db, store: f.store, adapterFactory: async () => new FakeProvider() });
  const old = await f.db.billingCycle.findFirst({ where: { userId: user.id } });
  await f.db.billingCycle.update({ where: { id: old.id }, data: { endsAt: new Date(Date.now() - 1) } });
  const paidId = randomUUID();
  await f.db.billingCycle.create({ data: { id: paidId, userId: user.id, plan: "standard", quota: 300, startsAt: new Date(), endsAt: new Date(Date.now() + 86400_000) } });
  await Promise.all(Array.from({ length: 5 }, () => compensateOutput(user.id, batch.tryonId, "fixture refund", f.db)));
  expect((await f.db.billingCycle.findUnique({ where: { id: old.id } })).used).toBe(0);
  expect((await usageSummary(user.id, f.db)).remaining).toBe(300);
  expect(await f.db.creditTransaction.count({ where: { userId: user.id, type: "refund" } })).toBe(1);
});

it("retains committed outbox work across Redis outage and deduplicates redelivery", async () => {
  const user = await f.user(18);
  await f.submit(user);
  await expect(dispatchOutbox(f.db, { add: async () => { throw new Error("Redis offline"); } })).rejects.toThrow("Redis offline");
  expect(await f.db.outboxEvent.count({ where: { deliveredAt: null } })).toBeGreaterThan(0);
  const connection = new Redis(f.environment.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(`outbox-${randomUUID()}`, { connection });
  try {
    await dispatchOutbox(f.db, queue, 1000);
    const before = await queue.count();
    await dispatchOutbox(f.db, queue, 1000);
    expect(await queue.count()).toBe(before);
  } finally { await queue.obliterate({ force: true }); await queue.close(); await connection.quit(); }
});
