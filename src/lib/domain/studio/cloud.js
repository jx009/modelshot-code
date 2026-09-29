import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { AppError } from "../../http.js";
import { downloadProviderImage } from "../../infra/storage/download.js";
import { maskPixels } from "./pixels.js";
import { segmentMaskScore } from "./segmentation.js";
import { segmentVolcImage } from "./volc-visual.js";

const dataURL = bytes => `data:image/png;base64,${bytes.toString("base64")}`;
const maxImageBytes = 10 * 1024 * 1024;

export async function providerImage(value) {
  if (typeof value !== "string") throw new AppError("EMPTY_PROVIDER_RESULT", 502);
  if (value.startsWith("data:")) {
    const match = /^data:image\/(?:png|webp|jpeg);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value);
    if (!match || match[1].length > Math.ceil(maxImageBytes / 3) * 4) throw new AppError("INVALID_IMAGE_SIZE", 413);
    return Buffer.from(match[1], "base64");
  }
  return downloadProviderImage(value);
}

async function jsonRequest(url, { apiKey, scheme = "Bearer", signal, body, method = "POST" }) {
  const response = await fetch(url, { method, redirect: "error", signal, headers: { Authorization: `${scheme} ${apiKey}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error || data.code) throw new AppError("PROVIDER_REJECTED", response.ok ? 422 : response.status >= 500 ? 502 : response.status);
  return data;
}

// APIs without a native inpainting mask receive an explicit visual region guide.
// Final pixel preservation is enforced by the caller's compositing mask.
export async function regionGuide(image, mask) {
  const { width, height } = await sharp(image).metadata();
  const alpha = await sharp(mask).ensureAlpha().extractChannel("alpha").raw().toBuffer();
  if (alpha.length !== width * height) throw new AppError("MASK_SIZE_MISMATCH");
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < alpha.length; i++) { rgba[i * 4] = 255; rgba[i * 4 + 2] = 180; rgba[i * 4 + 3] = Math.round((255 - alpha[i]) * 0.35); }
  return sharp(image).composite([{ input: rgba, raw: { width, height, channels: 4 } }]).png().toBuffer();
}

export async function generateCloudImage(config, { image, references = [], mask, prompt, size = "1024x1024", signal }) {
  const kind = config.imageKind;
  let inputs = image ? [image, ...references] : [];
  if (mask && image) {
    inputs = [image, ...references.slice(0, 1), await regionGuide(image, mask)];
    prompt += `\nImage ${inputs.length} is a REGION GUIDE ONLY: translucent magenta marks the editable area. Edit IMAGE 1 in that area, allow the requested new pose inside that area, and keep everything outside it unchanged. Never reproduce the guide, its color, or its border. Return one edited image, not a collage.`;
  }
  if (kind === "dashscope") {
    const base = (config.baseURL || "https://dashscope.aliyuncs.com").replace(/\/$/, "").replace(/\/api\/v1(?:\/.*)?$/, "");
    const content = [...inputs.slice(0, 3).map(bytes => ({ image: dataURL(bytes) })), { text: prompt }];
    const data = await jsonRequest(`${base}/api/v1/services/aigc/multimodal-generation/generation`, {
      apiKey: config.apiKey, signal,
      body: { model: config.imageModel, input: { messages: [{ role: "user", content }] }, parameters: { n: 1, watermark: false, prompt_extend: false, ...(config.imageModel !== "qwen-image-edit" ? { size: size.replace("x", "*") } : {}) } },
    });
    const output = data.output?.choices?.flatMap(choice => choice.message?.content || []).find(item => item.image);
    return providerImage(output?.image);
  }
  if (kind === "volcengine") {
    const base = (config.baseURL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "").replace(/\/images\/generations$/, "");
    // Use a 2K-class canvas suitable for recent Seedream image-edit endpoints.
    const [width, height] = size.split("x").map(Number);
    const scale = Math.max(1, Math.sqrt(3686400 / (width * height)));
    const outputSize = `${Math.ceil(width * scale / 16) * 16}x${Math.ceil(height * scale / 16) * 16}`;
    const data = await jsonRequest(`${base}/images/generations`, { apiKey: config.apiKey, signal, body: {
      model: config.imageModel, prompt, size: outputSize, response_format: "b64_json", watermark: false,
      ...(inputs.length ? { image: inputs.length === 1 ? dataURL(inputs[0]) : inputs.map(dataURL) } : {}),
    } });
    const output = data.data?.[0];
    return providerImage(output?.b64_json ? `data:image/png;base64,${output.b64_json}` : output?.url);
  }
  throw new AppError("PROVIDER_CAPABILITY_UNSUPPORTED", 422);
}

// Persist the queue request ID before waiting. Workers can resume after a restart
// without submitting the same paid decomposition a second time.
export async function falRequest(channel, input, { signal, requestId, onSubmitted } = {}) {
  if (!channel?.apiKey || channel.kind !== "fal") throw new AppError("PROVIDER_UNAVAILABLE", 503);
  const base = (channel.baseURL || "https://fal.run").replace(/\/$/, "");
  if (!onSubmitted && !requestId) return jsonRequest(`${base}/${channel.model}`, { apiKey: channel.apiKey, scheme: "Key", body: input, signal });
  const queueBase = base === "https://fal.run" ? "https://queue.fal.run" : `${base}/queue`;
  const queuePath = channel.model.split("/").slice(0, 2).join("/");
  if (!requestId) {
    const submitted = await jsonRequest(`${queueBase}/${channel.model}`, { apiKey: channel.apiKey, scheme: "Key", body: input, signal });
    requestId = submitted.request_id;
    if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(requestId)) throw new AppError("INVALID_PROVIDER_TASK", 502);
    await onSubmitted(requestId);
  }
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(requestId)) throw new AppError("INVALID_PROVIDER_TASK", 502);
  for (;;) {
    const status = await jsonRequest(`${queueBase}/${queuePath}/requests/${requestId}/status`, { apiKey: channel.apiKey, scheme: "Key", method: "GET", signal });
    if (status.status === "COMPLETED") return jsonRequest(`${queueBase}/${queuePath}/requests/${requestId}`, { apiKey: channel.apiKey, scheme: "Key", method: "GET", signal });
    if (!["IN_QUEUE", "IN_PROGRESS"].includes(status.status)) throw new AppError("PROVIDER_REJECTED", 422);
    await delay(700, undefined, { signal });
  }
}

export async function segmentCloudImage(channel, image, selection, signal, selectionBytes) {
  if (channel?.kind === "volc-visual") return segmentVolcImage(channel, image, selection, signal, selectionBytes);
  const result = await falRequest(channel, { image_url: dataURL(image), prompt: "", apply_mask: false, output_format: "png", sync_mode: true, return_multiple_masks: true, max_masks: 3,
    ...(selection.box ? { box_prompts: [{ x_min: selection.box.left, y_min: selection.box.top, x_max: selection.box.left + selection.box.width, y_max: selection.box.top + selection.box.height, object_id: 1 }] } : {}),
    point_prompts: (selection.points || []).map(point => ({ ...point, object_id: 1 })),
  }, { signal });
  const meta = await sharp(image).metadata();
  const selected = selection.box && selectionBytes ? await maskPixels(selectionBytes, meta.width, meta.height) : null;
  const candidates = result.masks?.length ? result.masks : result.image ? [result.image] : [];
  let best = null, bestScore = -Infinity;
  for (const candidate of candidates) {
    if (!candidate?.url) continue;
    const bytes = await providerImage(candidate.url);
    const input = sharp(bytes, { limitInputPixels: 40000000 });
    const metadata = await input.metadata(), statistics = await input.stats();
    const transparent = metadata.hasAlpha && statistics.channels.at(-1).min < 255;
    const grayscale = transparent ? input.extractChannel("alpha") : input.removeAlpha().greyscale();
    const mask = await grayscale.resize(meta.width, meta.height, { fit: "fill" }).png().toBuffer();
    const pixels = await sharp(mask).greyscale().raw().toBuffer();
    const score = segmentMaskScore(pixels, selected, meta.width, meta.height, selection);
    if (score > bestScore) { best = mask; bestScore = score; }
  }
  if (!best) throw new AppError("SEGMENTATION_FAILED", 422);
  return best;
}

export async function splitCloudImage(channel, image, { numLayers = 4 } = {}, context = {}) {
  const result = await falRequest(channel, { image_url: dataURL(image), num_layers: numLayers, output_format: "png" }, context);
  if (!Array.isArray(result.images) || result.images.length < 2 || result.images.length > 16) throw new AppError("INVALID_LAYER_RESULT", 422);
  const images = [];
  let transparentLayers = 0;
  let sourceExtent;
  for (const file of result.images) {
    const bytes = await providerImage(file.url);
    const meta = await sharp(bytes, { limitInputPixels: 40000000 }).metadata();
    if (!meta.width || !meta.height) throw new AppError("INVALID_LAYER_RESULT", 422);
    sourceExtent ||= [meta.width, meta.height];
    if (meta.width !== sourceExtent[0] || meta.height !== sourceExtent[1]) throw new AppError("LAYER_SIZE_MISMATCH", 422);
    if (meta.hasAlpha && (await sharp(bytes).stats()).channels.at(-1).min < 255) transparentLayers++;
    images.push(await sharp(bytes).ensureAlpha().png().toBuffer());
  }
  if (!transparentLayers) throw new AppError("INVALID_LAYER_RESULT", 422);
  return images;
}
