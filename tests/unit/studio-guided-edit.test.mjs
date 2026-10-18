import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { expansionPadding, editTargetSize, editOutputSize } from "../../src/lib/studio/edit-geometry.js";
import { greenEditGuide, runGuidedEdit } from "../../src/lib/domain/studio/guided-edit.js";
const solid = (background, width = 80, height = 80) => sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();

it.each(["16:9", "9:16", "1:1", "4:3", "3:4"])("preserves the source while producing exact %s expansion geometry", ratio => {
  for (const width of [600, 1024, 1254]) {
    const padding = expansionPadding(width, width, ratio);
    expect(padding).not.toBeNull();
    const size = editTargetSize("expand", { width, height: width }, padding);
    const [a, b] = ratio.split(":").map(Number);
    expect(size.width * b).toBe(size.height * a);
    expect(size.width).toBeGreaterThanOrEqual(width);
    expect(size.height).toBeGreaterThanOrEqual(width);
  }
  expect(expansionPadding(8192, 8192, ratio)).toBeNull();
});

it("does not add vertical margins when the source already fits an exact landscape expansion", () => {
  const padding = expansionPadding(900, 900, "16:9");
  expect(padding).toEqual({ left: 350, right: 350, top: 0, bottom: 0 });
});

it("marks only the selected pixels green without replacing the original input", async () => {
  const image = await solid("red");
  const mask = await sharp(await solid("black")).composite([{ input: await solid("white", 20, 20), left: 30, top: 30 }]).png().toBuffer();
  const pixels = await sharp(await greenEditGuide(image, mask)).raw().toBuffer();
  expect([...pixels.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  expect([...pixels.subarray((40 * 80 + 40) * 4, (40 * 80 + 40) * 4 + 4)]).toEqual([0, 255, 0, 255]);
  expect([...await sharp(image).raw().toBuffer()].slice(0, 4)).toEqual([255, 0, 0, 255]);
});

it("expansion ignores the composer's square ratio and never pastes the old center over the new result", async () => {
  const image = await solid("red", 90, 90), padding = expansionPadding(90, 90, "16:9");
  let request;
  const result = await runGuidedEdit({ baseURL: "https://example.invalid/v1" }, { tool: "expand", params: { size: "1024x1024", padding, prompt: "Extend the garden" } }, image, null, undefined,
    async (_config, args) => { request = args; const { width, height } = await sharp(args.image).metadata(); return solid("blue", width, height); });
  const frame = await sharp(request.image).metadata();
  expect(frame.width / frame.height).toBeCloseTo(16 / 9, 1);
  expect(request.size).toBe("auto@1K");
  expect(await sharp(result.images[0]).metadata()).toMatchObject({ width: 160, height: 90 });
  expect([...await sharp(result.images[0]).raw().toBuffer()].slice(0, 4)).toEqual([0, 0, 255, 255]);
  const center = await sharp(result.images[0]).extract({ left: 80, top: 45, width: 1, height: 1 }).raw().toBuffer();
  expect([...center]).toEqual([0, 0, 255, 255]);
  expect(result.edit.instruction).toContain("Extend the garden");
});

it("rejects an incompatible provider aspect ratio rather than stretching it", async () => {
  await expect(runGuidedEdit({}, { tool: "expand", params: { size: "1024x1024", padding: { left: 40, right: 40, top: 0, bottom: 0 }, prompt: "Expand" } },
    await solid("red"), null, undefined, () => solid("blue"))).rejects.toThrow("EDIT_GEOMETRY_MISMATCH");
});
it("does not deliver a transparent unfilled expansion as a successful result", async () => {
  await expect(runGuidedEdit({}, { tool: "expand", params: { size: "1024x1024", padding: 32, prompt: "Expand" } },
    await solid("red"), null, undefined, async (_config, args) => {
      const { width, height } = await sharp(args.image).metadata();
      return solid({ r: 0, g: 0, b: 0, alpha: 0 }, width, height);
    })).rejects.toThrow("EDIT_INCOMPLETE");
});

it("adapts cloud edits to a visual guide without adding a second conflicting mask guide", async () => {
  const generate = vi.fn(async (_config, args) => args.image);
  const result = await runGuidedEdit({ imageKind: "volcengine" }, { tool: "inpaint", params: { size: "1024x1024", prompt: "删除花盆" } },
    await solid("red"), await solid("white"), undefined, generate);
  const request = generate.mock.calls[0][1];
  expect(request.mask).toBeUndefined();
  expect(request.references).toHaveLength(1);
  expect(request.size).toBe("auto@2K");
  expect(request.prompt).toContain("do not blur");
  expect(result.edit.originalPrompt).toBe("删除花盆");
});

it("uses a legal letterbox frame for older official image models", () => {
  const resolved = editOutputSize({ imageModel: "gpt-image-1" }, "1:1@1K", { width: 1600, height: 900 });
  expect(resolved).toEqual({ choice: "1536x1024", dimensions: "1536x1024", error: null });
});
