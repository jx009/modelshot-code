import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { entityLayers, selectEntityMask, signedVisualHeaders } from "../../src/lib/domain/studio/volc-visual.js";
import { splitCloudImage } from "../../src/lib/domain/studio/cloud.js";
import { selectionPrompt, extractObject } from "../../src/lib/domain/studio/segmentation.js";
import { resolveStudioConfig, capabilities } from "../../src/lib/domain/studio/providers.js";
import { encryptSecret } from "../../src/lib/crypto.js";
import { channelCapability, channelScope, segmentChannelReady, splitChannelReady, supportsChannelCapability, validChannel } from "../../src/lib/studio/model-channels.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Volcengine EntitySegment", () => {
  it("splits visible entities once and preserves every pixel, alpha and boundary in aligned layers", async () => {
    const width = 6, height = 4;
    const labels = Buffer.from([0, 1, 1, 1, 1, 1, 1, 2, 2, 1, 3, 3, 1, 2, 2, 1, 3, 3, 1, 1, 1, 1, 1, 0]);
    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0; i < labels.length; i++) {
      rgba.set([i * 7, 255 - i * 5, 90, i === 10 ? 128 : i === 23 ? 0 : 255], i * 4);
    }
    const source = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const map = await sharp(labels, { raw: { width, height, channels: 1 } }).toColourspace("b-w").png().toBuffer();
    const fetch = vi.fn().mockResolvedValue(Response.json({ code: 10000, data: { algorithm_base_resp: { status_code: 0 }, binary_data_base64: [map.toString("base64")] } }));
    vi.stubGlobal("fetch", fetch);
    const submitted = vi.fn();
    const layers = await splitCloudImage({ kind: "volc-visual", model: "entity_seg", accessKeyId: "test-ak", secretAccessKey: "test-sk" }, source, { numLayers: 2 }, { onSubmitted: submitted });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get("Action")).toBe("EntitySegment");
    expect(submitted).not.toHaveBeenCalled();
    expect(layers).toHaveLength(4); // Automatic count, not the Qwen numLayers parameter.
    const rawLayers = [];
    for (const bytes of layers) {
      expect(await sharp(bytes).metadata()).toMatchObject({ width, height, hasAlpha: true });
      rawLayers.push(await sharp(bytes).raw().toBuffer());
    }
    for (let i = 0; i < labels.length; i++) {
      const visible = rawLayers.filter(layer => layer[i * 4 + 3] > 0);
      expect(visible.length).toBe(rgba[i * 4 + 3] ? 1 : 0);
      if (visible.length) expect([...visible[0].subarray(i * 4, i * 4 + 4)]).toEqual([...rgba.subarray(i * 4, i * 4 + 4)]);
    }
    expect(rawLayers[0][3]).toBe(255); // Unassigned label zero is retained at the bottom.
    const empty = await sharp(Buffer.alloc(width * height), { raw: { width, height, channels: 1 } }).toColourspace("b-w").png().toBuffer();
    await expect(entityLayers(source, empty)).rejects.toThrow("NO_SEPARABLE_OBJECTS");
    await expect(entityLayers(source, source)).rejects.toThrow("INVALID_SEGMENT_RESULT");
    await expect(entityLayers(source, map, AbortSignal.abort())).rejects.toThrow();
  });

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
    expect(supportsChannelCapability(row, "segment")).toBe(true);
    expect(supportsChannelCapability(row, "split")).toBe(true);
    expect(supportsChannelCapability(row, "image")).toBe(false);
    expect(supportsChannelCapability({ kind: "fal", config: JSON.stringify({ model: "fal-ai/sam-3/image" }) }, "split")).toBe(false);
    expect(splitChannelReady(config.segmentChannel)).toBe(true);
    expect(splitChannelReady({ kind: "volc-visual", accessKeyId: "ak-private" })).toBe(false);
    expect(validChannel("volc-visual", JSON.parse(row.config))).toBe(true);
    expect(validChannel("volc-visual", { model: "other", scope: "tool", studioCapability: "segment" })).toBe(false);
    const db = { modelProvider: { findMany: async () => rows }, studioToolConfig: { findMany: async () => settings } };
    const published = await capabilities(db, resolveStudioConfig(rows));
    expect(published.tools.find(tool => tool.id === "move").available).toBe(true);
    expect(published.tools.find(tool => tool.id === "split")).toMatchObject({ available: true, layerCountMode: "auto" });
    expect(published.imageModels.map(item => item.id)).toEqual(["image"]);
    expect(JSON.stringify(published)).not.toMatch(/ak-private|sk-private|volc-mask/);
    vi.unstubAllEnvs();
  });

  it("reuses the configured AK/SK channel for split routing and pinned worker execution", () => {
    vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
    const visual = { name: "shared-visual", kind: "volc-visual", config: JSON.stringify({ model: "entity_seg", scope: "tool", studioCapability: "segment", studioDefault: true, accessKeyIdEnc: encryptSecret("ak"), secretAccessKeyEnc: encryptSecret("sk") }) };
    const layered = { name: "qwen", kind: "fal", config: JSON.stringify({ model: "fal-ai/qwen-image-layered", studioCapability: "split", studioDefault: true, apiKeyEnc: encryptSecret("fal-key") }) };
    const rows = [visual, layered];
    expect(resolveStudioConfig(rows).splitChannel.name).toBe("qwen"); // Keep explicit split defaults.
    expect(resolveStudioConfig([visual]).splitChannel.name).toBe("shared-visual");
    const settings = [{ toolId: "split", routing: { mode: "dedicated", channelName: visual.name } }];
    expect(resolveStudioConfig(rows, settings, undefined, "image", "split").splitChannel).toMatchObject({ name: visual.name, accessKeyId: "ak", secretAccessKey: "sk" });
    expect(resolveStudioConfig(rows, [], visual.name, "split", null, { pinned: true, skipPreview: true }).splitChannel.name).toBe(visual.name);
    expect(() => resolveStudioConfig(rows, [], visual.name, "image")).toThrow("PROVIDER_CAPABILITY_UNSUPPORTED");
  });

  it("signs with a stable, credential-free request shape", () => {
    const url = new URL("https://visual.volcengineapi.com/?Action=EntitySegment&Version=2022-08-31");
    const headers = signedVisualHeaders(url, "{}", "test-ak", "test-sk", new Date("2026-01-01T00:00:00Z"));
    expect(headers["X-Date"]).toBe("20260101T000000Z");
    expect(headers.Authorization).toMatch(/^HMAC-SHA256 Credential=test-ak\/20260101\/cn-north-1\/cv\/request, SignedHeaders=host;x-content-sha256;x-date, Signature=[0-9a-f]{64}$/);
    expect(headers.Authorization).not.toContain("test-sk");
  });
});
