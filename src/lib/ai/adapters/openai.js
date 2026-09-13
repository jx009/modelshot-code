import OpenAI from "openai";
import { BaseAdapter, toFileObject } from "./base.js";
import { getModel } from "../model-registry.js";

function normalizeBaseURL(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    // Admins often paste the complete generations URL from a gateway's docs.
    // The SDK appends /images/edits itself, so keep only the API prefix.
    url.pathname = url.pathname.replace(/\/images\/(?:generations|edits)\/?$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

function providerError(response, payload) {
  const detail = payload?.error?.message || payload?.error || payload?.message || response.statusText || "Provider rejected request";
  const error = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  error.status = response.status;
  error.code = payload?.error?.code;
  error.error = payload?.error;
  return error;
}

export async function editThroughCompatibleGateway({ baseURL, apiKey, images, mask, model, prompt, size, quality, signal, fetcher = fetch }) {
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  if (size) form.append("size", size);
  if (quality) form.append("quality", quality);
  for (const image of images) form.append("image", image, image.name);
  if (mask) form.append("mask", mask, mask.name);
  const response = await fetcher(`${normalizeBaseURL(baseURL)}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    body: form,
    signal,
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) throw providerError(response, payload);
  return payload;
}

export class OpenAIAdapter extends BaseAdapter {
  constructor(config = {}) {
    super("openai", config);
    // 管理端数据库配置优先，环境变量作为部署兜底；baseURL 支持 OpenAI 兼容中转站。
    this.client = new OpenAI({
      maxRetries: 0,
      timeout: 120_000,
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
      ...(config.baseURL ? { baseURL: normalizeBaseURL(config.baseURL) } : {}),
    });
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.baseURL = config.baseURL ? normalizeBaseURL(config.baseURL) : null;
    this.modelOverride = config.model || null; // 中转站自定义模型名（如 gpt-4o-image-vip）
    this.costMap = getModel("openai").costPerImage;
  }

  async generateTryOn({ garmentImage, modelRef, sceneRef, referenceImages = [], prompt, size = "1024x1536", quality = "high", signal }) {
    if (!garmentImage) throw new Error("garmentImage is required");
    if (!prompt) throw new Error("prompt is required");

    // 收集参考图（gpt-image-2 支持多张参考图，服装图必须是第一张）
    const images = [await toFileObject(garmentImage, "garment")];
    if (modelRef) images.push(await toFileObject(modelRef, "model"));
    if (sceneRef) images.push(await toFileObject(sceneRef, "scene"));
    for (const [index, reference] of referenceImages.entries()) {
      images.push(await toFileObject(reference.image, `${reference.role || "reference"}-${index + 1}`));
    }

    const input = {
      model: this.modelOverride || "gpt-image-2",
      image: images,
      prompt,
      size,
      quality,
    };
    // OpenAI-compatible gateways commonly follow their curl contract and
    // expect repeated `image` parts. The OpenAI SDK encodes arrays as
    // `image[]`, which some gateways reject before the model sees the request.
    const response = this.baseURL
      ? await editThroughCompatibleGateway({ baseURL: this.baseURL, apiKey: this.apiKey, images, model: input.model, prompt, size, quality, signal })
      : await this.client.images.edit(input, { signal });

    const imageData = response.data?.[0];
    if (!imageData?.b64_json && !imageData?.url) {
      throw new Error("OpenAI returned no image data");
    }
    return {
      imageBase64: imageData.b64_json || null,
      imageUrl: imageData.url || null,
      costUsd: this.costMap[size]?.[quality] || 0.08,
      raw: { model: response.model, created: response.created },
    };
  }

  async inpaint({ image, mask, prompt, size = "1024x1024" }) {
    const source = await toFileObject(image, "image");
    const maskFile = mask ? await toFileObject(mask, "mask") : undefined;
    const model = this.modelOverride || "gpt-image-2";
    const response = this.baseURL
      ? await editThroughCompatibleGateway({ baseURL: this.baseURL, apiKey: this.apiKey, images: [source], mask: maskFile, model, prompt, size })
      : await this.client.images.edit({ model, image: source, mask: maskFile, prompt, size });
    return {
      imageBase64: response.data[0]?.b64_json || null,
      imageUrl: response.data[0]?.url || null,
      costUsd: this.costMap[size]?.medium || 0.04,
      raw: { model: response.model },
    };
  }

  async healthCheck() {
    try {
      await this.client.models.list();
      return { ok: true, provider: "openai" };
    } catch (e) {
      return { ok: false, provider: "openai", error: e.message };
    }
  }
}
