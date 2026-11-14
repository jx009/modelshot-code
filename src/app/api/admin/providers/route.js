import { z } from "zod";
import { randomUUID } from "node:crypto";
import { AppError, readJson, errorResponse } from "../../../../lib/http.js";
import { auditedOperation } from "../../../../lib/domain/identity/admin-operation.js";
import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/admin-auth";
import { invalidateProviderConfig, invokeModel } from "../../../../lib/ai/runner";
import { encryptSecret, decryptSecret, maskSecret } from "../../../../lib/crypto";
import { vision, studioConfig, generateImage } from "../../../../lib/domain/studio/providers";
import { segmentCloudImage, splitCloudImage } from "../../../../lib/domain/studio/cloud";
import { entityLabels } from "../../../../lib/domain/studio/volc-visual";
import { allowedProviderBaseURL, channelCapability, channelScope, validChannel } from "../../../../lib/studio/model-channels";
import sharp from "sharp";
import { recognizeText } from "../../../../lib/domain/studio/ocr.js";
import { upscaleVolcImage } from "../../../../lib/domain/studio/upscale.js";
import { synthesizeSpeech } from "../../../../lib/domain/studio/voice.js";
import { VIDEO_DURATIONS, videoModelOptions } from "../../../../lib/video/model-protocols.js";
import { GPTBEST_VIDEO_APIS, validVideoParameters } from "../../../../lib/video/gptbest-catalog.js";
import { videoVariantsSchema, videoFieldChoicesSchema } from "../../../../lib/video/variants.js";

const kindSchema = z.enum(["openai", "gemini", "fashn", "dashscope", "volcengine", "minimax", "volc-visual", "fal", "zzshu", "gptbest"]);
function assertVideoSettings(kind, config) {
  if (kind !== "gptbest" || config.studioCapability !== "video") return;
  const options = videoModelOptions(kind, config);
  if ((config.videoVariants || []).some(row => row.durations.some(value => !options.durations.includes(value)) || row.ratios.some(value => !options.ratios.includes(value)))) throw new AppError("VIDEO_VARIANT_UNSUPPORTED", 422);
  const keys = (options.fields || []).filter(field => !["sourceTaskId", "video_id"].includes(field.key)).map(field => field.key);
  if (Object.keys(config.videoFieldChoices || {}).some(key => !keys.includes(key))) throw new AppError("VIDEO_FIELDS_INVALID", 422);
}
const visualSecrets = { accessKeyId: z.string().max(4096).optional(), secretAccessKey: z.string().max(4096).optional() };
const channelFields = { scope: z.enum(["public", "tool", "language"]).optional(), studioCapability: z.enum(["image", "video", "segment", "split", "language", "ocr", "upscale", "voice"]).optional(),
  voiceOptions: z.object({ voices: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_.:-]{1,64}$/), label: z.string().trim().min(1).max(40) }).strict()).min(1).max(30) }).strict().optional(), imageMode: z.enum(["both", "generate", "edit"]).optional(), studioDefault: z.boolean().optional(),
  videoVariants: videoVariantsSchema.optional(), videoFieldChoices: videoFieldChoicesSchema.optional(),
  videoApi: z.enum(GPTBEST_VIDEO_APIS.map(api => api.id)).optional(), videoParameters: z.record(z.string(), z.json()).refine(validVideoParameters).optional(),
  videoInputMode: z.enum(["text", "image", "both"]).optional(), videoReferenceMode: z.enum(["first_frame", "reference_images"]).optional(), videoDurations: z.array(z.union(VIDEO_DURATIONS.map(value => z.literal(value)))).min(1).max(VIDEO_DURATIONS.length).refine(values => new Set(values).size === values.length).optional() };

/**
 * 模型提供商管理
 * GET    /api/admin/providers          → 列表（key 脱敏返回）
 * PATCH  /api/admin/providers          → 更新 { id, isActive?, isDefault?, priority?, displayName?, apiKey?, baseURL?, model? }
 *                                         apiKey 非空=加密覆盖；留空=不变更（前端明示）
 * POST   /api/admin/providers/test     → 测试连接（发一张最小测试图验证配置）
 */

