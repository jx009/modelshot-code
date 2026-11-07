import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { gptBestBody, gptBestVideoRequest } from "../../src/lib/domain/studio/gptbest-video.js";
import { videoModelOptions, videoInputError } from "../../src/lib/video/model-protocols.js";
import { publicVideoOptions, validVideoParameters } from "../../src/lib/video/gptbest-catalog.js";
import { validChannel } from "../../src/lib/studio/model-channels.js";

const fetchMock = vi.fn();
const json = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const config = (api, parameters = {}) => ({ videoKind: "gptbest", videoKey: "private-key", videoModel: "supplier-model", videoURL: "https://provider.example/v1", videoOptions: videoModelOptions("gptbest", { videoApi: api, videoParameters: parameters }) });
const input = { prompt: "A cinematic scene", duration: 5, ratio: "16:9" };
const image = { type: "image", url: "https://app.example/image.png", duration: 0 };
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

it("uses unified JSON and encodes colon-bearing task IDs without resubmitting", async () => {
  fetchMock.mockResolvedValueOnce(json({ task_id: "veo3:123" })).mockResolvedValueOnce(json({ task_id: "veo3:123", status: "SUCCESS", data: { output: "https://cdn.example/video.mp4" } }));
  expect(await gptBestVideoRequest(config("unified-veo"), input)).toEqual({ state: "pending", requestId: "veo3:123" });
  expect(fetchMock.mock.calls[0][0]).toBe("https://provider.example/v2/videos/generations");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ model: "supplier-model", prompt: input.prompt, aspect_ratio: "16:9" });
  expect(await gptBestVideoRequest(config("unified-veo"), { requestId: "veo3:123" })).toMatchObject({ state: "succeeded", url: "https://cdn.example/video.mp4" });
  expect(fetchMock.mock.calls[1][0]).toBe("https://provider.example/v2/videos/generations/veo3%3A123");
  expect(fetchMock.mock.calls[1][1].method).toBe("GET");
});

it("preserves native Kling task IDs instead of the trace request ID", async () => {
  fetchMock.mockResolvedValue(json({ code: 0, request_id: "trace-only", data: { task_id: "paid-task", task_status: "submitted" } }));
  expect(await gptBestVideoRequest(config("kling-text2video"), input)).toEqual({ state: "pending", requestId: "paid-task" });
});

