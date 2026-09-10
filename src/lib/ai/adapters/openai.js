import OpenAI from "openai";
import { BaseAdapter, toFileObject } from "./base.js";
import { getModel } from "../model-registry.js";

export class OpenAIAdapter extends BaseAdapter {
  constructor(config = {}) {
    super("openai", config);
    // 三级降级：config.apiKey（用户自带/DB 配置）> env；baseURL 支持 OpenAI 兼容中转站
    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    this.modelOverride = config.model || null; // 中转站自定义模型名（如 gpt-4o-image-vip）
    this.costMap = getModel("openai").costPerImage;
  }

  async generateTryOn({ garmentImage, modelRef, sceneRef, prompt, size = "1024x1536", quality = "high" }) {
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
    });

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
