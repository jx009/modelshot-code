import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { readExportSourceFormat } from "../../src/lib/domain/creation/export-source.js";
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => { throw new Error("No real storage"); } }));
function fixture(content = { schemaVersion: 2, kind: "sheet", engine: "univer", engineVersion: "1.2.0" }) {
  const bytes = Buffer.from(JSON.stringify(content)), blob = { userId: "u", state: "ready", objectKey: "private/revision", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") };
  const db = { artifactRevision: { findUnique: vi.fn(async () => ({ id: "revision", blob })) } };
  const cancel = vi.fn(), store = { stream: vi.fn(async () => new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 3)); controller.enqueue(bytes.subarray(3)); controller.close(); }, cancel })) };
  return { db, store, blob, bytes, cancel };
}
it("reads and checks the exact private immutable revision before returning a codec", async () => {
  const value = fixture();
  expect(await readExportSourceFormat("u", "artifact", 4, value)).toEqual({ revisionId: "revision", checksum: value.blob.checksum, schemaVersion: 2, kind: "sheet" });
  expect(value.db.artifactRevision.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { artifactId_revision: { artifactId: "artifact", revision: 4 } }, include: { blob: true } });
  expect(value.store.stream).toHaveBeenCalledWith("private/revision", undefined, expect.any(AbortSignal));
});
it("refuses wrong ownership, unready/large blobs, checksum mismatch and unsupported codecs", async () => {
  for (const patch of [{ userId: "other" }, { state: "staging" }, { bytes: 2097153 }, { bytes: -1 }]) {
    const value = fixture(); Object.assign(value.blob, patch);
    await expect(readExportSourceFormat("u", "a", 1, value)).rejects.toThrow(); expect(value.store.stream).not.toHaveBeenCalled();
  }
  const bad = fixture(); bad.blob.checksum = "wrong";
  await expect(readExportSourceFormat("u", "a", 1, bad)).rejects.toThrow("EXPORT_SOURCE_INTEGRITY_FAILED");
  for (const content of [{ kind: "sheet", schemaVersion: 3 }, { kind: "sheet", schemaVersion: 2, engine: "univer", engineVersion: "future" }, null]) {
    await expect(readExportSourceFormat("u", "a", 1, fixture(content))).rejects.toThrow("EXPORT_SOURCE_FORMAT_UNSUPPORTED");
  }
});
it("stops and cancels a stream that exceeds its declared size", async () => {
  const value = fixture(); value.blob.bytes = 3;
  value.store.stream.mockImplementation(async () => new ReadableStream({ start(controller) { controller.enqueue(value.bytes); }, cancel: value.cancel }));
  await expect(readExportSourceFormat("u", "a", 1, value)).rejects.toThrow("EXPORT_SOURCE_INTEGRITY_FAILED");
  expect(value.cancel).toHaveBeenCalledOnce();
});
