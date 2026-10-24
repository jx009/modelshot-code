import { beforeEach, expect, it, vi } from "vitest";
import { createContentRun, ensureContentWorkers, requireContentCreation } from "../../src/lib/domain/creation/content-runs.js";
import { advanceRun } from "../../src/lib/domain/creation/scheduler.js";
import { publishCreationLanguage } from "../../src/lib/domain/creation/publication.js";
import { validateLanguageResult } from "../../src/lib/creation/contracts/language.js";
import { webSchema } from "../../src/lib/creation/contracts/web.js";
import { WEB_LANGUAGE_HEARTBEAT, WEB_SCHEDULER_HEARTBEAT } from "../../src/lib/creation/contracts/web-runtime.js";

const mocks = vi.hoisted(() => ({ result: vi.fn(), read: vi.fn(), modify: vi.fn(), create: vi.fn(), event: vi.fn(), message: vi.fn() }));
vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => { throw new Error("Real storage forbidden"); } }));
vi.mock("../../src/lib/domain/billing/ledger.js", () => ({ lockUser: vi.fn() }));
vi.mock("../../src/lib/domain/creation/runs.js", () => ({ lockRun: async db => db.run, presentRun: run => structuredClone(run) }));
vi.mock("../../src/lib/domain/creation/language-execution.js", () => ({ readCreationLanguageResult: (...args) => mocks.result(...args) }));
vi.mock("../../src/lib/domain/creation/web-artifacts.js", () => ({ readWebArtifact: (...args) => mocks.read(...args), modifyWebArtifact: (...args) => mocks.modify(...args), createWebArtifact: (...args) => mocks.create(...args) }));
vi.mock("../../src/lib/domain/creation/events.js", () => ({ appendRunEvent: (...args) => mocks.event(...args), enqueueRun: vi.fn() }));
vi.mock("../../src/lib/domain/creation/messages.js", () => ({ appendCreationMessage: (...args) => mocks.message(...args) }));
vi.mock("../../src/lib/domain/creation/artifacts.js", () => ({ ownedArtifact: async () => ({ currentRevision: 1 }), readLayoutArtifact: () => { throw new Error("Wrong codec"); }, createLayoutArtifact: () => { throw new Error("Wrong codec"); }, modifyLayoutArtifact: () => { throw new Error("Wrong codec"); } }));
const book = () => webSchema.parse({ schemaVersion: 1, kind: "web", title: "Coffee", theme: { primary: "#111111", accent: "#ee5500", background: "#ffffff", fontFamily: "sans" }, entryPath: "index.html", files: [{ id: "html", path: "index.html", kind: "html", content: "<h1>Coffee</h1>" }, { id: "css", path: "styles.css", kind: "css", content: "h1{color:red}" }] });
const params = { purpose: "web.edit", prompt: "Update title", artifactId: "web", baseRevision: 1, fileIds: ["html"], paths: ["index.html"], locale: "en", assetIds: [] };
const patch = { operations: [{ op: "setFile", fileId: "html", path: "index.html", kind: "html", content: "<h1>New coffee</h1>" }] };
function fixture() {
  const run = { id: "run", userId: "u", projectId: "project", sessionId: "session", kind: "web", status: "running", eventSequence: 1, input: { locale: "en" }, steps: [{ id: "step", position: 0, attempt: 0, status: "running", jobId: "web-edit-job-1234", tool: "web.edit", params }] };
  const db = { run, $queryRaw: vi.fn(), creationRun: { findUnique: vi.fn(async () => null), count: vi.fn(async () => 0), create: vi.fn(async ({ data }) => Object.assign(run, { ...data, steps: [data.steps.create] })) },
    creationSession: { findFirst: vi.fn(async () => ({ id: "session", projectId: "project", project: { kind: "web" } })) },
    creationStep: { update: vi.fn(async ({ data }) => Object.assign(run.steps[0], data)), findUnique: vi.fn(async () => null) },
    tryOn: { findFirst: vi.fn(async () => ({ snapshot: { creationStepId: "step", creationAttempt: 0 } })) } };
  db.$transaction = async fn => fn(db);
  return { run, db, store: {}, configFor: async () => ({ visionApiKey: "fake", chatModel: "fake", plannerCreditCost: 1 }), ensureWorkers: vi.fn(), env: { CREATION_RUNS_ENABLED: "true", CREATION_WORKSPACE_ENABLED: "true", CREATION_WEB_ENABLED: "true" } };
}
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.event.mockImplementation(async (db, _id, _type, _payload, changes) => { Object.assign(db.run, changes); db.run.eventSequence++; return db.run; });
  mocks.read.mockResolvedValue({ projectId: "project", kind: "web", content: book() });
});
it("requires web-specific worker version heartbeats rather than accepting older generic workers", async () => {
  const db = { serviceHeartbeat: { findMany: vi.fn(async () => [{ id: "worker" }, { id: "creation-worker" }, { id: "creation-language-worker" }]) } };
  await expect(ensureContentWorkers(db, { kind: "web" })).rejects.toThrow("CREATION_WORKER_UNAVAILABLE");
  const rows = [{ id: "worker" }, { id: WEB_SCHEDULER_HEARTBEAT, details: { version: 1 } }, { id: WEB_LANGUAGE_HEARTBEAT, details: { version: 1 } }];
  db.serviceHeartbeat.findMany.mockResolvedValue(rows);
  await expect(ensureContentWorkers(db, { kind: "web" })).resolves.toBeUndefined();
  rows[2].details.version = 0;
  await expect(ensureContentWorkers(db, { kind: "web" })).rejects.toThrow("CREATION_WORKER_UNAVAILABLE");
});
it("validates web selections before creating paid work and never tries to read layout pages", async () => {
  const value = fixture(), { purpose: _purpose, prompt, locale, assetIds, ...target } = params;
  const request = { kind: "web", prompt, locale, assetIds, target, maxCredits: 1 };
  await expect(createContentRun("u", "session", { ...request, target: { ...target, paths: ["styles.css"] } }, "web-create-key-123", value)).rejects.toThrow("LANGUAGE_SELECTION_CHANGED");
  expect(value.db.creationRun.create).not.toHaveBeenCalled();
  const result = await createContentRun("u", "session", request, "web-create-key-123", value);
  expect(value.db.creationRun.create).toHaveBeenCalledOnce();
  expect(result.steps[0].params).toMatchObject({ purpose: "web.edit", fileIds: ["html"], paths: ["index.html"] });
  expect(value.ensureWorkers).toHaveBeenCalledWith(value.db, { kind: "web" });
});
it("revalidates serialized edit checkpoints and completes publication in the artifact hook", async () => {
  const value = fixture(), validated = validateLanguageResult(params, patch, book());
  mocks.result.mockResolvedValue(JSON.parse(JSON.stringify(validated)));
  mocks.modify.mockImplementation(async (_user, _id, _patch, options) => { await options.hooks.beforeCommit(value.db); await options.hooks.afterCommit(value.db, { artifactId: "web", revision: 2 }); return { artifactId: "web", revision: 2 }; });
  await publishCreationLanguage(value.run, value.run.steps[0], value);
  expect(value.run.status).toBe("succeeded"); expect(value.run.steps[0].result).toEqual({ artifactId: "web", revision: 2, disposition: "updated" });
  expect(mocks.result).toHaveBeenCalledOnce(); expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.modify.mock.calls[0][2]).toMatchObject({ baseRevision: 1, operations: patch.operations });
});
it("applies conflicts to the original web revision and publishes a separate site without overwriting manual edits", async () => {
  const value = fixture(), source = book(); mocks.read.mockResolvedValue({ content: source }); mocks.result.mockResolvedValue(patch);
  mocks.modify.mockRejectedValue(Object.assign(new Error("conflict"), { code: "ARTIFACT_VERSION_CONFLICT" }));
  mocks.create.mockImplementation(async (_user, _project, _content, _key, options) => { await options.hooks.beforeCommit(value.db); await options.hooks.afterCommit(value.db, { artifactId: "copy", revision: 1 }); });
  await publishCreationLanguage(value.run, value.run.steps[0], value);
  const copy = mocks.create.mock.calls[0][2];
  expect(copy.kind).toBe("web"); expect(copy.files[0].content).toBe("<h1>New coffee</h1>"); expect(copy.files[1]).toEqual(source.files[1]);
  expect(source.files[0].content).toBe("<h1>Coffee</h1>"); expect(copy.title).toContain("AI edit copy");
  expect(value.run.steps[0].result.disposition).toBe("conflict-copy"); expect(mocks.result).toHaveBeenCalledOnce();
});

