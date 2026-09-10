import { BaseAdapter } from "./base.js";

export class FASHNAdapter extends BaseAdapter {
  constructor(config = {}) {
    super("fashn", config);
    this.apiKey = config.apiKey || process.env.FASHN_API_KEY;
    this.baseUrl = "https://api.fashn.ai/v1";
  }

  async generateTryOn({ garmentImage, modelRef, category = "auto" }) {
    if (!garmentImage) throw new Error("garmentImage is required");
    if (!modelRef) throw new Error("FASHN requires a model reference image");

    // FASHN API：提交任务 → 轮询结果
    const submitRes = await fetch(`${this.baseUrl}/run`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_image: modelRef,
        garment_image: garmentImage,
        category,
      }),
    });
    if (!submitRes.ok) {
      const err = await submitRes.json().catch(() => ({}));
      throw new Error(`FASHN submit error: ${err.error || submitRes.status}`);
    }
    const { id: jobId } = await submitRes.json();
    if (!jobId) throw new Error("FASHN returned no job id");

    // 轮询（FASHN 通常 10-30s，最多等 120s）
    const startedAt = Date.now();
    while (Date.now() - startedAt < 120_000) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await fetch(`${this.baseUrl}/status/${jobId}`, {
        headers: { "Authorization": `Bearer ${this.apiKey}` },
      });
      if (!statusRes.ok) throw new Error(`FASHN status error: ${statusRes.status}`);
      const data = await statusRes.json();
      if (data.status === "completed") {
        return { imageBase64: null, imageUrl: data.output, costUsd: 0.05, raw: { jobId } };
      }
      if (data.status === "failed") {
        throw new Error(`FASHN job failed: ${data.error || "unknown"}`);
      }
    }
    throw new Error("FASHN job timed out after 120s");
  }

  async healthCheck() {
    return { ok: !!this.apiKey, provider: "fashn" };
  }
}
