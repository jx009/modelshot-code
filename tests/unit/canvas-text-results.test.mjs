import { describe, it, expect } from "vitest";
import { appendResult } from "../../src/lib/studio/canvas-utils.js";
import { textLayerHeight } from "../../src/lib/studio/text-layer.js";
import { contentSchema, jobSchema } from "../../src/lib/studio/tools.js";
import { presentJob } from "../../src/lib/domain/studio/jobs.js";

const image = { id: "original", type: "image", assetId: "asset-1", name: "Original", x: 90, y: 100, width: 320, height: 240, visible: true, rotation: 0, opacity: 1 };
const content = layers => ({ schemaVersion: 1, layers, messages: [], jobs: [], appliedJobs: [] });

describe("canvas text results", () => {
  it.each(["describe", "template"])("keeps %s as editable text without mutating images and deduplicates replay", tool => {
    const job = { id: "prompt-job", tool, resultData: { text: "明亮的自然光，玻璃瓶与绿叶。\n".repeat(24) } };
    const layers = appendResult([image], job, image);
    expect(layers[0]).toBe(image);
    expect(layers[1]).toMatchObject({ type: "text", textKind: "prompt", text: job.resultData.text, sourceJobId: job.id, y: 100 });
    expect(layers[1].x).toBeGreaterThan(image.x + image.width);
    expect(layers[1].height).toBeGreaterThan(80);
    expect(contentSchema.parse(content(layers)).layers).toHaveLength(2);
    expect(appendResult(layers, job, image)).toBe(layers);
  });
  it("preserves a long result in the document instead of truncating it for the composer", () => {
    const text = "长段提示词".repeat(1500);
    const layers = appendResult([image], { id: "long-result", tool: "describe", resultData: { text } }, image);
    expect(contentSchema.parse(content(layers)).layers[1].text).toBe(text);
    expect(layers[1].height).toBeLessThanOrEqual(8192);
  });
  it("attaches an OCR entry to the original image and retains geometry, pixel data and other results", () => {
    const source = { ...image, sourceJobId: "generation-job", pixelWidth: 1024, pixelHeight: 768 };
    const job = { id: "ocr-job", tool: "ocr", resultData: { ocr: { boxes: [{ text: "识别结果", rect: null }] } } };
    const layers = appendResult([source], job, source);
    expect(layers).toEqual([{ ...source, ocrJobId: "ocr-job" }]);
    expect(contentSchema.parse(content(layers)).layers[0].ocrJobId).toBe("ocr-job");
    expect(appendResult(layers, job, layers[0])).toEqual(layers);
    expect(appendResult([], job, source)).toEqual([]);
  });
  it("allocates multiline height and handles Chinese wrapping", () => {
    expect(textLayerHeight("第一行\n第二行", 440, 24)).toBeGreaterThan(textLayerHeight("第一行", 440, 24));
    expect(textLayerHeight("全角文字".repeat(40), 200, 24)).toBeGreaterThan(textLayerHeight("全角文字".repeat(40), 440, 24));
  });
  it("returns the persisted origin while keeping pre-origin jobs backward compatible", () => {
    const row = { id: "job", status: "succeeded", snapshot: { tool: "generate", documentId: "doc", origin: "chat" } };
    expect(presentJob(row)).toMatchObject({ origin: "chat" });
    expect(presentJob({ ...row, snapshot: { ...row.snapshot, origin: "canvas" } })).toMatchObject({ origin: "canvas" });
    const data = { tool: "generate", documentId: "doc", documentVersion: 1, params: { prompt: "test" } };
    expect(jobSchema.parse(data).origin).toBeUndefined();
    expect(jobSchema.parse({ ...data, origin: "chat" }).origin).toBe("chat");
    expect(() => jobSchema.parse({ ...data, origin: "unknown" })).toThrow();
  });
});