it("keeps web admission off without its explicit flag and generates a single content step", async () => {
  const value = fixture();
  expect(() => requireContentCreation("web", { ...value.env, CREATION_WEB_ENABLED: undefined })).toThrow("CREATION_NOT_ENABLED");
  const result = await createContentRun("u", "session", { kind: "web", prompt: "Coffee site", locale: "en", maxCredits: 1, pageCount: 2 }, "web-generate-key-123", value);
  expect(result.steps).toHaveLength(1); expect(result.steps[0]).toMatchObject({ tool: "web.generate", explanation: "Create website", params: { pageCount: 2 } });
  expect(result.input.pageCount).toBe(2); expect(result.input).not.toHaveProperty("width");
  expect(mocks.event.mock.calls[0][3].stepCount).toBe(1);
});
it("dispatches web language work and finalizes saved model results without image or assembly calls", async () => {
  const { db, run } = fixture();
  db.creationRun.findUnique.mockResolvedValue(run);
  const submitLanguage = vi.fn(), publishLanguage = vi.fn(), configFor = vi.fn(), assembleSlides = vi.fn(), assembleDocument = vi.fn();
  const options = { db, store: {}, submitLanguage, publishLanguage, configFor, assembleSlides, assembleDocument, languageConfigFor: async () => ({ model: "fake" }) };
  run.steps[0].jobId = null; run.steps[0].status = "ready";
  await advanceRun(run.id, options);
  expect(submitLanguage).toHaveBeenCalledOnce(); expect(configFor).not.toHaveBeenCalled();
  run.steps[0].jobId = "completed-job"; db.tryOn.findFirst.mockResolvedValue({ status: "succeeded" });
  await advanceRun(run.id, options);
  expect(publishLanguage).toHaveBeenCalledWith(run, run.steps[0], { db, store: {} });
  expect(assembleSlides).not.toHaveBeenCalled(); expect(assembleDocument).not.toHaveBeenCalled();
});
it("resumes completed web model work for artifact saving without another paid invocation", async () => {
  const value = fixture(), { run, db } = value;
  run.status = "awaiting_input"; run.errorCode = "ARTIFACT_VERSION_CONFLICT"; run.input.languageUnitCost = 1; run.committedCredits = 1;
  db.creationRun.findFirst = vi.fn(async () => run);
  db.creationRun.findUnique.mockResolvedValue(run);
  db.tryOn.findMany = vi.fn(async () => [{ id: run.steps[0].jobId, status: "succeeded" }]);
  const priceSteps = vi.fn(), configFor = vi.fn();
  const { resumeRun } = await vi.importActual("../../src/lib/domain/creation/runs.js");
  await resumeRun("u", "run", { expectedSequence: 1, maxCredits: 1 }, db, { ...value, env: {}, priceSteps, configFor });
  expect(priceSteps).not.toHaveBeenCalled(); expect(configFor).not.toHaveBeenCalled();
  expect(value.ensureWorkers).toHaveBeenCalledWith(db, { kind: "web", language: false });
  expect(run.steps[0].jobId).toBe("web-edit-job-1234"); expect(run.status).toBe("queued");
});
