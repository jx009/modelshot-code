import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { prepareCreationReferenceImages } from "../../src/lib/domain/creation/reference-images.js";
import { creationLanguageMessages } from "../../src/lib/domain/creation/language-provider.js";

async function reference() {
  const bytes = await sharp({ create: { width: 1800, height: 1200, channels: 4, background: "#aabbcc80" } }).png().toBuffer();
  const id = randomUUID(), userId = randomUUID();
  const asset = { id, width: 1800, height: 1200, bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex"), objectKey: `${userId}/${id}.png`, contentType: "image/png" };
  const db = { asset: { findMany: vi.fn(async () => [asset]) } };
  const store = { stream: vi.fn(async () => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } })) };
  return { bytes, asset, id, userId, db, store };
}

it("sends bounded actual pixels and metadata, reuses an immutable preview, and rechecks ownership on a cache hit", async () => {
  const f = await reference();
  const result = await prepareCreationReferenceImages(f.userId, [f.id, f.id], f);
  expect(f.db.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: f.userId, status: "active", id: { in: [f.id] } }) }));
  expect(result.assets).toEqual([{ id: f.id, width: 1800, height: 1200 }]);
  const bytes = Buffer.from(result.images[0].dataUrl.split(",")[1], "base64"), metadata = await sharp(bytes).metadata();
  expect(metadata.format).toBe("jpeg"); expect(metadata.width).toBeLessThanOrEqual(1280); expect(bytes.length).toBeLessThanOrEqual(512 * 1024);
  expect(await prepareCreationReferenceImages(f.userId, [f.id], f)).toEqual(result);
  expect(f.store.stream).toHaveBeenCalledTimes(1);
  f.db.asset.findMany.mockResolvedValue([]);
  await expect(prepareCreationReferenceImages(f.userId, [f.id], f)).rejects.toThrow("ASSET_NOT_FOUND");
  expect(f.store.stream).toHaveBeenCalledTimes(1);
});

it("rejects an oversized stream before decoding and cancels its reader", async () => {
  const f = await reference(), cancel = vi.fn();
  f.asset.bytes = 8;
  f.store.stream.mockImplementation(async () => new ReadableStream({ start(controller) { controller.enqueue(f.bytes); }, cancel }));
  await expect(prepareCreationReferenceImages(f.userId, [f.id], f)).rejects.toThrow("CREATION_REFERENCE_INVALID");
  expect(cancel).toHaveBeenCalledOnce();
});

it("rejects oversized reference sets from metadata without downloading any originals", async () => {
  const f = await reference();
  const rows = Array.from({ length: 3 }, () => ({ ...f.asset, id: randomUUID(), bytes: 40 * 1024 * 1024 }));
  f.db.asset.findMany.mockResolvedValue(rows);
  await expect(prepareCreationReferenceImages(f.userId, rows.map(row => row.id), f)).rejects.toThrow("CREATION_REFERENCE_TOO_LARGE");
  expect(f.store.stream).not.toHaveBeenCalled();
});

it("rejects changed image bytes and aborts before downloading when the worker lost its lease", async () => {
  const f = await reference(); f.asset.checksum = "wrong";
  await expect(prepareCreationReferenceImages(f.userId, [f.id], f)).rejects.toThrow("CREATION_REFERENCE_INVALID");
  const controller = new AbortController(); controller.abort(new Error("lease lost"));
  f.store.stream.mockClear();
  await expect(prepareCreationReferenceImages(f.userId, [f.id], { ...f, signal: controller.signal })).rejects.toThrow("lease lost");
  expect(f.store.stream).not.toHaveBeenCalled();
});

it("keeps input ordering for image labels and never silently downgrades missing pixels to metadata", async () => {
  const first = await reference(), second = await reference();
  first.db.asset.findMany.mockResolvedValue([second.asset, first.asset]);
  first.store.stream.mockImplementation(async key => new ReadableStream({ start(controller) { controller.enqueue(key === first.asset.objectKey ? first.bytes : second.bytes); controller.close(); } }));
  const references = await prepareCreationReferenceImages(first.userId, [first.id, second.id], first);
  expect(references.images.map(image => image.assetId)).toEqual([first.id, second.id]);
  const input = { purpose: "poster.generate", prompt: "Use the reference", locale: "zh", assetIds: [first.id, second.id], width: 1080, height: 1440 };
  const messages = creationLanguageMessages({ input, ...references });
  expect(messages[1].content.filter(block => block.type === "image_url").map(block => block.image_url.url)).toEqual(references.images.map(image => image.dataUrl));
  expect(messages[1].content[1].text).toContain(first.id);
  expect(messages[1].content[0].text).not.toContain("data:image");
  expect(messages[1].content[0].text).not.toContain(first.asset.objectKey);
  expect(() => creationLanguageMessages({ input, assets: references.assets, images: [] })).toThrow("CREATION_REFERENCE_INVALID");
  expect(() => creationLanguageMessages({ input, assets: references.assets, images: references.images.toReversed() })).toThrow("CREATION_REFERENCE_INVALID");
  const textOnly = creationLanguageMessages({ input: { ...input, assetIds: [] }, assets: [], images: [] });
  expect(typeof textOnly[1].content).toBe("string");
});
