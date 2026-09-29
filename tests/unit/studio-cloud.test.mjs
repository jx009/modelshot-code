import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import sharp from "sharp";
import { generateCloudImage, falRequest, segmentCloudImage, splitCloudImage } from "../../src/lib/domain/studio/cloud.js";
import { studioConfig, capabilities } from "../../src/lib/domain/studio/providers.js";
import { encryptSecret } from "../../src/lib/crypto.js";
import { allowedProviderBaseURL, channelCapability, channelScope, validChannel } from "../../src/lib/studio/model-channels.js";
import { extractObject, selectionPrompt } from "../../src/lib/domain/studio/segmentation.js";
import { beginObjectMove, appendResult } from "../../src/lib/studio/canvas-utils.js";
import { runImageTool } from "../../src/lib/domain/studio/execution.js";

let server, base, png, mask, shadow, foreground;
const calls = [];
const url = bytes => `data:image/png;base64,${bytes.toString("base64")}`;
beforeAll(async () => {
  png = await sharp({ create: { width: 20, height: 12, channels: 4, background: "red" } }).png().toBuffer();
  const pixels = Buffer.alloc(20 * 12); pixels.fill(128, 65, 70); pixels.fill(255, 85, 90);
  mask = await sharp(pixels, { raw: { width: 20, height: 12, channels: 1 } }).png().toBuffer();
  const shadowPixels = Buffer.alloc(20 * 12); shadowPixels.fill(255, 86, 88);
  shadow = await sharp(shadowPixels, { raw: { width: 20, height: 12, channels: 1 } }).png().toBuffer();
  foreground = (await extractObject(png, mask)).cutout;
  server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    calls.push({ method: req.method, path: req.url, auth: req.headers.authorization, body });
    res.setHeader("Content-Type", "application/json");
    if (req.url.includes("/queue/") && req.method === "POST") return res.end(JSON.stringify({ request_id: "remote-123" }));
    if (req.url.endsWith("/status")) return res.end(JSON.stringify({ status: "COMPLETED" }));
    if (req.url.includes("qwen-image-layered")) return res.end(JSON.stringify({ images: [{ url: url(png) }, { url: url(foreground) }] }));
    if (req.url.includes("sam-3")) return res.end(JSON.stringify({ masks: body.point_prompts?.[0]?.x === 7 ? [{ url: url(shadow) }] : [{ url: url(shadow) }, { url: url(mask) }] }));
    if (req.url.includes("multimodal-generation")) return res.end(JSON.stringify({ output: { choices: [{ message: { content: [{ image: url(png) }] } }] } }));
    res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => new Promise(resolve => server.close(resolve)));
afterEach(() => vi.unstubAllEnvs());

describe("cloud protocol contracts", () => {
  it("uses native DashScope multimodal input with explicit region guidance", async () => {
    const providerMask = await sharp({ create: { width: 20, height: 12, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
    expect(await generateCloudImage({ imageKind: "dashscope", apiKey: "ali-key", baseURL: base, imageModel: "qwen-image-edit-max" }, { image: png, mask: providerMask, references: [foreground], prompt: "Raise paw", size: "1024x1536" })).toEqual(png);
    const call = calls.at(-1);
    expect(call.path).toBe("/api/v1/services/aigc/multimodal-generation/generation");
    expect(call.auth).toBe("Bearer ali-key");
    expect(call.body.parameters).toMatchObject({ n: 1, size: "1024*1536", watermark: false });
    const content = call.body.input.messages[0].content;
    expect(content).toHaveLength(4); expect(content[0].image).toBe(url(png));
    expect(content[3].text).toContain("REGION GUIDE ONLY");
  });
  it("uses Ark image JSON and the exact configured model or endpoint ID", async () => {
    expect(await generateCloudImage({ imageKind: "volcengine", apiKey: "ark-key", baseURL: `${base}/api/v3`, imageModel: "ep-test-edit" }, { image: png, references: [foreground], prompt: "Edit", size: "1536x1024" })).toEqual(png);
    const call = calls.at(-1);
    expect(call.path).toBe("/api/v3/images/generations"); expect(call.auth).toBe("Bearer ark-key");
    expect(call.body).toMatchObject({ model: "ep-test-edit", image: [url(png), url(foreground)], response_format: "b64_json", watermark: false });
    const [w, h] = call.body.size.split("x").map(Number);
    expect(w * h).toBeGreaterThanOrEqual(3686400); expect(w / h).toBeCloseTo(1.5, 1);
  });
  it("passes SAM box/point prompts and overrides the upstream wheel default", async () => {
    const bytes = await segmentCloudImage({ kind: "fal", apiKey: "fal-key", baseURL: base, model: "fal-ai/sam-3/image" }, png, { box: { left: 3, top: 2, width: 7, height: 5 }, points: [{ x: 6, y: 4, label: 1 }] });
    const call = calls.at(-1);
    expect(call.auth).toBe("Key fal-key");
    expect(call.body).toMatchObject({ prompt: "", apply_mask: false, return_multiple_masks: true, max_masks: 3, box_prompts: [{ x_min: 3, y_min: 2, x_max: 10, y_max: 7, object_id: 1 }], point_prompts: [{ x: 6, y: 4, label: 1, object_id: 1 }] });
    expect((await sharp(bytes).metadata()).width).toBe(20);
    expect((await sharp(bytes).greyscale().raw().toBuffer())[65]).toBe(128);
  });
  it("rejects a shadow-only segmentation instead of creating a movable layer", async () => {
    await expect(segmentCloudImage({ kind: "fal", apiKey: "fal-key", baseURL: base, model: "fal-ai/sam-3/image" }, png,
      { box: { left: 3, top: 2, width: 7, height: 5 }, points: [{ x: 7, y: 4, label: 1 }] })).rejects.toThrow("SEGMENTATION_FAILED");
  });
  it("persists the fal request ID before polling and resumes without a second POST", async () => {
    const channel = { kind: "fal", apiKey: "fal-key", baseURL: base, model: "fal-ai/qwen-image-layered" };
    const start = calls.length; let stored;
    await falRequest(channel, { image_url: url(png) }, { onSubmitted: async id => {
      stored = id; expect(calls.slice(start).some(call => call.path.endsWith("/status"))).toBe(false);
    } });
    await falRequest(channel, {}, { requestId: stored });
    expect(calls.slice(start).filter(call => call.method === "POST")).toHaveLength(1);
    expect(calls.at(-1).path).toBe("/queue/fal-ai/qwen-image-layered/requests/remote-123");
    const result = await splitCloudImage(channel, png, { numLayers: 2 });
    expect(result).toHaveLength(2); expect((await sharp(result[1]).metadata()).hasAlpha).toBe(true);
  });
});

describe("capability-specific configuration", () => {
  it("isolates credentials, defaults, task modes and explicit invalid selections", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32)); vi.stubEnv("STUDIO_API_KEY", "wrong-legacy-key"); vi.stubEnv("STUDIO_BASE_URL", "https://legacy.test");
    const rows = [
      { name: "ali-edit", kind: "dashscope", displayName: "Ali", creditCost: 8, config: JSON.stringify({ apiKeyEnc: encryptSecret("ali-secret"), model: "qwen-image-edit-max", imageMode: "edit", studioDefault: true }) },
      { name: "ark", kind: "volcengine", displayName: "Ark", creditCost: 9, config: JSON.stringify({ apiKeyEnc: encryptSecret("ark-secret"), model: "ep-fixture", imageMode: "both" }) },
      { name: "layers", kind: "fal", displayName: "Layers", creditCost: 25, config: JSON.stringify({ apiKeyEnc: encryptSecret("fal-secret"), model: "fal-ai/qwen-image-layered", studioCapability: "split", studioDefault: true }) },
    ];
    const db = { modelProvider: { findMany: async () => rows }, studioToolConfig: { findMany: async () => [] } };
    const ali = await studioConfig(db);
    expect(ali).toMatchObject({ imageProvider: "ark", apiKey: "ark-secret", imageKind: "volcengine", baseURL: undefined });
    await expect(studioConfig(db, "ali-edit")).rejects.toThrow("PROVIDER_CAPABILITY_UNSUPPORTED");
    expect((await studioConfig(db, "ark")).apiKey).toBe("ark-secret");
    expect((await studioConfig(db, "layers", "split")).splitChannel.apiKey).toBe("fal-secret");
    await expect(studioConfig(db, "missing")).rejects.toThrow("PROVIDER_CAPABILITY_UNSUPPORTED");
    await expect(studioConfig(db, "layers")).rejects.toThrow("PROVIDER_CAPABILITY_UNSUPPORTED");
    const caps = await capabilities(db, ali);
    expect(caps.tools.find(t => t.id === "generate").available).toBe(true);
    expect(caps.imageModels.map(m => m.id)).toEqual(["ark"]);
    expect(caps.segmentModels).toBeUndefined();
    expect(caps.splitModels).toBeUndefined();
    expect(caps.tools.find(t => t.id === "edit").available).toBe(true);
    expect(caps.tools.find(t => t.id === "split")).toMatchObject({ available: true, cost: 20 });
    expect(JSON.stringify(caps)).not.toMatch(/secret|apiKey|apiKeyEnc|legacy/);
  });
  it("admits official origins but rejects arbitrary hosts and mismatched capabilities", () => {
    expect(allowedProviderBaseURL("https://dashscope.aliyuncs.com")).toBe(true);
    expect(allowedProviderBaseURL("https://ark.cn-beijing.volces.com/api/v3")).toBe(true);
    expect(allowedProviderBaseURL("https://api.callyouai.com/codex")).toBe(true);
    expect(allowedProviderBaseURL("https://custom-gateway.example:8443/v1")).toBe(true);
    for (const value of ["http://127.0.0.1", "https://key@fal.run", "https://fal.run?secret=1", "https://fal.run#secret"]) expect(allowedProviderBaseURL(value)).toBe(false);
    expect(validChannel("volcengine", { studioCapability: "split" })).toBe(false);
    expect(validChannel("fal", { studioCapability: "segment", model: "fal-ai/../bad" })).toBe(false);
  });
  it("keeps legacy fal channels discoverable by their model id", () => {
    const sam = { kind: "fal", config: JSON.stringify({ model: "fal-ai/sam-3/image" }) };
    const layered = { kind: "fal", config: JSON.stringify({ model: "fal-ai/qwen-image-layered" }) };
    expect(channelCapability(sam)).toBe("segment");
    expect(channelScope(sam)).toBe("tool");
    expect(validChannel("fal", { model: "fal-ai/sam-3/image" })).toBe(true);
    expect(channelCapability(layered)).toBe("split");
    expect(validChannel("fal", { model: "fal-ai/qwen-image-layered" })).toBe(true);
  });
});

describe("editable layers and late background repair", () => {
  const target = { id: "source", assetId: "source-asset", name: "Cat", type: "image", x: 10, y: 20, width: 200, height: 120, pixelWidth: 20, pixelHeight: 12, rotation: 90, visible: true, opacity: 1 };
  const bundle = { objectAssetId: "cat", holeAssetId: "hole", bounds: { left: 5, top: 3, width: 5, height: 2 } };
  it("preserves soft alpha and extracts a tight object instead of a rectangle", async () => {
    const result = await extractObject(png, mask);
    expect(result.bounds).toEqual(bundle.bounds);
    const rgba = await sharp(result.cutout).raw().toBuffer(), hole = await sharp(result.hole).raw().toBuffer();
    expect(rgba[65 * 4 + 3]).toBe(128); expect(hole[65 * 4 + 3]).toBe(127);
    expect(rgba[3]).toBe(0); expect(hole[3]).toBe(255);
    expect(await selectionPrompt(mask, 20, 12, { x: 2, y: 3 })).toEqual({ points: [{ x: 2, y: 3, label: 1 }] });
    expect(await selectionPrompt(mask, 20, 12)).toEqual({ box: bundle.bounds, points: [{ x: 7, y: 4, label: 1 }] });
    const lassoPixels = Buffer.alloc(20 * 12);
    for (let y = 1; y <= 5; y++) lassoPixels[y * 20 + 1] = 255;
    for (let x = 1; x <= 5; x++) lassoPixels[20 + x] = 255;
    const lasso = await sharp(lassoPixels, { raw: { width: 20, height: 12, channels: 1 } }).png().toBuffer();
    const prompt = await selectionPrompt(lasso, 20, 12);
    expect(prompt.box).toEqual({ left: 1, top: 1, width: 5, height: 5 });
    expect(lassoPixels[prompt.points[0].y * 20 + prompt.points[0].x]).toBe(255);
  });
  it("keeps a moved object independent, rotates offsets and only replaces its pending background", () => {
    const pending = { id: "job", moveBundle: bundle };
    const layers = beginObjectMove([target], target, pending, bundle, { dx: 2, dy: 1 });
    expect(layers[0].visible).toBe(false);
    expect(layers[2]).toMatchObject({ assetId: "cat", width: 50, height: 20, rotation: 90, layerRole: "object" });
    expect(layers[2].x).toBeCloseTo(-30); expect(layers[2].y).toBeCloseTo(90);
    const moved = layers.map(l => l.id === "job-object" ? { ...l, x: 900, y: 100 } : l);
    const job = { ...pending, resultData: { placement: "repair-background", assets: [{ id: "repaired" }] } };
    const completed = appendResult(moved, job);
    expect(completed[1].assetId).toBe("repaired"); expect(completed[2]).toBe(moved[2]);
    expect(appendResult([target], job)).toEqual([target]);
    expect(appendResult(completed, job)).toEqual(completed);
  });
  it("stacks decomposition in source order and leaves deleted or replaced input alone", () => {
    const job = { id: "split", assetId: target.assetId, resultData: { placement: "stack", assets: [{ id: "bg", width: 1024, height: 768 }, { id: "fg", width: 1024, height: 768 }] } };
    const layers = appendResult([target], job, target);
    expect(layers).toHaveLength(3); expect(layers[0]).toBe(target);
    for (const l of layers.slice(1)) expect(l).toMatchObject({ x: 260, y: 20, width: 200, height: 120, rotation: 90, groupId: "split" });
    expect(layers.map(l => l.assetId)).toEqual(["source-asset", "bg", "fg"]);
    expect(appendResult(layers, job, target)).toBe(layers);
    expect(appendResult([], job)).toEqual([]);
    const changed = { ...target, assetId: "changed" };
    expect(appendResult([changed], job, changed)).toEqual([changed]);
  });
  it("returns a complete moved image even when the client supplied extracted assets", async () => {
    const result = await runImageTool({}, { tool: "move", moveBundle: bundle, params: { dx: 4, dy: 0 } }, png, mask, undefined, { generate: async (_config, args) => { const [width, height] = args.size.split("x").map(Number); return sharp({ create: { width, height, channels: 4, background: "blue" } }).png().toBuffer(); } });
    expect(result.placement).toBe("replace-source");
    const rgba = await sharp(result.images[0]).raw().toBuffer();
    expect([...rgba.slice(85 * 4, 85 * 4 + 3)]).toEqual([0, 0, 255]);
    expect([...rgba.slice(89 * 4, 89 * 4 + 3)]).toEqual([255, 0, 0]);
  });
  it("keeps concurrent full-image results without overwriting a newer edit", () => {
    const job = { id: "first", assetId: target.assetId, tool: "move", resultData: { placement: "replace-source", assets: [{ id: "first-image", width: 20, height: 12 }] } };
    const first = appendResult([target], job, target);
    const secondJob = { ...job, id: "second", resultData: { ...job.resultData, assets: [{ id: "second-image", width: 20, height: 12 }] } };
    const second = appendResult(first, secondJob, first[0]);
    expect(second).toHaveLength(3);
    expect(second[0]).toBe(target);
    expect(second.every(layer => layer.visible)).toBe(true);
    expect(first[1].x).toBeGreaterThan(target.x + target.width);
    expect(second[0]).toBe(target);
    expect(second.every(layer => layer.visible)).toBe(true);
    expect(first[1].x).toBeGreaterThan(target.x + target.width);
    expect(second[1]).toBe(first[1]);
    expect(second[2]).toMatchObject({ assetId: "second-image", visible: true, sourceJobId: "second" });
    expect(second[2].x).toBeGreaterThan(first[1].x + first[1].width);
    expect(appendResult(second, secondJob, second[0])).toBe(second);
  });
});
