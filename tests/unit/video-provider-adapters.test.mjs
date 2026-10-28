import { afterEach, beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { videoRequest, downloadVideoContent } from "../../src/lib/domain/studio/video-providers.js";
import { videoModelOptions, videoInputError } from "../../src/lib/video/model-protocols.js";
import { videoModelChange, videoModelOffer } from "../../src/lib/video/model-choice.js";
import { validChannel } from "../../src/lib/studio/model-channels.js";
import { availableProviders } from "../../src/lib/domain/generation/providers.js";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), download: vi.fn() }));
vi.mock("../../src/lib/infra/storage/download.js", () => ({ downloadProviderVideo: mocks.download }));
vi.mock("../../src/lib/domain/billing/resolution-pricing.js", () => ({ getResolutionSurcharges: async () => ({ "1K": 0, "2K": 0, "4K": 0 }) }));
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", mocks.fetch); });
afterEach(() => vi.unstubAllGlobals());
const config = kind => ({ videoKind: kind, videoURL: "https://third-party.example/v1", videoKey: "private-key", videoModel: "custom-video-model", videoOptions: videoModelOptions(kind) });
const json = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });

it("submits multipart video requests to a custom compatible gateway", async () => {
  mocks.fetch.mockResolvedValue(json({ id: "video-job", status: "queued" }));
  expect(await videoRequest(config("openai"), { prompt: "A scene", duration: 8, ratio: "9:16" })).toEqual({ state: "pending", requestId: "video-job" });
  const [url, options] = mocks.fetch.mock.calls[0];
  expect(url).toBe("https://third-party.example/v1/videos");
  expect(options.redirect).toBe("manual");
  expect(options.headers.Authorization).toBe("Bearer private-key");
  expect(options.headers["Content-Type"]).toBeUndefined();
  expect(Object.fromEntries(options.body)).toEqual({ model: "custom-video-model", prompt: "A scene", seconds: "8", size: "720x1280" });
});

it("normalizes a first frame to the requested video size", async () => {
  mocks.fetch.mockResolvedValue(json({ id: "video-job", status: "queued" }));
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: "red" } }).jpeg().toBuffer();
  await videoRequest(config("openai"), { prompt: "Animate", duration: 4, ratio: "16:9", image });
  const file = mocks.fetch.mock.calls[0][1].body.get("input_reference");
  expect(file.type).toBe("image/png");
  expect(await sharp(Buffer.from(await file.arrayBuffer())).metadata()).toMatchObject({ width: 1280, height: 720, format: "png" });
});

it("polls completed Videos tasks and supports authenticated content downloads", async () => {
  mocks.fetch.mockResolvedValueOnce(json({ id: "job", status: "completed" }));
  expect(await videoRequest(config("openai"), { requestId: "job" })).toEqual({ state: "succeeded", requestId: "job", contentRequestId: "job" });
  expect(mocks.fetch.mock.calls[0][1].method).toBe("GET");
  mocks.fetch.mockResolvedValueOnce(new Response(Buffer.from("0000ftypisom")));
  expect((await downloadVideoContent(config("openai"), "job")).toString()).toBe("0000ftypisom");
  expect(mocks.fetch.mock.calls[1][0]).toBe("https://third-party.example/v1/videos/job/content");
});

it("uses the safe unauthenticated downloader for signed result redirects", async () => {
  mocks.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://cdn.example/result.mp4" } }));
  mocks.download.mockResolvedValue(Buffer.from("video"));
  await downloadVideoContent(config("openai"), "job");
  expect(mocks.download).toHaveBeenCalledExactlyOnceWith("https://cdn.example/result.mp4");
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("rejects oversized result downloads before buffering", async () => {
  mocks.fetch.mockResolvedValue(new Response("data", { headers: { "content-length": String(101 * 1024 * 1024) } }));
  await expect(downloadVideoContent(config("openai"), "job")).rejects.toThrow("VIDEO_TOO_LARGE");
});

it("submits and polls a third-party Wan-compatible service", async () => {
  mocks.fetch.mockResolvedValueOnce(json({ output: { task_id: "wan-task", task_status: "PENDING" } })).mockResolvedValueOnce(json({ output: { task_status: "SUCCEEDED", video_url: "https://cdn.example/wan.mp4" } }));
  const selected = { ...config("dashscope"), videoURL: "https://wan-gateway.example/api/v1" };
  expect(await videoRequest(selected, { prompt: "Landscape", duration: 10, ratio: "16:9" })).toEqual({ state: "pending", requestId: "wan-task" });
  expect(mocks.fetch.mock.calls[0][0]).toBe("https://wan-gateway.example/api/v1/services/aigc/video-generation/video-synthesis");
  expect(mocks.fetch.mock.calls[0][1].headers["X-DashScope-Async"]).toBe("enable");
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ model: "custom-video-model", input: { prompt: "Landscape" }, parameters: { duration: 10, size: "1280*720" } });
  expect(await videoRequest(selected, { requestId: "wan-task" })).toMatchObject({ state: "succeeded", url: "https://cdn.example/wan.mp4" });
  expect(mocks.fetch.mock.calls[1][0]).toBe("https://wan-gateway.example/api/v1/tasks/wan-task");
});

