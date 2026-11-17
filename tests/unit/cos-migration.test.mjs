import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ state: null }));
vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/site-config.js", () => ({
  getSiteConfig: async () => (mock.state ? JSON.stringify(mock.state) : null),
  setSiteConfig: vi.fn(async () => {}),
  invalidateSiteConfig: vi.fn(),
}));
vi.mock("../../src/lib/infra/storage/cos.js", () => ({ cosStorage: () => { throw new Error("stores must be injected"); } }));

const { migrationView, retargetKey, migrateBatch, switchConfig, copyObject, startMigration } = await import("../../src/lib/domain/assets/cos-migration.js");
const { cosTargetId } = await import("../../src/lib/infra/storage/cos-config.js");
const { qrTarget } = await import("../../src/lib/server/announcement-qr.js");

const config = { enabled: true, directUploadEnabled: false, bucket: "old-1250000000", region: "ap-guangzhou", prefix: "letaidraw", secretId: "id", secretKey: "secret", signedUrlSeconds: 300 };
const source = { bucket: config.bucket, region: config.region, prefix: config.prefix, targetId: cosTargetId(config) };
const target = { bucket: "new-1250000000", region: "ap-hongkong", prefix: "letaidraw" };
const startedAt = "2026-11-18T10:00:00.000Z";

// 把每次 saveState 写入的内容回写到 mock.state，模拟持久化。
function database(extra = {}) {
  return { systemConfig: { upsert: vi.fn(async ({ update }) => { mock.state = JSON.parse(update.value); }) }, ...extra };
}
function stores(pages) {
  const sourceStore = {
    bucket: config.bucket, region: config.region,
    list: vi.fn(async (_prefix, marker) => pages[marker || ""]),
    head: vi.fn(async () => ({ "content-type": "image/png" })),
    get: vi.fn(async () => Buffer.from("bytes")),
  };
  const targetStore = { copyFrom: vi.fn(async () => {}), put: vi.fn(async () => {}) };
  return { sourceStore, targetStore };
}

beforeEach(() => { mock.state = null; });

describe("retargetKey", () => {
  it("rewrites only keys pinned to the source bucket", () => {
    expect(retargetKey("cos://old-1250000000/ap-guangzhou/letaidraw/originals/a.png", source, target)).toBe("cos://new-1250000000/ap-hongkong/letaidraw/originals/a.png");
    expect(retargetKey("cos://other-1250000000/ap-guangzhou/letaidraw/a.png", source, target)).toBe("cos://other-1250000000/ap-guangzhou/letaidraw/a.png");
    expect(retargetKey("letaidraw/assets/v1/hash/320.webp", source, target)).toBe("letaidraw/assets/v1/hash/320.webp");
  });
});

describe("migrationView", () => {
  it("caps progress below 100 until the switch completes", () => {
    expect(migrationView({ status: "running", estimate: 10, copied: 4 })).toMatchObject({ active: true, percent: 40 });
    expect(migrationView({ status: "running", estimate: 10, copied: 30 }).percent).toBe(99);
    expect(migrationView({ status: "done", estimate: 10, copied: 12 })).toMatchObject({ active: false, percent: 100 });
    expect(migrationView(null, config)).toMatchObject({ active: false, current: { bucket: "old-1250000000" } });
  });
});

describe("copyObject", () => {
  it("prefers a server-side copy and relays bytes when COS refuses it", async () => {
    const { sourceStore, targetStore } = stores({});
    expect(await copyObject(sourceStore, targetStore, "letaidraw/a.png")).toBe("server");
    expect(targetStore.put).not.toHaveBeenCalled();
    targetStore.copyFrom.mockRejectedValueOnce(new Error("cross region"));
    expect(await copyObject(sourceStore, targetStore, "letaidraw/b.png")).toBe("relay");
    expect(targetStore.put).toHaveBeenCalledWith("letaidraw/b.png", Buffer.from("bytes"), "image/png");
  });
});

describe("startMigration", () => {
  it("refuses a no-op target and a second concurrent migration", async () => {
    const db = database({ asset: { count: async () => 3 }, assetDelivery: { count: async () => 6 } });
    await expect(startMigration({ bucket: config.bucket, region: config.region }, { db, config })).rejects.toThrow("COS_MIGRATION_NOOP");
    const view = await startMigration({ bucket: target.bucket, region: target.region }, { db, config });
    expect(view).toMatchObject({ active: true, estimate: 9, target: { bucket: target.bucket } });
    await expect(startMigration({ bucket: target.bucket, region: target.region }, { db, config })).rejects.toThrow("COS_MIGRATION_BUSY");
  });
});

