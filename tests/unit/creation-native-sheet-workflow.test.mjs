import { beforeEach, expect, it, vi } from "vitest";
import { createContentRun, ensureContentWorkers, resumeContentRun } from "../../src/lib/domain/creation/content-runs.js";
import { publishCreationLanguage } from "../../src/lib/domain/creation/publication.js";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";
import { toNativeDocumentArtifact } from "../../src/lib/creation/native-document-adapter.js";
import { SHEET_PIPELINE_VERSION, SHEET_LANGUAGE_HEARTBEAT, SHEET_SCHEDULER_HEARTBEAT } from "../../src/lib/creation/contracts/sheet-runtime.js";

const ports = vi.hoisted(() => ({ result: vi.fn(), read: vi.fn(), modify: vi.fn(), create: vi.fn(), event: vi.fn(), message: vi.fn() }));
vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => { throw new Error("Real storage forbidden"); } }));
vi.mock("../../src/lib/domain/billing/ledger.js", () => ({ lockUser: vi.fn() }));
vi.mock("../../src/lib/domain/creation/runs.js", () => ({ lockRun: async db => db.run, presentRun: run => structuredClone(run) }));
vi.mock("../../src/lib/domain/creation/language-execution.js", () => ({ readCreationLanguageResult: (...args) => ports.result(...args) }));
vi.mock("../../src/lib/domain/creation/native-office-artifacts.js", () => ({ readNativeOfficeArtifact: (...args) => ports.read(...args), modifyNativeSheetArtifact: (...args) => ports.modify(...args), modifyNativeDocumentArtifact: (...args) => ports.modify(...args), createNativeOfficeArtifact: (...args) => ports.create(...args) }));
vi.mock("../../src/lib/domain/creation/sheet-artifacts.js", () => ({ readSheetArtifact: () => { throw new Error("Wrong semantic codec"); } }));
vi.mock("../../src/lib/domain/creation/events.js", () => ({ appendRunEvent: (...args) => ports.event(...args), enqueueRun: vi.fn() }));
vi.mock("../../src/lib/domain/creation/messages.js", () => ({ appendCreationMessage: (...args) => ports.message(...args) }));
vi.mock("../../src/lib/domain/creation/artifacts.js", () => ({ ownedArtifact: async () => ({ currentRevision: 1 }), readLayoutArtifact: () => { throw new Error("Wrong codec"); }, createLayoutArtifact: vi.fn(), modifyLayoutArtifact: vi.fn() }));

const book = () => toNativeSheetArtifact({ schemaVersion: 1, kind: "sheet", title: "Budget", sheets: [{ id: "s", name: "Costs", cells: [{ id: "a1", address: "A1", value: 10 }, { id: "b1", address: "B1", value: 99 }] }] }, "unit");
const target = { format: "univer-sheet-1", artifactId: "sheet", baseRevision: 1, unitId: "unit", sheetId: "sheet0", cells: [{ row: 0, column: 0 }] };
const params = { ...target, purpose: "sheet.native.edit", prompt: "Update amount", locale: "en", assetIds: [] };
const patch = { operations: [{ op: "setNativeCell", sheetId: "sheet0", row: 0, column: 0, value: 20 }] };
function fixture(kind = "sheet") {
  const run = { id: "run", userId: "u", projectId: "project", sessionId: "session", kind, status: "running", eventSequence: 1, committedCredits: 0, input: { locale: "en", languageUnitCost: 1 }, steps: [{ id: "step", position: 0, attempt: 0, status: "running", jobId: "sheet-edit-job-1234", tool: "sheet.native.edit", params }] };
  const db = { run, $queryRaw: vi.fn(), creationRun: { findUnique: vi.fn(async () => null), count: vi.fn(async () => 0), create: vi.fn(async ({ data }) => ({ id: "run", ...data, steps: data.steps.create })) },
    creationSession: { findFirst: vi.fn(async () => ({ id: "session", projectId: "project", project: { kind } })) },
    creationStep: { update: vi.fn(async ({ data }) => Object.assign(run.steps[0], data)), findUnique: vi.fn(async () => null) },
    tryOn: { findFirst: vi.fn(async () => ({ snapshot: { creationStepId: "step", creationAttempt: 0 } })), findMany: vi.fn(async () => [{ id: run.steps[0].jobId, status: "succeeded" }]) } };
  db.$transaction = async fn => fn(db);
  return { run, db, store: {}, configFor: async () => ({ visionApiKey: "fake", chatModel: "fake", plannerCreditCost: 1 }), ensureWorkers: vi.fn(), env: { CREATION_RUNS_ENABLED: "true", CREATION_WORKSPACE_ENABLED: "true", CREATION_SHEET_ENABLED: "true", CREATION_DOCUMENT_ENABLED: "true", CREATION_NATIVE_OFFICE_ENABLED: "true" } };
}
beforeEach(() => {
  Object.values(ports).forEach(port => port.mockReset());
  ports.event.mockImplementation(async (db, _id, _type, _payload, changes) => { Object.assign(db.run, changes); db.run.eventSequence++; return db.run; });
  ports.read.mockResolvedValue({ projectId: "project", kind: "sheet", content: book() }); ports.result.mockResolvedValue(patch);
});

