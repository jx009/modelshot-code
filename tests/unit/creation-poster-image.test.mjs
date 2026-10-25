import { expect, it, vi } from "vitest";
import { contentRunSchema } from "../../src/lib/creation/contracts/content-runs.js";
import { languageInputSchema, validateLanguageResult } from "../../src/lib/creation/contracts/language.js";
import { posterImageStep } from "../../src/lib/creation/contracts/poster-image.js";
import { posterImageChoice } from "../../src/lib/creation/poster-image-choice.js";
import { posterImageQuote, publishPosterImage } from "../../src/lib/domain/creation/poster-images.js";
import { submitCreationPosterImageStep, submitStudioJob } from "../../src/lib/domain/studio/jobs.js";
import { createContentRun, resumeContentRun, ensureContentWorkers } from "../../src/lib/domain/creation/content-runs.js";
import { advanceRun } from "../../src/lib/domain/creation/scheduler.js";
import { POSTER_IMAGE_SCHEDULER_HEARTBEAT, POSTER_IMAGE_LANGUAGE_HEARTBEAT } from "../../src/lib/creation/contracts/poster-runtime.js";
import { HTML_PIPELINE_VERSION } from "../../src/lib/creation/contracts/html-runtime.js";

vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/domain/creation/events.js", () => ({ appendRunEvent: vi.fn(async db => ({ ...db.run, eventSequence: 2 })), enqueueRun: vi.fn() }));
vi.mock("../../src/lib/domain/creation/messages.js", () => ({ appendCreationMessage: vi.fn() }));
vi.mock("../../src/lib/domain/billing/ledger.js", () => ({ lockUser: async db => db.user.findUnique(), reserveCreditLots: vi.fn(async () => []) }));

const request = { kind: "poster", prompt: "Coffee shop opening", width: 1080, height: 1440, maxCredits: 6, image: { size: "1024x1536", expectedCost: 4, provider: "image-channel" } };
const env = { CREATION_RUNS_ENABLED: "true", CREATION_WORKSPACE_ENABLED: "true", CREATION_POSTER_ENABLED: "true" };
const languageConfig = { visionApiKey: "fixture", chatModel: "fixture", plannerCreditCost: 2 };
function fixture() {
  const params = posterImageStep(contentRunSchema.parse(request), "image-channel");
  const step = { id: "image-step", position: 0, attempt: 0, tool: "poster.image", status: "ready", expectedCost: 4, params };
  const next = { id: "layout-step", position: 1, attempt: 0, tool: "poster.generate", status: "blocked", expectedCost: 2,
    params: languageInputSchema.parse({ purpose: "poster.generate", prompt: request.prompt, width: 1080, height: 1440 }) };
  const run = { id: "run", userId: "u", sessionId: "session", projectId: "project", kind: "poster", status: "queued", eventSequence: 1, committedCredits: 0, maxCredits: 6, input: { languageUnitCost: 2 }, steps: [step, next] };
  const db = { run, $queryRaw: async () => [], user: { findUnique: async () => ({ id: "u", status: "active" }) },
    creationRun: { findFirst: async () => run, findUnique: vi.fn(async () => run), count: async () => 0, create: vi.fn(async ({ data }) => ({ ...run, ...data, steps: data.steps.create })) },
    creationProject: { findFirst: vi.fn(async () => ({ id: "project" })) },
    creationSession: { findFirst: async () => ({ id: "session", projectId: "project", project: { kind: "poster" } }) },
    serviceHeartbeat: { findUnique: async () => ({ updatedAt: new Date() }) },
    studioDocument: { findFirst: vi.fn() },
    creationStep: { update: vi.fn() }, creationStepAttempt: { create: vi.fn() },
    tryOn: { findUnique: vi.fn(async () => null), findFirst: vi.fn(), findMany: vi.fn(async () => []), count: async () => 0, create: vi.fn(async ({ data }) => ({ ...data, status: "queued" })) },
    asset: { findFirst: vi.fn(async () => ({ id: "generated-image" })), count: async () => 0 },
    assetReference: { upsert: vi.fn(), createMany: vi.fn() }, creditReservation: { create: vi.fn() }, outboxEvent: { create: vi.fn() },
  };
  db.$transaction = async fn => fn(db);
  return { db, run, step, next, config: { imageProvider: "image-channel", imageKind: "openai", imageModel: "gpt-image-1" },
    capabilities: { tools: [{ id: "generate", available: true, cost: 4 }] }, env, configFor: async () => languageConfig,
    quoteImage: vi.fn(async () => ({ provider: "image-channel", prices: { "1024x1536": 4 } })), ensureWorkers: vi.fn() };
}
function successfulImage(f) {
  f.step.jobId = "image-job"; f.step.status = "queued"; f.run.committedCredits = 4;
  f.db.tryOn.findFirst.mockResolvedValue({ id: "image-job", status: "succeeded", resultData: { assets: [{ id: "generated-image" }] },
    snapshot: { kind: "studio", tool: "generate", creationRunId: "run", creationStepId: f.step.id, creationAttempt: 0 } });
}

