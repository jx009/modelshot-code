import { AppError } from "../../http.js";
import { providerRejection } from "./provider-rejection.js";
import { gptBestApi, gptBestInputError } from "../../video/gptbest-catalog.js";

const sizes = { "16:9": "1280x720", "9:16": "720x1280", "1:1": "960x960", "4:5": "768x960" };
const object = value => value && typeof value === "object" && !Array.isArray(value);
function merge(base, next) {
  const result = { ...base };
  for (const [key, value] of Object.entries(next || {})) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new AppError("VIDEO_FIELDS_INVALID", 422);
    if (value !== undefined) result[key] = object(value) ? merge(object(result[key]) ? result[key] : {}, value) : value;
  }
  return result;
}
const present = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && !item.length)));
const nonempty = value => typeof value === "string" && value.length > 0;
function validId(value) {
  if (!nonempty(value) || value.length > 256 || [".", ".."].includes(value)) throw new AppError("INVALID_PROVIDER_TASK", 502);
  return value;
}

export function gptBestBase(value) {
  if (!value) throw new AppError("SERVICE_NOT_CONFIGURED", 503);
  // The catalog contains full API paths. Accept an administrator's /v1 prefix too.
  return value.replace(/\/+$/, "").replace(/\/v[12]$/, "");
}

async function call(config, path, { body, signal, headers = {}, method } = {}) {
  const form = body instanceof FormData;
  const response = await fetch(`${gptBestBase(config.videoURL)}${path}`, { method: method || (body ? "POST" : "GET"), signal, redirect: "manual",
    headers: { Authorization: `Bearer ${config.videoKey}`, ...(body && !form ? { "Content-Type": "application/json" } : {}), ...headers },
    ...(body ? { body: form ? body : JSON.stringify(body) } : {}) });
  if (!response.ok) throw await providerRejection(response, path);
  const data = await response.json();
  if (data.error || data.base_resp?.status_code || data.code !== undefined && ![0, 200, "0", "200"].includes(data.code)) throw new AppError("VIDEO_PROVIDER_REJECTED", 422);
  return data;
}

