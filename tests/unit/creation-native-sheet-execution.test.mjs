import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { executeCreationLanguage } from "../../src/lib/domain/creation/language-execution.js";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";
import { toNativeDocumentArtifact } from "../../src/lib/creation/native-document-adapter.js";
const ports = vi.hoisted(() => ({ claim: vi.fn(), finish: vi.fn(), defer: vi.fn(), read: vi.fn() }));
vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => { throw new Error("Real storage forbidden"); } }));
vi.mock("../../src/lib/domain/generation/execution.js", () => ({ claimOutput: (...args) => ports.claim(...args), finishOutput: (...args) => ports.finish(...args), deferOutput: (...args) => ports.defer(...args) }));
vi.mock("../../src/lib/domain/creation/native-office-artifacts.js", () => ({ readNativeOfficeArtifact: (...args) => ports.read(...args) }));
vi.mock("../../src/lib/domain/creation/language-provider.js", () => ({ invokeCreationLanguage: () => { throw new Error("Real provider forbidden"); } }));
const content = () => toNativeSheetArtifact({ schemaVersion: 1, kind: "sheet", title: "Budget", sheets: [{ id: "s", name: "Costs", cells: [{ id: "c", address: "A1", value: 10 }] }] }, "unit");
const patch = { operations: [{ op: "setNativeCell", sheetId: "sheet0", row: 0, column: 0, value: 20 }] };
function setup(checkpoint) {
  const input = { purpose: "sheet.native.edit", format: "univer-sheet-1", artifactId: "a", baseRevision: 1, unitId: "unit", sheetId: "sheet0", cells: [{ row: 0, column: 0 }], prompt: "Change amount" };
  const output = { id: "job", userId: "u", executionQueue: "creation-language", fence: 3, status: "running", snapshot: { executionVersion: 1, input, provider: null, providerKind: "openai", providerBaseURL: null, model: "fake" } };
  const bytes = checkpoint ? Buffer.from(JSON.stringify(checkpoint)) : null;
  const blob = bytes ? { id: "language-job", userId: "u", objectKey: "u/creation-language/job.json", state: "staging", checksum: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length } : null;
  const db = { $queryRaw: vi.fn(), tryOn: { findUnique: vi.fn(async () => output), updateMany: vi.fn(async () => ({ count: 1 })) },
    creationBlob: { findUnique: vi.fn(async () => blob), create: vi.fn(async ({ data }) => ({ ...data, state: "staging" })), updateMany: vi.fn(async () => ({ count: 1 })) },
    processingStep: { findUnique: vi.fn(async () => null), create: vi.fn() }, generationAttempt: { update: vi.fn() } };
  db.$transaction = async fn => fn(db);
  const store = { get: vi.fn(async () => bytes), put: vi.fn() }, invoke = vi.fn(async () => patch), configFor = vi.fn(async () => ({ chatModel: "fake" })), prepareReferences = vi.fn(async () => ({ assets: [], images: [] }));
  ports.claim.mockResolvedValue({ output, attempt: { id: "attempt" } }); ports.read.mockResolvedValue({ content: content() });
  return { db, store, invoke, configFor, prepareReferences, output };
}
beforeEach(() => Object.values(ports).forEach(port => port.mockReset()));

it("executes native document text edits against the exact native revision and rejects stale text before submission", async () => {
  const doc = toNativeDocumentArtifact({ schemaVersion: 1, kind: "document", title: "Report", sections: [{ id: "s", title: "Section", blocks: [{ id: "p", type: "paragraph", runs: [{ text: "Original", marks: { bold: true } }] }] }] }, "unit");
  const target = { format: "univer-document-1", artifactId: "a", baseRevision: 1, unitId: "unit", segmentId: "", spans: [{ start: 0, end: 8, expectedText: "Original" }] };
  const result = { operations: [{ op: "replaceNativeText", segmentId: "", ...target.spans[0], text: "Revised" }] };
  const t = setup(); t.output.snapshot.input = { ...target, purpose: "document.native.edit", prompt: "Polish" };
  ports.read.mockResolvedValue({ content: doc }); t.invoke.mockResolvedValue(result);
  await executeCreationLanguage("job", t);
  expect(ports.read).toHaveBeenCalledWith("u", "a", "document", 1, { db: t.db, store: t.store });
  expect(t.invoke).toHaveBeenCalledOnce(); expect(JSON.parse(t.store.put.mock.calls[0][1].toString())).toEqual(result);
  expect(ports.finish.mock.calls[0][2].resultData.creationLanguage.purpose).toBe("document.native.edit");
  const stale = setup(); stale.output.snapshot.input = { ...target, purpose: "document.native.edit", prompt: "Polish", spans: [{ start: 0, end: 8, expectedText: "Mismatch" }] };
  ports.read.mockResolvedValue({ content: doc }); await executeCreationLanguage("job", stale);
  expect(stale.invoke).not.toHaveBeenCalled(); expect(stale.db.processingStep.create).not.toHaveBeenCalled();
  expect(ports.finish).toHaveBeenLastCalledWith("job", 3, { errorCode: "LANGUAGE_RESULT_INVALID" }, stale.db);
});