const document = () => toNativeDocumentArtifact({ schemaVersion: 1, kind: "document", title: "Report", sections: [{ id: "s", title: "Section", blocks: [{ id: "p", type: "paragraph", runs: [{ text: "Original", marks: { bold: true } }] }] }] }, "unit");
const docTarget = { format: "univer-document-1", artifactId: "doc", baseRevision: 1, unitId: "unit", segmentId: "", spans: [{ start: 0, end: 8, expectedText: "Original" }] };
const docPatch = { operations: [{ op: "replaceNativeText", segmentId: "", ...docTarget.spans[0], text: "Revised" }] };

it("admits native document edits only with native capability and an exact owned text selection", async () => {
  const value = fixture("document"), request = { kind: "document", prompt: "Polish", maxCredits: 1, target: docTarget };
  ports.read.mockResolvedValue({ projectId: "project", kind: "document", content: document() });
  const stale = { ...docTarget, spans: [{ start: 0, end: 8, expectedText: "Mismatch" }] };
  await expect(createContentRun("u", "session", { ...request, target: stale }, "native-doc-request-123", value)).rejects.toThrow("LANGUAGE_SELECTION_CHANGED");
  expect(value.db.creationRun.create).not.toHaveBeenCalled();
  value.env.CREATION_NATIVE_OFFICE_ENABLED = "false";
  await expect(createContentRun("u", "session", request, "native-doc-request-123", value)).rejects.toThrow("CREATION_NOT_ENABLED");
  value.env.CREATION_NATIVE_OFFICE_ENABLED = "true";
  const result = await createContentRun("u", "session", request, "native-doc-request-123", value);
  expect(result.steps[0]).toMatchObject({ tool: "document.native.edit", params: { ...docTarget, purpose: "document.native.edit" } });
  expect(ports.read).toHaveBeenLastCalledWith("u", "doc", "document", 1, { db: value.db, store: value.store });
});

