import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { BaseAdapter } from "../../src/lib/ai/adapters/base.js";

export class FakeProviderError extends Error {
  constructor(code, { retryable = false, requestId = null } = {}) {
    super(code);
    this.code = code;
    this.retryable = retryable;
    this.requestId = requestId;
    this.status = code === "RATE_LIMIT" ? 429 : code === "INVALID_INPUT" ? 422 : undefined;
  }
}

// Test-only provider; deliberately absent from the application provider registry.
export class FakeProvider extends BaseAdapter {
  constructor(outcomes = ["success"]) {
    super("fake");
    this.outcomes = [...outcomes];
    this.requests = new Map();
    this.keys = new Map();
  }

  async submit({ idempotencyKey } = {}) {
    if (idempotencyKey && this.keys.has(idempotencyKey)) {
      return this.query(this.keys.get(idempotencyKey));
    }
    const outcome = this.outcomes.shift() || "success";
    if (outcome === "rate_limit") throw new FakeProviderError("RATE_LIMIT", { retryable: true });
    if (outcome === "failure") throw new FakeProviderError("INVALID_INPUT");
    const requestId = randomUUID();
    const pending = outcome === "lost_response" || outcome === "delayed";
    const record = { requestId, state: pending ? "pending" : "succeeded", outcome };
    this.requests.set(requestId, record);
    if (idempotencyKey) this.keys.set(idempotencyKey, requestId);
    if (outcome === "lost_response") {
      throw new FakeProviderError("TIMEOUT_AMBIGUOUS", { requestId });
    }
    return this.query(requestId);
  }

  async query(requestId) {
    const record = this.requests.get(requestId);
    if (!record) throw new FakeProviderError("NOT_FOUND");
    if (record.state !== "succeeded") return { requestId, state: record.state };
    const image = record.outcome === "invalid_image"
      ? Buffer.from("invalid image bytes")
      : await sharp({ create: { width: 64, height: 96, channels: 3, background: "#239b76" } }).png().toBuffer();
    return { requestId, state: "succeeded", imageBase64: image.toString("base64"), costUsd: 0 };
  }

  complete(requestId) {
    const record = this.requests.get(requestId);
    if (!record) throw new FakeProviderError("NOT_FOUND");
    if (record.state === "pending") record.state = "succeeded";
  }

  cancel(requestId) {
    const record = this.requests.get(requestId);
    if (!record) throw new FakeProviderError("NOT_FOUND");
    if (record.state === "pending") record.state = "cancelled";
    return { requestId, state: record.state };
  }

  async generateTryOn(params) {
    const result = await this.submit(params);
    if (params.onSubmitted) {
      await params.onSubmitted(result.requestId);
      return result;
    }
    if (result.state !== "succeeded") throw new FakeProviderError("PROVIDER_PENDING", { requestId: result.requestId });
    return result;
  }
}
