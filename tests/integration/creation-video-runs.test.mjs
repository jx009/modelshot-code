import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { saveDocument } from "../../src/lib/domain/studio/documents.js";
import { createVideoRun } from "../../src/lib/domain/creation/video-runs.js";
import { readRun, resumeRun, cancelRun } from "../../src/lib/domain/creation/runs.js";
import { advanceRun, recoverRuns } from "../../src/lib/domain/creation/scheduler.js";
import { claimOutput, finishOutput } from "../../src/lib/domain/generation/execution.js";
import { usageSummary } from "../../src/lib/domain/billing/ledger.js";

// Only the supplier configuration is simulated. Admission, locks, child
// documents, outbox and credit reservations use the isolated real database.
const supplier = vi.hoisted(() => ({ cost: 20 }));
vi.mock("../../src/lib/domain/studio/providers.js", () => ({
  studioConfig: async () => ({ videoProvider: "fixture-video", videoKind: "volcengine", videoModel: "fixture",
    videoOptions: { durations: [5], ratios: ["16:9"], inputMode: "text" } }),
  capabilities: async () => ({ tools: [{ id: "video", available: true, cost: supplier.cost }] }),
}));

let fixture;
const users = [];
async function setup() {
  const user = await fixture.user(100); users.push(user.id);
  await fixture.db.user.update({ where: { id: user.id }, data: { role: "root" } });
  for (const id of ["worker", "creation-worker"]) await fixture.db.serviceHeartbeat.upsert({ where: { id }, create: { id }, update: { updatedAt: new Date() } });
  const doc = await saveDocument(user.id, { name: "Video plan", content: { schemaVersion: 1, layers: [], messages: [], jobs: [],
    video: { mode: "motion", media: [{ id: user.asset.id, name: "Original", type: "image" }], composition: {
      version: 1, ratio: "16:9", fps: 24,
      scenes: ["first", "second"].map(id => ({ id, name: id, title: "", duration: 5, assetId: user.asset.id })),
    } },
  } }, fixture.db);
  const input = { documentId: doc.id, documentVersion: doc.version, summary: "Two shots", maxCredits: 40, expectedCosts: [20, 20],
    shots: ["first", "second"].map(sceneId => ({ sceneId, provider: "fixture-video", params: { prompt: sceneId, duration: 5, ratio: "16:9", media: [] } })),
  };
  return { user, doc, input, create: (key = randomUUID()) => createVideoRun(user.id, input, key, fixture.db) };
}
const advance = id => advanceRun(id, { db: fixture.db });
async function complete(jobId, userId, errorCode) {
  const claim = await claimOutput(jobId, fixture.db);
  expect(claim).not.toBeNull();
  if (errorCode) return finishOutput(jobId, claim.output.fence, { errorCode }, fixture.db);
  // A supplier-result metadata fixture, not an actual generated/decoded video.
  const asset = await fixture.db.asset.create({ data: { userId, objectKey: `fixture-video/${randomUUID()}`, kind: "video", contentType: "video/mp4", width: 1280, height: 720, bytes: 1, checksum: randomUUID() } });
  return finishOutput(jobId, claim.output.fence, { asset, resultData: { assets: [{ id: asset.id, contentType: asset.contentType, width: asset.width, height: asset.height, duration: 5 }] } }, fixture.db);
}
beforeAll(async () => { fixture = await domainFixture(); });
beforeEach(() => { supplier.cost = 20; });
afterAll(async () => {
  if (!fixture) return;
  const runs = await fixture.db.creationRun.findMany({ where: { userId: { in: users } }, select: { id: true } });
  await fixture.db.outboxEvent.deleteMany({ where: { entityId: { in: runs.map(run => run.id) } } });
  await fixture.db.creationRun.deleteMany({ where: { userId: { in: users } } });
  await fixture.cleanup();
});

it("deduplicates concurrent plan admission and wakes, preserving the composition until explicit replacement", async () => {
  const { user, doc, create } = await setup(), key = randomUUID();
  const plans = await Promise.all([create(key), create(key)]);
  expect(plans[0].id).toBe(plans[1].id);
  const run = plans[0];
  await Promise.all([advance(run.id), advance(run.id)]);
  let current = await readRun(user.id, run.id, fixture.db);
  const firstId = current.steps[0].jobId;
  expect(firstId).toBeTruthy();
  expect(current.steps[1].jobId).toBeNull();
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(1);
  expect(await fixture.db.studioDocument.count({ where: { userId: user.id, kind: "video" } })).toBe(1);
  expect((await usageSummary(user.id, fixture.db)).reservedCredits).toBe(20);
  const child = await fixture.db.studioDocument.findUnique({ where: { id: current.steps[0].result.documentId } });
  expect(child.content.video.sceneOrigin).toMatchObject({ documentId: doc.id, sceneId: "first", assetId: user.asset.id, sourceType: "image" });
  await complete(firstId, user.id);
  await recoverRuns(fixture.db, new Date(Date.now() + 60000));
  await advance(run.id); await advance(run.id);
  current = await readRun(user.id, run.id, fixture.db);
  expect(current.steps[0].jobId).toBe(firstId);
  expect(current.steps[1].jobId).toBeTruthy();
  await complete(current.steps[1].jobId, user.id);
  await advance(run.id);
  current = await readRun(user.id, run.id, fixture.db);
  expect(current.status).toBe("succeeded");
  expect(current.committedCredits).toBe(40);
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(60);
  expect((await fixture.db.studioDocument.findUnique({ where: { id: doc.id } })).content).toEqual(doc.content);
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(2);
});

