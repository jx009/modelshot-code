import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { cropOutputs } from "../../src/lib/domain/studio/pixels.js";
import { cropCells, ratioCrop } from "../../src/lib/studio/crop-geometry.js";
import { paramsSchema } from "../../src/lib/studio/tools.js";

describe("deterministic crop output", () => {
  it("keeps alpha outside shapes and preserves pixels within", async () => {
    const image = await sharp({ create: { width: 100, height: 100, channels: 4, background: "#ff0000" } }).png().toBuffer();
    for (const cropShape of ["ellipse", "triangle", "heart"]) {
      const [png] = await cropOutputs(image, { rect: { left: 0, top: 0, width: 100, height: 100 }, cropShape });
      const pixels = await sharp(png).ensureAlpha().raw().toBuffer();
      expect(pixels[3]).toBe(0);
      expect([...pixels.subarray((50 * 100 + 50) * 4, (50 * 100 + 50) * 4 + 4)]).toEqual([255, 0, 0, 255]);
    }
  });
  it("splits irregular grids without overlapping or losing a source pixel", async () => {
    const rect = { left: 0, top: 0, width: 101, height: 79 }, cropGrid = { x: [.31, .72], y: [.61] };
    const cells = cropCells(rect, cropGrid);
    expect(cells.reduce((n, cell) => n + cell.width * cell.height, 0)).toBe(101 * 79);
    const input = await sharp({ create: { width: 101, height: 79, channels: 3, background: "blue" } }).png().toBuffer();
    const outputs = await cropOutputs(input, { rect, cropShape: "grid", cropGrid });
    expect(outputs).toHaveLength(6);
    for (const [i, bytes] of outputs.entries()) expect(await sharp(bytes).metadata()).toMatchObject({ width: cells[i].width, height: cells[i].height });
    expect(() => paramsSchema.parse({ cropGrid: { x: [.8, .2], y: [] } })).toThrow();
    await expect(cropOutputs(input, { rect: { left: 0, top: 0, width: 1, height: 1 }, cropShape: "grid" })).rejects.toThrow("CROP_GRID_TOO_SMALL");
  });
  it("centers ratio presets within portrait or landscape images", () => {
    expect(ratioCrop(300, 200, 1)).toEqual({ left: 50, top: 0, width: 200, height: 200 });
    expect(ratioCrop(200, 300, 2)).toEqual({ left: 0, top: 100, width: 200, height: 100 });
  });
});
