import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { createProject } from "../../src/lib/domain/creation/projects.js";
import { submitCreationLanguageStep } from "../../src/lib/domain/creation/language-jobs.js";
import { executeCreationLanguage, readCreationLanguageResult } from "../../src/lib/domain/creation/language-execution.js";
import { claimOutput, cancelOutput, recoverLeases } from "../../src/lib/domain/generation/execution.js";
import { usageSummary } from "../../src/lib/domain/billing/ledger.js";
import { AppError } from "../../src/lib/http.js";

let fixture;
const users = [], blobs = new Map();
const store = { put: async (key, bytes) => blobs.set(key, Buffer.from(bytes)), get: async key => {
  if (!blobs.has(key)) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
  return Buffer.from(blobs.get(key));
} };
const config = { plannerProvider: "fixture-language", plannerKind: "openai", visionBaseURL: "https://fixture.invalid/v1", visionApiKey: "fixture", chatModel: "fixture-model", plannerCreditCost: 2 };
const layout = () => ({ schemaVersion: 1, kind: "poster", title: "Coffee opening", theme: { name: "Coffee", primary: "#202124", accent: "#ff8800", background: "#ffffff", fontFamily: "sans" },
  pages: [{ id: "p", title: "Opening", width: 1080, height: 1440, nodes: [{ id: "title", type: "text", name: "Title", text: "Coffee opens", x: 50, y: 80, width: 900, height: 120, style: { fontSize: 64 } }] }] });
async function setup() {
  const user = await fixture.user(); users.push(user.id);
  const project = await createProject(user.id, { createKey: randomUUID(), name: "Coffee", kind: "poster" }, fixture.db);
  await fixture.db.serviceHeartbeat.upsert({ where: { id: "creation-language-worker" }, create: { id: "creation-language-worker" }, update: { updatedAt: new Date() } });
  const run = await fixture.db.creationRun.create({ data: { userId: user.id, projectId: project.id, kind: "poster", requestId: randomUUID(), digest: "fixture", maxCredits: 2,
    input: { languageProvider: "fixture-language" }, steps: { create: { position: 0, tool: "poster.generate", explanation: "Create a poster", expectedCost: 2, status: "ready", params: { purpose: "poster.generate", prompt: "Coffee opening", locale: "zh", assetIds: [], width: 1080, height: 1440 } } },
  }, include: { steps: true } });
  const submit = () => submitCreationLanguageStep(user.id, run.id, run.steps[0].id, 0, { db: fixture.db, config });
  return { user, run, submit };
}
const execute = (id, options = {}) => executeCreationLanguage(id, { db: fixture.db, store, configFor: async () => config, ...options });
const expire = id => fixture.db.tryOn.update({ where: { id }, data: { leaseUntil: new Date(0), nextAttemptAt: null } });
beforeAll(async () => { fixture = await domainFixture(); });
afterAll(async () => {
  if (!fixture) return;
  const runs = await fixture.db.creationRun.findMany({ where: { userId: { in: users } }, select: { id: true } });
  await fixture.db.outboxEvent.deleteMany({ where: { entityId: { in: runs.map(run => run.id) } } });
  await fixture.db.creationRun.deleteMany({ where: { userId: { in: users } } });
  await fixture.db.creationProject.deleteMany({ where: { userId: { in: users } } });
  await fixture.db.tryOn.updateMany({ where: { userId: { in: users } }, data: { creationResultBlobId: null } });
  await fixture.db.creationBlob.deleteMany({ where: { userId: { in: users } } });
  await fixture.cleanup();
});
it("deduplicates a step admission and captures one reservation after a durable result", async () => {
  const { user, submit } = await setup();
  const [first, duplicate] = await Promise.all([submit(), submit()]);
  expect(duplicate.id).toBe(first.id);
  const invoke = vi.fn(async () => layout());
  await execute(first.id, { invoke }); await execute(first.id, { invoke });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(98);
  const result = await readCreationLanguageResult(user.id, first.id, { db: fixture.db, store });
  expect(result.pages[0].nodes[0].text).toBe("Coffee opens");
  expect((await fixture.db.tryOn.findUnique({ where: { id: first.id } })).resultData).not.toHaveProperty("pages");
  await expect(readCreationLanguageResult("another-user", first.id, { db: fixture.db, store })).rejects.toThrow("LANGUAGE_RESULT_NOT_FOUND");
});
it("recovers an uploaded result after a lost upload acknowledgement without calling the model again", async () => {
  const { user, submit } = await setup(), job = await submit(), invoke = vi.fn(async () => layout());
  await execute(job.id, { invoke, store: { ...store, put: async (key, bytes) => { await store.put(key, bytes); throw new Error("ack lost"); } } });
  expect((await fixture.db.tryOn.findUnique({ where: { id: job.id } })).status).toBe("reconciling");
  await expire(job.id); await execute(job.id, { invoke });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect((await fixture.db.tryOn.findUnique({ where: { id: job.id } })).status).toBe("succeeded");
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(98);
});
it("never resubmits an interrupted paid request when no result checkpoint exists", async () => {
  const { user, submit } = await setup(), job = await submit();
  const claim = await claimOutput(job.id, fixture.db);
  await fixture.db.processingStep.create({ data: { entityId: job.id, kind: "creation-language-submit", state: "submitted", fence: claim.output.fence } });
  await expire(job.id);
  const invoke = vi.fn(async () => layout());
  await execute(job.id, { invoke });
  expect(invoke).not.toHaveBeenCalled();
  expect((await fixture.db.tryOn.findUnique({ where: { id: job.id } })).errorCode).toBe("LANGUAGE_RESULT_UNAVAILABLE");
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(100);
});
it("releases queued cancellations and rejects malformed model output without charging", async () => {
  const cancelled = await setup(), first = await cancelled.submit(), invoke = vi.fn(async () => layout());
  await cancelOutput(cancelled.user.id, first.id, fixture.db); await execute(first.id, { invoke });
  expect(invoke).not.toHaveBeenCalled();
  expect((await usageSummary(cancelled.user.id, fixture.db)).credits).toBe(100);
  const invalid = await setup(), second = await invalid.submit();
  await execute(second.id, { invoke: async () => ({ html: "not a layout" }) });
  expect((await fixture.db.tryOn.findUnique({ where: { id: second.id } })).status).toBe("failed");
  expect((await usageSummary(invalid.user.id, fixture.db)).credits).toBe(100);
});
it("routes recovery to the language queue without loading the document into queue payloads", async () => {
  const { submit } = await setup(), job = await submit();
  await recoverLeases(fixture.db);
  const recovery = await fixture.db.outboxEvent.findFirst({ where: { entityId: job.id, businessKey: { startsWith: "recovery:" } } });
  expect(recovery.kind).toBe("creation-language");
});
it("keeps a successful late result billable when cancellation arrives after provider submission", async () => {
  const { user, submit } = await setup(), job = await submit();
  await execute(job.id, { invoke: async () => {
    await cancelOutput(user.id, job.id, fixture.db);
    return layout();
  } });
  const output = await fixture.db.tryOn.findUnique({ where: { id: job.id } });
  expect(output.status).toBe("succeeded");
  expect(output.cancelRequestedAt).not.toBeNull();
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(98);
  expect((await readCreationLanguageResult(user.id, job.id, { db: fixture.db, store })).title).toBe("Coffee opening");
});