it("rolls back child documents, jobs, references and credit reservations when recording an attempt fails", async () => {
  const { user, create } = await setup(), run = await create();
  let rolledBackJob;
  const failingDb = new Proxy(fixture.db, { get(target, key) {
    if (key !== "$transaction") return Reflect.get(target, key);
    return (callback, options) => target.$transaction(tx => callback(new Proxy(tx, { get(inner, property) {
      if (property !== "creationStepAttempt") return Reflect.get(inner, property);
      return { create: async ({ data }) => { rolledBackJob = data.jobId; throw new Error("simulated attempt persistence failure"); } };
    } })), options);
  } });
  await expect(advanceRun(run.id, { db: failingDb })).rejects.toThrow("simulated attempt persistence failure");
  expect(rolledBackJob).toBeTruthy();
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(0);
  expect(await fixture.db.studioDocument.count({ where: { userId: user.id, kind: "video" } })).toBe(0);
  expect(await fixture.db.creditReservation.count({ where: { userId: user.id } })).toBe(0);
  expect(await fixture.db.outboxEvent.count({ where: { entityId: rolledBackJob } })).toBe(0);
  expect(await fixture.db.assetReference.count({ where: { assetId: user.asset.id, entityId: `shot-${run.steps[0].id}-${run.steps[0].attempt}` } })).toBe(0);
  expect((await readRun(user.id, run.id, fixture.db)).committedCredits).toBe(0);
  await recoverRuns(fixture.db, new Date(Date.now() + 60000));
  await advance(run.id);
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(1);
});

it("retries only the failed shot and keeps the completed shot and its captured cost", async () => {
  const { user, create } = await setup(), run = await create();
  await advance(run.id);
  const first = (await readRun(user.id, run.id, fixture.db)).steps[0];
  await complete(first.jobId, user.id);
  await advance(run.id); await advance(run.id);
  const checkpoint = await readRun(user.id, run.id, fixture.db), second = checkpoint.steps[1];
  await complete(second.jobId, user.id, "SUPPLIER_FAILED");
  await advance(run.id);
  const failed = await readRun(user.id, run.id, fixture.db);
  expect(failed.status).toBe("failed");
  expect(failed.committedCredits).toBe(20);
  await expect(resumeRun(user.id, run.id, { expectedSequence: failed.eventSequence, maxCredits: 40 }, fixture.db)).rejects.toThrow("CREATION_EXPLICIT_RETRY_REQUIRED");
  await resumeRun(user.id, run.id, { expectedSequence: failed.eventSequence, maxCredits: 40, retryFailed: true }, fixture.db);
  await advance(run.id);
  const retry = await readRun(user.id, run.id, fixture.db);
  expect(retry.steps[0]).toEqual(checkpoint.steps[0]);
  expect(retry.steps[1].jobId).not.toBe(second.jobId);
  expect(retry.steps[1].attempt).toBe(second.attempt + 1);
  await complete(retry.steps[1].jobId, user.id);
  await advance(run.id);
  expect((await readRun(user.id, run.id, fixture.db)).status).toBe("succeeded");
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(60);
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(3);
});

it("requires a new budget for changed prices and releases a cancelled queued shot without generating successors", async () => {
  const { user, create } = await setup(), run = await create();
  supplier.cost = 25;
  await advance(run.id);
  const paused = await readRun(user.id, run.id, fixture.db);
  expect(paused.status).toBe("awaiting_budget");
  expect(await fixture.db.studioDocument.count({ where: { userId: user.id, kind: "video" } })).toBe(0);
  await expect(resumeRun(user.id, run.id, { expectedSequence: paused.eventSequence, maxCredits: 40 }, fixture.db)).rejects.toThrow("CREATION_BUDGET_EXCEEDED");
  await resumeRun(user.id, run.id, { expectedSequence: paused.eventSequence, maxCredits: 50 }, fixture.db);
  await advance(run.id);
  expect((await usageSummary(user.id, fixture.db)).reservedCredits).toBe(25);
  await cancelRun(user.id, run.id, fixture.db);
  await advance(run.id);
  const cancelled = await readRun(user.id, run.id, fixture.db);
  expect(cancelled.status).toBe("cancelled");
  expect(cancelled.steps[1].jobId).toBeNull();
  expect(cancelled.committedCredits).toBe(0);
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(100);
  expect((await usageSummary(user.id, fixture.db)).reservedCredits).toBe(0);
});
