import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { saveDocument } from "../../src/lib/domain/studio/documents.js";
import { submitStudioJob } from "../../src/lib/domain/studio/jobs.js";
import { createImageRun, readRun, cancelRun, resumeRun } from "../../src/lib/domain/creation/runs.js";
import { advanceRun, recoverRuns } from "../../src/lib/domain/creation/scheduler.js";
import { claimOutput, finishOutput } from "../../src/lib/domain/generation/execution.js";
import { usageSummary } from "../../src/lib/domain/billing/ledger.js";
import { TOOLS } from "../../src/lib/studio/tool-catalog.js";

let fixture;
const users = [];
const config = { imageProvider: "fixture-image", imageModel: "fixture", chatModel: "fixture-vision", videoModel: "fixture-video" };
const caps = { tools: TOOLS.map(tool => ({ ...tool, available: true })) };
const admission = {
  env: { CREATION_RUNS_ENABLED: "true" }, ensureWorkers: async () => {},
  priceSteps: async steps => ({ provider: config.imageProvider, costs: steps.map(() => 18) }),
};
const scheduler = () => ({ db: fixture.db, configFor: async () => config, capabilitiesFor: async () => caps });
async function setup() {
  const user = await fixture.user(100); users.push(user.id);
  const doc = await saveDocument(user.id, { name: "Durable image plan", content: { schemaVersion: 1, layers: [], messages: [], jobs: [] } }, fixture.db);
  const input = { kind: "image", documentId: doc.id, documentVersion: doc.version, provider: config.imageProvider,
    summary: "Create then edit", maxCredits: 36, steps: [
      { tool: "generate", params: { prompt: "A blue ball" }, explanation: "Create a source image" },
      { tool: "edit", params: { prompt: "Move the ball right" }, explanation: "Edit the first result" },
    ],
  };
  return { user, doc, input };
}
async function complete(jobId, asset) {
  const claim = await claimOutput(jobId, fixture.db);
  expect(claim).not.toBeNull();
  await finishOutput(jobId, claim.output.fence, { resultData: { assets: [{ id: asset.id, contentType: asset.contentType, width: asset.width, height: asset.height }] } }, fixture.db);
}
beforeAll(async () => { fixture = await domainFixture(); });
afterAll(async () => {
  if (!fixture) return;
  const runs = await fixture.db.creationRun.findMany({ where: { userId: { in: users } }, select: { id: true } });
  await fixture.db.outboxEvent.deleteMany({ where: { entityId: { in: runs.map(run => run.id) } } });
  await fixture.db.creationRun.deleteMany({ where: { userId: { in: users } } });
  await fixture.cleanup();
});

it("advances the whole plan without a browser saving intermediate image layers", async () => {
  const { user, doc, input } = await setup();
  const run = await createImageRun(user.id, input, randomUUID(), fixture.db, admission);
  await Promise.all([advanceRun(run.id, scheduler()), advanceRun(run.id, scheduler())]);
  let current = await readRun(user.id, run.id, fixture.db);
  expect(current.steps[0].jobId).toBeTruthy();
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(1);
  expect((await usageSummary(user.id, fixture.db)).reservedCredits).toBe(18);
  await complete(current.steps[0].jobId, user.asset);
  expect(await fixture.db.outboxEvent.count({ where: { entityId: run.id, kind: "creation-advance" } })).toBeGreaterThan(1);
  await advanceRun(run.id, scheduler());
  await advanceRun(run.id, scheduler());
  current = await readRun(user.id, run.id, fixture.db);
  const second = await fixture.db.tryOn.findUnique({ where: { id: current.steps[1].jobId } });
  expect(second.snapshot.assetId).toBe(user.asset.id);
  expect(second.snapshot.targetId).toBe(`${current.steps[0].jobId}-0`);
  expect((await fixture.db.studioDocument.findUnique({ where: { id: doc.id } })).content.layers).toEqual([]);
  await complete(second.id, user.asset);
  await advanceRun(run.id, scheduler());
  await advanceRun(run.id, scheduler());
  current = await readRun(user.id, run.id, fixture.db);
  expect(current.status).toBe("succeeded");
  expect(current.committedCredits).toBe(36);
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(2);
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(64);
  const events = await fixture.db.creationEvent.findMany({ where: { runId: run.id }, orderBy: { sequence: "asc" } });
  expect(events.map(row => row.sequence)).toEqual(events.map((_, index) => index + 1));
});