it("publishes native document operations atomically and uses a complete native copy if the user already edited the source", async () => {
  for (const conflict of [false, true]) {
    const value = fixture("document"), source = document();
    const step = value.run.steps[0]; step.tool = "document.native.edit"; step.params = { ...docTarget, purpose: step.tool, prompt: "Polish", locale: "en" };
    ports.read.mockResolvedValue({ content: source }); ports.result.mockResolvedValue(docPatch);
    if (conflict) ports.modify.mockRejectedValueOnce(Object.assign(new Error("conflict"), { code: "ARTIFACT_VERSION_CONFLICT" }));
    else ports.modify.mockImplementationOnce(async (_u, _a, _patch, options) => { await options.hooks.beforeCommit(value.db); await options.hooks.afterCommit(value.db, { artifactId: "doc", revision: 2 }); });
    ports.create.mockImplementation(async (_u, _p, _copy, _key, options) => { await options.hooks.beforeCommit(value.db); await options.hooks.afterCommit(value.db, { artifactId: "copy", revision: 1 }); });
    await publishCreationLanguage(value.run, step, value);
    expect(step.result.disposition).toBe(conflict ? "conflict-copy" : "updated");
    if (conflict) {
      const copy = ports.create.mock.calls.at(-1)[2];
      expect(copy.schemaVersion).toBe(2); expect(copy.snapshot.body.dataStream).toBe("Revised\r\n");
      expect(copy.snapshot.custom).toEqual(source.snapshot.custom); expect(copy.snapshot.title).toBe(copy.title);
    }
    expect(source.snapshot.body.dataStream).toBe("Original\r\n");
    expect(ports.modify.mock.calls.at(-1)[2]).toMatchObject({ baseRevision: 1, operations: docPatch.operations });
  }
});

it("rejects a new paid document retry with native admission closed but retains a succeeded result for publication", async () => {
  const value = fixture("document"); value.run.steps[0].tool = "document.native.edit"; value.env.CREATION_NATIVE_OFFICE_ENABLED = "false";
  await expect(resumeContentRun("u", value.run, { expectedSequence: 1, maxCredits: 1 }, value)).resolves.toBeNull();
  value.db.tryOn.findMany.mockResolvedValueOnce([{ id: value.run.steps[0].jobId, status: "failed" }]);
  await expect(resumeContentRun("u", value.run, { expectedSequence: value.run.eventSequence, maxCredits: 1 }, value)).rejects.toThrow("CREATION_NOT_ENABLED");
});

it("requires native admission and validates source ownership/selection before creating a paid native run", async () => {
  const value = fixture(), request = { kind: "sheet", prompt: "Update", locale: "en", maxCredits: 1, target };
  value.env.CREATION_NATIVE_OFFICE_ENABLED = "false";
  await expect(createContentRun("u", "session", request, "native-request-key-123", value)).rejects.toThrow("CREATION_NOT_ENABLED");
  expect(ports.read).not.toHaveBeenCalled(); value.env.CREATION_NATIVE_OFFICE_ENABLED = "true";
  await expect(createContentRun("u", "session", { ...request, target: { ...target, unitId: "wrong" } }, "native-request-key-123", value)).rejects.toThrow("LANGUAGE_SELECTION_CHANGED");
  expect(value.db.creationRun.create).not.toHaveBeenCalled();
  ports.read.mockResolvedValueOnce({ projectId: "different-project", kind: "sheet", content: book() });
  await expect(createContentRun("u", "session", request, "native-request-key-123", value)).rejects.toThrow("LANGUAGE_SOURCE_MISMATCH");
  const result = await createContentRun("u", "session", request, "native-request-key-123", value);
  expect(result.steps[0]).toMatchObject({ tool: "sheet.native.edit", params: { ...target, purpose: "sheet.native.edit" } });
  expect(ports.read).toHaveBeenLastCalledWith("u", "sheet", "sheet", 1, { db: value.db, store: value.store });
  expect(ports.message.mock.calls.at(-1)[5]).toContainEqual({ type: "selection", ...target });
  value.env.CREATION_NATIVE_OFFICE_ENABLED = "false";
  value.db.creationRun.findUnique.mockResolvedValueOnce({ ...result, userId: "u", digest: value.db.creationRun.create.mock.calls[0][0].data.digest });
  await expect(createContentRun("u", "session", request, "native-request-key-123", value)).resolves.toMatchObject({ id: "run" });
  expect(value.db.creationRun.create).toHaveBeenCalledOnce();
});

