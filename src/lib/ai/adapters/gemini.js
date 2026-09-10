import { GoogleGenerativeAI } from "@google/generative-ai";
import { BaseAdapter, toInlineData } from "./base.js";

const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-preview-image-generation";

export class GeminiAdapter extends BaseAdapter {
  constructor(config = {}) {
    super("gemini", config);
    this.genAI = new GoogleGenerativeAI(config.apiKey || process.env.GOOGLE_GEMINI_API_KEY);
  }

  async generateTryOn({ garmentImage, modelRef, sceneRef, prompt }) {
    if (!garmentImage) throw new Error("garmentImage is required");
    if (!prompt) throw new Error("prompt is required");

    const model = this.genAI.getGenerativeModel({
      model: GEMINI_IMAGE_MODEL,
      generationConfig: { responseModalities: ["image", "text"] },
    });

    const parts = [{ text: prompt }];

    const garment = await toInlineData(garmentImage);
    parts.push({ inlineData: garment });
    if (modelRef) parts.push({ inlineData: await toInlineData(modelRef) });
    if (sceneRef) parts.push({ inlineData: await toInlineData(sceneRef) });

    const result = await model.generateContent(parts);
    const imagePart = result.response.candidates?.[0]?.content?.parts?.find(
      p => p.inlineData?.mimeType?.startsWith("image/")
    );
    if (!imagePart) throw new Error("Gemini 未返回图片");

    return {
      imageBase64: imagePart.inlineData.data,
      imageUrl: null,
      costUsd: 0.04,
      raw: { model: GEMINI_IMAGE_MODEL },
    };
  }

  async healthCheck() {
    return { ok: true, provider: "gemini", note: "no cheap ping API, assumed ok" };
  }
}
