import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createReferenceReader } from "../../src/lib/domain/creation/reference-reader.js";
import { readReferenceBytes } from "../../src/lib/domain/creation/reference-read.js";
import { referenceType, referenceContentType } from "../../src/lib/creation/reference-policy.js";

const stream = bytes => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
const row = (id, bytes = Buffer.from("source"), kind = "docx") => ({ id, name: `${id}.${kind}`, fileType: kind, contentType: referenceContentType(referenceType(kind)), bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex"), objectKey: `private/${id}` });
it("serializes Office parsers across requests, preserves input ordering and caches by user/checksum", async () => {
  let active = 0, peak = 0;
  const extract = vi.fn(async () => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return { text: "Located text", readerVersion: "office-reference-1", limitations: ["text only"] }; });
  const read = createReferenceReader({ extract }), rows = [row("a"), row("b")];
  const db = { creationReference: { findMany: vi.fn(async () => rows) } }, store = { stream: vi.fn(async () => stream(Buffer.from("source"))) };
  const [first, second] = await Promise.all([read("u", "s", ["b", "a"], { db, store }), read("u", "s", ["a", "b"], { db, store })]);
  expect(first.map(item => item.id)).toEqual(["b", "a"]); expect(second.map(item => item.id)).toEqual(["a", "b"]);
  expect(peak).toBe(1); expect(extract).toHaveBeenCalledTimes(2); expect(store.stream).toHaveBeenCalledTimes(2);
  expect(first[0].sourceChecksum).toBe(rows[1].checksum);
  first[0].limitations[0] = "caller mutation";
  expect((await read("u", "s", ["a", "b"], { db, store }))[1].limitations).toEqual(["text only"]);
  await read("other-user", "s", ["a", "b"], { db, store }); expect(extract).toHaveBeenCalledTimes(4);
  db.creationReference.findMany.mockResolvedValueOnce([]);
  await expect(read("u", "s", ["a"], { db, store })).rejects.toThrow("CREATION_REFERENCE_NOT_FOUND");
  expect(db.creationReference.findMany.mock.calls[0][0].where.session.project).toEqual({ userId: "u", deletedAt: null });
});
it("checks checksum before extraction, honors cancellation and limits extracted rather than binary size", async () => {
  const bytes = Buffer.alloc(200000, 65), source = row("a", bytes);
  const db = { creationReference: { findMany: async () => [source] } }, store = { stream: async () => stream(bytes) };
  const extract = vi.fn(async () => ({ text: "short extracted text" })), read = createReferenceReader({ extract });
  expect((await read("u", "s", ["a"], { db, store }))[0].text).toBe("short extracted text");
  const fresh = createReferenceReader({ extract });
  await expect(fresh("u", "s", ["a"], { db, store: { stream: async () => stream(Buffer.alloc(bytes.length, 66)) } })).rejects.toThrow("CREATION_REFERENCE_INTEGRITY_FAILED");
  expect(extract).toHaveBeenCalledOnce();
  const abort = new AbortController(); abort.abort(new Error("lease lost"));
  await expect(read("u", "s", ["a"], { db, store, signal: abort.signal })).rejects.toThrow("lease lost");
  const large = createReferenceReader({ extract: async () => ({ text: "x".repeat(128 * 1024) }) });
  await expect(large("u", "s", ["a"], { db, store })).rejects.toThrow("CREATION_REFERENCE_CONTEXT_LIMIT");
});
it("enforces the combined context budget", async () => {
  const rows = [row("a"), row("b")], db = { creationReference: { findMany: async () => rows } }, store = { stream: async () => stream(Buffer.from("source")) };
  const read = createReferenceReader({ extract: async () => ({ text: "x".repeat(70000) }) });
  await expect(read("u", "s", ["a", "b"], { db, store })).rejects.toThrow("CREATION_REFERENCE_CONTEXT_LIMIT");
});
it("bounds streaming reads against lying storage lengths and cancels incomplete streams", async () => {
  const file = row("ref"), cancel = vi.fn();
  const store = { stream: async () => new ReadableStream({ start(controller) { controller.enqueue(Buffer.alloc(100)); }, cancel }) };
  await expect(readReferenceBytes(file, store, new AbortController().signal)).rejects.toThrow("CREATION_REFERENCE_INTEGRITY_FAILED");
  expect(cancel).toHaveBeenCalledOnce();
});