it("does not mark a paid submission or charge credits when reference preparation fails", async () => {
  const { user, submit } = await setup(), job = await submit(), invoke = vi.fn();
  await execute(job.id, { invoke, prepareReferences: async () => { throw new AppError("CREATION_REFERENCE_INVALID", 422); } });
  expect(invoke).not.toHaveBeenCalled();
  expect(await fixture.db.processingStep.findUnique({ where: { entityId_kind: { entityId: job.id, kind: "creation-language-submit" } } })).toBeNull();
  expect((await fixture.db.tryOn.findUnique({ where: { id: job.id } })).errorCode).toBe("CREATION_REFERENCE_INVALID");
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(100);
});

it("carries owned reference pixels into a language job without persisting their base64 in job JSON", async () => {
  const { user, run, submit } = await setup();
  await fixture.db.creationStep.update({ where: { id: run.steps[0].id }, data: { params: { ...run.steps[0].params, assetIds: [user.asset.id] } } });
  const job = await submit(), invoke = vi.fn(async (_config, context) => {
    expect(context.assets).toEqual([{ id: user.asset.id, width: user.asset.width, height: user.asset.height }]);
    expect(context.images[0].assetId).toBe(user.asset.id);
    expect(context.images[0].dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    return layout();
  });
  await execute(job.id, { invoke, store: { ...store, stream: async key => {
    const bytes = await fixture.store.get(key);
    return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  } } });
  expect(invoke).toHaveBeenCalledOnce();
  const output = await fixture.db.tryOn.findUnique({ where: { id: job.id } });
  expect(output.status).toBe("succeeded");
  expect(JSON.stringify(output.snapshot)).not.toContain("data:image");
  expect(JSON.stringify(output.resultData)).not.toContain("data:image");
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(98);
});

it("honors cancellation received while preparing references before contacting the provider", async () => {
  const { user, submit } = await setup(), job = await submit(), invoke = vi.fn();
  await execute(job.id, { invoke, prepareReferences: async () => {
    await cancelOutput(user.id, job.id, fixture.db);
    return { assets: [], images: [] };
  } });
  expect(invoke).not.toHaveBeenCalled();
  expect(await fixture.db.processingStep.findUnique({ where: { entityId_kind: { entityId: job.id, kind: "creation-language-submit" } } })).toBeNull();
  expect((await fixture.db.tryOn.findUnique({ where: { id: job.id } })).status).toBe("cancelled");
  expect((await usageSummary(user.id, fixture.db)).credits).toBe(100);
});
