import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import sharp from "sharp";
import { capabilities, generateImage, studioConfig, videoRequest, vision } from "../../src/lib/domain/studio/providers.js";

afterEach(() => vi.unstubAllEnvs());

let server, base, png;
const calls = [];
beforeAll(async () => {
  png = await sharp({ create: { width: 4, height: 4, channels: 4, background: "red" } }).png().toBuffer();
  server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    calls.push({ path: req.url, method: req.method, contentType: req.headers["content-type"], body, authorization: req.headers.authorization });
    res.setHeader("Content-Type", "application/json");
    if (req.url.endsWith("/tasks/remote-id")) return res.end(JSON.stringify({ status: "succeeded", content: { video_url: "https://example.com/result.mp4" } }));
    if (req.url.endsWith("/tasks")) return res.end(JSON.stringify({ id: "remote-id" }));
    if (req.url.endsWith("/chat/completions")) return res.end(JSON.stringify({ choices: [{ message: { content: "Image description" } }] }));
    res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

describe("studio real HTTP protocol against isolated fixture", () => {
  it("separates image model aliases from the selected planning model", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-key");
    const db = { modelProvider: { findMany: vi.fn().mockResolvedValue([
      { name: "image-pro", kind: "openai", displayName: "ModelShot Pro", creditCost: 7, isDefault: true, isPlanner: false, priority: 1, config: JSON.stringify({ model: "gpt-image-2" }) },
      { name: "planner", kind: "openai", displayName: "Visual Director", creditCost: 3, isDefault: false, isPlanner: true, priority: 2, config: JSON.stringify({ model: "unused-image", chatModel: "gpt-4.1-mini" }) },
    ]), }, studioToolConfig: { findMany: vi.fn().mockResolvedValue([{ toolId: "upscale", creditCost: 9, isEnabled: true }]) } };
    const config = await studioConfig(db);
    expect(config).toMatchObject({ imageProvider: "image-pro", imageModel: "gpt-image-2", imageDisplayName: "ModelShot Pro", chatModel: "gpt-4.1-mini", plannerDisplayName: "Visual Director" });
    const caps = await capabilities(db, config);
    expect(caps.imageModels).toEqual([{ id: "image-pro", label: "ModelShot Pro", creditCost: 7 }, { id: "planner", label: "Visual Director", creditCost: 3 }]);
    expect(caps.chatModel).toBe("Visual Director");
    expect(caps.tools.find(tool => tool.id === "generate").cost).toBe(7);
    expect(caps.tools.find(tool => tool.id === "upscale").cost).toBe(9);
  });
  it("sends image and mask as multipart files to compatible gateway", async () => {
    expect(await generateImage({ apiKey: "fixture", baseURL: `${base}/v1`, imageModel: "image-model" }, { image: png, mask: png, prompt: "change", size: "1024x1024" })).toEqual(png);
    const request = calls.at(-1);
    expect(request.path).toBe("/v1/images/edits");
    expect(request.contentType).toContain("multipart/form-data");
    expect(request.body.toString()).toContain('name="mask"; filename="mask.png"');
    expect(request.body.toString()).toContain('name="image"; filename="image.png"');
  });
  it("sends actual selected pixels and bounded conversation to vision", async () => {
    expect(await vision({ apiKey: "fixture", baseURL: `${base}/v1`, chatModel: "vision-model" }, { image: png, instruction: "Describe only", messages: [{ role: "user", text: "What material?" }] })).toBe("Image description");
    const body = JSON.parse(calls.at(-1).body);
    expect(body.messages[1]).toEqual({ role: "user", content: "What material?" });
    expect(body.messages.at(-1).content[1].image_url.url).toBe(`data:image/png;base64,${png.toString("base64")}`);
  });
  it("sends product identity and style reference as distinct multipart images", async () => {
    await generateImage({ apiKey: "fixture", baseURL: `${base}/v1`, imageModel: "image-model" }, { image: png, references: [png], prompt: "Image 1 is product; image 2 is style", size: "1024x1536" });
    const body = calls.at(-1).body.toString();
    expect(body).toContain('filename="image.png"');
    expect(body).toContain('filename="style-reference-1.png"');
    expect(body.indexOf('filename="image.png"')).toBeLessThan(body.indexOf('filename="style-reference-1.png"'));
  });
  it("creates an Ark first-frame task and queries by the persisted remote ID", async () => {
    const config = { videoURL: base, videoKey: "fixture", videoModel: "endpoint-123" };
    expect(await videoRequest(config, { image: png, prompt: "Orbit", duration: 5 })).toEqual({ state: "pending", requestId: "remote-id" });
    const body = JSON.parse(calls.at(-1).body);
    expect(body.model).toBe("endpoint-123"); expect(body.content[1].role).toBe("first_frame");
    expect(await videoRequest(config, { requestId: "remote-id" })).toEqual({ state: "succeeded", url: "https://example.com/result.mp4" });
    expect(calls.at(-1).method).toBe("GET");
  });
});
