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
    this.modelOverride = config.model || null; // 中转站自定义模型名（如 gpt-4o-image-vip）
    this.costMap = getModel("openai").costPerImage;
  }

  async generateTryOn({ garmentImage, modelRef, sceneRef, prompt, size = "1024x1536", quality = "high", signal }) {
    if (!garmentImage) throw new Error("garmentImage is required");
    if (!prompt) throw new Error("prompt is required");

    // 收集参考图（gpt-image-2 支持多张参考图，服装图必须是第一张）
    const images = [await toFileObject(garmentImage, "garment")];
    if (modelRef) images.push(await toFileObject(modelRef, "model"));
    if (sceneRef) images.push(await toFileObject(sceneRef, "scene"));

    const response = await this.client.images.edit({
      model: this.modelOverride || "gpt-image-2",
      image: images,
      prompt,
      size,
      quality,
    }, { signal });

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
    const response = await this.client.images.edit({
      model: this.modelOverride || "gpt-image-2",
      image: await toFileObject(image, "image"),
      mask: mask ? await toFileObject(mask, "mask") : undefined,
      prompt,
      size,
    });
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
