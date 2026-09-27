import { z } from "zod";
import { randomUUID } from "node:crypto";
import { AppError, readJson, errorResponse } from "../../../../lib/http.js";
import { auditedOperation } from "../../../../lib/domain/identity/admin-operation.js";
import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin, auditLog } from "../../../../lib/admin-auth";
import { invalidateProviderConfig, invokeModel } from "../../../../lib/ai/runner";
import { encryptSecret, decryptSecret, maskSecret } from "../../../../lib/crypto";
import { vision } from "../../../../lib/domain/studio/providers";

const kindSchema = z.enum(["openai", "gemini", "fashn"]);

/**
 * 模型提供商管理
 * GET    /api/admin/providers          → 列表（key 脱敏返回）
 * PATCH  /api/admin/providers          → 更新 { id, isActive?, isDefault?, priority?, displayName?, apiKey?, baseURL?, model? }
 *                                         apiKey 非空=加密覆盖；留空=不变更（前端明示）
 * POST   /api/admin/providers/test     → 测试连接（发一张最小测试图验证配置）
 */

/** config 解析为安全响应（key 永远脱敏） */
function safeConfig(configStr) {
  let cfg = {};
  try { cfg = configStr ? JSON.parse(configStr) : {}; } catch { cfg = {}; }
  const apiKey = cfg.apiKeyEnc ? decryptSecret(cfg.apiKeyEnc) : null;
  return {
    keyMasked: apiKey ? maskSecret(apiKey) : "",
    hasKey: Boolean(apiKey),
    baseURL: cfg.baseURL || "",
    model: cfg.model || "",
    chatModel: cfg.chatModel || "",
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
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  const providers = await prisma.modelProvider.findMany({
    orderBy: { priority: "asc" },
  });
  // 永远不回传 config 原文（含密文）——只回脱敏视图
  return NextResponse.json(providers.map(p => ({
    id: p.id,
    name: p.name,
    kind: p.kind || p.name,
    displayName: p.displayName,
    isActive: p.isActive,
    isDefault: p.isDefault,
    isPlanner: p.isPlanner,
    priority: p.priority,
    creditCost: p.creditCost,
    costPerImage: p.costPerImage,
    config: safeConfig(p.config),
  })));
}

export async function PATCH(req) {
  try {
    const auth = await requireAdmin(req, "root");
    if (auth.response) return auth.response;
    const input = await readJson(req, z.object({ id: z.string().min(1).max(128), kind: kindSchema.optional(), isActive: z.boolean().optional(), isDefault: z.boolean().optional(), isPlanner: z.boolean().optional(), priority: z.number().int().min(0).max(1000).optional(), displayName: z.string().min(1).max(100).optional(), creditCost: z.number().int().min(0).max(100000).optional(), costPerImage: z.number().min(0).max(1000).optional(), apiKey: z.string().max(4096).optional(), baseURL: z.string().max(500).optional(), model: z.string().max(128).optional(), chatModel: z.string().max(128).optional(), reason: z.string().min(3).max(500) }).strict());
    if (input.baseURL) {
      const url = new URL(input.baseURL);
      const allowed = (process.env.PROVIDER_PROXY_HOSTS || "").split(",").map(value => value.trim());
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !allowed.includes(url.hostname)) throw new AppError("PROVIDER_PROXY_NOT_ALLOWED");
    }
    const result = await auditedOperation(auth.user.id, req.headers.get("idempotency-key"), "UPDATE_PROVIDER", input, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('provider-config', 0))::text`;
      const existing = await tx.modelProvider.findUnique({ where: { id: input.id } });
      if (!existing) throw new AppError("PROVIDER_NOT_FOUND", 404);
      const cfg = JSON.parse(existing.config || "{}");
      if (input.apiKey?.trim()) cfg.apiKeyEnc = encryptSecret(input.apiKey.trim());
      if (input.baseURL !== undefined) cfg.baseURL = normalizeBaseURL(input.baseURL);
      if (input.model !== undefined) cfg.model = input.model;
      if (input.chatModel !== undefined) cfg.chatModel = input.chatModel;
      if (input.isDefault) await tx.modelProvider.updateMany({ data: { isDefault: false } });
      if (input.isPlanner) {
        if ((input.kind || existing.kind || existing.name) !== "openai") throw new AppError("PLANNER_PROVIDER_UNSUPPORTED");
        if (!cfg.chatModel?.trim()) throw new AppError("VISION_NOT_CONFIGURED", 422);
        await tx.modelProvider.updateMany({ data: { isPlanner: false } });
      }
      await tx.modelProvider.update({ where: { id: input.id }, data: { kind: input.kind, isActive: input.isActive, isDefault: input.isDefault, isPlanner: input.isPlanner, priority: input.priority, displayName: input.displayName, creditCost: input.creditCost, costPerImage: input.costPerImage, config: JSON.stringify(cfg) } });
      return { audit: { provider: existing.name, keyChanged: !!input.apiKey, fields: Object.keys(input).filter(key => !["apiKey", "reason"].includes(key)) } };
    }, prisma, "root");
    invalidateProviderConfig();
    return Response.json(result);
  } catch (error) { return errorResponse(error); }
}

export async function PUT(req) {
  try {
    const auth = await requireAdmin(req, "root");
    if (auth.response) return auth.response;
    const input = await readJson(req, z.object({ kind: kindSchema, displayName: z.string().trim().min(1).max(100), model: z.string().trim().min(1).max(128), chatModel: z.string().trim().max(128).default(""), apiKey: z.string().max(4096).default(""), baseURL: z.string().max(500).default(""), creditCost: z.number().int().min(0).max(100000).default(18), costPerImage: z.number().min(0).max(1000).default(0), reason: z.string().min(3).max(500) }).strict());
    if (input.baseURL) {
      const url = new URL(input.baseURL);
      const allowed = (process.env.PROVIDER_PROXY_HOSTS || "").split(",").map(value => value.trim());
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !allowed.includes(url.hostname)) throw new AppError("PROVIDER_PROXY_NOT_ALLOWED");
    }
    const result = await auditedOperation(auth.user.id, req.headers.get("idempotency-key"), "CREATE_PROVIDER", input, async tx => {
      const priority = (await tx.modelProvider.aggregate({ _max: { priority: true } }))._max.priority || 0;
      const config = { model: input.model, ...(input.chatModel ? { chatModel: input.chatModel } : {}), ...(input.baseURL ? { baseURL: normalizeBaseURL(input.baseURL) } : {}), ...(input.apiKey.trim() ? { apiKeyEnc: encryptSecret(input.apiKey.trim()) } : {}) };
      const row = await tx.modelProvider.create({ data: { name: `${input.kind}-${randomUUID().slice(0, 12)}`, kind: input.kind, displayName: input.displayName, priority: priority + 1, creditCost: input.creditCost, costPerImage: input.costPerImage, config: JSON.stringify(config) } });
      return { response: { id: row.id }, audit: { provider: row.name, kind: row.kind, displayName: row.displayName, keyConfigured: Boolean(input.apiKey) } };
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

    const started = Date.now();
    if (mode === "planner") {
      const stored = JSON.parse(provider.config || "{}");
      const apiKey = process.env.STUDIO_API_KEY || (stored.apiKeyEnc ? decryptSecret(stored.apiKeyEnc) : process.env.OPENAI_API_KEY);
      const chatModel = process.env.STUDIO_CHAT_MODEL || stored.chatModel;
      if ((provider.kind || provider.name) !== "openai" || !apiKey || !chatModel) throw new AppError("VISION_NOT_CONFIGURED", 503);
      await vision({ visionApiKey: apiKey, visionBaseURL: process.env.STUDIO_BASE_URL || stored.baseURL, chatModel }, { instruction: "Return only the word OK.", messages: [{ role: "user", text: "Connection test" }], maxTokens: 8, signal: AbortSignal.timeout(30000) });
      return NextResponse.json({ ok: true, provider: provider.name, mode, durationMs: Date.now() - started });
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
