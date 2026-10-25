import { beforeEach, expect, it, vi } from "vitest";
import { confirmOutline, readApprovedOutline } from "../../src/lib/domain/creation/outline-review.js";
import { createContentRun, ensureContentWorkers, requireContentCreation, resumeContentRun } from "../../src/lib/domain/creation/content-runs.js";
import { advanceRun } from "../../src/lib/domain/creation/scheduler.js";
import { publishCreationLanguage, assembleCreationDocument } from "../../src/lib/domain/creation/publication.js";
import { textDocumentSchema } from "../../src/lib/creation/contracts/document.js";
import { DOCUMENT_PIPELINE_VERSION, DOCUMENT_LANGUAGE_HEARTBEAT, DOCUMENT_SCHEDULER_HEARTBEAT } from "../../src/lib/creation/contracts/document-runtime.js";

const mocks = vi.hoisted(() => ({ result: vi.fn(), readDoc: vi.fn(), modifyDoc: vi.fn(), createDoc: vi.fn(), event: vi.fn(), enqueue: vi.fn(), message: vi.fn() }));
vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => { throw new Error("Real storage forbidden"); } }));
vi.mock("../../src/lib/domain/creation/runs.js", () => ({ lockRun: async db => db.run, presentRun: run => structuredClone(run) }));
vi.mock("../../src/lib/domain/creation/language-execution.js", () => ({ readCreationLanguageResult: (...args) => mocks.result(...args) }));
vi.mock("../../src/lib/domain/creation/document-artifacts.js", () => ({ readDocumentArtifact: (...args) => mocks.readDoc(...args), modifyDocumentArtifact: (...args) => mocks.modifyDoc(...args), createDocumentArtifact: (...args) => mocks.createDoc(...args) }));
vi.mock("../../src/lib/domain/creation/events.js", () => ({ appendRunEvent: (...args) => mocks.event(...args), enqueueRun: (...args) => mocks.enqueue(...args) }));
vi.mock("../../src/lib/domain/creation/messages.js", () => ({ appendCreationMessage: (...args) => mocks.message(...args) }));
const outline = () => ({ title: "Report", sections: [{ id: "a", title: "Summary", brief: "Facts" }, { id: "b", title: "Findings", brief: "Evidence" }] });
const sourceParams = { purpose: "document.outline", sectionCount: 2, prompt: "Write report", locale: "en", assetIds: [], audience: "Investors" };
const config = { visionApiKey: "mock", chatModel: "mock", plannerCreditCost: 2, plannerProvider: "mock" };
const env = { CREATION_RUNS_ENABLED: "true", CREATION_WORKSPACE_ENABLED: "true", CREATION_DOCUMENT_ENABLED: "true" };
const approval = () => ({ saveKey: "approval-key-123456", expectedSequence: 3, expectedUnitCost: 2, maxCredits: 6, outline: outline() });
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.event.mockImplementation(async (db, _id, _type, _payload, changes) => { Object.assign(db.run, changes); db.run.eventSequence++; return db.run; });
});
function fixture() {
  const run = { id: "run", userId: "u", projectId: "project", sessionId: "session", kind: "document", status: "awaiting_input", errorCode: "CREATION_OUTLINE_CONFIRMATION_REQUIRED", eventSequence: 3,
    committedCredits: 2, maxCredits: 6, input: { sectionCount: 2, locale: "en", languageProvider: "mock", languageUnitCost: 2 }, steps: [{ id: "outline", position: 0, tool: "document.outline", status: "succeeded", jobId: "outline-job", attempt: 0, params: sourceParams, result: {} }] };
  const blobs = new Map(), objects = new Map();
  const db = { run, $queryRaw: vi.fn(),
    creationRun: { findFirst: vi.fn(async () => run), findUnique: vi.fn(async () => run), count: vi.fn(async () => 0) },
    creationProject: { findFirst: vi.fn(async () => ({ id: "project" })) },
    creationBlob: { create: vi.fn(async ({ data }) => { const row = { id: `blob${blobs.size}`, state: "staging", ...data }; blobs.set(row.id, row); return row; }),
      findFirst: vi.fn(async ({ where }) => blobs.get(where.id)), updateMany: vi.fn(async ({ where, data }) => { Object.assign(blobs.get(where.id), data); return { count: 1 }; }) },
    creationStep: { createMany: vi.fn(async ({ data }) => { run.steps.push(...data.map((step, index) => ({ ...step, id: step.id || `part${index}`, attempt: 0 }))); }),
      update: vi.fn(async ({ where, data }) => { const step = run.steps.find(step => step.id === where.id); Object.assign(step, data); return step; }),
      findUnique: vi.fn(async ({ where }) => run.steps.find(step => step.position === where.runId_position.position)) },
    tryOn: { findFirst: vi.fn(async ({ where }) => { const step = run.steps.find(step => step.jobId === where.id); return { status: "succeeded", snapshot: { creationStepId: step.id, creationAttempt: step.attempt } }; }) },
  };
  db.$transaction = async fn => fn(db);
  const store = { put: vi.fn(async (key, bytes) => objects.set(key, bytes)), get: vi.fn(async key => objects.get(key)) };
  return { db, run, store, env, configFor: async () => config, ensureWorkers: vi.fn() };
}

