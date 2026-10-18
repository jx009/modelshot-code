import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import http from "node:http";
import { normalizeOcrResult, recognizeText } from "../../src/lib/domain/studio/ocr.js";
import { upscaleVolcImage } from "../../src/lib/domain/studio/upscale.js";
import { capabilities, resolveStudioConfig } from "../../src/lib/domain/studio/providers.js";
import { runImageTool } from "../../src/lib/domain/studio/execution.js";
import { upscaleInputError } from "../../src/lib/studio/upscale.js";
import { validChannel, supportsChannelCapability, toolRouting } from "../../src/lib/studio/model-channels.js";
import { encryptSecret } from "../../src/lib/crypto.js";
import { imageToolErrorMessage } from "../../src/lib/studio/image-tool-errors.js";

const png = (width = 80, height = 60) => sharp({ create: { width, height, channels: 3, background: "white" } }).png().toBuffer();
const upscale = { kind: "volc-visual", model: "lens_vida_nnsr", accessKeyId: "fixture-ak", secretAccessKey: "fixture-sk" };
let rows;
beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("STUDIO_TOOLS_URL", "");
  rows = [
    { name: "planner", kind: "volcengine", isPlanner: true, config: { studioCapability: "language", scope: "language", model: "planner-model", apiKeyEnc: encryptSecret("planner-secret") } },
    { name: "ocr", kind: "volcengine", config: { studioCapability: "ocr", scope: "tool", model: "ocr-model", apiKeyEnc: encryptSecret("ocr-secret") } },
    { name: "upscale", kind: "volc-visual", config: { studioCapability: "upscale", scope: "tool", model: "lens_vida_nnsr", accessKeyIdEnc: encryptSecret("fixture-ak"), secretAccessKeyEnc: encryptSecret("fixture-sk") } },
  ].map(row => ({ ...row, config: JSON.stringify(row.config) }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("dedicated OCR and Volcengine upscale", () => {
  it("explains upscale failures in both languages and preserves unknown errors", () => {
    expect(imageToolErrorMessage("INVALID_IMAGE_SIZE")).toContain("PNG");
    expect(imageToolErrorMessage("UPSCALE_INPUT_DIMENSIONS")).toContain("2128");
    expect(imageToolErrorMessage("UPSCALE_SIZE_MISMATCH", false)).toContain("2×");
    expect(imageToolErrorMessage("CUSTOM_PROVIDER_ERROR")).toBe("CUSTOM_PROVIDER_ERROR");
  });
  it.each(["volcengine", "openai"])("isolates %s OCR from planning and upscale from segmentation, without publishing secrets", async kind => {
    rows[1].kind = kind;
    expect(validChannel(kind, JSON.parse(rows[1].config))).toBe(true);
    expect(validChannel("volc-visual", JSON.parse(rows[2].config))).toBe(true);
    expect(supportsChannelCapability(rows[2], "segment")).toBe(false);
    expect(supportsChannelCapability(rows[2], "split")).toBe(false);
    expect(validChannel("volc-visual", { scope: "tool", studioCapability: "upscale", model: "entity_seg" })).toBe(false);
    const config = resolveStudioConfig(rows);
    expect(config.chatModel).toBe("planner-model");
    expect(config.ocrChannel).toMatchObject({ name: "ocr", apiKey: "ocr-secret", model: "ocr-model" });
    expect(config.segmentChannel).toBeNull();
    const settings = [{ toolId: "ocr", creditCost: 7 }, { toolId: "upscale", creditCost: 9 }];
    const db = { systemConfig: { findUnique: async () => null }, modelProvider: { findMany: async () => rows }, studioToolConfig: { findMany: async () => settings } };
    const caps = await capabilities(db);
    expect(caps.tools.find(t => t.id === "ocr")).toMatchObject({ available: true, cost: 7 });
    expect(caps.tools.find(t => t.id === "upscale")).toMatchObject({ available: true, cost: 9, supportedScales: [2] });
    expect(caps.imageModels).toEqual([]);
    expect(JSON.stringify(caps)).not.toMatch(/secret|fixture-ak|fixture-sk|ocr-model|lens_vida/);
    const missing = await capabilities({ ...db, modelProvider: { findMany: async () => [rows[0]] } });
    expect(missing.tools.find(t => t.id === "ocr").available).toBe(false);
  });

  it("pins a queued OCR channel despite a later tool binding, and rejects removed channels", () => {
    const settings = [{ toolId: "ocr", routing: { mode: "dedicated", channelName: "removed" } }];
    expect(() => resolveStudioConfig(rows, settings, undefined, "image", "ocr")).toThrow("PROVIDER_CAPABILITY_UNSUPPORTED");
    expect(resolveStudioConfig(rows, settings, "ocr", "ocr", null, { pinned: true }).ocrChannel.model).toBe("ocr-model");
    expect(() => resolveStudioConfig([rows[0]], [], "ocr", "ocr", null, { pinned: true })).toThrow("PROVIDER_CAPABILITY_UNSUPPORTED");
    expect(toolRouting({ dependency: "ocr" }, { routing: { mode: "service" } }).mode).toBe("dedicated");
  });

  it.each(["volcengine", "openai"])("sends images and JSON OCR requests through %s with only the dedicated model credentials", async kind => {
    rows[1].kind = kind;
    let request;
    const server = http.createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      request = { url: req.url, authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) };
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ boxes: [{ text: "TEST 123", bbox: [100, 200, 900, 500] }] }) } }] }));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const config = resolveStudioConfig(rows);
      config.ocrChannel.baseURL = `http://127.0.0.1:${server.address().port}/api/v3`;
      const service = vi.fn();
      const result = await runImageTool(config, { tool: "ocr", params: {} }, await png(), null, undefined, { service });
      expect(result.ocr.boxes[0]).toEqual({ text: "TEST 123", rect: { left: 8, top: 12, width: 64, height: 18 } });
      expect(request.url).toBe("/api/v3/chat/completions");
      expect(request.authorization).toBe("Bearer ocr-secret");
      expect(request.body).toMatchObject({ model: "ocr-model", response_format: { type: "json_object" } });
      expect(request.body.messages.at(-1).content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
      expect(service).not.toHaveBeenCalled();
    } finally { await new Promise(resolve => server.close(resolve)); }
  });

  it("preserves text without a usable box, handles no text and rejects malformed output", () => {
    const data = normalizeOcrResult(JSON.stringify({ boxes: [{ text: "正常", bbox: [0, 0, 1000, 1000] }, { text: "无坐标", bbox: [-1, 0, 500, 400] }, { text: "倒置", bbox: [900, 200, 100, 100] }] }), 81, 63);
    expect(data.boxes[0].rect).toEqual({ left: 0, top: 0, width: 81, height: 63 });
    expect(data.boxes[1].rect).toBeNull(); expect(data.boxes[2].rect).toBeNull();
    expect(data.text).toBe("正常\n无坐标\n倒置");
    expect(normalizeOcrResult('```json\n{"boxes":[]}\n```', 80, 60).boxes).toEqual([]);
    for (const raw of ['{"boxes":', '{"text":"guess"}', '{"boxes":[{"text":42}]}']) expect(() => normalizeOcrResult(raw, 80, 60)).toThrow("INVALID_OCR_RESULT");
  });

  it("requires dedicated credentials instead of falling back to image or planning keys", async () => {
    await expect(recognizeText(null, await png())).rejects.toThrow("OCR_NOT_CONFIGURED");
    await expect(upscaleVolcImage({ ...upscale, secretAccessKey: "" }, await png())).rejects.toThrow("UPSCALE_NOT_CONFIGURED");
  });

  it.each([["openai", "https://api.openai.com/v1"], ["volcengine", "https://ark.cn-beijing.volces.com/api/v3"]])("uses the correct default OCR endpoint for %s", async (kind, baseURL) => {
    const invoke = vi.fn().mockResolvedValue('{"boxes":[]}');
    await recognizeText({ kind, apiKey: "dedicated-key", model: "vision-model" }, await png(), undefined, invoke);
    expect(invoke.mock.calls[0][0]).toMatchObject({ visionBaseURL: baseURL, visionApiKey: "dedicated-key" });
  });

  it("signs CVProcess, sends the original image, verifies exact 2x output and bypasses local tools", async () => {
    const output = await png(160, 120), source = await png();
    const fetch = vi.fn().mockResolvedValue(Response.json({ code: 10000, data: { algorithm_base_resp: { status_code: 0 }, binary_data_base64: [output.toString("base64")] } }));
    vi.stubGlobal("fetch", fetch);
    const service = vi.fn();
    const result = await runImageTool({ upscaleChannel: upscale }, { tool: "upscale", params: { scale: 2 } }, source, null, undefined, { service });
    expect(result.images[0]).toEqual(output);
    const [url, init] = fetch.mock.calls[0];
    expect(url.searchParams.get("Action")).toBe("CVProcess");
    expect(JSON.parse(init.body)).toEqual({ req_key: "lens_vida_nnsr", binary_data_base64: [source.toString("base64")], return_url: false });
    expect(init.headers.Authorization).toContain("Credential=fixture-ak/");
    expect(init.headers.Authorization).not.toContain("fixture-sk");
    expect(service).not.toHaveBeenCalled();
  });

  it("rejects unsupported scales and oversized inputs before any paid request", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(upscaleVolcImage(upscale, await png(), { scale: 4 })).rejects.toThrow("UPSCALE_SCALE_UNSUPPORTED");
    await expect(upscaleVolcImage(upscale, await png(2200, 100))).rejects.toThrow("UPSCALE_INPUT_DIMENSIONS");
    expect(upscaleInputError({ width: 100, height: 100, bytes: 6 * 1024 * 1024 }, 2)).toBe("UPSCALE_INPUT_TOO_LARGE");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["size", "empty", "rejected"])("does not accept an invalid upscale result: %s", async mode => {
    const data = mode === "size" ? { binary_data_base64: [(await png()).toString("base64")] } : {};
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: mode === "rejected" ? 50000 : 10000, data: { algorithm_base_resp: { status_code: 0 }, ...data } })));
    await expect(upscaleVolcImage(upscale, await png())).rejects.toThrow(mode === "size" ? "UPSCALE_SIZE_MISMATCH" : mode === "empty" ? "INVALID_UPSCALE_RESULT" : "PROVIDER_REJECTED");
  });
});