it("persists completed submission IDs before parsing or downloading results", async () => {
  fetchMock.mockResolvedValue(json({ task_id: "task", status: "SUCCESS" }));
  expect(await gptBestVideoRequest(config("unified-seedance"), input)).toEqual({ state: "pending", requestId: "task" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([
  ["higgsfield", "/higgsfield/feed/job", { task_id: "job" }, { jobs: [{ status: "completed", result: { type: "video", url: "https://cdn.example/result.mp4" } }] }],
  ["runway", "/runway/v1/feed", { task_id: "job" }, { code: 200, data: { status: "3", video_url: "https://cdn.example/result.mp4" } }],
])("uses the documented POST query for %s", async (api, path, body, response) => {
  fetchMock.mockResolvedValue(json(response));
  expect(await gptBestVideoRequest(config(api), { requestId: "job" })).toMatchObject({ state: "succeeded", url: "https://cdn.example/result.mp4" });
  expect(fetchMock.mock.calls[0][0]).toBe(`https://provider.example${path}`);
  expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(body);
});

it("retrieves MiniMax file metadata only after generation completes", async () => {
  fetchMock.mockResolvedValueOnce(json({ task_id: "job", status: "Success", file_id: "file-1", base_resp: { status_code: 0 } })).mockResolvedValueOnce(json({ file: { download_url: "https://cdn.example/minimax.mp4" } }));
  expect(await gptBestVideoRequest(config("minimax"), { requestId: "job" })).toMatchObject({ state: "succeeded", url: "https://cdn.example/minimax.mp4" });
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["https://provider.example/minimax/v1/query/video_generation?task_id=job", "https://provider.example/minimax/v1/files/retrieve?file_id=file-1"]);
});

it.each([
  ["pika", { videos: [{ status: "finished", resultUrl: "https://cdn.example/result.mp4" }] }],
  ["seedance-native", { status: "succeeded", content: [{ type: "video_url", video_url: { url: "https://cdn.example/result.mp4" } }] }],
  ["xai", { status: "done", video: { url: "https://cdn.example/result.mp4" } }],
  ["qwen-text", { output: { task_status: "SUCCEEDED", video_url: "https://cdn.example/result.mp4" } }],
  ["vidu-text2video", { state: "success", creations: [{ url: "https://cdn.example/result.mp4" }] }],
  ["runway-native", { status: "SUCCEEDED", output: ["https://cdn.example/result.mp4"] }],
])("normalizes %s video results", async (api, response) => {
  fetchMock.mockResolvedValue(json(response));
  expect(await gptBestVideoRequest(config(api), { requestId: "job" })).toMatchObject({ state: "succeeded", url: "https://cdn.example/result.mp4" });
});

it("keeps standard Videos multipart separate from Wan 3 JSON", () => {
  const sora = gptBestBody(config("sora"), { ...input, image: Buffer.from("image"), references: [image] });
  expect(sora.body).toBeInstanceOf(FormData);
  expect(sora.body.get("seconds")).toBe("5");
  expect(sora.body.get("input_reference")).toBeInstanceOf(Blob);
  const wan = gptBestBody(config("wan3"), { ...input, references: [image] });
  expect(wan.body).toMatchObject({ duration: 5, aspect_ratio: "16:9", image_urls: [image.url] });
  expect(wan.body).not.toHaveProperty("seconds");
});

it("keeps nested model settings while applying this request's prompt and media", () => {
  const request = gptBestBody(config("qwen-reference", { input: { prompt: "stale" }, parameters: { resolution: "480P", prompt_extend: false } }), { ...input, references: [image] });
  expect(request.body.input).toEqual({ prompt: input.prompt, function: "image_reference", ref_images_url: [image.url] });
  expect(request.body.parameters).toMatchObject({ resolution: "480P", prompt_extend: false, obj_or_bg: ["obj"] });
});

it("rejects missing required sources, template fields and excess references before submitting", async () => {
  expect(videoInputError(config("xai-edit").videoOptions, input)).toBe("VIDEO_REFERENCE_REQUIRED");
  expect(videoInputError(config("higgsfield").videoOptions, { ...input, media: [image] })).toBe("VIDEO_FIELDS_REQUIRED");
  expect(videoInputError(config("veo-omni").videoOptions, { ...input, media: Array.from({ length: 8 }, (_, index) => ({ type: index < 4 ? "image" : "video" })) })).toBe("VIDEO_MEDIA_LIMIT");
  await expect(gptBestVideoRequest(config("higgsfield"), { ...input, references: [image] })).rejects.toThrow("VIDEO_FIELDS_REQUIRED");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("fails closed for unknown states, supplier errors and redirects", async () => {
  for (const response of [json({ status: "surprise" }), json({ code: 403, message: "rejected" }), new Response(null, { status: 302, headers: { Location: "https://elsewhere.example" } })]) {
    fetchMock.mockResolvedValueOnce(response);
    await expect(gptBestVideoRequest(config("xai"), { requestId: "job" })).rejects.toThrow();
  }
});

it("keeps administrator parameters private and channels video-only", () => {
  const selected = config("higgsfield", { motion_id: "preset", resolution: "720p" });
  const metadata = publicVideoOptions(selected.videoOptions);
  expect(metadata).not.toHaveProperty("parameters");
  expect(metadata.configuredFields).toContain("motion_id");
  expect(videoInputError(metadata, { ...input, media: [image] })).toBeNull();
  expect(validVideoParameters({ input: { api_key: "private-key" } })).toBe(false);
  expect(validVideoParameters(JSON.parse('{"__proto__":{"polluted":true}}'))).toBe(false);
  expect(validChannel("gptbest", { studioCapability: "image", model: "supplier-model" })).toBe(false);
  expect(validChannel("gptbest", { studioCapability: "video", model: "supplier-model", videoApi: "unknown" })).toBe(false);
});
