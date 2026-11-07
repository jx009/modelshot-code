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

it("submits zzshu JSON with the supplier's exact model ID and duration fields", async () => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ id: "vid_123", status: "queued" }), { status: 202 }));
  const selected = { ...config("zzshu"), videoURL: "https://sub.zzshu.cc", videoModel: "官转SD2.5-30图版-480P" };
  expect(await videoRequest(selected, { prompt: "A cat on a beach", duration: 5, ratio: "1:1" })).toEqual({ state: "pending", requestId: "vid_123" });
  const [url, options] = mocks.fetch.mock.calls[0];
  expect(url).toBe("https://sub.zzshu.cc/v1/videos");
  expect(options.headers).toEqual({ Authorization: "Bearer private-key", "Content-Type": "application/json" });
  expect(JSON.parse(options.body)).toEqual({ model: "官转SD2.5-30图版-480P", prompt: "A cat on a beach", duration: 5, ratio: "1:1" });
});

it.each(["reference_images", "first_frame"])("sends zzshu %s as a public file URL without multipart or base64", async referenceMode => {
  mocks.fetch.mockResolvedValue(json({ id: "vid_123", status: "processing" }));
  const imageUrl = "https://app.example/api/video/reference/asset?token=temporary";
  const selected = { ...config("zzshu"), videoOptions: { ...videoModelOptions("zzshu"), referenceMode } };
  await videoRequest(selected, { prompt: "Animate", duration: 5, image: Buffer.from("owned-image"), imageUrl });
  const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
  expect(body[referenceMode]).toEqual(referenceMode === "first_frame" ? { image_url: imageUrl } : [{ image_url: imageUrl }]);
  expect(body[referenceMode === "first_frame" ? "reference_images" : "first_frame"]).toBeUndefined();
  expect(body.seconds).toBeUndefined();
  expect(body.size).toBeUndefined();
});

it("requires a URL for zzshu image inputs and rejects incompatible text-only inputs", async () => {
  await expect(videoRequest(config("zzshu"), { prompt: "Animate", duration: 5, image: Buffer.from("owned-image") })).rejects.toThrow("VIDEO_REFERENCE_URL_REQUIRED");
  await expect(videoRequest({ ...config("zzshu"), videoOptions: { ...videoModelOptions("zzshu"), inputMode: "text" } }, { duration: 5, image: Buffer.from("owned-image") })).rejects.toThrow("VIDEO_REFERENCE_UNSUPPORTED");
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("polls existing zzshu tasks without resubmitting images and downloads the authenticated MP4", async () => {
  mocks.fetch.mockResolvedValueOnce(json({ id: "vid_123", status: "processing" })).mockResolvedValueOnce(json({ id: "vid_123", status: "completed", duration: 5, resolution: "480p" }));
  expect(await videoRequest(config("zzshu"), { requestId: "vid_123" })).toEqual({ state: "pending", requestId: "vid_123" });
  expect(await videoRequest(config("zzshu"), { requestId: "vid_123" })).toEqual({ state: "succeeded", requestId: "vid_123", contentRequestId: "vid_123" });
  for (const [url, options] of mocks.fetch.mock.calls) {
    expect(url).toBe("https://third-party.example/v1/videos/vid_123");
    expect(options.method).toBe("GET");
    expect(options.body).toBeUndefined();
  }
  mocks.fetch.mockResolvedValueOnce(new Response(Buffer.from("0000ftypisom")));
  expect((await downloadVideoContent(config("zzshu"), "vid_123")).toString()).toBe("0000ftypisom");
  expect(mocks.fetch.mock.calls[2][0]).toBe("https://third-party.example/v1/videos/vid_123/content");
  expect(mocks.fetch.mock.calls[2][1].headers.Authorization).toBe("Bearer private-key");
});

it("keeps zzshu channels video-only and validates configured reference mode", () => {
  const channel = { studioCapability: "video", scope: "public", model: "SD2.5-文生-720P", videoDurations: [5], videoInputMode: "text" };
  expect(validChannel("zzshu", channel)).toBe(true);
  expect(validChannel("zzshu", { ...channel, videoReferenceMode: "reference_images" })).toBe(true);
  expect(validChannel("zzshu", { ...channel, videoReferenceMode: "unknown" })).toBe(false);
  expect(validChannel("zzshu", { ...channel, studioCapability: "image" })).toBe(false);
  expect(videoModelOptions("zzshu", { videoReferenceMode: "first_frame" }).referenceMode).toBe("first_frame");
});

it("submits zzshu multimodal references and keeps first/last frames separate", async () => {
  mocks.fetch.mockResolvedValue(json({ id: "task", status: "queued" }));
  const refs = [{ type: "image", url: "https://app.example/first.png" }, { type: "image", url: "https://app.example/last.png" }];
  await videoRequest({ ...config("zzshu"), videoOptions: videoModelOptions("zzshu", { videoReferenceMode: "first_frame" }) }, { prompt: "Animate", duration: 5, references: refs });
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ first_frame: { image_url: refs[0].url }, last_frame: { image_url: refs[1].url } });
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).not.toHaveProperty("reference_images");
  await videoRequest(config("zzshu"), { prompt: "Animate", duration: 5, references: [...refs, { type: "video", url: "https://app.example/ref.mp4", duration: 5 }, { type: "audio", url: "https://app.example/ref.mp3", duration: 2 }] });
  expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toMatchObject({ reference_images: refs.map(item => ({ image_url: item.url })), reference_videos: [{ video_url: "https://app.example/ref.mp4" }], reference_audios: [{ audio_url: "https://app.example/ref.mp3" }] });
});

it("rejects excess media, incompatible frame references and invalid audio before submitting", async () => {
  const options = videoModelOptions("zzshu");
  expect(videoInputError(options, { duration: 5, media: Array.from({ length: 31 }, () => ({ type: "image" })) })).toBe("VIDEO_MEDIA_LIMIT");
  expect(videoInputError(options, { duration: 5, media: [{ type: "audio", duration: 1 }] })).toBe("VIDEO_AUDIO_DURATION_INVALID");
  expect(videoInputError(options, { duration: 5, media: [{ type: "audio", duration: 31 }] })).toBe("VIDEO_AUDIO_DURATION_INVALID");
  await expect(videoRequest({ ...config("zzshu"), videoOptions: videoModelOptions("zzshu", { videoReferenceMode: "first_frame" }) }, { duration: 5, references: [{ type: "video", url: "https://app.example/ref.mp4" }] })).rejects.toThrow("VIDEO_MEDIA_LIMIT");
  expect(mocks.fetch).not.toHaveBeenCalled();
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
