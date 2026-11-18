import sharp from "sharp";
import { AppError } from "../../http.js";
import { providerRejection } from "./provider-rejection.js";
import { downloadProviderVideo } from "../../infra/storage/download.js";
import { videoInputError, videoModelOptions } from "../../video/model-protocols.js";
import { gptBestBase, gptBestVideoRequest } from "./gptbest-video.js";

const sizes = { "16:9": "1280x720", "9:16": "720x1280", "1:1": "960x960", "4:5": "768x960" };

async function referenceImage(image, ratio) {
  const [width, height] = sizes[ratio].split("x").map(Number);
  return sharp(image).rotate().resize(width, height, { fit: "contain", background: "#000000" }).flatten({ background: "#000000" }).png().toBuffer();
}

function taskId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || [".", ".."].includes(value)) throw new AppError("INVALID_PROVIDER_TASK", 502);
  return value;
}

function apiBase(config) {
  if (!config.videoURL) throw new AppError("SERVICE_NOT_CONFIGURED", 503);
  const base = config.videoURL.replace(/\/+$/, "");
  if (config.videoKind === "gptbest") return `${gptBestBase(config.videoURL)}/v1`;
  if (config.videoKind === "zzshu" && new URL(base).pathname === "/") return `${base}/v1`;
  if (config.videoKind === "dashscope") {
    if (new URL(base).pathname === "/") return `${base}/api/v1`;
    return base.replace(/\/compatible-mode\/v1$/, "/api/v1");
  }
  return base;
}

async function request(config, path, { signal, body, headers = {} } = {}) {
  const response = await fetch(`${apiBase(config)}${path}`, { method: body ? "POST" : "GET", redirect: "manual", signal,
    headers: { Authorization: `Bearer ${config.videoKey}`, ...headers }, ...(body ? { body } : {}) });
  if (!response.ok) throw await providerRejection(response, path);
  return response.json();
}

