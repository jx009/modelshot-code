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

it.each(["expand", "inpaint"])("bounds the %s reference input at 3072px and exports a JPEG without changing the requested output size", async tool => {
  const image = await solid("red", 3200, 1800);
  const mask = tool === "inpaint" ? await solid("white", 3200, 1800) : null;
  const generate = vi.fn(async () => solid("blue", 120, 60));
  const result = await runGuidedEdit({}, { tool, params: { size: "auto@2K", padding: { left: 100, right: 100, top: 0, bottom: 0 }, prompt: "补全" } }, image, mask, undefined, generate);
  const request = generate.mock.calls[0][1], input = await sharp(request.image).metadata();
  expect(input.format).toBe("jpeg");
  expect(input.width).toBe(3072);
  expect(input.height).toBeLessThanOrEqual(3072);
  expect(request.sizeSource).toEqual({ width: tool === "expand" ? 3400 : 3200, height: 1800 });
  expect(request.mask).toBeUndefined();
  expect(result.edit.inputMode).toBe(tool === "expand" ? "green-expansion-canvas" : "single-green-guide");
  expect(generate).toHaveBeenCalledTimes(1);
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
    async (_config, args) => { request = args; return solid("blue", 160, 90); });
  const frame = await sharp(request.image).metadata();
  expect(frame).toMatchObject({ width: 160, height: 90, format: "jpeg" });
  const sample = async (left, top) => [...await sharp(request.image).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
  const margin = await sample(5, 45), source = await sample(80, 45);
  expect(margin[1]).toBeGreaterThan(250); expect(margin[0]).toBeLessThan(5);
  expect(source[0]).toBeGreaterThan(250); expect(source[1]).toBeLessThan(5);
  expect(request.sizeSource).toEqual({ width: 160, height: 90 });
  expect(request.mask).toBeUndefined();
  expect(request.references).toHaveLength(0);
  expect(request.prompt).toContain("16:9");
  expect(request.size).toBe("auto@1K");
  expect(await sharp(result.images[0]).metadata()).toMatchObject({ width: 160, height: 90 });
  expect([...await sharp(result.images[0]).raw().toBuffer()].slice(0, 4)).toEqual([0, 0, 255, 255]);
  const center = await sharp(result.images[0]).extract({ left: 80, top: 45, width: 1, height: 1 }).raw().toBuffer();
  expect([...center]).toEqual([0, 0, 255, 255]);
  expect(result.edit.instruction).toContain("Extend the garden");
});

it("preserves a valid provider image despite a different ratio, without stretching or discarding it", async () => {
  const generated = await solid("blue", 1536, 1024);
  const result = await runGuidedEdit({}, { tool: "expand", params: { size: "1024x1024", padding: { left: 40, right: 40, top: 0, bottom: 0 }, prompt: "Expand" } },
    await solid("red"), null, undefined, () => generated);
  expect(result.images[0]).toEqual(generated);
  expect(result.edit.warning).toBe("PROVIDER_ASPECT_RATIO_DIFFERENT");
});
it("rejects corrupt bytes instead of declaring an image successful", async () => {
  await expect(runGuidedEdit({}, { tool: "expand", params: { size: "1024x1024", padding: 32, prompt: "Expand" } },
    await solid("red"), null, undefined, async () => Buffer.from("not an image"))).rejects.toThrow();
});

it("adapts cloud edits to a visual guide without adding a second conflicting mask guide", async () => {
  const generate = vi.fn(async (_config, args) => args.image);
  const result = await runGuidedEdit({ imageKind: "volcengine" }, { tool: "inpaint", params: { size: "1024x1024", prompt: "删除花盆" } },
    await solid("red"), await solid("white"), undefined, generate);
  const request = generate.mock.calls[0][1];
  expect(request.mask).toBeUndefined();
  expect(request.references).toHaveLength(0);
  expect(request.size).toBe("auto@2K");
  expect(request.prompt).toContain("不能用模糊");
  const selected = [...await sharp(request.image).raw().toBuffer()].slice(0, 3);
  expect(selected[0]).toBeLessThan(5); expect(selected[1]).toBeGreaterThan(250); expect(selected[2]).toBeLessThan(5);
  expect(result.edit.originalPrompt).toBe("删除花盆");
});

it("uses a legal output size for older official image models", () => {
  const resolved = editOutputSize({ imageModel: "gpt-image-1" }, "1:1@1K", { width: 1600, height: 900 });
  expect(resolved).toEqual({ choice: "1536x1024", dimensions: "1536x1024", error: null });
});

it("sends a native alpha mask and preserves pixels outside a feathered selection", async () => {
  const original = await solid("red", 24, 24);
  const mask = await sharp(await solid("black", 24, 24)).composite([{ input: await solid("white", 12, 12), left: 6, top: 6 }]).png().toBuffer();
  const generate = vi.fn(async () => solid("blue", 24, 24));
  const result = await runGuidedEdit({}, { imageEditStrategy: "native-mask", tool: "inpaint", params: { size: "1:1@1K", preserveOutside: true, feather: 6, prompt: "blue" } }, original, mask, undefined, generate);
  const sent = generate.mock.calls[0][1];
  const alpha = await sharp(sent.mask).ensureAlpha().raw().toBuffer();
  expect(alpha[3]).toBe(255);
  expect(alpha[(12 * 24 + 12) * 4 + 3]).toBeLessThan(5);
  const pixels = await sharp(result.images[0]).ensureAlpha().raw().toBuffer();
  expect([...pixels.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  expect(pixels[(12 * 24 + 12) * 4 + 2]).toBeGreaterThan(250);
  expect(result.edit).toMatchObject({ inputMode: "native-mask", maskSent: true, preserveOutside: true });
});

it("rejects a mismatched native response instead of stretching the subject", async () => {
  await expect(runGuidedEdit({}, { imageEditStrategy: "native-mask", tool: "inpaint", params: { size: "1:1@1K" } }, await solid("red"), await solid("white"), undefined, () => solid("blue", 80, 40))).rejects.toThrow("EDIT_GEOMETRY_MISMATCH");
});