it("binds a shared slide visual to every intended page without releasing pages before all visuals finish", async () => {
  const f = fixture(); successfulImage(f); f.run.kind = "slides"; f.step.params.visualId = "hero";
  const page = { id: "page", position: 2, tool: "slides.page", status: "blocked", dependsOn: ["image-2"],
    params: languageInputSchema.parse({ purpose: "slides.page", prompt: "Launch", sourceFormat: "html", pageId: "one", width: 1280, height: 720, title: "One", brief: "Facts", visualId: "hero", theme: { name: "A", primary: "#000000", accent: "#ff0000", background: "#ffffff", fontFamily: "sans" } }) };
  const secondImage = { id: "image-2", position: 1, tool: "poster.image", dependsOn: [f.step.id], status: "blocked", params: { visualId: "detail" } };
  const last = { ...page, id: "page-2", position: 3, dependsOn: [page.id], params: { ...page.params, pageId: "two" } };
  f.run.steps = [f.step, secondImage, page, last];
  await publishPosterImage(f.run, f.step, f);
  for (const id of [page.id, last.id]) {
    const update = f.db.creationStep.update.mock.calls.find(([call]) => call.where.id === id)[0];
    expect(update.data.params.visualAssetId).toBe("generated-image");
    expect(update.data.status).toBeUndefined();
  }
  expect(f.db.creationStep.update).toHaveBeenCalledWith({ where: { id: secondImage.id }, data: { status: "ready" } });
  expect(f.db.tryOn.create).not.toHaveBeenCalled();
});

