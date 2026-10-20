import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { COS_DEFAULTS, cosConfigSchema, cosConfigView, cosTargetId, mergeCosConfig } from "../../src/lib/infra/storage/cos-config.js";
import { cosStorage, testCosConnection } from "../../src/lib/infra/storage/cos.js";
import { assetDeliveryUrl, assetDeliveryBatch, cosAssetKey, documentAssetIds, enqueueCosAsset, processCosAsset, removeCosAsset } from "../../src/lib/domain/assets/cos-delivery.js";

const config = { ...COS_DEFAULTS, enabled: true, bucket: "fixture-1250000000", secretId: "fixture-id", secretKey: "fixture-secret" };
const asset = { id: "asset-fixture-0001", userId: "owner", checksum: "checksum", objectKey: "owner/upload/fixture.png", contentType: "image/png", status: "active" };
afterEach(() => vi.restoreAllMocks());

describe("COS configuration and credentials", () => {
  it("preserves blank credentials, never returns them, and invalidates rotated targets", () => {
    expect(mergeCosConfig({ ...config, secretId: "", secretKey: "" }, config)).toEqual(config);
    expect(cosConfigView(config)).not.toHaveProperty("secretKey");
    expect(cosConfigView(config)).not.toHaveProperty("secretId");
    expect(cosConfigView(config).credentialsConfigured).toBe(true);
    expect(() => mergeCosConfig({ ...COS_DEFAULTS, enabled: true })).toThrow("COS_CREDENTIALS_REQUIRED");
    for (const changes of [{ bucket: "other-1250000000" }, { prefix: "new-prefix" }, { secretKey: "rotated" }]) expect(cosTargetId({ ...config, ...changes })).not.toBe(cosTargetId(config));
  });
  it("rejects arbitrary endpoints, traversal, and permanent signatures", () => {
    for (const changes of [{ bucket: "http://127.0.0.1" }, { region: "ap-hongkong/.." }, { prefix: "../../private" }, { prefix: "/root" }, { signedUrlSeconds: 31536000 }, { endpoint: "http://localhost" }]) expect(cosConfigSchema.safeParse({ ...config, ...changes }).success).toBe(false);
  });
  it("uses official HTTPS endpoints and short signed URLs without sending the secret", async () => {
    const url = new URL(await cosStorage(config).signedUrl("letaidraw/assets/file.png"));
    expect(url.protocol).toBe("https:"); expect(url.hostname).toBe("fixture-1250000000.cos.ap-hongkong.myqcloud.com");
    expect(url.searchParams.get("q-signature")).toMatch(/^[a-f0-9]+$/);
    const times = url.searchParams.get("q-sign-time").split(";").map(Number);
    expect(times[1] - times[0]).toBe(300);
    expect(url.href).not.toContain("fixture-secret");
  });
  it("tests private ACL, byte integrity and deletion; returns only a short browser probe", async () => {
    const values = new Map();
    const store = { assertPrivateBucket: vi.fn(), put: vi.fn(async (k, b) => values.set(k, b)), get: vi.fn(async k => values.get(k)), delete: vi.fn(async k => values.delete(k)), signedUrl: vi.fn(async () => "https://fixture/probe"), signedUpload: vi.fn(async () => "https://fixture/upload-probe") };
    const result = await testCosConnection(config, store);
    expect(result).toEqual({ ok: true, probeUrl: "https://fixture/probe", uploadProbe: { url: "https://fixture/upload-probe", headers: { "Content-Type": "image/png" }, bodyBase64: expect.any(String) } });
    expect(store.assertPrivateBucket).toHaveBeenCalled(); expect(store.delete).toHaveBeenCalledOnce();
    expect([...values.keys()]).toEqual(["letaidraw/diagnostics/browser-probe.png"]);
    expect(await sharp(values.get("letaidraw/diagnostics/browser-probe.png")).raw().toBuffer()).toEqual(Buffer.from([255, 255, 255]));
    expect(store.signedUrl).toHaveBeenCalledWith("letaidraw/diagnostics/browser-probe.png", 60);
    const probeBytes = values.get("letaidraw/diagnostics/browser-probe.png");
    expect(Buffer.from(result.uploadProbe.bodyBase64, "base64")).toEqual(probeBytes);
    expect(store.signedUpload).toHaveBeenCalledWith("letaidraw/diagnostics/browser-probe.png", "image/png", probeBytes.length);
    const client = { getBucketAcl: vi.fn(async () => ({ ACL: "public-read" })) };
    await expect(cosStorage(config, client).assertPrivateBucket()).rejects.toThrow("COS_BUCKET_PUBLIC");
  });
});

