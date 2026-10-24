import { beforeEach, expect, it, vi } from "vitest";
import { createContentRun, ensureContentWorkers } from "../../src/lib/domain/creation/content-runs.js";
import { publishCreationLanguage } from "../../src/lib/domain/creation/publication.js";
import { validateLanguageResult } from "../../src/lib/creation/contracts/language.js";
import { workbookSchema } from "../../src/lib/creation/contracts/sheet.js";
import { SHEET_PIPELINE_VERSION, SHEET_LANGUAGE_HEARTBEAT, SHEET_SCHEDULER_HEARTBEAT } from "../../src/lib/creation/contracts/sheet-runtime.js";

const mocks = vi.hoisted(() => ({ result: vi.fn(), read: vi.fn(), modify: vi.fn(), create: vi.fn(), event: vi.fn(), message: vi.fn() }));
vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => { throw new Error("Real storage forbidden"); } }));
vi.mock("../../src/lib/domain/billing/ledger.js", () => ({ lockUser: vi.fn() }));
vi.mock("../../src/lib/domain/creation/runs.js", () => ({ lockRun: async db => db.run, presentRun: run => structuredClone(run) }));
vi.mock("../../src/lib/domain/creation/language-execution.js", () => ({ readCreationLanguageResult: (...args) => mocks.result(...args) }));
vi.mock("../../src/lib/domain/creation/sheet-artifacts.js", () => ({ readSheetArtifact: (...args) => mocks.read(...args), modifySheetArtifact: (...args) => mocks.modify(...args), createSheetArtifact: (...args) => mocks.create(...args) }));
vi.mock("../../src/lib/domain/creation/events.js", () => ({ appendRunEvent: (...args) => mocks.event(...args), enqueueRun: vi.fn() }));
vi.mock("../../src/lib/domain/creation/messages.js", () => ({ appendCreationMessage: (...args) => mocks.message(...args) }));
vi.mock("../../src/lib/domain/creation/artifacts.js", () => ({ ownedArtifact: async () => ({ currentRevision: 1 }), readLayoutArtifact: () => { throw new Error("Wrong codec"); }, createLayoutArtifact: () => { throw new Error("Wrong codec"); }, modifyLayoutArtifact: () => { throw new Error("Wrong codec"); } }));
const book = () => workbookSchema.parse({ schemaVersion: 1, kind: "sheet", title: "Budget", sheets: [{ id: "s", name: "Costs", cells: [{ id: "a1", address: "A1", value: 10 }, { id: "b1", address: "B1", value: 99 }] }] });
const params = { purpose: "sheet.edit", prompt: "Update amount", artifactId: "sheet", baseRevision: 1, sheetId: "s", addresses: ["A1"], locale: "en", assetIds: [] };
const patch = { operations: [{ op: "setCell", sheetId: "s", address: "A1", id: "a1", value: 20, expectedValue: 10 }] };
function fixture() {
  const run = { id: "run", userId: "u", projectId: "project", sessionId: "session", kind: "sheet", status: "running", eventSequence: 1, input: { locale: "en" }, steps: [{ id: "step", position: 0, attempt: 0, status: "running", jobId: "sheet-edit-job-1234", tool: "sheet.edit", params }] };
  const db = { run, $queryRaw: vi.fn(), creationRun: { findUnique: vi.fn(async () => null), count: vi.fn(async () => 0), create: vi.fn(async ({ data }) => ({ id: "run", ...data, steps: [data.steps.create] })) },
    creationSession: { findFirst: vi.fn(async () => ({ id: "session", projectId: "project", project: { kind: "sheet" } })) },
    creationStep: { update: vi.fn(async ({ data }) => Object.assign(run.steps[0], data)), findUnique: vi.fn(async () => null) },
    tryOn: { findFirst: vi.fn(async () => ({ snapshot: { creationStepId: "step", creationAttempt: 0 } })) } };
  db.$transaction = async fn => fn(db);
  return { run, db, store: {}, configFor: async () => ({ visionApiKey: "fake", chatModel: "fake", plannerCreditCost: 1 }), ensureWorkers: vi.fn(), env: { CREATION_RUNS_ENABLED: "true", CREATION_WORKSPACE_ENABLED: "true", CREATION_SHEET_ENABLED: "true" } };
}
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.event.mockImplementation(async (db, _id, _type, _payload, changes) => { Object.assign(db.run, changes); db.run.eventSequence++; return db.run; });
  mocks.read.mockResolvedValue({ projectId: "project", kind: "sheet", content: book() });
});
it("requires sheet-specific worker version heartbeats rather than accepting older generic workers", async () => {
  const db = { serviceHeartbeat: { findMany: vi.fn(async () => [{ id: "worker" }, { id: "creation-worker" }, { id: "creation-language-worker" }]) } };
  await expect(ensureContentWorkers(db, { kind: "sheet" })).rejects.toThrow("CREATION_WORKER_UNAVAILABLE");
  const rows = [{ id: "worker" }, { id: SHEET_SCHEDULER_HEARTBEAT, details: { version: SHEET_PIPELINE_VERSION } }, { id: SHEET_LANGUAGE_HEARTBEAT, details: { version: SHEET_PIPELINE_VERSION } }];
  db.serviceHeartbeat.findMany.mockResolvedValue(rows);
  await expect(ensureContentWorkers(db, { kind: "sheet" })).resolves.toBeUndefined();
  rows[2].details.version = 0;
  await expect(ensureContentWorkers(db, { kind: "sheet" })).rejects.toThrow("CREATION_WORKER_UNAVAILABLE");
});
it("validates sheet selections before creating paid work and never tries to read layout pages", async () => {
  const value = fixture(), { purpose: _purpose, prompt, locale, assetIds, ...target } = params;
  const request = { kind: "sheet", prompt, locale, assetIds, target, maxCredits: 1 };
  await expect(createContentRun("u", "session", { ...request, target: { ...target, sheetId: "wrong" } }, "sheet-create-key-123", value)).rejects.toThrow("LANGUAGE_SELECTION_CHANGED");
  expect(value.db.creationRun.create).not.toHaveBeenCalled();
  const result = await createContentRun("u", "session", request, "sheet-create-key-123", value);
  expect(value.db.creationRun.create).toHaveBeenCalledOnce();
  expect(result.steps[0].params).toMatchObject({ purpose: "sheet.edit", sheetId: "s", addresses: ["A1"] });
  expect(value.ensureWorkers).toHaveBeenCalledWith(value.db, { kind: "sheet" });
});
it("revalidates serialized edit checkpoints and completes publication in the artifact hook", async () => {
  const value = fixture(), validated = validateLanguageResult(params, patch, book());
  mocks.result.mockResolvedValue(JSON.parse(JSON.stringify(validated)));
  mocks.modify.mockImplementation(async (_user, _id, _patch, options) => { await options.hooks.beforeCommit(value.db); await options.hooks.afterCommit(value.db, { artifactId: "sheet", revision: 2 }); return { artifactId: "sheet", revision: 2 }; });
  await publishCreationLanguage(value.run, value.run.steps[0], value);
  expect(value.run.status).toBe("succeeded"); expect(value.run.steps[0].result).toEqual({ artifactId: "sheet", revision: 2, disposition: "updated" });
  expect(mocks.result).toHaveBeenCalledOnce(); expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.modify.mock.calls[0][2]).toMatchObject({ baseRevision: 1, operations: patch.operations });
});
it("applies conflicts to the original sheet revision and publishes a separate workbook without overwriting manual edits", async () => {
  const value = fixture(), source = book(); mocks.read.mockResolvedValue({ content: source }); mocks.result.mockResolvedValue(patch);
  mocks.modify.mockRejectedValue(Object.assign(new Error("conflict"), { code: "ARTIFACT_VERSION_CONFLICT" }));
  mocks.create.mockImplementation(async (_user, _project, _content, _key, options) => { await options.hooks.beforeCommit(value.db); await options.hooks.afterCommit(value.db, { artifactId: "copy", revision: 1 }); });
  await publishCreationLanguage(value.run, value.run.steps[0], value);
  const copy = mocks.create.mock.calls[0][2];
  expect(copy.kind).toBe("sheet"); expect(copy.sheets[0].cells.map(cell => cell.value)).toEqual([20, 99]);
  expect(source.sheets[0].cells.map(cell => cell.value)).toEqual([10, 99]); expect(copy.title).toContain("AI edit copy");
  expect(value.run.steps[0].result.disposition).toBe("conflict-copy"); expect(mocks.result).toHaveBeenCalledOnce();
});
