import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { alphaMask, compositeSelection, cropImage, expandInput, moveSelection } from "../../src/lib/domain/studio/pixels.js";
import { runImageTool } from "../../src/lib/domain/studio/execution.js";
import { jobSchema, planSchema, contentSchema, validatePlan } from "../../src/lib/studio/tools.js";
import { appendResult } from "../../src/lib/studio/canvas-utils.js";
import { byteRange } from "../../src/lib/domain/assets/range.js";

const solid = (color, width = 8, height = 6) => sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
async function selection() {
  return sharp(await solid("black")).composite([{ input: await solid("white", 2, 2), left: 2, top: 1 }]).png().toBuffer();
}
describe("studio pixel contracts", () => {
  it("sends transparent alpha for selected pixels and preserves unmasked RGBA exactly", async () => {
    const source = await solid("red"), mask = await selection(), result = await solid("blue");
    const provider = await sharp(await alphaMask(mask, 8, 6)).raw().toBuffer();
    expect(provider[(1 * 8 + 2) * 4 + 3]).toBe(0);
    expect(provider[3]).toBe(255);
    const output = await sharp(await compositeSelection(source, result, mask)).raw().toBuffer();
    expect([...output.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...output.slice((1 * 8 + 2) * 4, (1 * 8 + 2) * 4 + 4)]).toEqual([0, 0, 255, 255]);
  });
  it("passes an actual mask to image editing, not just a text instruction", async () => {
    let called;
    const result = await runImageTool({}, { tool: "inpaint", params: { prompt: "blue", size: "1024x1024" } }, await solid("red"), await selection(), undefined, { generate: async (_config, args) => { called = args; return solid("blue"); } });
    expect(Buffer.isBuffer(called.mask)).toBe(true);
    expect((await sharp(result.images[0]).metadata()).width).toBe(8);
    expect([...await sharp(result.images[0]).raw().toBuffer()].slice(0, 4)).toEqual([255, 0, 0, 255]);
  });
  it("rejects empty and wrong-size masks before contacting a supplier", async () => {
    await expect(alphaMask(await solid("black"), 8, 6)).rejects.toThrow("EMPTY_MASK");
    await expect(alphaMask(await solid("white"), 7, 6)).rejects.toThrow("MASK_SIZE_MISMATCH");
  });
  it("crops exact pixel dimensions and rejects out-of-bounds requests", async () => {
    const source = await solid("red");
    expect(await sharp(await cropImage(source, { left: 1, top: 1, width: 3, height: 2 })).metadata()).toMatchObject({ width: 3, height: 2 });
    await expect(cropImage(source, { left: 7, top: 0, width: 2, height: 2 })).rejects.toThrow("CROP_OUT_OF_BOUNDS");
  });
  it("expands canvas with only its new border selected", async () => {
    const expanded = await expandInput(await solid("red"), 2);
    expect(await sharp(expanded.image).metadata()).toMatchObject({ width: 12, height: 10 });
    const raw = await sharp(expanded.mask).greyscale().raw().toBuffer();
    expect(raw[0]).toBe(255); expect(raw[2 * 12 + 2]).toBe(0);
  });
  it("moves masked foreground after background repair and rejects fake super resolution", async () => {
    const image = await moveSelection(await solid("red"), await solid("blue"), await selection(), 3, 2);
    const raw = await sharp(image).raw().toBuffer();
    expect([...raw.slice((3 * 8 + 5) * 4, (3 * 8 + 5) * 4 + 4)]).toEqual([255, 0, 0, 255]);
    await expect(runImageTool({}, { tool: "upscale", params: { scale: 2 } }, await solid("red"), null, undefined, { service: () => solid("blue") })).rejects.toThrow("UPSCALE_SIZE_MISMATCH");
  });
});
describe("studio validation and late results", () => {
  it("validates plan dataflow before confirmation and permits generate-then-edit", () => {
    const step = tool => ({ tool, explanation: "test", params: { prompt: "new scene" } });
    expect(validatePlan({ summary: "test", steps: [step("generate"), step("edit")] }, ["generate", "edit"], false).credits).toBe(36);
    expect(() => validatePlan({ summary: "test", steps: [step("edit")] }, ["edit"], false)).toThrow("INVALID_AGENT_PLAN");
    expect(() => validatePlan({ summary: "test", steps: [step("describe"), step("edit")] }, ["describe", "edit"], true)).toThrow("INVALID_AGENT_PLAN");
    expect(() => validatePlan({ summary: "test", steps: [step("video")] }, ["edit"], true)).toThrow("INVALID_AGENT_PLAN");
  });
  it("supports video byte ranges and rejects malformed/multiple/empty ranges", () => {
    expect(byteRange("bytes=10-20", 100)).toEqual({ start: 10, end: 20 });
    expect(byteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange("bytes=-8", 100)).toEqual({ start: 92, end: 99 });
    for (const range of ["bytes=0-1,4-5", "bytes=-0", "bytes=100-", "bytes=50-20", "bytes=-", "bytes=a-b"]) expect(() => byteRange(range, 100)).toThrow("INVALID_RANGE");
  });
  it("rejects arbitrary tools, missing masks, giant documents and shell plans", () => {
    expect(jobSchema.safeParse({ tool: "inpaint", documentId: "doc", documentVersion: 1, assetId: "asset", params: { prompt: "edit" } }).success).toBe(false);
    expect(planSchema.safeParse({ summary: "test", steps: [{ tool: "execute", params: {}, explanation: "shell" }] }).success).toBe(false);
    expect(contentSchema.safeParse({ schemaVersion: 1, layers: [], messages: [], jobs: [], arbitrary: "value" }).success).toBe(false);
  });
  it("late results append once and never replace the currently edited input", () => {
    const original = { id: "input", x: 12, y: 10, width: 100, height: 100, assetId: "newer-version" };
    const job = { id: "job", tool: "inpaint", resultData: { assets: [{ id: "result", width: 800, height: 400, contentType: "image/png" }] } };
    const layers = appendResult([original], job, original);
    expect(layers[0]).toEqual(original); expect(layers[1].id).toBe("job-0");
    expect(appendResult(layers, job, original)).toHaveLength(2);
  });
});