export function gptBestBody(config, input) {
  const options = config.videoOptions, api = gptBestApi(options?.api);
  if (!api) throw new AppError("VIDEO_PROTOCOL_UNSUPPORTED", 422);
  const { prompt, duration, ratio = "16:9", references = [], videoFields = {} } = input;
  const invalid = gptBestInputError(options, { ...input, media: references, hasImage: Boolean(input.image) });
  if (invalid) throw new AppError(invalid, 422);
  const images = references.filter(item => item.type === "image").map(item => item.url);
  const videos = references.filter(item => item.type === "video").map(item => item.url);
  const audios = references.filter(item => item.type === "audio").map(item => item.url);
  if (references.some(item => !nonempty(item.url))) throw new AppError("VIDEO_REFERENCE_URL_REQUIRED", 422);
  const model = config.videoModel, size = sizes[ratio];
  const fields = { ...(options.parameters || {}), ...Object.fromEntries(Object.entries(videoFields).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()])) };
  let defaults = {}, dynamic = { model, prompt }, path = api.path;
  if (api.family === "unified") {
    dynamic = { model, prompt, ...(!api.noDuration ? { duration: api.durationString ? String(duration) : duration } : {}), ...(api.ratioField ? { [api.ratioField]: ratio } : {}), ...present({ images, videos, audios }) };
    if (api.wan) {
      dynamic = { model, prompt, duration, ...present({ images, audio_url: audios[0] }), ...(images.length ? {} : { size: size.replace("x", "*") }) };
    }
  } else if (api.family === "videos") {
    if (api.id === "sora-remix") dynamic = { prompt };
    else if (api.json) dynamic = { model, prompt, duration, aspect_ratio: ratio, ...present({ image_urls: images, video_urls: videos, audio_urls: audios }) };
    else {
      dynamic = { model, prompt, seconds: String(duration), ...(api.form && api.form !== "omni" ? { aspect_ratio: ratio } : { size }) };
      if (api.form === "grok") dynamic = { ...dynamic, ...present({ images }) };
      if (api.form === "h3") dynamic = { ...dynamic, ...present({ imageUrls: images, videoUrls: videos, audioUrls: audios }) };
    }
  } else if (api.family === "higgsfield") {
    dynamic = { ...(api.id === "higgsfield" ? { model, prompt } : api.id === "higgsfield-speech" ? { prompt, width: Number(size.split("x")[0]), height: Number(size.split("x")[1]), ...present({ audio: audios[0] }) } : {}), image: images };
  } else if (api.family === "pixverse") {
    defaults = images.length ? { motion_strength: 0.5, motion_scale: { horizontal: 0, vertical: 0, roll: 0, zoom: 0 } } : {};
    dynamic = { model, prompt, ...(images.length ? { image: images[0] } : { ratio }) };
  } else if (api.family === "luma") dynamic = { model_name: model, user_prompt: prompt, duration, aspect_ratio: ratio, ...present({ image_url: images[0], image_end_url: images[1] }) };
  else if (api.family === "runway-native") dynamic = { model, promptText: prompt, duration, ratio: model.includes("gen3") ? (ratio === "9:16" ? "768:1280" : "1280:768") : size.replace("x", ":"), promptImage: images.map((uri, index) => ({ uri, position: index ? "last" : "first" })) };
  else if (api.family === "runway") {
    defaults = { options: { duration, motion_vector: 5 } };
    dynamic = { model, prompt, ...(api.id === "runway" ? { ratio } : {}), ...present({ image: images[0], video: videos[0], ...(api.id === "runway-aleph" ? { images } : {}), character_video: videos[1] }) };
  } else if (api.family === "pika") {
    defaults = { pikaffect: "", options: { aspectRatio: Number(ratio.split(":")[0]) / Number(ratio.split(":")[1]), frameRate: 24, camera: {}, parameters: { guidanceScale: 12, motion: 1, negativePrompt: "" }, extend: false } };
    dynamic = { model, promptText: prompt, ...present({ image: images[0], video: videos[0] }) };
  } else if (api.family === "minimax") dynamic = { model, prompt, duration, ...present({ first_frame_image: images[0], last_frame_image: images[1] }) };
  else if (api.family === "vidu") {
    defaults = { seed: 0, resolution: "720p", movement_amplitude: "auto", off_peak: false };
    dynamic = { model, prompt, duration, ...present({ images }), aspect_ratio: ratio };
  } else if (api.family === "seedance") dynamic = { model, duration, ratio, content: [{ type: "text", text: prompt }, ...references.map(item => ({ type: `${item.type}_url`, [`${item.type}_url`]: { url: item.url }, role: item.type === "image" ? "reference_image" : `reference_${item.type}` }))] };
  else if (api.family === "xai") {
    defaults = { resolution: "720p" };
    dynamic = { model, prompt, duration, aspect_ratio: ratio, ...(api.id === "xai-reference" ? { reference_images: images.map(url => ({ url })) } : images.length ? { image: { url: images[0] } } : {}), ...(videos.length ? { video: { url: videos[0] } } : {}) };
  } else if (api.family === "qwen") {
    const action = api.id.slice(5);
    let params = {}, content = {};
    if (["text", "image", "frames", "reference", "edit"].includes(action)) {
      content = { prompt, ...(action === "image" ? present({ img_url: images[0] }) : {}), ...(action === "frames" ? present({ first_frame_url: images[0], last_frame_url: images[1] }) : {}), ...(["reference", "edit"].includes(action) ? present({ function: action === "reference" ? "image_reference" : "video_edit", ref_images_url: images, video_url: videos[0] }) : {}) };
      params = { duration, ...(action === "text" || action === "reference" ? { size: size.replace("x", "*") } : {}) };
      if (action === "reference") params.obj_or_bg = images.map(() => "obj");
    } else {
      content = present({ image_url: images[0], video_url: videos[0], audio_url: audios[0] });
      if (["move", "mix"].includes(action)) params.mode = "wan-std";
      if (action === "retalk") { delete content.image_url; if (images[0]) content.ref_image_url = images[0]; }
      if (action === "style") params = { style: 0, video_fps: 15 };
      if (action === "animate") content.template_id = fields.template_id;
      if (action === "emoji") content.driven_id = fields.driven_id;
    }
    dynamic = { model, input: content, parameters: params };
  } else if (api.family === "kling") {
    defaults = { mode: "std" };
    dynamic = { model_name: model, prompt, duration: String(duration), aspect_ratio: ratio };
    if (api.id === "kling-image2video") Object.assign(dynamic, present({ image: images[0], image_tail: images[1] }));
    if (api.id === "kling-multi-image2video") dynamic.image_list = images.map(image => ({ image }));
    if (api.id === "kling-omni-video") Object.assign(dynamic, present({ image_list: images.map(image_url => ({ image_url })), video_list: videos.map(video_url => ({ video_url, refer_type: "base" })) }));
    if (api.id === "kling-motion-control") dynamic = { prompt, image_url: images[0], video_url: videos[0] };
    if (api.id === "kling-video-extend") { defaults = {}; dynamic = { video_id: fields.video_id, prompt }; }
    if (api.id === "kling-avatar-image2video") dynamic = { image: images[0], sound_file: audios[0], prompt };
    if (api.id === "kling-lip-sync") { defaults = {}; dynamic = { input: { video_url: videos[0], mode: "audio2video", audio_type: "url", audio_url: audios[0] } }; }
    if (api.id === "kling-effects") { defaults = {}; dynamic = { effect_scene: fields.effect_scene, input: { model_name: model, mode: "std", images, duration: String(duration) } }; }
  }
  const extras = { ...(options.parameters || {}) };
  for (const field of api.fields || []) {
    const value = videoFields[field.key]?.trim() || extras[field.key];
    if (field.key === "sourceTaskId") { path = path.replace("{sourceTaskId}", encodeURIComponent(validId(value))); delete extras.sourceTaskId; }
    else if (!["template_id", "driven_id", "video_id", "effect_scene"].includes(field.key)) extras[field.key] = value;
    else delete extras[field.key];
  }
  const body = merge(merge(defaults, extras), dynamic);
  // These models require detected face bounds. Reject incomplete setup before billing/submitting.
  if (["qwen-emo", "qwen-emoji"].includes(api.id) && (!Array.isArray(body.input?.face_bbox) || !Array.isArray(body.input?.ext_bbox))) throw new AppError("VIDEO_FIELDS_REQUIRED", 422);
  if (input.validateOnly) return { api, path, body };
  if (api.family === "videos" && !api.json && api.id !== "sora-remix") {
    const form = new FormData();
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) for (const item of value) form.append(key, typeof item === "object" ? JSON.stringify(item) : String(item));
      else form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
    if (api.form === "omni") {
      for (const item of references) {
        if (!item.bytes) throw new AppError("VIDEO_REFERENCE_REQUIRED", 422);
        form.append("input_reference", new Blob([item.bytes], { type: item.contentType }), item.type === "video" ? "reference.mp4" : "reference.png");
      }
    } else if (!api.form && input.image) form.set("input_reference", new Blob([input.image], { type: "image/png" }), "reference.png");
    return { api, path, body: form };
  }
  return { api, path, body };
}

