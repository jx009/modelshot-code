import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { executeCreationLanguage } from "../../src/lib/domain/creation/language-execution.js";
import { officeFile } from "../fixtures/creation-office-reference.mjs";
const ports = vi.hoisted(() => ({ claim: vi.fn(), finish: vi.fn(), defer: vi.fn() }));
vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => { throw new Error("Real storage forbidden"); } }));
vi.mock("../../src/lib/domain/generation/execution.js", () => ({ claimOutput: (...args) => ports.claim(...args), finishOutput: (...args) => ports.finish(...args), deferOutput: (...args) => ports.defer(...args) }));
vi.mock("../../src/lib/domain/creation/language-provider.js", () => ({ invokeCreationLanguage: () => { throw new Error("Real provider forbidden"); } }));
beforeEach(() => { Object.values(ports).forEach(port => port.mockReset()); vi.stubEnv("CREATION_REFERENCE_ISOLATED", "true"); });
afterEach(() => vi.unstubAllEnvs());
function setup(bytes) {
  const output = { id: "job", userId: "reference-execution", executionQueue: "creation-language", fence: 3, status: "running", snapshot: { creationRunId: "run", executionVersion: 1, input: { purpose: "slides.outline", pageCount: 1, prompt: "Use the document", referenceIds: ["ref"] }, provider: null, providerKind: "openai", providerBaseURL: null, model: "fake" } };
  const db = { $queryRaw: vi.fn(), tryOn: { findUnique: vi.fn(async () => output), updateMany: vi.fn(async () => ({ count: 1 })) },
    creationBlob: { findUnique: vi.fn(async () => null), create: vi.fn(async ({ data }) => ({ ...data, state: "staging" })), updateMany: vi.fn(async () => ({ count: 1 })) },
    processingStep: { findUnique: vi.fn(async () => null), create: vi.fn() }, generationAttempt: { update: vi.fn() },
    creationRun: { findFirst: vi.fn(async () => ({ sessionId: "s" })) }, creationReference: { findMany: vi.fn(async () => [{ id: "ref", name: "brief.docx", fileType: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex"), objectKey: "private/original" }]) },
  };
  db.$transaction = async callback => callback(db);
  const store = { put: vi.fn().mockResolvedValue(undefined), stream: vi.fn(async () => {
    expect(db.processingStep.create).not.toHaveBeenCalled();
    return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  }) };
  const invoke = vi.fn(async () => ({ title: "Coffee", theme: { name: "Brand", primary: "#202124", accent: "#ff8800", background: "#ffffff", fontFamily: "sans" }, pages: [{ id: "p", title: "Opening", brief: "Use the document facts" }] }));
  ports.claim.mockResolvedValue({ output, attempt: { id: "attempt" } });
  return { db, store, invoke, configFor: async () => ({ chatModel: "fake" }), prepareReferences: async () => ({ assets: [], images: [] }) };
}
it("reads the real Office child output before recording the paid call, retaining source locators", async () => {
  const value = setup(await officeFile("docx"));
  await executeCreationLanguage("job", value);
  expect(value.invoke).toHaveBeenCalledOnce(); expect(value.db.processingStep.create).toHaveBeenCalledOnce();
  const references = value.invoke.mock.calls[0][1].referenceFiles;
  expect(references[0].text).toContain("document/table2/row1/cell1/p1");
  expect(references[0].readerVersion).toBe("office-reference-1"); expect(references[0].sourceChecksum).toMatch(/^[a-f0-9]{64}$/);
  expect(ports.finish.mock.calls[0][2].resultData.creationLanguage.purpose).toBe("slides.outline");
});
it("does not invoke or mark a paid request when Office extraction fails", async () => {
  const value = setup(Buffer.from("invalid archive")); await executeCreationLanguage("job", value);
  expect(value.invoke).not.toHaveBeenCalled(); expect(value.db.processingStep.create).not.toHaveBeenCalled();
  expect(ports.finish).toHaveBeenCalledWith("job", 3, { errorCode: "CREATION_REFERENCE_ARCHIVE_INVALID" }, value.db);
});
it("does not re-read references or repeat a submitted model call during recovery", async () => {
  const value = setup(Buffer.from("unavailable now")); value.db.processingStep.findUnique.mockResolvedValueOnce({ id: "submitted" });
  await executeCreationLanguage("job", value);
  expect(value.store.stream).not.toHaveBeenCalled(); expect(value.invoke).not.toHaveBeenCalled();
  expect(ports.finish).toHaveBeenCalledWith("job", 3, { errorCode: "LANGUAGE_RESULT_UNAVAILABLE", cancelled: false }, value.db);
});