describe("private replica delivery", () => {
  it("serves COS originals immediately without waiting for replica uploads", async () => {
    const primary = { ...asset, objectKey: `cos://${config.bucket}/${config.region}/letaidraw/originals/image.jpg` };
    const db = { assetDelivery: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) }, asset: { findMany: vi.fn(async () => [primary]) } };
    const store = { signedUrl: vi.fn(async () => "https://fixture/direct") };
    expect(await assetDeliveryUrl(primary, 0, { config, db, store, download: true })).toBe("https://fixture/direct");
    expect(db.assetDelivery.findUnique).not.toHaveBeenCalled();
    expect(store.signedUrl).toHaveBeenCalledWith("letaidraw/originals/image.jpg", 300, true);
    expect(await assetDeliveryUrl(primary, 320, { config, db, store })).toBe("https://fixture/direct");
    const batch = await assetDeliveryBatch(primary.userId, [primary.id], [0, 320], { config, db, store });
    expect(batch.items).toHaveLength(2);
    expect(batch.items.map(item => item.variant)).toEqual([0, 320]);
  });
  it("batch signs only owned, active images and matching receipts with one scoped query", async () => {
    const key = cosAssetKey(config, asset, 320);
    const other = { ...asset, id: "other-image", userId: "other-user" };
    const db = { assetDelivery: { findMany: vi.fn(async () => [
      { assetId: asset.id, variant: 320, objectKey: key, asset },
      { assetId: asset.id, variant: 640, objectKey: "old-key", asset },
      { assetId: other.id, variant: 320, objectKey: cosAssetKey(config, other, 320), asset: other },
    ]) } };
    const store = { signedUrl: vi.fn(async () => "https://fixture/signed") };
    const result = await assetDeliveryBatch(asset.userId, [asset.id, asset.id, other.id], [320, 640], { config, db, store, now: 1000 });
    expect(db.assetDelivery.findMany).toHaveBeenCalledOnce();
    expect(db.assetDelivery.findMany.mock.calls[0][0].where).toEqual({ assetId: { in: [asset.id, other.id] }, targetId: cosTargetId(config), variant: { in: [320, 640] }, asset: { userId: asset.userId, status: "active", contentType: { startsWith: "image/" } } });
    expect(result).toEqual({ userId: asset.userId, expiresAt: 301000, items: [{ assetId: asset.id, variant: 320, url: "https://fixture/signed" }] });
    expect(store.signedUrl).toHaveBeenCalledOnce();
  });
  it("skips disabled or empty batches and degrades optional delivery failures to source", async () => {
    const db = { assetDelivery: { findMany: vi.fn(async () => { throw new Error("offline"); }) } };
    expect(await assetDeliveryBatch(asset.userId, [], [320], { config, db })).toBeNull();
    expect(await assetDeliveryBatch(asset.userId, [asset.id], [320], { config: { ...config, enabled: false }, db })).toBeNull();
    expect(db.assetDelivery.findMany).not.toHaveBeenCalled();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await assetDeliveryBatch(asset.userId, [asset.id], [320], { config, db })).toBeNull();
  });
  it("bounds signing batches and extracts asset IDs without changing document contents", async () => {
    const db = { assetDelivery: { findMany: vi.fn(async () => []) } };
    await assetDeliveryBatch(asset.userId, Array.from({ length: 300 }, (_, index) => `asset-${index}`), [320], { config, db });
    expect(db.assetDelivery.findMany.mock.calls[0][0].where.assetId.in).toHaveLength(256);
    const content = { layers: [{ assetId: "layer" }], messages: [{ assetId: "layer" }, { assetId: "message" }], composer: { referenceIds: ["reference"] }, commerce: { productAssetId: "product", sections: [{ revisionAssetId: "revision" }] } };
    expect(documentAssetIds(content)).toEqual(["layer", "message", "reference", "product", "revision"]);
    expect(content.layers).toEqual([{ assetId: "layer" }]);
  });
  it("returns no URL when disabled, cold, or when the receipt key is wrong", async () => {
    const db = { assetDelivery: { findUnique: vi.fn(async () => null) } };
    const store = { signedUrl: vi.fn() };
    expect(await assetDeliveryUrl(asset, 320, { config: { ...config, enabled: false }, db, store })).toBeNull();
    expect(db.assetDelivery.findUnique).not.toHaveBeenCalled();
    expect(await assetDeliveryUrl(asset, 320, { config, db, store })).toBeNull();
    db.assetDelivery.findUnique.mockResolvedValue({ readyAt: new Date(), objectKey: "wrong/user/key" });
    expect(await assetDeliveryUrl(asset, 320, { config, db, store })).toBeNull();
    expect(store.signedUrl).not.toHaveBeenCalled();
  });
  it("signs a ready replica using a local receipt without a COS HEAD request", async () => {
    const key = cosAssetKey(config, asset, 1280);
    const db = { assetDelivery: { findUnique: vi.fn(async () => ({ readyAt: new Date("2020-01-01"), objectKey: key })) } };
    const store = { signedUrl: vi.fn(async () => "https://fixture/signed") };
    expect(await assetDeliveryUrl(asset, 1280, { config, db, store })).toBe("https://fixture/signed");
    expect(store.signedUrl).toHaveBeenCalledWith(key);
    expect(cosAssetKey(config, { ...asset, userId: "other" }, 1280)).not.toBe(key);
  });
  it("deduplicates durable enqueue requests within a time window and does not block generation on failure", async () => {
    const db = { outboxEvent: { upsert: vi.fn() } };
    await enqueueCosAsset(asset.id, { config, db, now: 100 }); await enqueueCosAsset(asset.id, { config, db, now: 200 });
    expect(db.outboxEvent.upsert.mock.calls[0]).toEqual(db.outboxEvent.upsert.mock.calls[1]);
    expect(db.outboxEvent.upsert.mock.calls[0][0].create.kind).toBe("asset-mirror");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db.outboxEvent.upsert.mockRejectedValue(new Error("offline"));
    await expect(enqueueCosAsset(asset.id, { config, db })).resolves.toBeUndefined();
  });
  it("creates original and persistent previews, publishes receipts only after successful uploads", async () => {
    const bytes = await sharp({ create: { width: 1600, height: 800, channels: 4, background: "red" } }).png().toBuffer();
    const originals = new Map([[asset.objectKey, bytes]]), replicas = new Map(), receipts = new Map();
    const db = { asset: { findFirst: vi.fn(async () => asset) }, assetDelivery: {
      findUnique: vi.fn(async ({ where }) => receipts.get(where.assetId_targetId_variant.variant)),
      upsert: vi.fn(async ({ create }) => { expect(replicas.has(create.objectKey)).toBe(true); receipts.set(create.variant, { ...create, readyAt: new Date() }); }),
    } };
    const source = { get: vi.fn(async key => originals.get(key)), getOptional: vi.fn(async key => originals.get(key)), put: vi.fn(async (key, b) => originals.set(key, b)) };
    const target = { assertPrivateBucket: vi.fn(), put: vi.fn(async (key, b) => replicas.set(key, b)), delete: vi.fn() };
    await processCosAsset(asset.id, { config, db, source, target });
    expect(replicas.size).toBe(4); expect(originals.size).toBe(4); expect(receipts.size).toBe(4);
    expect(target.put.mock.calls.map(([key]) => key.split("/").at(-1))).toEqual(["320.webp", "640.webp", "1280.webp", "original.png"]);
    expect(await sharp(replicas.get(cosAssetKey(config, asset, 320))).metadata()).toMatchObject({ width: 320, height: 160, format: "webp" });
    for (const receipt of receipts.values()) receipt.readyAt = new Date("2020-01-01");
    await processCosAsset(asset.id, { config, db, source, target });
    expect(target.put).toHaveBeenCalledTimes(4);
    const failedDb = { ...db, assetDelivery: { findUnique: vi.fn(async () => null), upsert: vi.fn() } };
    target.put.mockRejectedValue(new Error("cos offline"));
    await expect(processCosAsset(asset.id, { config, db: failedDb, source, target })).rejects.toThrow("cos offline");
    expect(failedDb.assetDelivery.upsert).not.toHaveBeenCalled();
  });
  it("removes replicas even while acceleration is disabled", async () => {
    const db = { assetDelivery: { deleteMany: vi.fn() } }, target = { delete: vi.fn() };
    await removeCosAsset(asset, { config: { ...config, enabled: false }, db, target });
    expect(target.delete).toHaveBeenCalledTimes(4); expect(db.assetDelivery.deleteMany).toHaveBeenCalledOnce();
  });
  it("reuses persisted preview bytes after a fresh module load without reading the original", async () => {
    const persisted = await sharp({ create: { width: 160, height: 80, channels: 3, background: "blue" } }).webp().toBuffer();
    vi.resetModules();
    const { imagePreview } = await import("../../src/lib/domain/assets/preview.js");
    const source = { getOptional: vi.fn(async () => persisted), get: vi.fn(), put: vi.fn() };
    expect(await imagePreview({ ...asset, id: "persisted-preview-fixture" }, 320, source)).toEqual(persisted);
    expect(source.get).not.toHaveBeenCalled(); expect(source.put).not.toHaveBeenCalled();
  });
});
