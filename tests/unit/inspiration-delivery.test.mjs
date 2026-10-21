import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ item: null, image: vi.fn() }));
vi.mock("@/lib/infra/storage/cos", () => ({ cosStorage: vi.fn() }));
vi.mock("@/lib/server/inspiration", () => ({
  findInspiration: async () => mocks.item,
  readInspirationImage: mocks.image,
}));
vi.mock("sharp", () => ({ default: () => ({ rotate() { return this; }, resize() { return this; }, webp() { return this; }, toBuffer: async () => Buffer.from("thumbnail") }) }));

let processMirror, db, target, records, inTransaction;
const config = { enabled: true, bucket: "fixture", region: "ap-hongkong", prefix: "test", secretId: "fixture", secretKey: "fixture", signedUrlSeconds: 300 };

beforeEach(async () => {
  vi.resetModules();
  processMirror = (await import("../../src/lib/server/inspiration-delivery.js")).processInspirationMirror;
  mocks.item = { id: "example", cover: { type: "asset", assetId: "asset" } };
  mocks.image.mockResolvedValue({ bytes: Buffer.from("image"), contentType: "image/png" });
  records = new Map();
  inTransaction = false;
  let previous = Promise.resolve();
  db = {
    asset: { findFirst: async () => ({ checksum: "version-one" }) },
    $queryRaw: async () => [],
    systemConfig: {
      findUnique: async ({ where }) => records.has(where.key) ? { value: records.get(where.key) } : null,
      upsert: async ({ where, create, update }) => records.set(where.key, records.has(where.key) ? update.value : create.value),
      updateMany: async ({ where, data }) => {
        if (records.get(where.key) !== where.value) return { count: 0 };
        records.set(where.key, data.value);
        return { count: 1 };
      },
      deleteMany: async ({ where }) => {
        if (records.get(where.key) === where.value) records.delete(where.key);
      },
    },
    $transaction: vi.fn(callback => {
      const task = previous.then(async () => {
        inTransaction = true;
        try { return await callback(db); } finally { inTransaction = false; }
      });
      previous = task.catch(() => {});
      return task;
    }),
  };
  target = { assertPrivateBucket: vi.fn(async () => { expect(inTransaction).toBe(false); }), put: vi.fn(async () => { expect(inTransaction).toBe(false); }) };
});

test("transfers images outside transactions and skips ready mirrors", async () => {
  await processMirror("example", { db, config, target });
  expect([...records.values()]).toEqual(["ready"]);
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(target.put).toHaveBeenCalledTimes(2);
  await processMirror("example", { db, config, target });
  expect(target.assertPrivateBucket).toHaveBeenCalledOnce();
  expect(target.put).toHaveBeenCalledTimes(2);
});

test("releases failed uploads for retry without publishing partial files", async () => {
  target.put.mockRejectedValueOnce(new Error("transfer failed"));
  await expect(processMirror("example", { db, config, target })).rejects.toThrow("transfer failed");
  expect(records.size).toBe(0);
  await processMirror("example", { db, config, target });
  expect([...records.values()]).toEqual(["ready"]);
});

test("independent workers honor the same database lease", async () => {
  let release, started;
  const transferring = new Promise(resolve => { started = resolve; });
  target.put.mockImplementationOnce(() => new Promise(resolve => { release = resolve; started(); }));
  const first = processMirror("example", { db, config, target });
  await transferring;
  vi.resetModules();
  const secondWorker = (await import("../../src/lib/server/inspiration-delivery.js")).processInspirationMirror;
  try {
    await expect(secondWorker("example", { db, config, target })).rejects.toThrow("INSPIRATION_MIRROR_BUSY");
    expect(target.put).toHaveBeenCalledOnce();
  } finally { release(); await first; }
  expect([...records.values()]).toEqual(["ready"]);
});

test("recovers expired leases and does not publish a hidden item", async () => {
  await processMirror("example", { db, config, target });
  const key = [...records.keys()][0];
  records.set(key, JSON.stringify({ token: "crashed-worker", expiresAt: 1 }));
  target.put.mockImplementationOnce(async () => { mocks.item = null; });
  await processMirror("example", { db, config, target });
  expect(records.size).toBe(0);
});
