import { BaseAdapter, toDataUri } from "./base.js";

export class FASHNAdapter extends BaseAdapter {
  constructor(config = {}) {
    super("fashn", config);
    this.apiKey = config.apiKey;
    this.baseUrl = "https://api.fashn.ai/v1";
  }

  async generateTryOn({ garmentImage, modelRef, category = "auto", onSubmitted }) {
    const response = await fetch(`${this.baseUrl}/run`, {
      method: "POST", signal: AbortSignal.timeout(30_000), redirect: "error",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model_name: this.config.model || "tryon-v1.6", inputs: { model_image: toDataUri(modelRef), garment_image: toDataUri(garmentImage), category } }),
    });
    if (!response.ok) { const error = new Error("Supplier rejected submission"); error.status = response.status; throw error; }
    const { id } = await response.json();
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(id)) throw new Error("Supplier response missing request ID");
    await onSubmitted(id);
    return { state: "pending", requestId: id };
  }

  async query(requestId) {
    if (!/^[a-zA-Z0-9_-]{1,256}$/.test(requestId)) throw new Error("Invalid supplier request ID");
    const response = await fetch(`${this.baseUrl}/status/${requestId}`, {
      signal: AbortSignal.timeout(20_000), redirect: "error", headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!response.ok) throw new Error("Supplier query unavailable");
    const data = await response.json();
    if (data.status === "completed") return { state: "succeeded", imageUrl: Array.isArray(data.output) ? data.output[0] : data.output, costUsd: 0.05 };
    if (data.status === "failed") return { state: "failed" };
    return { state: "pending" };
  }
}