it("requires document-specific worker versions without changing poster/slides admission", async () => {
  const db = { serviceHeartbeat: { findMany: vi.fn(async () => [{ id: "worker" }, { id: DOCUMENT_SCHEDULER_HEARTBEAT, details: { version: 1 } }, { id: DOCUMENT_LANGUAGE_HEARTBEAT, details: { version: 0 } }]) } };
  await expect(ensureContentWorkers(db, { kind: "document" })).rejects.toThrow("CREATION_WORKER_UNAVAILABLE");
  db.serviceHeartbeat.findMany.mockResolvedValue([{ id: "worker" }, { id: DOCUMENT_SCHEDULER_HEARTBEAT, details: { version: DOCUMENT_PIPELINE_VERSION } }]);
  await expect(ensureContentWorkers(db, { kind: "document", language: false })).resolves.toBeUndefined();
  expect(() => requireContentCreation("document", { ...env, CREATION_DOCUMENT_ENABLED: "false", CREATION_SLIDES_ENABLED: "true" })).toThrow("CREATION_NOT_ENABLED");
});

it("admits a document request with an outline-plus-sections budget and persists only the outline initially", async () => {
  const value = fixture();
  value.db.creationRun.findUnique.mockResolvedValue(null);
  value.db.creationSession = { findFirst: vi.fn(async () => ({ id: "session", projectId: "project", project: { kind: "document" } })) };
  value.db.user = { findUnique: vi.fn(async () => ({ id: "u", status: "active" })) };
  value.db.creationRun.create = vi.fn(async ({ data }) => { Object.assign(value.run, data, { id: "run", steps: data.steps.create.map(step => ({ ...step })) }); return value.run; });
  const request = { kind: "document", prompt: "Write report", sectionCount: 2, audience: "Investors", maxCredits: 6 };
  await expect(createContentRun("u", "session", { ...request, maxCredits: 4 }, "submit-document-key-123", value)).rejects.toThrow("CREATION_BUDGET_EXCEEDED");
  expect(value.db.creationRun.create).not.toHaveBeenCalled();
  const created = await createContentRun("u", "session", request, "submit-document-key-123", value);
  expect(created.steps).toHaveLength(1);
  expect(value.db.creationRun.create.mock.calls[0][0].data.steps.create[0].params).toMatchObject({ purpose: "document.outline", sectionCount: 2, audience: "Investors" });
  expect(created.input.width).toBeUndefined();
  expect(mocks.event.mock.calls[0][3]).toMatchObject({ stepCount: 4 });
});

it("resumes free document assembly without enabling new model admissions or requesting a language worker", async () => {
  const value = fixture();
  value.run.status = "awaiting_input"; value.run.errorCode = "TEMPORARY_STORAGE"; value.run.committedCredits = 6;
  value.run.steps.push({ id: "assemble", tool: "document.assemble", status: "ready", position: 1, expectedCost: 0 });
  value.db.tryOn.findMany = vi.fn(async () => []);
  const configFor = vi.fn(() => { throw new Error("No model call needed"); });
  await resumeContentRun("u", value.run, { expectedSequence: 3, maxCredits: 6, retryFailed: false }, { ...value, env: {}, configFor });
  expect(value.ensureWorkers).toHaveBeenCalledWith(value.db, { language: false, kind: "document", posterImage: false });
  expect(configFor).not.toHaveBeenCalled();
  expect(value.run.steps.at(-1).expectedCost).toBe(0);
  expect(value.run.status).toBe("queued");
});

it("checks budget before upload, freezes the reviewed outline, and replays an accepted confirmation with admission off", async () => {
  const value = fixture(), request = approval();
  await expect(confirmOutline("u", "run", { ...request, maxCredits: 4 }, value)).rejects.toThrow("CREATION_BUDGET_EXCEEDED");
  expect(value.store.put).not.toHaveBeenCalled();
  request.outline.sections.reverse();
  const confirmed = await confirmOutline("u", "run", request, value);
  expect(confirmed.steps.map(step => step.tool)).toEqual(["document.outline", "document.section", "document.section", "document.assemble"]);
  expect(confirmed.steps.map(step => step.status)).toEqual(["succeeded", "ready", "blocked", "blocked"]);
  expect(confirmed.steps[3].expectedCost).toBe(0);
  expect(confirmed.input.sectionCount).toBe(2);
  expect(await readApprovedOutline("u", value.run, value)).toEqual(request.outline);
  expect((await confirmOutline("u", "run", request, { ...value, env: {} })).steps).toHaveLength(4);
  expect(value.db.creationStep.createMany).toHaveBeenCalledOnce();
  expect(value.store.put).toHaveBeenCalledOnce();
});

