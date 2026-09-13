import { describe, expect, it, vi } from "vitest";
import { editThroughCompatibleGateway, OpenAIAdapter } from "../../src/lib/ai/adapters/openai.js";

const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

describe("OpenAI-compatible image edits", () => {
  it("uses repeated image fields for a custom Base URL", async () => {
    const fetcher = vi.fn(async (_url, options) => {
      expect([...options.body.keys()]).toEqual(["model", "prompt", "size", "quality", "image", "image", "image"]);
      expect(options.body.getAll("image")).toHaveLength(3);
      expect(options.headers.Authorization).toBe("Bearer platform-key");
      return new Response(JSON.stringify({ data: [{ b64_json: "result" }] }), { status: 200 });
    });
    const images = ["garment", "model", "scene"].map(name => new File([pixel], `${name}.png`, { type: "image/png" }));

    const response = await editThroughCompatibleGateway({
      baseURL: "https://gateway.example/v1/images/edits",
      apiKey: "platform-key",
      images,
      model: "gpt-image-2",
      prompt: "Fashion photo",
      size: "1024x1024",
      quality: "medium",
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith("https://gateway.example/v1/images/edits", expect.objectContaining({ method: "POST" }));
    expect(response.data[0].b64_json).toBe("result");
  });

  it("routes real generation through the gateway-compatible multipart request", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url, options) => {
      expect(options.body.getAll("image")).toHaveLength(2);
      expect(options.body.getAll("image[]")).toHaveLength(0);
      return new Response(JSON.stringify({ data: [{ b64_json: "result" }] }), { status: 200 });
    });
    try {
      const adapter = new OpenAIAdapter({ apiKey: "platform-key", baseURL: "https://gateway.example/v1", model: "gpt-image-2" });
      const result = await adapter.generateTryOn({ garmentImage: pixel, modelRef: pixel, prompt: "Fashion photo", size: "1024x1024", quality: "medium" });
      expect(result.imageBase64).toBe("result");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves provider status and message on rejection", async () => {
    await expect(editThroughCompatibleGateway({
      baseURL: "https://gateway.example/v1",
      apiKey: "platform-key",
      images: [new File([pixel], "image.png", { type: "image/png" })],
      model: "gpt-image-2",
      prompt: "Fashion photo",
      fetcher: async () => new Response(JSON.stringify({ error: { code: "blocked", message: "Request blocked" } }), { status: 403 }),
    })).rejects.toMatchObject({ status: 403, code: "blocked", message: "Request blocked" });
  });
});