it("sends Wan reference images using the image-to-video contract", async () => {
  mocks.fetch.mockResolvedValue(json({ output: { task_id: "wan-task", task_status: "RUNNING" } }));
  const image = await sharp({ create: { width: 16, height: 16, channels: 4, background: "transparent" } }).png().toBuffer();
  await videoRequest({ ...config("dashscope"), videoOptions: { ...videoModelOptions("dashscope"), inputMode: "image" } }, { prompt: "Animate", duration: 5, ratio: "1:1", image });
  const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
  expect(body.input.img_url).toMatch(/^data:image\/png;base64,/);
  expect(body.parameters).toEqual({ resolution: "720P", duration: 5 });
  expect((await sharp(Buffer.from(body.input.img_url.split(",")[1], "base64")).metadata()).hasAlpha).toBe(false);
});

it("preserves arbitrary third-party API prefixes instead of replacing them", async () => {
  mocks.fetch.mockResolvedValue(json({ output: { task_id: "task", task_status: "RUNNING" } }));
  await videoRequest({ ...config("dashscope"), videoURL: "https://vendor.example/custom/wan" }, { requestId: "task" });
  expect(mocks.fetch.mock.calls[0][0]).toBe("https://vendor.example/custom/wan/tasks/task");
});

it("rejects unknown statuses, unsafe task IDs and request redirects", async () => {
  mocks.fetch.mockResolvedValueOnce(json({ status: "surprise" }));
  await expect(videoRequest(config("openai"), { requestId: "job" })).rejects.toThrow("INVALID_PROVIDER_TASK");
  await expect(videoRequest(config("openai"), { requestId: ".." })).rejects.toThrow("INVALID_PROVIDER_TASK");
  mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "https://elsewhere.example" } }));
  await expect(videoRequest(config("openai"), { requestId: "job" })).rejects.toThrow("VIDEO_PROVIDER_REJECTED");
});

it("validates model restrictions before contacting a provider", async () => {
  await expect(videoRequest(config("openai"), { prompt: "Scene", duration: 5 })).rejects.toThrow("VIDEO_DURATION_UNSUPPORTED");
  await expect(videoRequest(config("openai"), { prompt: "Scene", duration: 4, ratio: "1:1" })).rejects.toThrow("VIDEO_RATIO_UNSUPPORTED");
  expect(videoInputError({ ...videoModelOptions("dashscope"), inputMode: "image" }, { duration: 5 })).toBe("VIDEO_REFERENCE_REQUIRED");
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(validChannel("openai", { studioCapability: "video", model: "custom", baseURL: "https://third-party.example/v1", videoDurations: [5] })).toBe(false);
});

it("switches to supported parameters without silently discarding reference images", () => {
  const caps = { videoModels: [{ id: "custom", cost: 20, available: true, ...videoModelOptions("openai") }], tools: [{ id: "video", available: true }] };
  const video = { duration: 5, ratio: "1:1", media: [{ id: "reference", type: "image" }] };
  expect(videoModelChange(caps, "custom", video)).toEqual({ provider: "custom", duration: 4, ratio: "16:9" });
  expect(videoModelOffer(caps, "custom", video)).toMatchObject({ available: false, reason: "VIDEO_DURATION_UNSUPPORTED" });
  expect(video.media).toHaveLength(1);
});

it("does not expose OpenAI-compatible video channels as ecommerce image models", async () => {
  const db = { modelProvider: { findMany: async () => [{ name: "video", kind: "openai", config: JSON.stringify({ studioCapability: "video", scope: "public", apiKeyEnc: "secret" }) }] } };
  expect(await availableProviders("owner", db)).toEqual([]);
});
