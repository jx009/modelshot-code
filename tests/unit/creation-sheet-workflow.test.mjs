import { beforeEach, expect, it, vi } from "vitest";
import { createContentRun, ensureContentWorkers } from "../../src/lib/domain/creation/content-runs.js";
import { publishCreationLanguage, assembleCreationSheet } from "../../src/lib/domain/creation/publication.js";
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
  const db = { run, $queryRaw: vi.fn(), creationRun: { findUnique: vi.fn(async () => null), count: vi.fn(async () => 0), create: vi.fn(async ({ data }) => ({ id: "run", ...data, steps: data.steps.create })) },
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
  expect(value.db.creationRun.create.mock.calls[0][0].data.steps.create[0].params).toMatchObject({ purpose: "sheet.edit", sheetId: "s", addresses: ["A1"] });
  expect(value.ensureWorkers).toHaveBeenCalledWith(value.db, { kind: "sheet", posterImage: false });
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

it("prices every bounded sheet chunk before admission and keeps small sheets on the existing path", async () => {
  const value = fixture();
  await expect(createContentRun("u", "session", { kind: "sheet", prompt: "Budget", sheetCount: 2, targetRows: 40, maxCredits: 4 }, "sheet-batch-key-123", value)).rejects.toThrow("CREATION_BUDGET_EXCEEDED");
  const result = await createContentRun("u", "session", { kind: "sheet", prompt: "Budget", sheetCount: 2, targetRows: 40, maxCredits: 5 }, "sheet-batch-key-123", value);
  expect(result.steps[0].params).toMatchObject({ purpose: "sheet.outline", sheetCount: 2, targetRows: 40 });
});
it("expands and assembles persisted chunks with stable cell identities and no model rerun", async () => {
  const value = fixture(), { run, db } = value;
  Object.assign(run, { committedCredits: 1, maxCredits: 5, input: { locale: "en", sheetCount: 1, targetRows: 40, languageUnitCost: 1 } });
  run.steps = [{ id: "step", position: 0, tool: "sheet.outline", params: { purpose: "sheet.outline", prompt: "Budget", sheetCount: 1, targetRows: 40 }, status: "running", jobId: "outline", attempt: 0, dependsOn: [] }];
  db.creationStep.createMany = vi.fn(async ({ data }) => { run.steps.push(...data); });
  db.creationStep.update.mockImplementation(async ({ where, data }) => Object.assign(run.steps.find(step => step.id === where.id), data));
  const outline = { title: "Budget", sheets: [{ id: "s", name: "Costs", columns: ["Label", "Amount"], brief: "Example costs" }] };
  mocks.result.mockResolvedValue(outline);
  await publishCreationLanguage(run, run.steps[0], value);
  expect(run.steps.map(step => step.tool)).toEqual(["sheet.outline", "sheet.chunk", "sheet.chunk", "sheet.assemble"]);
  expect(run.steps[1].params).toMatchObject({ startRow: 1, endRow: 25 });
  expect(run.steps[2].params).toMatchObject({ startRow: 26, endRow: 40 });
  expect(run.steps[2].dependsOn).toEqual([run.steps[1].id]);
  run.steps[1].status = "succeeded"; run.steps[1].jobId = "chunk1"; run.steps[2].status = "succeeded"; run.steps[2].jobId = "chunk2"; run.steps[3].status = "ready";
  mocks.result.mockImplementation(async (_u, id) => id === "outline" ? outline : { sheetId: "s", cells: [{ id: "duplicate-model-id", address: id === "chunk1" ? "A1" : "A26", value: id }] });
  mocks.create.mockImplementation(async (_user, _project, content, _key, options) => { await options.hooks.beforeCommit(db); await options.hooks.afterCommit(db, { artifactId: "sheet", revision: 1 }); return content; });
  const content = await assembleCreationSheet(run, run.steps[3], value);
  expect(content.sheets[0].cells.map(cell => cell.id)).toEqual(["s_A1", "s_A26"]);
  expect(run.status).toBe("succeeded");
});
it("rejects chunks that write outside their row range or change columns", () => {
  const input = { purpose: "sheet.chunk", sheetId: "s", columns: ["A"], startRow: 26, endRow: 50 };
  for (const address of ["A25", "A51", "B26"]) expect(() => validateLanguageResult(input, { sheetId: "s", cells: [{ id: "cell", address, value: 1 }] })).toThrow("LANGUAGE_SHEET_CHUNK_MISMATCH");
});

it("limits chunk work to the planned useful rows and persists one shared structure", async () => {
  const value = fixture(), { run, db } = value;
  Object.assign(run, { committedCredits: 1, maxCredits: 5, input: { locale: "en", sheetCount: 1, targetRows: 60, languageUnitCost: 1 } });
  run.steps = [{ id: "step", position: 0, tool: "sheet.outline", params: { purpose: "sheet.outline", prompt: "Budget", sheetCount: 1, targetRows: 60 }, status: "running", jobId: "outline", attempt: 0, dependsOn: [] }];
  db.creationStep.createMany = vi.fn(async ({ data }) => { run.steps.push(...data); });
  db.creationStep.update.mockImplementation(async ({ where, data }) => Object.assign(run.steps.find(step => step.id === where.id), data));
  const plan = { rowCount: 28, columnFormats: ["general", "currency"], rows: [{ startRow: 2, endRow: 27, brief: "26 actual source records in source order" }], totals: [{ column: 2, operation: "SUM" }] };
  const outline = { title: "Budget", sheets: [{ id: "s", name: "Costs", columns: ["Code", "Amount"], brief: "Source costs", plan }] };
  mocks.result.mockResolvedValue(outline);
  await publishCreationLanguage(run, run.steps[0], value);
  const chunks = run.steps.filter(step => step.tool === "sheet.chunk");
  expect(chunks.map(step => [step.params.startRow, step.params.endRow])).toEqual([[1, 25], [26, 28]]);
  expect(chunks.every(step => JSON.stringify(step.params.plan) === JSON.stringify(plan))).toBe(true);
  for (const [index, step] of chunks.entries()) { step.status = "succeeded"; step.jobId = `chunk${index}`; }
  run.steps.at(-1).status = "ready";
  mocks.result.mockImplementation(async (_user, id) => id === "outline" ? outline : { sheetId: "s", cells: [{ id: "cell", address: id === "chunk0" ? "B2" : "B26", value: 20 }] });
  mocks.create.mockImplementation(async (_user, _project, content) => content);
  const content = await assembleCreationSheet(run, run.steps.at(-1), value);
  expect(content.sheets[0].cells.find(cell => cell.address === "B28").formula).toBe('=IF(COUNT(B2:B27)=0,"",SUM(B2:B27))');
  chunks[1].params.startRow = 27;
  mocks.result.mockImplementation(async (_user, id) => id === "outline" ? outline : { sheetId: "s", cells: [{ id: "cell", address: id === "chunk0" ? "B2" : "B27", value: 20 }] });
  await expect(assembleCreationSheet(run, run.steps.at(-1), value)).rejects.toThrow("CREATION_OUTLINE_CHANGED");
});