/** config 解析为安全响应（key 永远脱敏） */
function safeConfig(configStr, row) {
  let cfg = {};
  try { cfg = configStr ? JSON.parse(configStr) : {}; } catch { cfg = {}; }
  const apiKey = cfg.apiKeyEnc ? decryptSecret(cfg.apiKeyEnc) : null;
  return {
    keyMasked: apiKey ? maskSecret(apiKey) : "",
    hasKey: Boolean(apiKey),
    hasAccessKey: Boolean(cfg.accessKeyIdEnc),
    hasSecretKey: Boolean(cfg.secretAccessKeyEnc),
    baseURL: cfg.baseURL || "",
    model: cfg.model || "",
    chatModel: cfg.chatModel || "",
    scope: channelScope(row, cfg), studioCapability: channelCapability(row, cfg), imageMode: cfg.imageMode || "both", studioDefault: Boolean(cfg.studioDefault),
    ...(channelCapability(row, cfg) === "video" ? { videoInputMode: videoModelOptions(row.kind, cfg)?.inputMode, videoDurations: videoModelOptions(row.kind, cfg)?.durations,
      ...(row.kind === "gptbest" ? { videoApi: videoModelOptions(row.kind, cfg).api, videoParameters: cfg.videoParameters || {}, videoVariants: cfg.videoVariants || [], videoFieldChoices: cfg.videoFieldChoices || {} } : {}),
      ...(row.kind === "zzshu" ? { videoReferenceMode: videoModelOptions(row.kind, cfg).referenceMode } : {}) } : {}),
    ...(channelCapability(row, cfg) === "voice" ? { voiceOptions: cfg.voiceOptions || { voices: [] } } : {}),
  };
}

