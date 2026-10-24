import { expect, it, vi } from "vitest";
import { cleanupExpiredCreationBlobs } from "../../src/lib/domain/creation/blob-maintenance.js";

const now = new Date("2026-10-25T00:00:00Z");
function fixture(input = []) {
  const rows = new Map(input.map(row => [row.id, { state: "staging", expiresAt: new Date(+now - 1), objectKey: row.id, ...row }]));
  const matches = (row, where) => row && (!where.id || where.id === row.id)
    && (typeof where.state === "string" ? where.state === row.state : where.state.in.includes(row.state))
    && (where.expiresAt instanceof Date ? +row.expiresAt === +where.expiresAt : +row.expiresAt < +where.expiresAt.lt)
    && ["revisions", "outputs", "exports"].every(key => !where[key] || !row[key]);
  const db = { creationBlob: {
    findMany: vi.fn(async ({ where, take }) => [...rows.values()].filter(row => matches(row, where)).slice(0, take).map(({ id, objectKey }) => ({ id, objectKey }))),
    updateMany: vi.fn(async ({ where, data }) => {
      const row = rows.get(where.id); if (!matches(row, where)) return { count: 0 };
      Object.assign(row, data); return { count: 1 };
    }),
    deleteMany: vi.fn(async ({ where }) => {
      if (!matches(rows.get(where.id), where)) return { count: 0 };
      rows.delete(where.id); return { count: 1 };
    }),
  } };
  const store = { delete: vi.fn(async () => {}) };
  return { db, store, rows, run: options => cleanupExpiredCreationBlobs({ db, store, now, ...options }) };
}
it("removes only expired unreferenced staging/deleting objects, leaving published and referenced bytes", async () => {
  const f = fixture([{ id: "expired" }, { id: "retry", state: "deleting" }, { id: "ready", state: "ready" }, { id: "future", expiresAt: new Date(+now + 1000) },
    { id: "revision", revisions: 1 }, { id: "job", outputs: 1 }, { id: "export", exports: 1 }]);
  expect(await f.run()).toEqual({ scanned: 2, deleted: 2, failed: 0 });
  expect([...f.rows.keys()]).toEqual(["ready", "future", "revision", "job", "export"]);
});
it("rechecks references when claiming and prevents concurrent cleaners deleting the same object", async () => {
  const f = fixture([{ id: "shared" }, { id: "published-during-scan" }]);
  const scan = f.db.creationBlob.findMany.getMockImplementation();
  f.db.creationBlob.findMany.mockImplementation(async args => { const found = await scan(args); f.rows.get("published-during-scan").outputs = 1; return found; });
  const results = await Promise.all([f.run(), f.run()]);
  expect(results.reduce((sum, result) => sum + result.deleted, 0)).toBe(1);
  expect(f.store.delete).toHaveBeenCalledExactlyOnceWith("shared");
  expect(f.rows.has("published-during-scan")).toBe(true);
});
it("leases a failed deletion, continues the batch and retries only after lease expiry", async () => {
  const f = fixture([{ id: "fails" }, { id: "ok" }]);
  f.store.delete.mockRejectedValueOnce(new Error("storage unavailable"));
  expect(await f.run()).toEqual({ scanned: 2, deleted: 1, failed: 1 });
  expect(f.rows.get("fails").state).toBe("deleting");
  expect((await f.run()).scanned).toBe(0);
  expect((await f.run({ now: new Date(+now + 300001) })).deleted).toBe(1);
});
it("retries idempotently after object removal but failed database acknowledgement", async () => {
  const f = fixture([{ id: "crash" }]);
  f.db.creationBlob.deleteMany.mockRejectedValueOnce(new Error("db unavailable"));
  expect((await f.run()).failed).toBe(1);
  expect((await f.run({ now: new Date(+now + 300001) })).deleted).toBe(1);
  expect(f.store.delete).toHaveBeenCalledTimes(2);
});
it("stops between objects and does not delete another worker's renewed lease", async () => {
  const f = fixture([{ id: "first" }, { id: "second" }]);
  let stop = false;
  f.store.delete.mockImplementationOnce(async () => { f.rows.get("first").expiresAt = new Date(+now + 600000); stop = true; });
  expect(await f.run({ shouldStop: () => stop })).toEqual({ scanned: 2, deleted: 0, failed: 0 });
  expect(f.store.delete).toHaveBeenCalledTimes(1);
  expect(f.rows.size).toBe(2);
});
it("bounds batch sizes and rejects invalid clocks before querying", async () => {
  const f = fixture([{ id: "one" }, { id: "two" }]);
  expect((await f.run({ limit: 1 })).deleted).toBe(1);
  for (const options of [{ limit: 0 }, { limit: 51 }, { limit: 1.1 }, { now: new Date(NaN) }]) await expect(f.run(options)).rejects.toThrow("INVALID_CREATION_CLEANUP_OPTIONS");
  expect(f.db.creationBlob.findMany).toHaveBeenCalledTimes(1);
});
