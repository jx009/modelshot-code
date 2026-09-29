import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { selectEntityMask, signedVisualHeaders } from "../../src/lib/domain/studio/volc-visual.js";
import { selectionPrompt, extractObject } from "../../src/lib/domain/studio/segmentation.js";
import { resolveStudioConfig, capabilities } from "../../src/lib/domain/studio/providers.js";
import { encryptSecret } from "../../src/lib/crypto.js";
import { channelCapability, channelScope, segmentChannelReady, validChannel } from "../../src/lib/studio/model-channels.js";

describe("Volcengine EntitySegment", () => {
  it("chooses a complete entity from a rectangle without clipping it to the box", async () => {
    const width = 20, height = 12;
    const labels = Buffer.alloc(width * height, 1);
    for (let y = 2; y < 11; y++) labels.fill(2, y * width + 4, y * width + 13);
    for (let y = 0; y < 4; y++) labels.fill(3, y * width + 16, y * width + 20);
    const map = await sharp(labels, { raw: { width, height, channels: 1 } }).toColourspace("b-w").png().toBuffer();
    const selection = Buffer.alloc(width * height);
    for (let y = 2; y < 8; y++) selection.fill(255, y * width + 5, y * width + 12);
    const rectangle = await sharp(selection, { raw: { width, height, channels: 1 } }).png().toBuffer();
    const prompt = await selectionPrompt(rectangle, width, height);
    const mask = await selectEntityMask(map, prompt, width, height, rectangle);
    const extracted = await extractObject(await sharp({ create: { width, height, channels: 3, background: "red" } }).png().toBuffer(), mask);
    expect(extracted.bounds).toEqual({ left: 4, top: 2, width: 9, height: 9 });
    const alpha = await sharp(mask).extractChannel(0).raw().toBuffer();
    expect(alpha[10 * width + 12]).toBe(255);
    expect(alpha[3 * width + 17]).toBe(0);
    expect(alpha[1 * width + 2]).toBe(0);
    await expect(selectEntityMask(map, prompt, width + 1, height, rectangle)).rejects.toThrow("INVALID_SEGMENT_RESULT");
  });

  it("keeps AK/SK encrypted, internal, and required together", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
    const row = { name: "volc-mask", kind: "volc-visual", displayName: "Volc mask", config: JSON.stringify({ model: "entity_seg", scope: "tool", studioCapability: "segment", accessKeyIdEnc: encryptSecret("ak-private"), secretAccessKeyEnc: encryptSecret("sk-private") }) };
    const rows = [{ name: "image", kind: "openai", displayName: "Image", config: JSON.stringify({ scope: "public", model: "gpt-image-2", apiKeyEnc: encryptSecret("image-private") }) }, row];
    const settings = [{ toolId: "move", routing: { mode: "inherit", segmentMode: "dedicated", segmentChannelName: row.name } }];
    const config = resolveStudioConfig(rows, settings, "image", "image", "move");
    expect(config.segmentChannel).toMatchObject({ kind: "volc-visual", accessKeyId: "ak-private", secretAccessKey: "sk-private" });
    expect(segmentChannelReady(config.segmentChannel)).toBe(true);
    expect(segmentChannelReady({ kind: "volc-visual", accessKeyId: "ak-private" })).toBe(false);
    expect(channelCapability(row)).toBe("segment");
    expect(channelScope(row)).toBe("tool");
    expect(validChannel("volc-visual", JSON.parse(row.config))).toBe(true);
    expect(validChannel("volc-visual", { model: "other", scope: "tool", studioCapability: "segment" })).toBe(false);
    const db = { modelProvider: { findMany: async () => rows }, studioToolConfig: { findMany: async () => settings } };
    const published = await capabilities(db, resolveStudioConfig(rows));
    expect(published.tools.find(tool => tool.id === "move").available).toBe(true);
    expect(published.imageModels.map(item => item.id)).toEqual(["image"]);
    expect(JSON.stringify(published)).not.toMatch(/ak-private|sk-private|volc-mask/);
    vi.unstubAllEnvs();
  });

  it("signs with a stable, credential-free request shape", () => {
    const url = new URL("https://visual.volcengineapi.com/?Action=EntitySegment&Version=2022-08-31");
    const headers = signedVisualHeaders(url, "{}", "test-ak", "test-sk", new Date("2026-01-01T00:00:00Z"));
    expect(headers["X-Date"]).toBe("20260101T000000Z");
    expect(headers.Authorization).toMatch(/^HMAC-SHA256 Credential=test-ak\/20260101\/cn-north-1\/cv\/request, SignedHeaders=host;x-content-sha256;x-date, Signature=[0-9a-f]{64}$/);
    expect(headers.Authorization).not.toContain("test-sk");
  });
});