describe("migrateBatch", () => {
  it("does nothing without a running migration", async () => {
    expect(await migrateBatch({ db: database(), config })).toEqual({ active: false, remaining: false });
  });

  it("aborts without touching storage when the config changed mid-way", async () => {
    mock.state = { status: "running", phase: "copy", source, target, cursor: null, copied: 0, startedAt };
    const { sourceStore, targetStore } = stores({});
    await migrateBatch({ db: database(), config: { ...config, secretKey: "rotated" }, sourceStore, targetStore });
    expect(mock.state).toMatchObject({ status: "failed", error: "CONFIG_CHANGED" });
    expect(sourceStore.list).not.toHaveBeenCalled();
  });

  it("copies every page, catches up new writes, then switches", async () => {
    mock.state = { status: "running", phase: "copy", source, target, cursor: null, copied: 0, skipped: 0, startedAt };
    const old = "2026-11-01T00:00:00.000Z", fresh = "2026-11-18T10:05:00.000Z";
    const pages = {
      "": { contents: [{ key: "letaidraw/originals/a.png", lastModified: old }, { key: "letaidraw/assets/v1/h/320.webp", lastModified: old }], nextMarker: "m1" },
      m1: { contents: [{ key: "letaidraw/inspiration/v1/r/original", lastModified: fresh }], nextMarker: null },
    };
    const { sourceStore, targetStore } = stores(pages);
    const tx = {
      $executeRaw: vi.fn(async () => 1),
      assetDelivery: { findMany: async () => [], deleteMany: async () => {}, createMany: async () => {} },
      assetUpload: { deleteMany: async () => ({ count: 0 }) },
      systemConfig: { findUnique: async () => null, update: vi.fn() },
    };
    const db = database({ $transaction: async fn => fn(tx) });

    expect(await migrateBatch({ db, config, sourceStore, targetStore })).toMatchObject({ remaining: true, copied: 2 });
    expect(mock.state).toMatchObject({ phase: "copy", cursor: "m1" });
    expect(await migrateBatch({ db, config, sourceStore, targetStore })).toMatchObject({ remaining: true, copied: 1 });
    expect(mock.state).toMatchObject({ phase: "catchup", cursor: null, copied: 3 });
    // 补齐阶段只复制迁移开始后写入的对象。
    targetStore.copyFrom.mockClear();
    await migrateBatch({ db, config, sourceStore, targetStore });
    expect(targetStore.copyFrom).not.toHaveBeenCalled();
    const final = await migrateBatch({ db, config, sourceStore, targetStore });
    expect(targetStore.copyFrom).toHaveBeenCalledWith(sourceStore, "letaidraw/inspiration/v1/r/original");
    expect(final).toMatchObject({ remaining: false, result: { status: "done" } });
    expect(mock.state.status).toBe("done");
  });
});

describe("switchConfig", () => {
  it("rewrites pinned keys, moves receipts, refreshes QR targets and switches the config", async () => {
    const { setSiteConfig } = await import("../../src/lib/site-config.js");
    const nextConfig = { ...config, bucket: target.bucket, region: target.region };
    const calls = { raw: null, createMany: null, announcement: null };
    const tx = {
      $executeRaw: async (_strings, ...values) => { calls.raw = values; return 2; },
      assetDelivery: {
        findMany: async () => [{ assetId: "a1", targetId: source.targetId, variant: 320, objectKey: "letaidraw/assets/v1/h/320.webp", readyAt: new Date("2026-01-01") }],
        deleteMany: async () => {},
        createMany: async input => { calls.createMany = input.data; },
      },
      assetUpload: { deleteMany: async () => ({ count: 3 }) },
      systemConfig: {
        findUnique: async () => ({ value: JSON.stringify([{ qrImage: { id: "q1", target: qrTarget(config) } }]) }),
        update: async input => { calls.announcement = input.data.value; },
      },
    };
    const result = await switchConfig({ state: { source, target, startedAt }, config, db: database({ $transaction: async fn => fn(tx) }) });
    const oldPrefix = `cos://${source.bucket}/${source.region}/`;
    expect(calls.raw).toEqual([`cos://${target.bucket}/${target.region}/`, oldPrefix.length + 1, `${oldPrefix}%`]);
    expect(calls.createMany[0]).toMatchObject({ assetId: "a1", variant: 320, targetId: cosTargetId(nextConfig) });
    expect(JSON.parse(calls.announcement)[0].qrImage.target).toBe(qrTarget(nextConfig));
    expect(setSiteConfig).toHaveBeenCalledWith("cos_delivery", JSON.stringify(nextConfig), tx);
    expect(result).toMatchObject({ status: "done", moved: 2, deliveryRows: 1, uploads: 3 });
  });
});

describe("switch retry", () => {
  it("records a failed switch, retries it without copying again, and gives up after five attempts", async () => {
    mock.state = { status: "switching", phase: "switch", source, target, copied: 10, startedAt, switchAttempts: 0 };
    const { sourceStore, targetStore } = stores({});
    const db = database({ $transaction: async () => { throw new Error("function substring(text, bigint) does not exist"); } });
    const first = await migrateBatch({ db, config, sourceStore, targetStore });
    expect(first).toMatchObject({ active: true, remaining: false });
    expect(mock.state).toMatchObject({ status: "switching", switchAttempts: 1 });
    expect(mock.state.error).toContain("substring");
    expect(sourceStore.list).not.toHaveBeenCalled();
    for (let i = 0; i < 4; i++) await migrateBatch({ db, config, sourceStore, targetStore });
    expect(mock.state).toMatchObject({ status: "failed", switchAttempts: 5 });
  });

  it("finishes a migration that was stuck in switching once the switch succeeds", async () => {
    mock.state = { status: "switching", phase: "switch", source, target, copied: 10, startedAt, switchAttempts: 2, error: "SWITCH_FAILED: old" };
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      assetDelivery: { findMany: async () => [], deleteMany: async () => {}, createMany: async () => {} },
      assetUpload: { deleteMany: async () => ({ count: 0 }) },
      systemConfig: { findUnique: async () => null, update: vi.fn() },
    };
    const result = await migrateBatch({ db: database({ $transaction: async fn => fn(tx) }), config, ...stores({}) });
    expect(result).toMatchObject({ remaining: false, result: { status: "done" } });
    expect(mock.state).toMatchObject({ status: "done", error: null });
  });
});
