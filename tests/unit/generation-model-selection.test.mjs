import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { capabilities, resolveStudioConfig } from "../../src/lib/domain/studio/providers.js";
import { executeStudio } from "../../src/lib/domain/studio/execution.js";
import { channelScope, validChannel } from "../../src/lib/studio/model-channels.js";
import { videoModelOffer } from "../../src/lib/video/model-choice.js";
import { videoDocumentSchema } from "../../src/lib/video/schema.js";
import { contentRunSchema } from "../../src/lib/creation/contracts/content-runs.js";
import { posterImageChoice } from "../../src/lib/creation/poster-image-choice.js";

const execution = vi.hoisted(() => ({ claim: vi.fn(), finish: vi.fn(), defer: vi.fn() }));
vi.mock("../../src/lib/crypto.js", () => ({ decryptSecret: value => value }));
vi.mock("../../src/lib/domain/billing/resolution-pricing.js", () => ({ getResolutionSurcharges: async () => ({ "1K": 2, "2K": 3, "4K": 4 }) }));
vi.mock("../../src/lib/domain/generation/execution.js", () => ({ claimOutput: execution.claim, finishOutput: execution.finish, deferOutput: execution.defer, safeProviderError: error => error.code }));

const channel = (name, capability, cost, extra = {}) => ({ name, kind: capability === "video" ? "volcengine" : "openai", displayName: name, creditCost: cost,
  config: JSON.stringify({ studioCapability: capability, scope: "public", model: `${name}-model`, apiKeyEnc: `${name}-secret`, ...extra }) });
const rows = () => [channel("image", "image", 6, { model: "gpt-image-2" }), channel("video-default", "video", 11, { studioDefault: true }), channel("video-other", "video", 24)];
const database = providers => ({ modelProvider: { findMany: vi.fn(async () => providers) }, studioToolConfig: { findMany: vi.fn(async () => []) } });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("STUDIO_TOOLS_URL", ""); vi.stubEnv("ARK_API_KEY", "legacy-key"); vi.stubEnv("ARK_VIDEO_MODEL", "legacy-model"); vi.stubEnv("ARK_BASE_URL", "https://legacy.example/v3"); });
afterEach(() => vi.unstubAllEnvs());

it("configures only supported video protocols without exposing them as image channels", () => {
  expect(validChannel("volcengine", { studioCapability: "video", scope: "public", model: "endpoint" })).toBe(true);
  expect(validChannel("openai", { studioCapability: "video", scope: "public", model: "endpoint" })).toBe(false);
  expect(validChannel("openai", { studioCapability: "video", scope: "public", model: "third-party-model", baseURL: "https://gateway.example/v1" })).toBe(true);
  expect(validChannel("dashscope", { studioCapability: "video", scope: "public", model: "wan-custom" })).toBe(true);
  expect(validChannel("volcengine", { studioCapability: "video", scope: "public", model: "" })).toBe(false);
  expect(channelScope(rows()[1])).toBe("public");
  expect(resolveStudioConfig(rows(), [], "video-other", "video", "video")).toMatchObject({ imageProvider: "image", videoProvider: "video-other", videoModel: "video-other-model", videoKey: "video-other-secret", videoCreditCost: 24 });
  expect(() => resolveStudioConfig(rows(), [], "removed", "video", "video")).toThrow("PROVIDER_CAPABILITY_UNSUPPORTED");
});

it("quotes the selected video channel and lists credential-free models separately", async () => {
  const config = resolveStudioConfig(rows(), [], "video-other", "video", "video");
  const caps = await capabilities(database(rows()), config);
  expect(caps.tools.find(tool => tool.id === "video")).toMatchObject({ cost: 24, available: true });
  expect(caps.imageModels.map(model => model.id)).toEqual(["image"]);
  expect(caps.videoModels).toMatchObject([{ id: "video-default", label: "video-default", cost: 11, durations: [5, 10] }, { id: "video-other", label: "video-other", cost: 24 }]);
  expect(JSON.stringify(caps)).not.toContain("secret");
});