function result(api, data, requestId) {
  let task = data.data && !Array.isArray(data.data) ? data.data : data;
  if (api.family === "qwen") task = data.output || task;
  if (api.family === "higgsfield") task = data.jobs?.[0] || task;
  if (api.family === "pika") task = data.videos?.[0] || task;
  const id = validId(requestId || data.task_id || task.task_id || data.id || task.id || data.request_id);
  const status = String(task.task_status || task.state || task.status || data.status || "").toLowerCase();
  const url = task.video_url || task.resultUrl || task.result?.url || task.video?.url || task.video?.download_url || task.video_raw?.url
    || task.content?.video_url || task.content?.find?.(item => item.type === "video_url")?.video_url?.url
    || task.task_result?.videos?.[0]?.url || task.creations?.[0]?.url || (Array.isArray(task.output) ? task.output[0] : undefined) || task.outputs?.[0]
    || (typeof task.output === "string" ? task.output : undefined) || data.data?.output || data.data?.outputs?.[0];
  if (["failed", "failure", "fail", "error", "cancelled", "canceled", "expired", "4", "5"].includes(status)) return { state: "failed", requestId: id };
  if (["success", "succeeded", "succeed", "completed", "finished", "done", "3"].includes(status)) {
    if (nonempty(url)) return { state: "succeeded", requestId: id, url, ...(task.task_result?.videos?.[0]?.id ? { providerVideoId: task.task_result.videos[0].id } : {}) };
    if (api.family === "minimax" && nonempty(task.file_id)) return { state: "file", requestId: id, fileId: task.file_id };
    if (api.family === "videos") return { state: "succeeded", requestId: id, contentRequestId: id };
    throw new AppError("EMPTY_PROVIDER_RESULT", 502);
  }
  if (!["", "not_start", "submitted", "queued", "queueing", "pending", "preparing", "processing", "running", "in_progress", "in_queue", "0", "1", "2"].includes(status) || !status && requestId) throw new AppError("INVALID_PROVIDER_TASK", 502);
  return { state: "pending", requestId: id };
}

