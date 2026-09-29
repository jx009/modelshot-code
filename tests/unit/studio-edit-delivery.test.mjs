import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { editFrame, restoreEditFrame } from "../../src/lib/domain/studio/edit-frame.js";
import { prepareObjectEdit } from "../../src/lib/domain/studio/object-edit.js";
import { imagePreview, previewSize } from "../../src/lib/domain/assets/preview.js";

describe("object edit geometry and repair coverage", () => {
  it("letterboxes an edit and restores its original dimensions without stretching", async () => {
    const image = await sharp({ create: { width: 120, height: 40, channels: 4, background: "red" } }).png().toBuffer();
    const mask = await sharp({ create: { width: 120, height: 40, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
    const frame = await editFrame(image, mask, "120x80");
    expect(frame.content).toEqual({ left: 0, top: 20, width: 120, height: 40 });
    const alpha = await sharp(frame.mask).extractChannel("alpha").raw().toBuffer();
    expect(alpha[0]).toBe(255); expect(alpha[40 * 120 + 60]).toBe(0);
    const restored = await restoreEditFrame(frame.image, frame);
    expect(await sharp(restored).metadata()).toMatchObject({ width: 120, height: 40 });
    expect(await sharp(restored).raw().toBuffer()).toEqual(await sharp(image).raw().toBuffer());
    const wrong = await sharp(image).resize(100, 100).png().toBuffer();
    await expect(restoreEditFrame(wrong, frame)).rejects.toThrow("EDIT_GEOMETRY_MISMATCH");
  });
  it("repairs surrounding shadow space and feathers the patch instead of cutting along the object", async () => {
    const image = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#aaaaaa" } }).png().toBuffer();
    const mask = await sharp({ create: { width: 200, height: 200, channels: 3, background: "black" } }).composite([{ input: await sharp({ create: { width: 60, height: 80, channels: 3, background: "white" } }).png().toBuffer(), left: 70, top: 60 }]).png().toBuffer();
    const prepared = await prepareObjectEdit(image, mask, { remove: true });
    expect(prepared.context).toEqual({ left: 0, top: 0, width: 200, height: 200 });
    const blend = await sharp(prepared.blendMask).greyscale().raw().toBuffer();
    expect(blend[100 * 200 + 65]).toBe(255); // outside the old object, inside repair area
    expect(blend[100 * 200 + 70]).toBe(255); // old contour must not be a seam
    expect(blend[100 * 200 + 50]).toBeGreaterThan(0);
    expect(blend[100 * 200 + 50]).toBeLessThan(255);
    expect(blend[0]).toBe(0);
  });
});

describe("private asset previews", () => {
  it("bounds previews, preserves alpha and deduplicates concurrent reads", async () => {
    const png = await sharp({ create: { width: 1600, height: 800, channels: 4, background: { r: 200, g: 70, b: 10, alpha: 0.5 } } }).png().toBuffer();
    const store = { get: vi.fn(async () => png) }, asset = { id: "preview-fixture", userId: "owner", checksum: "abc", objectKey: "private" };
    const [a, b] = await Promise.all([imagePreview(asset, 320, store), imagePreview(asset, 320, store)]);
    expect(a).toEqual(b); expect(store.get).toHaveBeenCalledTimes(1);
    expect(await sharp(a).metadata()).toMatchObject({ format: "webp", width: 320, height: 160, hasAlpha: true });
    await imagePreview({ ...asset, userId: "other-owner" }, 320, store);
    expect(store.get).toHaveBeenCalledTimes(2);
  });
  it("rejects arbitrary sizes so the cache cannot grow by unbounded variants", () => {
    expect(previewSize(null)).toBeNull(); expect(previewSize("1280")).toBe(1280);
    for (const value of ["0", "8192", "evil", "512"]) expect(() => previewSize(value)).toThrow("INVALID_PREVIEW_SIZE");
  });
});