it("deduplicates admission and rejects changed intent or cross-account reads", async () => {
  const { user, input } = await setup(), key = randomUUID();
  const results = await Promise.all([createImageRun(user.id, input, key, fixture.db, admission), createImageRun(user.id, input, key, fixture.db, admission)]);
  expect(results[0].id).toBe(results[1].id);
  await expect(createImageRun(user.id, { ...input, summary: "Changed" }, key, fixture.db, admission)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  await expect(readRun("another-user", results[0].id, fixture.db)).rejects.toThrow("CREATION_RUN_NOT_FOUND");
});

it("rolls back the child job, reservation and outbox if recording the step fails", async () => {
  const { user, input } = await setup();
  const run = await createImageRun(user.id, input, randomUUID(), fixture.db, admission);
  await expect(advanceRun(run.id, { ...scheduler(), submit: async (...args) => {
    await submitStudioJob(...args);
    throw new Error("simulated crash before recording the step");
  } })).rejects.toThrow("simulated crash");
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(0);
  expect(await fixture.db.creditReservation.count({ where: { userId: user.id } })).toBe(0);
  expect((await readRun(user.id, run.id, fixture.db)).committedCredits).toBe(0);
  await recoverRuns(fixture.db, new Date(Date.now() + 60000));
  await advanceRun(run.id, scheduler());
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(1);
});

it("cancels queued work and releases its reservation without submitting successors", async () => {
  const { user, input } = await setup();
  const run = await createImageRun(user.id, input, randomUUID(), fixture.db, admission);
  await advanceRun(run.id, scheduler());
  await cancelRun(user.id, run.id, fixture.db);
  await advanceRun(run.id, scheduler());
  const result = await readRun(user.id, run.id, fixture.db);
  expect(result.status).toBe("cancelled");
  expect(result.steps[1].jobId).toBeNull();
  expect(result.committedCredits).toBe(0);
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(100);
});

it("archives a late successful result after cancellation but never advances the plan", async () => {
  const { user, input } = await setup();
  const run = await createImageRun(user.id, input, randomUUID(), fixture.db, admission);
  await advanceRun(run.id, scheduler());
  const first = (await readRun(user.id, run.id, fixture.db)).steps[0].jobId;
  const claim = await claimOutput(first, fixture.db);
  await cancelRun(user.id, run.id, fixture.db);
  await advanceRun(run.id, scheduler());
  await finishOutput(first, claim.output.fence, { resultData: { assets: [{ id: user.asset.id, contentType: "image/png" }] } }, fixture.db);
  await advanceRun(run.id, scheduler());
  const result = await readRun(user.id, run.id, fixture.db);
  expect(result.status).toBe("cancelled");
  expect(result.committedCredits).toBe(18);
  expect(result.steps[1].jobId).toBeNull();
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(82);
});

it("pauses before a changed price can spend credits, then requires a fresh budget authorization", async () => {
  const { user, input } = await setup();
  const run = await createImageRun(user.id, input, randomUUID(), fixture.db, admission);
  const higher = { tools: caps.tools.map(tool => ({ ...tool, cost: 20 })) };
  await advanceRun(run.id, { ...scheduler(), capabilitiesFor: async () => higher });
  const paused = await readRun(user.id, run.id, fixture.db);
  expect(paused.status).toBe("awaiting_budget");
  expect(await fixture.db.tryOn.count({ where: { userId: user.id } })).toBe(0);
  const updatedPricing = { ...admission, priceSteps: async steps => ({ provider: config.imageProvider, costs: steps.map(() => 20) }) };
  await expect(resumeRun(user.id, run.id, { expectedSequence: paused.eventSequence, maxCredits: 36 }, fixture.db, updatedPricing)).rejects.toThrow("CREATION_BUDGET_EXCEEDED");
  await resumeRun(user.id, run.id, { expectedSequence: paused.eventSequence, maxCredits: 40 }, fixture.db, updatedPricing);
  await advanceRun(run.id, { ...scheduler(), capabilitiesFor: async () => higher });
  expect((await readRun(user.id, run.id, fixture.db)).committedCredits).toBe(20);
});