it("limits generated visuals to new posters and reserves one reference slot", () => {
  expect(contentRunSchema.parse(request).image).toEqual(request.image);
  for (const input of [{ ...request, kind: "slides" }, { ...request, target: { artifactId: "a", pageId: "p", baseRevision: 1 } },
    { ...request, assetIds: Array.from({ length: 8 }, (_, i) => `a${i}`) }, { ...request, image: { ...request.image, expectedCost: -1 } }]) expect(contentRunSchema.safeParse(input).success).toBe(false);
  expect(posterImageStep({ ...contentRunSchema.parse(request), assetIds: ["a", "b", "c"] }).referenceAssetIds).toEqual(["a", "b"]);
});
it("quotes only supported sizes and rejects invalid administrator prices", async () => {
  const deps = { configFor: async () => ({ imageModel: "dall-e-2" }), capabilitiesFor: async () => ({ tools: [{ id: "generate", available: true, cost: 4 }] }) };
  expect((await posterImageQuote({}, undefined, deps)).prices).toEqual({ "1024x1024": 4 });
  await expect(posterImageQuote({}, undefined, { ...deps, capabilitiesFor: async () => ({ tools: [{ id: "generate", available: true, cost: -2 }] }) })).rejects.toThrow("INVALID_PRICE");
  expect(posterImageChoice({ posterImage: { provider: "i", prices: { "1024x1536": 4 } } }, "1080x1440")).toEqual({ size: "1024x1536", expectedCost: 4, provider: "i" });
});
it("creates a ready image step and blocked editable-layout step with the combined budget", async () => {
  const f = fixture(); f.db.creationRun.findUnique.mockResolvedValue(null);
  await createContentRun("u", "session", request, "poster-submit-key", f);
  expect(f.ensureWorkers).toHaveBeenCalledWith(f.db, { kind: "poster", posterImage: true });
  expect(f.db.creationRun.create.mock.calls[0][0].data.steps.create).toEqual([
    expect.objectContaining({ tool: "poster.image", position: 0, status: "ready", expectedCost: 4 }),
    expect.objectContaining({ tool: "poster.generate", position: 1, status: "blocked", expectedCost: 2 }),
  ]);
});
it.each([[5, 4, "CREATION_BUDGET_EXCEEDED"], [6, 5, "PRICE_CHANGED"]])("rejects budget %s / changed image price %s before persistence", async (maxCredits, expectedCost, code) => {
  const f = fixture(); f.db.creationRun.findUnique.mockResolvedValue(null);
  await expect(createContentRun("u", "session", { ...request, maxCredits, image: { ...request.image, expectedCost } }, "poster-submit-key", f)).rejects.toThrow(code);
  expect(f.db.creationRun.create).not.toHaveBeenCalled();
});
it("keeps the public studio document requirement while server admission uses the normal job and reservation", async () => {
  const f = fixture();
  await expect(submitStudioJob("u", { origin: "chat", tool: "generate", params: f.step.params.params }, "poster-submit-key", f.db, f)).rejects.toThrow();
  const output = await submitCreationPosterImageStep("u", "run", f.step.id, 1, f);
  expect(output.cost).toBe(4); expect(f.db.studioDocument.findFirst).not.toHaveBeenCalled();
  expect(f.db.tryOn.create.mock.calls[0][0].data.snapshot).toMatchObject({ kind: "studio", tool: "generate", creationRunId: "run", creationStepId: f.step.id, creationAttempt: 0 });
  expect(f.db.creditReservation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: 4, tryOnId: output.id }) });
  expect(f.db.outboxEvent.create).toHaveBeenCalledOnce();
});
it.each(["cancel", "sequence", "project", "provider", "budget", "price"])("blocks image admission on %s without creating a job", async gate => {
  const f = fixture();
  if (gate === "cancel") f.run.cancelRequestedAt = new Date();
  if (gate === "sequence") f.run.eventSequence++;
  if (gate === "project") f.db.creationProject.findFirst.mockResolvedValue(null);
  if (gate === "provider") f.config.imageProvider = "different";
  if (gate === "budget") f.run.maxCredits = 3;
  if (gate === "price") f.step.expectedCost = 3;
  await expect(submitCreationPosterImageStep("u", "run", f.step.id, 1, f)).rejects.toThrow();
  expect(f.db.tryOn.create).not.toHaveBeenCalled(); expect(f.db.creditReservation.create).not.toHaveBeenCalled();
});
it("replays the linked image without pricing, queueing or a second reservation, rejecting foreign links", async () => {
  const f = fixture(); successfulImage(f);
  expect((await submitCreationPosterImageStep("u", "run", f.step.id, 99, { db: f.db })).id).toBe("image-job");
  expect(f.db.tryOn.create).not.toHaveBeenCalled();
  f.db.tryOn.findFirst.mockResolvedValue({ snapshot: { kind: "studio", tool: "generate", creationRunId: "foreign", creationStepId: f.step.id, creationAttempt: 0 } });
  await expect(submitCreationPosterImageStep("u", "run", f.step.id, 1, f)).rejects.toThrow("CREATION_STEP_CHANGED");
});
it("retains the owned generated asset and binds it before releasing the layout step", async () => {
  const f = fixture(); successfulImage(f);
  await publishPosterImage(f.run, f.step, f);
  expect(f.db.asset.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "generated-image", userId: "u", status: "active" }) }));
  expect(f.db.assetReference.upsert).toHaveBeenCalledOnce();
  expect(f.db.creationStep.update).toHaveBeenNthCalledWith(2, { where: { id: f.next.id }, data: { status: "ready", params: expect.objectContaining({ assetIds: ["generated-image"], visualAssetId: "generated-image" }) } });
});
it.each(["cancel", "stale", "foreign-asset", "foreign-job", "missing-result"])("does not release layout on %s", async gate => {
  const f = fixture(); successfulImage(f); const initial = { ...f.run };
  if (gate === "cancel") f.run.cancelRequestedAt = new Date();
  if (gate === "stale") f.run.eventSequence++;
  if (gate === "foreign-asset") f.db.asset.findFirst.mockResolvedValue(null);
  if (gate === "foreign-job") f.db.tryOn.findFirst.mockResolvedValue({ snapshot: { creationRunId: "foreign" } });
  if (gate === "missing-result") f.db.tryOn.findFirst.mockResolvedValue({ ...(await f.db.tryOn.findFirst()), resultData: {} });
  await expect(publishPosterImage(initial, f.step, f)).rejects.toThrow();
  expect(f.db.creationStep.update).not.toHaveBeenCalled(); expect(f.db.assetReference.upsert).not.toHaveBeenCalled();
});
it("keeps a paid successful image when resuming publication and budgets only remaining language", async () => {
  const f = fixture(); successfulImage(f); f.run.status = "awaiting_input";
  f.db.tryOn.findMany.mockResolvedValue([{ id: "image-job", status: "succeeded" }]);
  await resumeContentRun("u", f.run, { expectedSequence: 1, maxCredits: 6 }, f);
  expect(f.quoteImage).not.toHaveBeenCalled();
  expect(f.db.creationStep.update.mock.calls[0][0].data).toMatchObject({ status: "running", expectedCost: 4 });
  expect(f.db.creationStep.update.mock.calls[0][0].data.jobId).toBeUndefined();
});
it("reprices a failed image plus remaining language and increments only failed attempts", async () => {
  const f = fixture(); successfulImage(f); f.run.status = "failed"; f.run.committedCredits = 0;
  f.db.tryOn.findMany.mockResolvedValue([{ id: "image-job", status: "failed" }]);
  await expect(resumeContentRun("u", f.run, { expectedSequence: 1, maxCredits: 5 }, f)).rejects.toThrow("CREATION_BUDGET_EXCEEDED");
  await resumeContentRun("u", f.run, { expectedSequence: 1, maxCredits: 6 }, f);
  const imageRetry = f.db.creationStep.update.mock.calls.find(([{ where, data }]) => where.id === "image-step" && data.status === "blocked");
  const imageReady = f.db.creationStep.update.mock.calls.find(([{ where, data }]) => where.id === "image-step" && data.status === "ready");
  const languageReset = f.db.creationStep.update.mock.calls.find(([{ where, data }]) => where.id === "layout-step" && data.status === "blocked");
  expect(imageRetry[0].data).toMatchObject({ expectedCost: 4, jobId: null, attempt: { increment: 1 } });
  expect(imageReady[0].data).toEqual({ status: "ready" });
  expect(languageReset[0].data).toMatchObject({ expectedCost: 2 });
});
it("dispatches image submission and publication without treating them as language calls", async () => {
  const f = fixture(), submitPosterImage = vi.fn(), publishImage = vi.fn(), submitLanguage = vi.fn();
  await advanceRun("run", { db: f.db, submitPosterImage, submitLanguage });
  expect(submitPosterImage).toHaveBeenCalledOnce(); expect(submitLanguage).not.toHaveBeenCalled();
  successfulImage(f);
  await advanceRun("run", { db: f.db, publishImage }); expect(publishImage).toHaveBeenCalledOnce();
});
it("requires matching new scheduler and language heartbeats only for generated-image posters", async () => {
  const rows = ["worker", "creation-worker", "creation-language-worker"].map(id => ({ id }));
  const db = { serviceHeartbeat: { findMany: async () => rows } };
  await expect(ensureContentWorkers(db, { kind: "poster" })).rejects.toThrow("CREATION_WORKER_UNAVAILABLE");
  rows.push(...["creation-html-worker", "creation-html-language-worker"].map(id => ({ id, details: { version: HTML_PIPELINE_VERSION } })));
  await ensureContentWorkers(db, { kind: "poster" });
  await expect(ensureContentWorkers(db, { kind: "poster", posterImage: true })).rejects.toThrow("CREATION_WORKER_UNAVAILABLE");
  rows.push(...[POSTER_IMAGE_SCHEDULER_HEARTBEAT, POSTER_IMAGE_LANGUAGE_HEARTBEAT].map(id => ({ id, details: { version: 1 } })));
  await ensureContentWorkers(db, { kind: "poster", posterImage: true });
});
it("requires the bound generated visual in editable output and rejects hidden or omitted visuals", () => {
  const input = languageInputSchema.parse({ purpose: "poster.generate", prompt: request.prompt, width: 1080, height: 1440, assetIds: ["generated-image"], visualAssetId: "generated-image" });
  const node = { id: "visual", name: "Visual", type: "image", assetId: "generated-image", x: 0, y: 0, width: 1080, height: 1440 };
  const output = { schemaVersion: 1, kind: "poster", title: "Coffee", theme: { name: "Coffee", primary: "#000000", accent: "#ff8800", background: "#ffffff", fontFamily: "sans" }, pages: [{ id: "p", title: "Coffee", width: 1080, height: 1440, nodes: [node] }] };
  expect(validateLanguageResult(input, output).pages[0].nodes[0].assetId).toBe("generated-image");
  // Includes a rotated rectangle whose enclosing box overlaps the page but
  // whose actual corners and edges are outside the top-left page corner.
  for (const nodes of [[], [{ ...node, visible: false }], [{ ...node, opacity: 0 }], [{ ...node, x: 1080 }], [{ ...node, x: -1080 }], [{ ...node, y: 1440 }],
    [{ ...node, x: -70, y: -80, width: 100, height: 10, rotation: 45 }]]) expect(() => validateLanguageResult(input, { ...output, pages: [{ ...output.pages[0], nodes }] })).toThrow("LANGUAGE_VISUAL_ASSET_MISSING");
  for (const placement of [{ x: -1000 }, { x: 1090, y: 50, rotation: 90 }, { x: -70, y: -60, width: 100, height: 10, rotation: 45 }]) {
    expect(validateLanguageResult(input, { ...output, pages: [{ ...output.pages[0], nodes: [{ ...node, ...placement }] }] }).pages[0].nodes[0].assetId).toBe("generated-image");
  }
  expect(languageInputSchema.safeParse({ ...input, assetIds: [] }).success).toBe(false);
});