it("revalidates native document checkpoints without resubmitting the language model", async () => {
  const doc = toNativeDocumentArtifact({ schemaVersion: 1, kind: "document", title: "Report", sections: [{ id: "s", title: "Section", blocks: [{ id: "p", type: "paragraph", runs: [{ text: "Original", marks: {} }] }] }] }, "unit");
  const result = { operations: [{ op: "replaceNativeText", segmentId: "", start: 0, end: 8, expectedText: "Original", text: "Revised" }] };
  const t = setup(result); t.output.snapshot.input = { purpose: "document.native.edit", prompt: "Polish", format: "univer-document-1", artifactId: "a", baseRevision: 1, unitId: "unit", segmentId: "", spans: [{ start: 0, end: 8, expectedText: "Original" }] };
  ports.read.mockResolvedValue({ content: doc }); await executeCreationLanguage("job", t);
  expect(t.invoke).not.toHaveBeenCalled(); expect(t.store.put).not.toHaveBeenCalled();
  expect(ports.finish.mock.calls[0][2].resultData.creationLanguage.purpose).toBe("document.native.edit");
});

it("validates native scope before recording or invoking a paid request and never falls through to the semantic codec", async () => {
  const t = setup(); t.output.snapshot.input.unitId = "wrong";
  await executeCreationLanguage("job", t);
  expect(ports.read).toHaveBeenCalledWith("u", "a", "sheet", 1, { db: t.db, store: t.store });
  expect(t.db.processingStep.create).not.toHaveBeenCalled(); expect(t.invoke).not.toHaveBeenCalled();
  expect(ports.finish).toHaveBeenCalledWith("job", 3, { errorCode: "LANGUAGE_RESULT_INVALID" }, t.db);
});

it("validates and checkpoints a native model response, then settles without submitting again", async () => {
  const t = setup(); await executeCreationLanguage("job", t);
  expect(t.invoke).toHaveBeenCalledOnce(); expect(t.db.processingStep.create).toHaveBeenCalledOnce();
  expect(t.invoke.mock.calls[0][1].source.schemaVersion).toBe(2);
  expect(JSON.parse(t.store.put.mock.calls[0][1].toString())).toEqual(patch);
  expect(ports.finish.mock.calls[0][2].resultData.creationLanguage.purpose).toBe("sheet.native.edit");
  expect(ports.defer).not.toHaveBeenCalled();
});

it("recovers a native checkpoint without a model call, and fails corrupt scope rather than retrying it indefinitely", async () => {
  const valid = setup(patch); await executeCreationLanguage("job", valid);
  expect(valid.invoke).not.toHaveBeenCalled(); expect(valid.store.put).not.toHaveBeenCalled();
  expect(ports.finish).toHaveBeenCalledOnce(); ports.finish.mockClear();
  const invalid = setup({ operations: [{ ...patch.operations[0], column: 1 }] });
  await executeCreationLanguage("job", invalid);
  expect(invalid.invoke).not.toHaveBeenCalled(); expect(ports.defer).not.toHaveBeenCalled();
  expect(ports.finish).toHaveBeenCalledWith("job", 3, { errorCode: "LANGUAGE_RESULT_INVALID" }, invalid.db);
});

it("does not resubmit a request whose paid invocation marker exists but result is unavailable", async () => {
  const t = setup(); t.db.processingStep.findUnique.mockResolvedValueOnce({ id: "submitted" });
  await executeCreationLanguage("job", t);
  expect(t.invoke).not.toHaveBeenCalled(); expect(t.db.processingStep.create).not.toHaveBeenCalled();
  expect(ports.finish).toHaveBeenCalledWith("job", 3, { errorCode: "LANGUAGE_RESULT_UNAVAILABLE", cancelled: false }, t.db);
});
