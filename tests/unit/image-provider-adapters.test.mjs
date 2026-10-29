import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { generateImage, capabilities, resolveStudioConfig } from "../../src/lib/domain/studio/providers.js";
import { encryptSecret } from "../../src/lib/crypto.js";
import { CHANNEL_PRESETS, channelCapability, channelScope, supportsImageTask, validChannel } from "../../src/lib/studio/model-channels.js";
import { imageSizeError } from "../../src/lib/studio/image-size.js";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), download: vi.fn() }));
vi.mock("../../src/lib/infra/storage/download.js", () => ({ downloadProviderImage: mocks.download }));
const bytes = Buffer.from("image-fixture");
const encoded = bytes.toString("base64");
const config = { imageKind: "minimax", imageMode: "generate", imageModel: "image-01", apiKey: "fixture-key" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const success = () => json({ base_resp: { status_code: 0 }, data: { image_base64: [encoded] } });
beforeEach(() => { vi.stubGlobal("fetch", mocks.fetch); mocks.fetch.mockReset(); mocks.download.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([
  [undefined, "https://api.minimax.cn/v1/image_generation"],
  ["https://gateway.example", "https://gateway.example/v1/image_generation"],
  ["https://gateway.example/proxy/v1/", "https://gateway.example/proxy/v1/image_generation"],
  ["https://gateway.example/proxy/v1/image_generation", "https://gateway.example/proxy/v1/image_generation"],
])("uses the native MiniMax endpoint for %s", async (baseURL, endpoint) => {
  mocks.fetch.mockResolvedValue(success());
  const signal = new AbortController().signal;
  expect(await generateImage({ ...config, baseURL }, { prompt: "A product photo", size: "1024x1536", signal })).toEqual(bytes);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  const [url, request] = mocks.fetch.mock.calls[0];
  expect(url).toBe(endpoint);
  expect(request).toMatchObject({ method: "POST", redirect: "error", signal, headers: { Authorization: "Bearer fixture-key" } });
  expect(JSON.parse(request.body)).toEqual({ model: "image-01", prompt: "A product photo", width: 1024, height: 1536, response_format: "base64", n: 1, prompt_optimizer: false, aigc_watermark: false });
});

it("downloads URL results through the existing safe image downloader", async () => {
  mocks.fetch.mockResolvedValue(json({ base_resp: { status_code: 0 }, data: { image_urls: ["https://cdn.example/result.png"] } }));
  mocks.download.mockResolvedValue(bytes);
  expect(await generateImage(config, { prompt: "A scene" })).toEqual(bytes);
  expect(mocks.download).toHaveBeenCalledExactlyOnceWith("https://cdn.example/result.png");
});

it.each([1002, 1004, 1008, 1026, 2013, 2049])("rejects MiniMax business error %s even on HTTP 200", async status_code => {
  mocks.fetch.mockResolvedValue(json({ base_resp: { status_code, status_msg: "private upstream detail" }, data: { image_base64: [encoded] } }));
  await expect(generateImage(config, { prompt: "A scene" })).rejects.toThrow("PROVIDER_REJECTED");
  expect(mocks.download).not.toHaveBeenCalled();
});

it("rejects missing status, empty results and HTTP errors", async () => {
  mocks.fetch.mockResolvedValueOnce(json({ data: { image_base64: [encoded] } }));
  await expect(generateImage(config, { prompt: "A scene" })).rejects.toThrow("PROVIDER_REJECTED");
  mocks.fetch.mockResolvedValueOnce(json({ base_resp: { status_code: 0 }, data: {} }));
  await expect(generateImage(config, { prompt: "A scene" })).rejects.toThrow("EMPTY_PROVIDER_RESULT");
  mocks.fetch.mockResolvedValueOnce(json({}, 401));
  await expect(generateImage(config, { prompt: "A scene" })).rejects.toMatchObject({ code: "PROVIDER_REJECTED", status: 401 });
});

it("rejects unsupported inputs and dimensions before calling MiniMax", async () => {
  for (const prompt of ["", " ", "字".repeat(1501)]) {
    await expect(generateImage(config, { prompt })).rejects.toThrow("IMAGE_PROMPT_INVALID");
  }
  for (const input of [{ image: bytes }, { references: [bytes] }, { mask: bytes }]) {
    await expect(generateImage({ ...config, imageMode: "both" }, { prompt: "A scene", ...input })).rejects.toThrow("PROVIDER_CAPABILITY_UNSUPPORTED");
  }
  for (const size of ["1:1@4K", "16:9@2K", "8:1@1K"]) {
    expect(imageSizeError(config, size)).toBe("IMAGE_SIZE_UNSUPPORTED");
    await expect(generateImage(config, { prompt: "A scene", size })).rejects.toThrow("IMAGE_SIZE_UNSUPPORTED");
  }
  expect(imageSizeError(config, "1:1@2K")).toBeNull();
  expect(imageSizeError(config, "16:9@1K")).toBeNull();
  await expect(generateImage({ ...config, imageModel: "image-01-live" }, { prompt: "A scene" })).rejects.toThrow("PROVIDER_CAPABILITY_UNSUPPORTED");
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("keeps native Ali and Volcengine text-to-image requests available", async () => {
  mocks.fetch.mockResolvedValueOnce(json({ output: { choices: [{ message: { content: [{ image: `data:image/png;base64,${encoded}` }] } }] } }));
  expect(await generateImage({ imageKind: "dashscope", imageModel: "qwen-image-2.0-pro", apiKey: "ali-key" }, { prompt: "A scene", size: "1024x1024" })).toEqual(bytes);
  const [aliURL, aliRequest] = mocks.fetch.mock.calls[0];
  expect(aliURL).toBe("https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation");
  expect(JSON.parse(aliRequest.body)).toMatchObject({ model: "qwen-image-2.0-pro", input: { messages: [{ role: "user", content: [{ text: "A scene" }] }] }, parameters: { n: 1, size: "1024*1024" } });
  mocks.fetch.mockResolvedValueOnce(json({ data: [{ b64_json: encoded }] }));
  expect(await generateImage({ imageKind: "volcengine", imageModel: "ep-seedream", apiKey: "ark-key" }, { prompt: "A scene", size: "1:1@2K" })).toEqual(bytes);
  const [arkURL, arkRequest] = mocks.fetch.mock.calls[1];
  expect(arkURL).toBe("https://ark.cn-beijing.volces.com/api/v3/images/generations");
  expect(JSON.parse(arkRequest.body)).toEqual({ model: "ep-seedream", prompt: "A scene", size: "2048x2048", response_format: "b64_json", watermark: false });
});

it("validates MiniMax as a public generation-only channel", () => {
  const preset = CHANNEL_PRESETS.find(item => item.kind === "minimax");
  expect(validChannel("minimax", preset)).toBe(true);
  expect(channelCapability({ kind: "minimax" }, preset)).toBe("image");
  expect(channelScope({ kind: "minimax" }, preset)).toBe("public");
  expect(supportsImageTask({ ...preset, imageMode: "both" }, "edit")).toBe(false);
  for (const change of [{ imageMode: "both" }, { scope: "tool" }, { studioCapability: "video" }, { studioCapability: "language" }, { model: "image-01-live" }]) {
    expect(validChannel("minimax", { ...preset, ...change })).toBe(false);
  }
});

it("exposes all three configured providers with generation-only MiniMax capabilities", async () => {
  vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
  const rows = ["dashscope", "volcengine", "minimax"].map(kind => {
    const preset = CHANNEL_PRESETS.find(item => item.kind === kind && item.studioCapability === "image" && item.imageMode !== "edit");
    return { name: kind, kind, displayName: preset.label, creditCost: 18, config: JSON.stringify({ ...preset, scope: "public", model: preset.model || "ep-seedream", apiKeyEnc: encryptSecret(`${kind}-secret`) }) };
  });
  const db = { systemConfig: { findUnique: async () => null }, modelProvider: { findMany: async () => rows }, studioToolConfig: { findMany: async () => [] } };
  const selected = resolveStudioConfig(rows, [], "minimax", "image", "generate", { imageOnly: true });
  expect(selected).toMatchObject({ imageKind: "minimax", imageMode: "generate", imageModel: "image-01", apiKey: "minimax-secret" });
  const result = await capabilities(db, selected, undefined, { imageOnly: true });
  expect(result.imageModels.map(model => model.id)).toEqual(["dashscope", "volcengine", "minimax"]);
  expect(result.imageModels.find(model => model.id === "minimax")).toMatchObject({ maxReferenceImages: 0, prices: { "1024x1024": 18, "1024x1536": 18, "1536x1024": 18 } });
  expect(result.tools.find(tool => tool.id === "generate").available).toBe(true);
  expect(result.tools.find(tool => tool.id === "edit").available).toBe(false);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