it("routes document steps through language and publication ports and dispatches assembly without a model call", async () => {
  const value = fixture(); value.run.status = "queued";
  value.run.steps = [{ id: "section", tool: "document.section", status: "ready", position: 0 }];
  const submitLanguage = vi.fn(), submit = vi.fn(), publishLanguage = vi.fn(), assembleDocument = vi.fn();
  const deps = { ...value, languageConfigFor: async () => config, submitLanguage, submit, publishLanguage, assembleDocument };
  await advanceRun("run", deps);
  expect(submitLanguage).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled();
  value.run.steps[0].jobId = "section-job";
  await advanceRun("run", deps); expect(publishLanguage).toHaveBeenCalledOnce();
  value.run.steps[0] = { id: "assemble", tool: "document.assemble", status: "ready", position: 0 };
  await advanceRun("run", deps); expect(assembleDocument).toHaveBeenCalledOnce();
  expect(submitLanguage).toHaveBeenCalledOnce();
});

it("publishes the outline to user review without creating or starting section tasks", async () => {
  const value = fixture(); value.run.status = "running"; value.run.steps[0].status = "running";
  mocks.result.mockResolvedValue(outline());
  await publishCreationLanguage(value.run, value.run.steps[0], value);
  expect(value.run.status).toBe("awaiting_input");
  expect(value.run.steps).toHaveLength(1);
  expect(value.db.creationStep.createMany).not.toHaveBeenCalled();
  expect(value.run.steps[0].result).toMatchObject({ sectionCount: 2, awaitingConfirmation: true });
  expect(mocks.message).toHaveBeenCalledOnce();
});

it("assembles saved section checkpoints in approved order and completes publication in the artifact transaction hook", async () => {
  const value = fixture(); await confirmOutline("u", "run", approval(), value);
  const children = value.run.steps.filter(step => step.tool === "document.section");
  children.forEach((step, index) => { step.status = "succeeded"; step.jobId = `job${index}`; });
  const last = value.run.steps.at(-1); last.status = "ready";
  mocks.result.mockImplementation(async (_userId, id) => { const input = children.find(step => step.jobId === id).params; return { id: input.sectionId, title: input.title, blocks: [{ id: "p", type: "paragraph", runs: [{ text: input.title }] }] }; });
  mocks.createDoc.mockImplementation(async (_user, _project, content, _key, options) => { expect(content.sections.map(section => section.id)).toEqual(["a", "b"]); await options.hooks.beforeCommit(value.db); await options.hooks.afterCommit(value.db, { artifactId: "saved", revision: 1 }); return { artifactId: "saved" }; });
  await assembleCreationDocument(value.run, last, value);
  expect(value.run.status).toBe("succeeded");
  expect(last.result).toEqual({ artifactId: "saved", revision: 1, disposition: "created" });
  expect(mocks.result).toHaveBeenCalledTimes(2);
  expect(mocks.createDoc).toHaveBeenCalledOnce();
});

it("keeps manual changes by publishing a document AI edit as a separate copy on version conflict", async () => {
  const value = fixture(); value.run.status = "running";
  const input = { purpose: "document.edit", prompt: "Change price", artifactId: "doc", baseRevision: 1, sectionId: "s", blockIds: ["p"], assetIds: [], locale: "en" };
  const step = { id: "edit", tool: "document.edit", params: input, position: 0, status: "running", jobId: "edit-job", attempt: 0 };
  value.run.steps = [step];
  const content = textDocumentSchema.parse({ schemaVersion: 1, kind: "document", title: "Report", sections: [{ id: "s", title: "Summary", blocks: [{ id: "p", type: "paragraph", runs: [{ text: "18" }] }] }] });
  mocks.readDoc.mockResolvedValue({ content });
  mocks.result.mockResolvedValue({ operations: [{ op: "replaceDocumentText", sectionId: "s", blockId: "p", leafId: "p", start: 0, end: 2, expectedText: "18", text: "20" }] });
  mocks.modifyDoc.mockRejectedValue(Object.assign(new Error("conflict"), { code: "ARTIFACT_VERSION_CONFLICT" }));
  mocks.createDoc.mockResolvedValue({ artifactId: "copy", revision: 1 });
  await publishCreationLanguage(value.run, step, value);
  expect(mocks.createDoc.mock.calls[0][2].sections[0].blocks[0].runs[0].text).toBe("20");
  expect(mocks.createDoc.mock.calls[0][2].title).toContain("AI edit copy");
  expect(content.sections[0].blocks[0].runs[0].text).toBe("18");
  expect(mocks.readDoc).toHaveBeenCalledWith("u", "doc", 1, expect.anything());
});

it("refuses mismatched section metadata before publishing a document", async () => {
  const value = fixture(); await confirmOutline("u", "run", approval(), value);
  value.run.steps.filter(step => step.tool === "document.section").forEach(step => { step.status = "succeeded"; step.jobId = `job-${step.id}`; });
  value.run.steps[1].params.brief = "Unapproved content";
  await expect(assembleCreationDocument(value.run, value.run.steps.at(-1), value)).rejects.toThrow("CREATION_OUTLINE_CHANGED");
  expect(mocks.result).not.toHaveBeenCalled(); expect(mocks.createDoc).not.toHaveBeenCalled();
});