it("resolves third-party video credentials, custom model IDs and per-channel limits", async () => {
  const custom = { ...channel("gateway", "video", 35, { model: "vendor-custom-model", baseURL: "https://vendor.example/proxy/v1", videoDurations: [8, 12], videoInputMode: "image" }), kind: "openai" };
  const providers = [...rows(), custom];
  const selected = resolveStudioConfig(providers, [], "gateway", "video", "video");
  expect(selected).toMatchObject({ videoKind: "openai", videoURL: "https://vendor.example/proxy/v1", videoKey: "gateway-secret", videoModel: "vendor-custom-model", videoOptions: { durations: [8, 12], inputMode: "image" } });
  const caps = await capabilities(database(providers), selected);
  expect(caps.videoModels.find(model => model.id === "gateway")).toMatchObject({ cost: 35, durations: [8, 12], inputMode: "image" });
  expect(caps.imageModels.map(model => model.id)).toEqual(["image"]);
  expect(caps.tools.find(tool => tool.id === "video")).toMatchObject({ cost: 35, available: true });
  expect(JSON.stringify(caps)).not.toContain("gateway-secret");
});

it("quotes public image models by their own price and never replaces a missing selection", async () => {
  const caps = await capabilities(database(rows()), undefined, undefined, { imageOnly: true });
  expect(caps.imageModels[0].prices["1024x1536"]).toBe(8);
  expect(posterImageChoice({ imageModels: caps.imageModels.map(model => ({ ...model, provider: model.id })) }, "1080x1440", "image")).toEqual({ provider: "image", size: "1024x1536", expectedCost: 8 });
  expect(posterImageChoice({ posterImage: { prices: { "1024x1536": 1 } }, imageModels: [] }, "1080x1440", "removed")).toBeNull();
});

it("keeps legacy environment jobs pinned after administrators add video models", () => {
  expect(resolveStudioConfig(rows(), [], undefined, "video", null, { pinned: true })).toMatchObject({ videoProvider: null, videoModel: "legacy-model", videoKey: "legacy-key", videoURL: "https://legacy.example/v3" });
  expect(resolveStudioConfig(rows(), [], undefined, "video", "video")).toMatchObject({ videoProvider: "video-default" });
});

it("retains model choices in video documents and slide requests without generating poster steps", () => {
  expect(videoDocumentSchema.parse({ mode: "video", provider: "video-other" }).provider).toBe("video-other");
  const request = contentRunSchema.parse({ kind: "slides", prompt: "A pitch deck", width: 1920, height: 1080, pageCount: 5, maxCredits: 12, imageProvider: "image" });
  expect(request.imageProvider).toBe("image");
  expect(request.image).toBeUndefined();
});

it("does not offer unavailable selected models or charge the default model price", () => {
  const caps = { videoProvider: "first", tools: [{ id: "video", available: true, cost: 11 }], videoModels: [{ id: "first", available: true, cost: 11 }, { id: "second", available: true, cost: 24 }] };
  expect(videoModelOffer(caps, "second")).toMatchObject({ provider: "second", available: true, cost: 24 });
  expect(videoModelOffer(caps, "removed").available).toBe(false);
  expect(videoModelOffer({ tools: caps.tools })).toEqual(caps.tools[0]);
});

it("polls the snapshotted video model even when its configured model changes", async () => {
  const db = { ...database(rows()), tryOn: { findUnique: vi.fn(async () => ({ fence: 1 })) }, generationAttempt: { update: vi.fn() } };
  execution.claim.mockResolvedValue({ output: { fence: 1, snapshot: { tool: "video", videoProvider: "video-other", videoModel: "original-model", videoBaseURL: "https://ark.cn-beijing.volces.com/api/v3", videoKind: "volcengine", params: { prompt: "A scene" } } }, attempt: { id: "attempt", requestId: "remote-task" }, reconcile: false });
  const video = vi.fn(async () => ({ state: "pending", requestId: "remote-task" }));
  await executeStudio("job", { db, store: {}, adapters: { video } });
  expect(video).toHaveBeenCalledWith(expect.objectContaining({ videoKey: "video-other-secret", videoModel: "original-model" }), expect.objectContaining({ requestId: "remote-task" }));
  expect(execution.defer).toHaveBeenCalled();
});

it("rejects endpoint changes instead of polling a different video service", async () => {
  const db = { ...database(rows()), tryOn: { findUnique: vi.fn(async () => ({ fence: 1 })) }, generationAttempt: { findUnique: vi.fn(async () => ({ state: "claimed" })) } };
  execution.claim.mockResolvedValue({ output: { fence: 1, snapshot: { tool: "video", videoProvider: "video-other", videoModel: "original-model", videoBaseURL: "https://original.example/v3", videoKind: "volcengine", params: {} } }, attempt: { id: "attempt", requestId: "remote-task" }, reconcile: false });
  const video = vi.fn();
  await executeStudio("job", { db, store: {}, adapters: { video } });
  expect(video).not.toHaveBeenCalled();
  expect(execution.finish).toHaveBeenCalledWith("job", 1, { errorCode: "PROVIDER_CONFIGURATION_CHANGED" }, db);
});