export async function videoRequest(config, { image, imageUrl, references = [], media = [], videoFields = {}, videoVariant, resolution, prompt, duration, ratio = "16:9", requestId, signal }) {
  // resolution 来自任务快照：下单时已按价格表确定并扣费，执行时原样传给上游。
  const kind = config.videoKind || "volcengine";
  if (!config.videoKey || !config.videoModel) throw new AppError("SERVICE_NOT_CONFIGURED", 503);
  if (!requestId) {
    const error = videoInputError(config.videoOptions || videoModelOptions(kind), { duration, ratio, hasImage: Boolean(image), media, videoFields, videoVariant });
    if (error) throw new AppError(error, 422);
  } else taskId(requestId);
  const encodedId = requestId ? encodeURIComponent(requestId) : null;
  if (kind === "gptbest") return gptBestVideoRequest(config, { image: image && config.videoOptions?.api === "sora" ? await referenceImage(image, ratio) : image, references, media, videoFields, prompt, duration, ratio, resolution, requestId, signal });
  if (["openai", "zzshu"].includes(kind)) {
    let body;
    if (!requestId) {
      if (kind === "zzshu") {
        if (!references.length && imageUrl) references = [{ type: "image", url: imageUrl }];
        if (image && !references.some(item => item.type === "image") || references.some(item => !item.url)) throw new AppError("VIDEO_REFERENCE_URL_REQUIRED", 422);
        const referenceMode = config.videoOptions?.referenceMode || "reference_images";
        if (!["first_frame", "reference_images"].includes(referenceMode)) throw new AppError("VIDEO_REFERENCE_UNSUPPORTED", 422);
        const images = references.filter(item => item.type === "image");
        const invalid = videoInputError(config.videoOptions || videoModelOptions(kind), { duration, ratio, hasImage: Boolean(image), media: references });
        if (invalid) throw new AppError(invalid, 422);
        // Resolution is fixed by the supplier model ID. Do not force 720p on a 480p/4K model.
        body = JSON.stringify({ model: config.videoModel, prompt, duration, ratio,
          ...(referenceMode === "first_frame" ? {
            ...(images[0] ? { first_frame: { image_url: images[0].url } } : {}),
            ...(images[1] ? { last_frame: { image_url: images[1].url } } : {}),
          } : {
            ...(images.length ? { reference_images: images.map(item => ({ image_url: item.url })) } : {}),
            ...(references.some(item => item.type === "video") ? { reference_videos: references.filter(item => item.type === "video").map(item => ({ video_url: item.url })) } : {}),
            ...(references.some(item => item.type === "audio") ? { reference_audios: references.filter(item => item.type === "audio").map(item => ({ audio_url: item.url })) } : {}),
          }) });
      } else {
        body = new FormData();
        body.set("model", config.videoModel); body.set("prompt", prompt); body.set("seconds", String(duration)); body.set("size", sizes[ratio]);
        if (image) {
          const bytes = await referenceImage(image, ratio);
          body.set("input_reference", new Blob([bytes], { type: "image/png" }), "reference.png");
        }
      }
    }
    const data = await request(config, `/videos${requestId ? `/${encodedId}` : ""}`, { signal, body,
      ...(kind === "zzshu" && body ? { headers: { "Content-Type": "application/json" } } : {}) });
    const id = taskId(requestId || data.id);
    if (["failed", "cancelled", "canceled", "expired"].includes(data.status)) return { state: "failed", requestId: id };
    if (data.status === "completed") {
      const url = data.video_url || data.url || data.output?.video_url;
      return { state: "succeeded", requestId: id, ...(typeof url === "string" ? { url } : { contentRequestId: id }) };
    }
    if (!["queued", "in_progress", "pending", "processing"].includes(data.status) && (requestId || data.status)) throw new AppError("INVALID_PROVIDER_TASK", 502);
    return { state: "pending", requestId: id };
  }
  if (kind === "dashscope") {
    const data = await request(config, requestId ? `/tasks/${encodedId}` : "/services/aigc/video-generation/video-synthesis", { signal,
      headers: { "Content-Type": "application/json", ...(!requestId ? { "X-DashScope-Async": "enable" } : {}) },
      ...(!requestId ? { body: JSON.stringify({ model: config.videoModel, input: { prompt, ...(image ? { img_url: `data:image/png;base64,${(await referenceImage(image, ratio)).toString("base64")}` } : {}) },
        parameters: { duration, ...(image ? { resolution: "720P" } : { size: sizes[ratio].replace("x", "*") }) } }) } : {}) });
    if (data.code) throw new AppError("VIDEO_PROVIDER_REJECTED", 422);
    const output = data.output, id = taskId(requestId || output?.task_id);
    if (["FAILED", "CANCELED", "CANCELLED", "UNKNOWN"].includes(output?.task_status)) return { state: "failed", requestId: id };
    if (output?.task_status === "SUCCEEDED") {
      if (typeof output.video_url !== "string" || !output.video_url) throw new AppError("EMPTY_PROVIDER_RESULT", 502);
      return { state: "succeeded", requestId: id, url: output.video_url };
    }
    if (!["PENDING", "RUNNING"].includes(output?.task_status)) throw new AppError("INVALID_PROVIDER_TASK", 502);
    return { state: "pending", requestId: id };
  }
  if (kind !== "volcengine") throw new AppError("VIDEO_PROTOCOL_UNSUPPORTED", 422);
  const data = await request(config, `/contents/generations/tasks${requestId ? `/${encodedId}` : ""}`, { signal, headers: { "Content-Type": "application/json" },
    ...(!requestId ? { body: JSON.stringify({ model: config.videoModel, content: [{ type: "text", text: `${prompt} --duration ${duration} --watermark false --ratio ${ratio}${resolution ? ` --resolution ${resolution}` : ""}` }, ...(image ? [{ type: "image_url", image_url: { url: `data:image/png;base64,${image.toString("base64")}` }, role: "first_frame" }] : [])] }) } : {}) });
  if (!requestId) return { state: "pending", requestId: taskId(data.id) };
  if (["failed", "cancelled", "expired"].includes(data.status)) return { state: "failed" };
  if (data.status !== "succeeded") {
    if (!["queued", "running"].includes(data.status)) throw new AppError("INVALID_PROVIDER_TASK", 502);
    return { state: "pending", requestId };
  }
  if (!data.content?.video_url) throw new AppError("EMPTY_PROVIDER_RESULT", 502);
  return { state: "succeeded", url: data.content.video_url };
}

export async function downloadVideoContent(config, requestId, signal) {
  if (!["openai", "zzshu", "gptbest"].includes(config.videoKind)) throw new AppError("VIDEO_PROTOCOL_UNSUPPORTED", 422);
  const response = await fetch(`${apiBase(config)}/videos/${encodeURIComponent(taskId(requestId))}/content`, {
    headers: { Authorization: `Bearer ${config.videoKey}` }, redirect: "manual", signal,
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    return downloadProviderVideo(response.headers.get("location"));
  }
  if (!response.ok) throw new AppError("VIDEO_DOWNLOAD_REJECTED", 502);
  const limit = 100 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new AppError("VIDEO_TOO_LARGE", 413); }
  if (!response.body) throw new AppError("EMPTY_PROVIDER_RESULT", 502);
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new AppError("VIDEO_TOO_LARGE", 413); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