function submittedId(data) {
  const task = data.output || data.data || {};
  return validId(data.task_id || task.task_id || data.id || task.id || data.request_id);
}

export async function gptBestVideoRequest(config, input) {
  const api = gptBestApi(config.videoOptions?.api);
  if (!api) throw new AppError("VIDEO_PROTOCOL_UNSUPPORTED", 422);
  const { requestId, signal } = input;
  if (!requestId) {
    const submission = gptBestBody(config, input);
    const data = await call(config, submission.path, { body: submission.body, signal, headers: api.family === "qwen" ? { "X-DashScope-Async": "enable" } : api.family === "runway-native" ? { "X-Runway-Version": "2024-11-06" } : {} });
    // Always persist a submitted ID before querying or retrieving any result file.
    return { state: "pending", requestId: submittedId(data) };
  }
  const id = encodeURIComponent(validId(requestId));
  let path, body;
  switch (api.family) {
    case "unified": path = `/v2/videos/generations/${id}`; break;
    case "videos": path = `/v1/videos/${id}`; break;
    case "higgsfield": path = `/higgsfield/feed/${id}`; body = { task_id: requestId }; break;
    case "pixverse": path = `/pixverse/v1/pro/feed?task_id=${id}`; break;
    case "luma": path = `/luma/generations/${id}`; break;
    case "runway-native": path = `/runwayml/v1/tasks/${id}`; break;
    case "runway": path = "/runway/v1/feed"; body = { task_id: requestId }; break;
    case "pika": path = `/pika/feed/${id}`; break;
    case "minimax": path = `/minimax/v1/query/video_generation?task_id=${id}`; break;
    case "vidu": path = `/vidu/v2/tasks/${id}/creations`; break;
    case "seedance": path = `/seedance/v3/contents/generations/tasks/${id}`; break;
    case "xai": path = `/xai/v1/videos/${id}`; break;
    case "qwen": path = `/qwen/api/v1/tasks/${id}`; break;
    case "kling": path = `${api.path.replace(/\/lip-sync$/, "/advanced-lip-sync")}/${id}`; break;
    default: throw new AppError("VIDEO_PROTOCOL_UNSUPPORTED", 422);
  }
  const data = await call(config, path, { body, signal, headers: api.family === "runway-native" ? { "X-Runway-Version": "2024-11-06" } : {} });
  const remote = result(api, data, requestId);
  if (remote.state !== "file") return remote;
  const file = await call(config, `/minimax/v1/files/retrieve?file_id=${encodeURIComponent(remote.fileId)}`, { signal });
  const url = file.file?.download_url;
  if (!nonempty(url)) throw new AppError("EMPTY_PROVIDER_RESULT", 502);
  return { state: "succeeded", requestId, url };
}
