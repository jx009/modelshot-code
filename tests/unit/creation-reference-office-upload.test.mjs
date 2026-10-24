import { afterEach, expect, it, vi } from "vitest";
import { uploadCreationReference } from "../../src/lib/domain/creation/reference-files.js";
import { officeReferencesAvailable } from "../../src/lib/domain/creation/reference-admission.js";
import { REFERENCE_READER_VERSION } from "../../src/lib/creation/reference-policy.js";
import { officeFile } from "../fixtures/creation-office-reference.mjs";

afterEach(() => vi.unstubAllEnvs());
function setup() {
  const db = { serviceHeartbeat: { findUnique: vi.fn(async () => ({ updatedAt: new Date(), details: { version: REFERENCE_READER_VERSION, isolated: true } })) }, creationSession: { findFirst: vi.fn(async () => ({ id: "s" })) }, creationReference: {
    aggregate: vi.fn(async () => ({ _count: { _all: 0 }, _sum: { bytes: 0 } })), create: vi.fn(async ({ data }) => data),
  }, $queryRaw: vi.fn(async () => []) };
  db.$transaction = callback => callback(db);
  return { db, store: { put: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) } };
}
it("stores the original Office bytes without parsing XML in the upload service", async () => {
  vi.stubEnv("CREATION_OFFICE_REFERENCES_ENABLED", "true");
  const { db, store } = setup(), bytes = await officeFile("docx");
  const file = new File([bytes], "brief.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const result = await uploadCreationReference("u", "s", file, { db, store });
  expect(result.fileType).toBe("docx"); expect(result.bytes).toBe(bytes.length); expect(store.put.mock.calls[0][1]).toEqual(bytes);
  expect(db.creationSession.findFirst).toHaveBeenCalledTimes(2);
});
it("requires fresh versioned isolated worker capacity, and rejects binary formats and oversized files", async () => {
  const { db, store } = setup(), bytes = await officeFile("docx"), file = new File([bytes], "brief.docx");
  vi.stubEnv("CREATION_OFFICE_REFERENCES_ENABLED", "false");
  await expect(uploadCreationReference("u", "s", file, { db, store })).rejects.toThrow("CREATION_REFERENCE_READER_UNAVAILABLE");
  expect(db.serviceHeartbeat.findUnique).not.toHaveBeenCalled();
  vi.stubEnv("CREATION_OFFICE_REFERENCES_ENABLED", "true");
  for (const beat of [null, { updatedAt: new Date(0), details: { version: REFERENCE_READER_VERSION, isolated: true } }, { updatedAt: new Date(), details: { version: "old", isolated: true } }, { updatedAt: new Date(), details: { version: REFERENCE_READER_VERSION, isolated: false } }]) {
    db.serviceHeartbeat.findUnique.mockResolvedValueOnce(beat); expect(await officeReferencesAvailable(db)).toBe(false);
  }
  await expect(uploadCreationReference("u", "s", new File(["binary"], "old.doc"), { db, store })).rejects.toThrow("CREATION_REFERENCE_TYPE_UNSUPPORTED");
  await expect(uploadCreationReference("u", "s", new File(["not zip"], "false.docx"), { db, store })).rejects.toThrow("CREATION_REFERENCE_ARCHIVE_INVALID");
  await expect(uploadCreationReference("u", "s", { name: "large.xlsx", type: "", size: 4 * 1024 * 1024 + 1 }, { db, store })).rejects.toThrow("CREATION_REFERENCE_TOO_LARGE");
  expect(store.put).not.toHaveBeenCalled();
});
it("rechecks project ownership under the session lock before committing the reference", async () => {
  const { db, store } = setup(); db.creationSession.findFirst.mockResolvedValueOnce({ id: "s" }).mockResolvedValueOnce(null);
  await expect(uploadCreationReference("u", "s", new File(["text"], "a.txt"), { db, store })).rejects.toThrow("CREATION_SESSION_NOT_FOUND");
  expect(db.creationReference.create).not.toHaveBeenCalled(); expect(store.delete).toHaveBeenCalledOnce();
});
