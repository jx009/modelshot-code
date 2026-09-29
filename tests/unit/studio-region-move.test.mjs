import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { containRegion, regionInside } from "../../src/lib/studio/move-geometry.js";
import { runImageTool } from "../../src/lib/domain/studio/execution.js";
import { jobSchema } from "../../src/lib/studio/tools.js";

const source = { left: 20, top: 20, width: 20, height: 30, rotation: 0 };
const target = { left: 80, top: 40, width: 25, height: 30, rotation: 30 };
const snapshot = { tool: "move", params: { selectionMode: "region", moveSource: source, moveTarget: target } };
const solid = (color, width, height) => sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();

describe("region-based object movement", () => {
  it("constrains rotated corners and rejects regions too large to fit", () => {
    expect(regionInside(target, 160, 120)).toBe(true);
    const outside = { ...target, left: 0 };
    expect(regionInside(outside, 160, 120)).toBe(false);
    expect(regionInside(containRegion(outside, 160, 120), 160, 120)).toBe(true);
    expect(containRegion({ ...source, width: 500 }, 160, 120)).toBeNull();
    expect(regionInside({ ...source, width: 1 }, 160, 120)).toBe(false);
  });
  it("requires two regions, accepts a move without segmentation, and disallows region mode for other tools", () => {
    const job = { ...snapshot, documentId: "doc", documentVersion: 1, targetId: "layer", assetId: "image" };
    expect(jobSchema.safeParse(job).success).toBe(true);
    expect(jobSchema.safeParse({ ...job, params: { ...job.params, moveTarget: undefined } }).success).toBe(false);
    expect(jobSchema.safeParse({ ...job, tool: "erase", maskId: "mask" }).success).toBe(false);
  });
  it("calls the edit model once with the full scene and placement guide, then preserves pixels outside both regions", async () => {
    const image = await solid("red", 160, 120);
    const generate = vi.fn(async (_config, args) => {
      expect(args.references).toHaveLength(1);
      expect(args.prompt).toContain("Move that same object");
      expect(args.prompt).toContain("old shadow");
      expect(args.prompt).toContain('"rotation":30');
      expect(args.image.equals(args.references[0])).toBe(false);
      const { width, height } = await sharp(args.image).metadata();
      expect(await sharp(args.mask).metadata()).toMatchObject({ width, height, channels: 4 });
      return solid("blue", width, height);
    });
    const result = await runImageTool({}, snapshot, image, null, undefined, { generate });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.placement).toBe("append");
    expect(await sharp(result.images[0]).metadata()).toMatchObject({ width: 160, height: 120 });
    const raw = await sharp(result.images[0]).raw().toBuffer();
    const pixel = (x, y) => [...raw.subarray((y * 160 + x) * 4, (y * 160 + x) * 4 + 4)];
    expect(pixel(0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(150, 110)).toEqual([255, 0, 0, 255]);
    expect(pixel(30, 30)).toEqual([0, 0, 255, 255]);
    expect(pixel(80, 55)).toEqual([0, 0, 255, 255]);
  });
  it("rejects an invalid rotated destination before spending a model call", async () => {
    const generate = vi.fn();
    await expect(runImageTool({}, { ...snapshot, params: { ...snapshot.params, moveTarget: { ...target, left: 0 } } }, await solid("red", 160, 120), null, undefined, { generate })).rejects.toThrow("MOVE_OUT_OF_BOUNDS");
    expect(generate).not.toHaveBeenCalled();
  });
});
