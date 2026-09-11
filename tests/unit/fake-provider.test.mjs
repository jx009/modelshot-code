import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { FakeProvider } from "../support/fake-provider.mjs";

describe("provider failure fixtures", () => {
  it("produces decodable image bytes after a retryable rejection", async () => {
    const provider = new FakeProvider(["rate_limit", "success"]);
    await expect(provider.generateTryOn({})).rejects.toMatchObject({ code: "RATE_LIMIT", retryable: true });
    const result = await provider.generateTryOn({});
    expect(await sharp(Buffer.from(result.imageBase64, "base64")).metadata()).toMatchObject({ width: 64, height: 96, format: "png" });
  });
  it("keeps an accepted request queryable when its response is lost", async () => {
    const provider = new FakeProvider(["lost_response"]);
    await expect(provider.submit({ idempotencyKey: "output-1" })).rejects.toMatchObject({ code: "TIMEOUT_AMBIGUOUS", retryable: false });
    const replay = await provider.submit({ idempotencyKey: "output-1" });
    expect(replay.state).toBe("pending");
    expect(provider.requests.size).toBe(1);
    provider.complete(replay.requestId);
    expect((await provider.query(replay.requestId)).state).toBe("succeeded");
  });
  it("does not complete an accepted cancellation", async () => {
    const provider = new FakeProvider(["delayed"]);
    const job = await provider.submit();
    expect(provider.cancel(job.requestId).state).toBe("cancelled");
    provider.complete(job.requestId);
    expect((await provider.query(job.requestId)).state).toBe("cancelled");
  });
  it("simulates malformed supplier output", async () => {
    const result = await new FakeProvider(["invalid_image"]).generateTryOn({});
    await expect(sharp(Buffer.from(result.imageBase64, "base64")).metadata()).rejects.toThrow();
  });
});
