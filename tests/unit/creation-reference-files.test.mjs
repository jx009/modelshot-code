import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { CREATION_REFERENCE_MAX_CONTEXT_BYTES, uploadCreationReference, prepareCreationReferenceFiles, listCreationReferences } from "../../src/lib/domain/creation/reference-files.js";

const bytes = Buffer.from("Coffee launch\r\nNovember 1", "utf8");
const file = (name = "brief.md", type = "text/markdown") => ({ name, type, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

it("stores only bounded UTF-8 reference types under the owning session", async () => {
  let created, stored;
  const db = {
    creationSession: { findFirst: async args => { expect(args.where.id).toBe("session"); return { id: "session" }; } },
    $transaction: async callback => callback({
      $queryRaw: async () => [],
      creationSession: { findFirst: async () => ({ id: "session" }) },
      creationReference: {
        aggregate: async () => ({ _count: { _all: 1 }, _sum: { bytes: 12 } }),
        create: async args => (created = args.data),
      },
    }),
  };
  const store = { put: async (key, body, type) => { stored = { key, body, type }; }, delete: async () => {} };
  const result = await uploadCreationReference("user", "session", file("C:\\draft\\launch.md"), { db, store });
  expect(result.name).toBe("launch.md");
  expect(created.userId).toBe("user");
  expect(created.sessionId).toBe("session");
  expect(stored.type).toBe("text/markdown; charset=utf-8");
  expect(stored.body).toEqual(bytes);
});

it("rejects unsupported, malformed, cross-session and oversized reference data", async () => {
  const store = { put: async () => { throw new Error("must not store"); }, get: async () => Buffer.alloc(0) };
  await expect(uploadCreationReference("user", "session", file("brief.pdf", "application/pdf"), { db: {}, store })).rejects.toThrow("CREATION_REFERENCE_TYPE_UNSUPPORTED");
  await expect(uploadCreationReference("user", "session", file("brief.__proto__", ""), { db: {}, store })).rejects.toThrow("CREATION_REFERENCE_TYPE_UNSUPPORTED");
  const invalid = { ...file(), size: 1, arrayBuffer: async () => new Uint8Array([0xff]).buffer };
  await expect(uploadCreationReference("user", "session", invalid, { db: { creationSession: { findFirst: async () => ({ id: "session" }) } }, store })).rejects.toThrow("CREATION_REFERENCE_INVALID");
  const db = { creationReference: { findMany: async args => { expect(args.where.sessionId).toBe("session"); return []; } } };
  await expect(prepareCreationReferenceFiles("user", "session", ["foreign"], { db, store })).rejects.toThrow("CREATION_REFERENCE_NOT_FOUND");
  const tooLarge = [{ id: "a", bytes: CREATION_REFERENCE_MAX_CONTEXT_BYTES + 1 }];
  await expect(prepareCreationReferenceFiles("user", "session", ["a"], { db: { creationReference: { findMany: async () => tooLarge } }, store })).rejects.toThrow("CREATION_REFERENCE_CONTEXT_LIMIT");
});

it("checks ownership before reading bytes and preserves originals after an uncertain commit", async () => {
  const input = { ...file(), arrayBuffer: vi.fn(file().arrayBuffer) }, store = { put: vi.fn(async () => {}), delete: vi.fn(async () => {}) };
  const db = { creationSession: { findFirst: vi.fn(async () => null) }, $transaction: async () => { throw new Error("Lost commit acknowledgement"); } };
  await expect(uploadCreationReference("user", "session", input, { db, store })).rejects.toThrow("CREATION_SESSION_NOT_FOUND");
  expect(input.arrayBuffer).not.toHaveBeenCalled(); expect(store.put).not.toHaveBeenCalled();
  db.creationSession.findFirst.mockResolvedValue({ id: "session" });
  await expect(uploadCreationReference("user", "session", input, { db, store })).rejects.toThrow("Lost commit acknowledgement");
  expect(store.put).toHaveBeenCalledOnce(); expect(store.delete).not.toHaveBeenCalled();
});

it("lists only public reference metadata through the owned active session", async () => {
  const row = { id: "ref", name: "brief.md", bytes: 20 };
  const findFirst = vi.fn(async () => ({ references: [row] }));
  expect(await listCreationReferences("user", "session", { creationSession: { findFirst } })).toEqual([row]);
  const query = findFirst.mock.calls[0][0];
  expect(query.where).toEqual({ id: "session", project: { userId: "user", deletedAt: null } });
  expect(query.select.references.where).toEqual({ deletedAt: null });
  expect(query.select.references.select).not.toHaveProperty("objectKey");
  expect(query.select.references.select).not.toHaveProperty("checksum");
  await expect(listCreationReferences("user", "foreign", { creationSession: { findFirst: async () => null } })).rejects.toThrow("CREATION_SESSION_NOT_FOUND");
});

it("checks quota while holding the session lock and removes the staged object when quota rejects", async () => {
  for (const [count, total, code] of [[8, 0, "CREATION_REFERENCE_COUNT_LIMIT"], [7, 32 * 1024 * 1024, "CREATION_REFERENCE_SESSION_LIMIT"]]) {
    let locked = false;
    const create = vi.fn(), store = { put: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) };
    const db = { creationSession: { findFirst: async () => ({ id: "session" }) }, $transaction: async callback => callback({
      creationSession: { findFirst: async () => ({ id: "session" }) },
      $queryRaw: async () => { locked = true; }, creationReference: { create, aggregate: async () => { expect(locked).toBe(true); return { _count: { _all: count }, _sum: { bytes: total } }; } },
    }) };
    await expect(uploadCreationReference("user", "session", file(), { db, store })).rejects.toThrow(code);
    expect(create).not.toHaveBeenCalled();
    expect(store.delete).toHaveBeenCalledWith(store.put.mock.calls[0][0]);
  }
});

it("does not touch object storage when the session is foreign or the input exceeds the file limit", async () => {
  const store = { put: vi.fn(), delete: vi.fn() }, db = { creationSession: { findFirst: async () => null } };
  await expect(uploadCreationReference("user", "foreign", file(), { db, store })).rejects.toThrow("CREATION_SESSION_NOT_FOUND");
  await expect(uploadCreationReference("user", "session", { ...file(), size: 256 * 1024 + 1 }, { db, store })).rejects.toThrow("CREATION_REFERENCE_TOO_LARGE");
  expect(store.put).not.toHaveBeenCalled();
});

it("checks the private object checksum before returning file text to the language worker", async () => {
  const text = Buffer.from("# Brief\nKeep the November 1 date.");
  const row = { id: "ref", name: "brief.md", fileType: "md", contentType: "text/markdown; charset=utf-8", bytes: text.length, checksum: createHash("sha256").update(text).digest("hex"), objectKey: "private/object" };
  const db = { creationReference: { findMany: async args => { expect(args.where.userId).toBe("user"); expect(args.where.sessionId).toBe("session"); return [row]; } } };
  const stream = bytes => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  const prepared = await prepareCreationReferenceFiles("user", "session", ["ref"], { db, store: { stream: async key => { expect(key).toBe(row.objectKey); return stream(text); } } });
  expect(prepared).toEqual([{ id: "ref", name: "brief.md", fileType: "md", text: "# Brief\nKeep the November 1 date." }]);
  await expect(prepareCreationReferenceFiles("user", "session", ["ref"], { db, store: { stream: async () => stream(Buffer.from("changed")) } })).rejects.toThrow("CREATION_REFERENCE_INTEGRITY_FAILED");
});
