import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { domainFixture } from "../support/domain-fixture.mjs";
import { saveDocument } from "../../src/lib/domain/studio/documents.js";
import { submitStudioJob } from "../../src/lib/domain/studio/jobs.js";
import { executeStudio } from "../../src/lib/domain/studio/execution.js";
import { capabilities } from "../../src/lib/domain/studio/providers.js";
import { cancelOutput, recoverLeases } from "../../src/lib/domain/generation/execution.js";
import { usageSummary } from "../../src/lib/domain/billing/ledger.js";
import { TOOLS } from "../../src/lib/studio/tools.js";
import { createStoryboard } from "../../src/lib/commerce/planner.js";
import { briefSchema } from "../../src/lib/commerce/schema.js";
import { createImage } from "../../src/lib/domain/assets/service.js";

let f;
const config = { imageModel: "fixture", chatModel: "fixture-vision", videoModel: "fixture-video" };
const deps = { config, capabilities: { tools: TOOLS.map(t => ({ ...t, available: true })) } };
async function setup() {
  const user = await f.user(100);
  const content = { schemaVersion: 1, layers: [{ id: "selected", type: "image", name: "source", assetId: user.asset.id, x: 0, y: 0, width: 320, height: 480, pixelWidth: user.asset.width, pixelHeight: user.asset.height }], messages: [], jobs: [] };
  const doc = await saveDocument(user.id, { name: "Test canvas", content }, f.db);
  return { user, doc, input: { tool: "edit", documentId: doc.id, documentVersion: doc.version, targetId: "selected", assetId: user.asset.id, params: { prompt: "Preserve product" } } };
}
describe("studio documents and task ledger", () => {
  beforeAll(async () => { f = await domainFixture(); });
  afterAll(async () => { await f?.cleanup(); });
  it("uses document CAS and rejects another user's private assets", async () => {
    const { user, doc } = await setup(), other = await f.user();
    const outcomes = await Promise.allSettled([1, 2].map(n => saveDocument(user.id, { id: doc.id, version: 1, name: `Edit ${n}`, content: doc.content }, f.db)));
    expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(r => r.status === "rejected").reason.code).toBe("DOCUMENT_VERSION_CONFLICT");
    await expect(saveDocument(other.id, { name: "Stolen", content: doc.content }, f.db)).rejects.toThrow("ASSET_NOT_FOUND");
  });
  it("commits task, reservation and outbox once; capture is idempotent under worker replay", async () => {
    const { user, input } = await setup(), key = randomUUID();
    const [a, b] = await Promise.all([submitStudioJob(user.id, input, key, f.db, deps), submitStudioJob(user.id, input, key, f.db, deps)]);
    expect(a.id).toBe(b.id);
    expect((await usageSummary(user.id, f.db)).reservedCredits).toBe(18);
    expect(await f.db.outboxEvent.count({ where: { entityId: a.id } })).toBe(1);
    let calls = 0;
    const adapters = { generate: async () => { calls++; return f.image; } };
    await executeStudio(a.id, { db: f.db, store: f.store, config, adapters });
    await executeStudio(a.id, { db: f.db, store: f.store, config, adapters });
    expect(calls).toBe(1);
    const job = await f.db.tryOn.findUnique({ where: { id: a.id } });
    expect(job.status).toBe("succeeded"); expect(job.resultData.assets).toHaveLength(1);
    expect((await usageSummary(user.id, f.db)).credits).toBe(82);
    expect(await f.db.creditTransaction.count({ where: { tryOnId: a.id, type: "consume" } })).toBe(1);
    expect(await f.db.outboxEvent.count({ where: { entityId: a.id, kind: "delivery" } })).toBe(0);
    await expect(submitStudioJob(user.id, { ...input, params: { prompt: "Changed" } }, key, f.db, deps)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });
  it("cancels queued work without provider submission or credit consumption", async () => {
    const { user, input } = await setup();
    const job = await submitStudioJob(user.id, input, randomUUID(), f.db, deps);
    await cancelOutput(user.id, job.id, f.db);
    let calls = 0;
    await executeStudio(job.id, { db: f.db, store: f.store, config, adapters: { generate: async () => { calls++; return f.image; } } });
    expect(calls).toBe(0); expect((await usageSummary(user.id, f.db)).credits).toBe(100);
    expect((await f.db.creditReservation.findUnique({ where: { tryOnId: job.id } })).state).toBe("released");
  });
  it("reconciles an unknown response without reissuing a paid image request", async () => {
    const { user, input } = await setup();
    const job = await submitStudioJob(user.id, input, randomUUID(), f.db, deps);
    let calls = 0;
    const adapters = { generate: async () => { calls++; throw new Error("connection reset after accept"); } };
    await executeStudio(job.id, { db: f.db, store: f.store, config, adapters });
    expect((await f.db.tryOn.findUnique({ where: { id: job.id } })).status).toBe("reconciling");
    await f.db.tryOn.update({ where: { id: job.id }, data: { nextAttemptAt: null, reconcileUntil: new Date(0) } });
    await recoverLeases(f.db);
    await executeStudio(job.id, { db: f.db, store: f.store, config, adapters });
    expect(calls).toBe(1); expect((await usageSummary(user.id, f.db)).credits).toBe(100);
  });
  it("persists a video task ID then resumes polling after a worker restart", async () => {
    const { user, input } = await setup();
    const job = await submitStudioJob(user.id, { ...input, tool: "video", params: { prompt: "Slow orbit", duration: 5 } }, randomUUID(), f.db, deps);
    const calls = [];
    const adapters = { video: async (_c, args) => { calls.push(args.requestId); return args.requestId ? { state: "succeeded", url: "https://example.test/video.mp4" } : { state: "pending", requestId: "remote-123" }; }, downloadVideo: async () => Buffer.from("0000ftypisom0000000000") };
    await executeStudio(job.id, { db: f.db, store: f.store, config, adapters });
    expect((await f.db.generationAttempt.findFirst({ where: { tryOnId: job.id } })).requestId).toBe("remote-123");
    await f.db.tryOn.update({ where: { id: job.id }, data: { nextAttemptAt: null } });
    await executeStudio(job.id, { db: f.db, store: f.store, config, adapters });
    expect(calls).toEqual([null, "remote-123"]);
    const output = await f.db.tryOn.findUnique({ where: { id: job.id } });
    expect(output.status).toBe("succeeded"); expect(output.resultData.assets[0].contentType).toBe("video/mp4");
    expect((await usageSummary(user.id, f.db)).credits).toBe(40);
  });
  it("executes a real crop with zero reservation and exact stored dimensions", async () => {
    const { user, input } = await setup();
    const job = await submitStudioJob(user.id, { ...input, tool: "crop", params: { rect: { left: 0, top: 0, width: 16, height: 12 } } }, randomUUID(), f.db, deps);
    await executeStudio(job.id, { db: f.db, store: f.store, config });
    const row = await f.db.tryOn.findUnique({ where: { id: job.id } });
    expect(row.status).toBe("succeeded");
    const asset = await f.db.asset.findUnique({ where: { id: row.resultData.assets[0].id } });
    expect(await sharp(await f.store.get(asset.objectKey)).metadata()).toMatchObject({ width: 16, height: 12 });
    expect(await f.db.creditReservation.count({ where: { tryOnId: job.id } })).toBe(0);
  });
  it("uses the administrator configured tool price for reservation and capture", async () => {
    const { user, input } = await setup();
    await f.db.studioToolConfig.upsert({
      where: { toolId: "crop" },
      create: { toolId: "crop", creditCost: 7, isEnabled: true },
      update: { creditCost: 7, isEnabled: true },
    });
    try {
      const dynamicCapabilities = await capabilities(f.db, config);
      const job = await submitStudioJob(user.id, {
        ...input,
        tool: "crop",
        params: { rect: { left: 0, top: 0, width: 16, height: 12 } },
      }, randomUUID(), f.db, { config, capabilities: dynamicCapabilities });
      expect(job.cost).toBe(7);
      expect((await usageSummary(user.id, f.db)).reservedCredits).toBe(7);

      await executeStudio(job.id, { db: f.db, store: f.store, config });

      expect((await f.db.tryOn.findUnique({ where: { id: job.id } })).status).toBe("succeeded");
      expect((await usageSummary(user.id, f.db)).credits).toBe(93);
      expect(await f.db.creditTransaction.count({ where: { tryOnId: job.id, type: "consume", amount: -7 } })).toBe(1);
    } finally {
      await f.db.studioToolConfig.upsert({
        where: { toolId: "crop" },
        create: { toolId: "crop", creditCost: 0, isEnabled: true },
        update: { creditCost: 0, isEnabled: true },
      });
    }
  });
  it("pins each commerce section to original product plus owned style; replay does not spend twice", async () => {
    const { user, doc, input } = await setup(), other = await f.user();
    const reference = await createImage(user.id, await sharp({ create: { width: 24, height: 24, channels: 3, background: "blue" } }).png().toBuffer(), {}, f.db, f.store);
    const brief = briefSchema.parse({ product: "Chair", description: "Visible upholstered chair", language: "en" });
    const sections = createStoryboard(brief).slice(0, 2);
    const commerce = { version: 1, brief, sections, productAssetId: user.asset.id, referenceAssetId: reference.id, planning: "template" };
    const saved = await saveDocument(user.id, { id: doc.id, version: doc.version, name: "Chair story", content: { ...doc.content, commerce } }, f.db);
    await expect(saveDocument(user.id, { id: doc.id, version: saved.version, name: "Invalid", content: { ...saved.content, commerce: { ...commerce, referenceAssetId: other.asset.id } } }, f.db)).rejects.toThrow("ASSET_NOT_FOUND");
    const outputs = [];
    for (const section of sections) {
      const data = { ...input, documentVersion: saved.version, referenceAssetIds: [reference.id], sectionId: section.id, sectionAttempt: 0, params: { prompt: section.prompt } };
      await expect(submitStudioJob(user.id, { ...data, params: { prompt: "changed after plan" } }, randomUUID(), f.db, deps)).rejects.toThrow("STORYBOARD_CHANGED");
      const key = randomUUID(), job = await submitStudioJob(user.id, data, key, f.db, deps);
      expect((await submitStudioJob(user.id, data, key, f.db, deps)).id).toBe(job.id);
      await executeStudio(job.id, { db: f.db, store: f.store, config, adapters: { generate: async (_config, args) => { expect(args.image).toEqual(f.image); expect(args.references).toHaveLength(1); expect(args.references[0]).toEqual(await f.store.get(reference.objectKey)); return f.image; } } });
      outputs.push(await f.db.tryOn.findUnique({ where: { id: job.id } }));
    }
    expect(outputs.every(row => row.status === "succeeded")).toBe(true);
    expect(outputs.map(row => row.snapshot.assetId)).toEqual([user.asset.id, user.asset.id]);
    expect((await usageSummary(user.id, f.db)).credits).toBe(64);
  });
});