it("refuses older sheet workers that cannot execute native edit jobs", async () => {
  const rows = [{ id: "worker" }, { id: SHEET_SCHEDULER_HEARTBEAT, details: { version: 1 } }, { id: SHEET_LANGUAGE_HEARTBEAT, details: { version: 1 } }];
  const db = { serviceHeartbeat: { findMany: vi.fn(async () => rows) } };
  await expect(ensureContentWorkers(db, { kind: "sheet" })).rejects.toThrow("CREATION_WORKER_UNAVAILABLE");
  rows[1].details.version = rows[2].details.version = SHEET_PIPELINE_VERSION;
  await expect(ensureContentWorkers(db, { kind: "sheet" })).resolves.toBeUndefined();
});

it("publishes only revalidated native operations using the atomic run hooks", async () => {
  const value = fixture();
  ports.result.mockResolvedValueOnce({ operations: [{ ...patch.operations[0], column: 1 }] });
  await expect(publishCreationLanguage(value.run, value.run.steps[0], value)).rejects.toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
  expect(ports.modify).not.toHaveBeenCalled();
  ports.modify.mockImplementation(async (_user, _id, _patch, options) => { await options.hooks.beforeCommit(value.db); await options.hooks.afterCommit(value.db, { artifactId: "sheet", revision: 2 }); });
  await publishCreationLanguage(value.run, value.run.steps[0], value);
  expect(value.run.steps[0].result).toEqual({ artifactId: "sheet", revision: 2, disposition: "updated" });
  expect(ports.modify.mock.calls[0][2]).toMatchObject({ baseRevision: 1, operations: patch.operations, saveKey: "edited-sheet-edit-job-1234" });
  expect(ports.modify.mock.calls[0][3].sourceRunId).toBe("run");
});

it("keeps the source intact and publishes a full native AI copy when the original changes", async () => {
  const value = fixture(), source = book(); source.snapshot.custom.notes = "Preserve all metadata";
  ports.read.mockResolvedValue({ content: source });
  ports.modify.mockRejectedValue(Object.assign(new Error("conflict"), { code: "ARTIFACT_VERSION_CONFLICT" }));
  ports.create.mockImplementation(async (_user, _project, _content, _key, options) => { await options.hooks.beforeCommit(value.db); await options.hooks.afterCommit(value.db, { artifactId: "copy", revision: 1 }); });
  await publishCreationLanguage(value.run, value.run.steps[0], value);
  const copy = ports.create.mock.calls[0][2];
  expect(copy.schemaVersion).toBe(2); expect(copy.snapshot.sheets.sheet0.cellData[0][0].v).toBe(20);
  expect(copy.snapshot.sheets.sheet0.cellData[0][1].v).toBe(99); expect(copy.snapshot.custom).toEqual(source.snapshot.custom);
  expect(copy.snapshot.name).toBe(copy.title); expect(copy.title).toContain("AI edit copy");
  expect(source.snapshot.sheets.sheet0.cellData[0][0].v).toBe(10); expect(ports.result).toHaveBeenCalledOnce();
  expect(value.run.steps[0].result.disposition).toBe("conflict-copy");
});

it("allows publication recovery after admission closes but rejects another paid native retry", async () => {
  const value = fixture(); value.env.CREATION_NATIVE_OFFICE_ENABLED = "false";
  await expect(resumeContentRun("u", value.run, { expectedSequence: 1, maxCredits: 1 }, value)).resolves.toBeNull();
  expect(value.ensureWorkers).toHaveBeenCalledWith(value.db, { language: false, kind: "sheet", posterImage: false });
  value.db.tryOn.findMany.mockResolvedValueOnce([{ id: value.run.steps[0].jobId, status: "failed" }]);
  await expect(resumeContentRun("u", value.run, { expectedSequence: value.run.eventSequence, maxCredits: 1 }, value)).rejects.toThrow("CREATION_NOT_ENABLED");
});
