import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { saveDocument } from "../../src/lib/domain/studio/documents.js";
import { createStoryboardRun } from "../../src/lib/domain/creation/storyboard-runs.js";
import { readRun, resumeRun, cancelRun } from "../../src/lib/domain/creation/runs.js";
import { advanceRun, recoverRuns } from "../../src/lib/domain/creation/scheduler.js";
import { claimOutput, finishOutput } from "../../src/lib/domain/generation/execution.js";
import { usageSummary } from "../../src/lib/domain/billing/ledger.js";

// 只模拟供应商配置与视频元数据读取。准入、锁、子文档、出站事件和积分预留使用隔离的真实数据库。
const supplier = vi.hoisted(() => ({ cost: 20 }));
vi.mock("../../src/lib/domain/studio/providers.js", () => ({
  studioConfig: async () => ({ videoProvider: "fixture-video", videoKind: "volcengine", videoModel: "fixture",
    videoOptions: { durations: [5], ratios: ["16:9"], inputMode: "text" } }),
  capabilities: async () => ({ tools: [{ id: "video", available: true, cost: supplier.cost }, { id: "motion-render", available: true, cost: 0 }] }),
}));
vi.mock("../../src/lib/domain/studio/video-result-media.js", () => ({
  inspectVideoResult: async (_userId, id) => ({ id, type: "video", duration: 5, width: 1280, height: 720, proof: "fixture-proof" }),
}));

let fixture;
const users = [];
async function setup() {
  const user = await fixture.user(100); users.push(user.id);
  await fixture.db.user.update({ where: { id: user.id }, data: { role: "root" } });
  for (const id of ["worker", "creation-worker"]) await fixture.db.serviceHeartbeat.upsert({ where: { id }, create: { id }, update: { updatedAt: new Date() } });
  const doc = await saveDocument(user.id, { name: "Storyboard", content: { schemaVersion: 1, layers: [], messages: [], jobs: [],
    video: { mode: "motion", media: [], composition: {
      version: 1, ratio: "16:9", fps: 24,
      scenes: ["first", "second"].map(id => ({ id, name: id, title: "", duration: 5, source: "ai-video", visual: `${id} shot` })),
    } },
  } }, fixture.db);
  const input = { documentId: doc.id, documentVersion: doc.version, sceneIds: ["first", "second"], provider: "fixture-video", maxCredits: 40, expectedTotal: 40 };
  return { user, doc, input, create: (key = randomUUID()) => createStoryboardRun(user.id, input, key, fixture.db) };
}
const advance = id => advanceRun(id, { db: fixture.db });
async function complete(jobId, userId, errorCode) {
  const claim = await claimOutput(jobId, fixture.db);
  expect(claim).not.toBeNull();
  if (errorCode) return finishOutput(jobId, claim.output.fence, { errorCode }, fixture.db);
  // 供应商结果元数据，不是真实生成或解码的视频。
  const asset = await fixture.db.asset.create({ data: { userId, objectKey: `fixture-video/${randomUUID()}`, kind: "video", contentType: "video/mp4", width: 1280, height: 720, bytes: 1, checksum: randomUUID() } });
  return finishOutput(jobId, claim.output.fence, { asset, resultData: { assets: [{ id: asset.id, contentType: asset.contentType, width: asset.width, height: asset.height, duration: 5 }] } }, fixture.db);
}
// 完成最后的导出步骤：调度器先把片段写回工程，再提交导出任务。
async function finishRender(user, run) {
  await advance(run.id);
  const current = await readRun(user.id, run.id, fixture.db);
  const render = current.steps.find(step => step.tool === "motion-render");
  expect(render.jobId).toBeTruthy();
  await complete(render.jobId, user.id);
  await advance(run.id);
  return readRun(user.id, run.id, fixture.db);
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

it("deduplicates admission and wakes, then writes clips back into the storyboard and renders it", async () => {
  const { user, doc, create } = await setup(), key = randomUUID();
  const runs = await Promise.all([create(key), create(key)]);
  expect(runs[0].id).toBe(runs[1].id);
  const run = runs[0];
  expect(run.steps.map(step => step.tool)).toEqual(["video", "video", "motion-render"]);
  await Promise.all([advance(run.id), advance(run.id)]);
  let current = await readRun(user.id, run.id, fixture.db);
  const firstId = current.steps[0].jobId;
  expect(firstId).toBeTruthy();
  expect(current.steps[1].jobId).toBeNull();
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(1);
  expect((await usageSummary(user.id, fixture.db)).reservedCredits).toBe(20);
  const child = await fixture.db.studioDocument.findUnique({ where: { id: current.steps[0].result.documentId } });
  expect(child.content.video.sceneOrigin).toMatchObject({ documentId: doc.id, sceneId: "first", assetId: null });
  await complete(firstId, user.id);
  await recoverRuns(fixture.db, new Date(Date.now() + 60000));
  await advance(run.id); await advance(run.id);
  current = await readRun(user.id, run.id, fixture.db);
  expect(current.steps[1].jobId).toBeTruthy();
  await complete(current.steps[1].jobId, user.id);
  await advance(run.id);
  current = await finishRender(user, run);
  expect(current.status).toBe("succeeded");
  expect(current.committedCredits).toBe(40);
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(60);
  const stored = (await fixture.db.studioDocument.findUnique({ where: { id: doc.id } })).content.video;
  expect(stored).toMatchObject({ confirmed: true, shotRunId: run.id });
  expect(stored.composition.scenes.map(scene => scene.status)).toEqual(["ready", "ready"]);
  expect(stored.media.map(item => item.type)).toEqual(["video", "video"]);
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(3);
});

it("rolls back child documents, jobs and credit reservations when recording an attempt fails", async () => {
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
  expect((await finishRender(user, run)).status).toBe("succeeded");
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(60);
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(4);
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
