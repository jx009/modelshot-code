import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveStudioConfig, capabilities } from "../../src/lib/domain/studio/providers.js";
import { encryptSecret } from "../../src/lib/crypto.js";

let rows;
beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("STUDIO_TOOLS_URL", "");
  rows = [
    { name: "public", kind: "openai", displayName: "Public", creditCost: 8, config: { scope: "public", model: "image-public" } },
    { name: "repair", kind: "volcengine", displayName: "Private repair", creditCost: 50, config: { scope: "tool", model: "ep-repair" } },
    { name: "segment", kind: "fal", displayName: "Private mask", config: { studioCapability: "segment", model: "fal-ai/sam-3/image" } },
    { name: "layers", kind: "fal", displayName: "Private layers", config: { studioCapability: "split", model: "fal-ai/qwen-image-layered" } },
    { name: "llm", kind: "dashscope", displayName: "Private language", isPlanner: true, creditCost: 3, config: { scope: "language", studioCapability: "language", model: "qwen-vl-plus" } },
  ].map(row => ({ ...row, config: JSON.stringify({ ...row.config, apiKeyEnc: encryptSecret(`${row.name}-secret`) }) }));
});
afterEach(() => vi.unstubAllEnvs());

describe("administrator tool routing", () => {
  it("uses dedicated repair and segmentation regardless of the user's image model", async () => {
    const settings = [{ toolId: "move", creditCost: 11, routing: { mode: "dedicated", channelName: "repair", segmentMode: "dedicated", segmentChannelName: "segment" } }];
    const config = resolveStudioConfig(rows, settings, "public", "image", "move");
    expect(config).toMatchObject({ imageProvider: "repair", imageModel: "ep-repair", apiKey: "repair-secret", segmentChannel: { name: "segment", apiKey: "segment-secret" } });
    const db = { modelProvider: { findMany: async () => rows }, studioToolConfig: { findMany: async () => settings } };
    const caps = await capabilities(db, resolveStudioConfig(rows));
    expect(caps.tools.find(t => t.id === "move")).toMatchObject({ cost: 11, available: true });
    expect(caps.tools.find(t => t.id === "describe").cost).toBe(3);
    expect(caps.imageModels.map(m => m.id)).toEqual(["public"]);
    expect(JSON.stringify(caps)).not.toMatch(/secret|Private|ep-repair|fal-ai|qwen/);
  });
  it("supports inherited images, backend split routing and legacy local settings", () => {
    expect(resolveStudioConfig(rows, [], "public", "image", "erase").imageProvider).toBe("public");
    const settings = [{ toolId: "split", routing: { mode: "dedicated", channelName: "layers" } }, { toolId: "move", routing: { mode: "inherit", segmentMode: "local" } }];
    expect(resolveStudioConfig(rows, settings, "public", "image", "split").splitChannel.name).toBe("layers");
    expect(resolveStudioConfig(rows, settings, "public", "image", "move").segmentChannel.name).toBe("segment");
    expect(() => resolveStudioConfig(rows, [], "repair")).toThrow("PROVIDER_CAPABILITY_UNSUPPORTED");
    expect(() => resolveStudioConfig(rows, [{ toolId: "move", routing: { mode: "dedicated", channelName: "deleted" } }], "public", "image", "move")).toThrow("PROVIDER_CAPABILITY_UNSUPPORTED");
  });
  it("resolves the pinned provider without rerouting a queued job to current tool settings", () => {
    const settings = [{ toolId: "move", routing: { mode: "dedicated", channelName: "deleted" } }];
    expect(resolveStudioConfig(rows, settings, "repair", "image", null, { pinned: true }).imageProvider).toBe("repair");
    const llm = resolveStudioConfig(rows);
    expect(llm).toMatchObject({ chatModel: "qwen-vl-plus", visionApiKey: "llm-secret", visionBaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", plannerCreditCost: 3 });
    const ark = rows.map(row => row.name === "llm" ? { ...row, kind: "volcengine" } : row);
    expect(resolveStudioConfig(ark).visionBaseURL).toBe("https://ark.cn-beijing.volces.com/api/v3");
  });
});