function normalizeBaseURL(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    // Accept a pasted full endpoint such as /images/generations, then store
    // the prefix expected by the OpenAI SDK (which appends /images/edits).
    url.pathname = url.pathname.replace(/\/images\/(?:generations|edits)\/?$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

export async function GET(req) {
  const started = performance.now(), timings = [];
  let stage = "auth", stageStarted = started;
  const completeStage = () => {
    const now = performance.now();
    timings.push({ name: stage, duration: now - stageStarted });
    stageStarted = now;
  };
  const finish = response => {
    const total = performance.now() - started;
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Server-Timing", [...timings, { name: "total", duration: total }].map(item => `${item.name};dur=${item.duration.toFixed(1)}`).join(", "));
    if (total >= 1000) console.warn("[ADMIN_PROVIDERS_SLOW]", { status: response.status, stages: timings, totalMs: total });
    return response;
  };
  try {
    const auth = await requireAdmin(req);
    completeStage();
    if (auth.response) return finish(auth.response);
    stage = "query";
    const providers = await prisma.modelProvider.findMany({ orderBy: { priority: "asc" } });
    completeStage();
    stage = "serialize";
    const response = NextResponse.json(providers.map(provider => ({
      id: provider.id,
      name: provider.name,
      kind: provider.kind || provider.name,
      displayName: provider.displayName,
      isActive: provider.isActive,
      isDefault: provider.isDefault,
      isPlanner: provider.isPlanner,
      priority: provider.priority,
      creditCost: provider.creditCost,
      costPerImage: provider.costPerImage,
      config: safeConfig(provider.config, provider),
    })));
    completeStage();
    return finish(response);
  } catch (error) {
    completeStage();
    return finish(errorResponse(error));
  }
}

export async function PATCH(req) {
  try {
    const auth = await requireAdmin(req, "root");
    if (auth.response) return auth.response;
    const input = await readJson(req, z.object({ ...channelFields, ...visualSecrets, id: z.string().min(1).max(128), kind: kindSchema.optional(), isActive: z.boolean().optional(), isDefault: z.boolean().optional(), isPlanner: z.boolean().optional(), priority: z.number().int().min(0).max(1000).optional(), displayName: z.string().min(1).max(100).optional(), creditCost: z.number().int().min(0).max(100000).optional(), costPerImage: z.number().min(0).max(1000).optional(), apiKey: z.string().max(4096).optional(), baseURL: z.string().trim().max(500).optional(), model: z.string().max(128).optional(), chatModel: z.string().max(128).optional(), reason: z.string().min(3).max(500) }).strict());
    if (!allowedProviderBaseURL(input.baseURL)) throw new AppError("PROVIDER_BASE_URL_INVALID");
    const result = await auditedOperation(auth.user.id, req.headers.get("idempotency-key"), "UPDATE_PROVIDER", input, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('provider-config', 0))::text`;
      const existing = await tx.modelProvider.findUnique({ where: { id: input.id } });
      if (!existing) throw new AppError("PROVIDER_NOT_FOUND", 404);
      const cfg = JSON.parse(existing.config || "{}");
      if (input.apiKey?.trim()) cfg.apiKeyEnc = encryptSecret(input.apiKey.trim());
      if (input.accessKeyId?.trim()) cfg.accessKeyIdEnc = encryptSecret(input.accessKeyId.trim());
      if (input.secretAccessKey?.trim()) cfg.secretAccessKeyEnc = encryptSecret(input.secretAccessKey.trim());
      if (input.baseURL !== undefined) cfg.baseURL = normalizeBaseURL(input.baseURL);
      if (input.model !== undefined) cfg.model = input.model;
      if (input.chatModel !== undefined) cfg.chatModel = input.chatModel;
      const kind = input.kind || existing.kind || existing.name;
      for (const field of Object.keys(channelFields)) if (input[field] !== undefined) cfg[field] = input[field];
      if (kind !== "zzshu" || cfg.studioCapability !== "video") delete cfg.videoReferenceMode;
      if (kind !== "gptbest" || cfg.studioCapability !== "video") { delete cfg.videoApi; delete cfg.videoParameters; delete cfg.videoVariants; delete cfg.videoFieldChoices; }
      if (cfg.studioCapability !== "voice") delete cfg.voiceOptions;
      if (!validChannel(kind, cfg)) throw new AppError("PROVIDER_CAPABILITY_UNSUPPORTED", 422);
      assertVideoSettings(kind, cfg);
      if (kind === "volc-visual" && (!cfg.accessKeyIdEnc || !cfg.secretAccessKeyEnc)) throw new AppError(cfg.studioCapability === "upscale" ? "UPSCALE_NOT_CONFIGURED" : "SEGMENTATION_NOT_CONFIGURED", 422);
      if (cfg.studioCapability === "ocr" && !cfg.apiKeyEnc) throw new AppError("OCR_NOT_CONFIGURED", 422);
      if (cfg.studioCapability === "voice" && (!cfg.apiKeyEnc || !cfg.baseURL)) throw new AppError("VOICE_NOT_CONFIGURED", 422);
      if (channelScope({ kind }, cfg) !== "public" && channelCapability({ kind }, cfg) === "image") cfg.studioDefault = false;
      if (cfg.studioDefault) {
        const rows = await tx.modelProvider.findMany();
        for (const row of rows) if (row.id !== existing.id && channelCapability(row) === channelCapability({ kind }, cfg)) {
          const other = JSON.parse(row.config || "{}");
          if (other.studioDefault) await tx.modelProvider.update({ where: { id: row.id }, data: { config: JSON.stringify({ ...other, studioDefault: false }) } });
        }
      }
      if (input.isDefault) {
        if (channelCapability({ kind }, cfg) === "video") throw new AppError("PROVIDER_CAPABILITY_UNSUPPORTED", 422);
        if (!["openai", "gemini", "fashn"].includes(kind)) throw new AppError("PROVIDER_CAPABILITY_UNSUPPORTED", 422);
        await tx.modelProvider.updateMany({ data: { isDefault: false } });
      }
      if (input.isPlanner) {
        if (channelCapability({ kind }, cfg) !== "language") throw new AppError("PLANNER_PROVIDER_UNSUPPORTED");
        if (!cfg.model?.trim()) throw new AppError("VISION_NOT_CONFIGURED", 422);
        await tx.modelProvider.updateMany({ data: { isPlanner: false } });
      }
      await tx.modelProvider.update({ where: { id: input.id }, data: { kind: input.kind, isActive: input.isActive, isDefault: input.scope && input.scope !== "public" ? false : input.isDefault, isPlanner: channelCapability({ kind }, cfg) === "language" ? input.isPlanner : false, priority: input.priority, displayName: input.displayName, creditCost: input.creditCost, costPerImage: input.costPerImage, config: JSON.stringify(cfg) } });
      return { audit: { provider: existing.name, keyChanged: Boolean(input.apiKey || input.accessKeyId || input.secretAccessKey), fields: Object.keys(input).filter(key => !["apiKey", "accessKeyId", "secretAccessKey", "reason"].includes(key)) } };
    }, prisma, "root");
    invalidateProviderConfig();
    return Response.json(result);
  } catch (error) { return errorResponse(error); }
}

export async function PUT(req) {
  try {
    const auth = await requireAdmin(req, "root");
    if (auth.response) return auth.response;
    const input = await readJson(req, z.object({ ...channelFields, ...visualSecrets, kind: kindSchema, displayName: z.string().trim().min(1).max(100), model: z.string().trim().min(1).max(128), chatModel: z.string().trim().max(128).default(""), apiKey: z.string().max(4096).default(""), baseURL: z.string().trim().max(500).default(""), creditCost: z.number().int().min(0).max(100000).default(18), costPerImage: z.number().min(0).max(1000).default(0), reason: z.string().min(3).max(500) }).strict());
    if (!allowedProviderBaseURL(input.baseURL)) throw new AppError("PROVIDER_BASE_URL_INVALID");
    const result = await auditedOperation(auth.user.id, req.headers.get("idempotency-key"), "CREATE_PROVIDER", input, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('provider-config', 0))::text`;
      const priority = (await tx.modelProvider.aggregate({ _max: { priority: true } }))._max.priority || 0;
      const config = { model: input.model, ...(input.chatModel ? { chatModel: input.chatModel } : {}), ...(input.baseURL ? { baseURL: normalizeBaseURL(input.baseURL) } : {}), ...(input.apiKey.trim() ? { apiKeyEnc: encryptSecret(input.apiKey.trim()) } : {}) };
      for (const field of ["studioCapability", "imageMode", "scope", "videoInputMode", "videoDurations", "videoReferenceMode", "videoApi", "videoParameters", "videoVariants", "videoFieldChoices", "voiceOptions"]) if (input[field] !== undefined) config[field] = input[field];
      if (input.accessKeyId?.trim()) config.accessKeyIdEnc = encryptSecret(input.accessKeyId.trim());
      if (input.secretAccessKey?.trim()) config.secretAccessKeyEnc = encryptSecret(input.secretAccessKey.trim());
      if (input.kind === "volc-visual" && (!config.accessKeyIdEnc || !config.secretAccessKeyEnc)) throw new AppError(config.studioCapability === "upscale" ? "UPSCALE_NOT_CONFIGURED" : "SEGMENTATION_NOT_CONFIGURED", 422);
      if (config.studioCapability === "ocr" && !config.apiKeyEnc) throw new AppError("OCR_NOT_CONFIGURED", 422);
      if (config.studioCapability === "voice" && (!config.apiKeyEnc || !config.baseURL)) throw new AppError("VOICE_NOT_CONFIGURED", 422);
      if (!validChannel(input.kind, config) || input.studioDefault) throw new AppError("PROVIDER_CAPABILITY_UNSUPPORTED", 422);
      assertVideoSettings(input.kind, config);
      if (input.scope === "language") await tx.modelProvider.updateMany({ data: { isPlanner: false } });
      const row = await tx.modelProvider.create({ data: { isPlanner: input.scope === "language", name: `${input.kind}-${randomUUID().slice(0, 12)}`, kind: input.kind, displayName: input.displayName, priority: priority + 1, creditCost: input.creditCost, costPerImage: input.costPerImage, config: JSON.stringify(config) } });
      return { response: { id: row.id }, audit: { provider: row.name, kind: row.kind, displayName: row.displayName, keyConfigured: Boolean(input.apiKey || input.accessKeyId && input.secretAccessKey) } };
    }, prisma, "root");
    invalidateProviderConfig();
    return Response.json(result, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

/** 测试连接：用指定通道发一张最小成本的 dry-run + 真实 1x1 图（验证 key/baseURL/model 全链路） */
export async function POST(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const { id, mode = "image" } = await req.json();
    const provider = await prisma.modelProvider.findUnique({ where: { id } });
    if (!provider) return new NextResponse("Provider not found", { status: 404 });

    if (channelCapability(provider) === "video") throw new AppError("VIDEO_TEST_USE_WORKSPACE", 422);

    const started = Date.now();
    if (channelCapability(provider) === "voice") {
      // 真实合成一句很短的旁白，验证地址、密钥、模型与第一个音色。
      const config = await studioConfig(prisma, provider.name, "voice", null, { pinned: true });
      const bytes = await synthesizeSpeech(config.voiceChannel, { text: "测试配音。", voice: config.voiceChannel?.voiceOptions?.voices?.[0]?.id, signal: AbortSignal.timeout(60000) });
      return NextResponse.json({ ok: true, provider: provider.name, mode: "voice", bytes: bytes.length, durationMs: Date.now() - started });
    }
    if (mode === "planner" || channelCapability(provider) === "language") {
      const config = await studioConfig(prisma, provider.name, "language", null, { pinned: true });
      await vision(config, { instruction: "Return only the word OK.", messages: [{ role: "user", text: "Connection test" }], maxTokens: 8, signal: AbortSignal.timeout(30000) });
      return NextResponse.json({ ok: true, provider: provider.name, mode, durationMs: Date.now() - started });
    }
    if (["openai", "dashscope", "volcengine", "minimax", "volc-visual", "fal"].includes(provider.kind)) {
      const capability = channelCapability(provider);
      const config = await studioConfig(prisma, provider.name, capability, null, { pinned: true });
      const image = await sharp({ create: { width: 512, height: 512, channels: 4, background: "white" } })
        .composite([{ input: await sharp({ create: { width: 128, height: 128, channels: 4, background: "red" } }).png().toBuffer(), left: 192, top: 192 }]).png().toBuffer();
      const signal = AbortSignal.timeout(180000);
      if (capability === "ocr") {
        const sample = await sharp(Buffer.from('<svg width="512" height="256"><rect width="512" height="256" fill="white"/><text x="40" y="150" font-size="72" fill="black">TEST 123</text></svg>')).png().toBuffer();
        const result = await recognizeText(config.ocrChannel, sample, signal);
        if (!result.text.includes("123")) throw new AppError("OCR_TEST_FAILED", 422);
      }
      else if (capability === "upscale") await upscaleVolcImage(config.upscaleChannel, image, { scale: 2 }, signal);
      else if (provider.kind === "volc-visual") await entityLabels(config.segmentChannel, image, signal);
      else if (capability === "segment") await segmentCloudImage(config.segmentChannel, image, { box: { left: 190, top: 190, width: 132, height: 132 } }, signal);
      else if (capability === "split") await splitCloudImage(config.splitChannel, image, { numLayers: 2 }, { signal });
      else await generateImage(config, { ...(config.imageMode !== "generate" ? { image } : {}), prompt: "A red square on a white background.", size: "1024x1024", signal });
      return NextResponse.json({ ok: true, provider: provider.name, durationMs: Date.now() - started });
    }
    // 最小测试：小尺寸低质量，验证 key/baseURL/model 全链路
    const result = await invokeModel({
      provider: provider.name,
      garmentImage: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"), // 1x1 px
      prompt: "A plain white square. Test call.",
      size: "1024x1024",
      quality: "low",
    });

    return NextResponse.json({
      ok: result.success,
      provider: provider.name,
      durationMs: Date.now() - started,
      error: result.success ? null : result.error,
    });
  } catch (error) { return errorResponse(error); }
}
