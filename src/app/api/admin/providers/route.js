import { z } from "zod";
import { AppError, readJson, errorResponse } from "../../../../lib/http.js";
import { auditedOperation } from "../../../../lib/domain/identity/admin-operation.js";
import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin, auditLog } from "../../../../lib/admin-auth";
import { invalidateProviderConfig, invokeModel } from "../../../../lib/ai/runner";
import { encryptSecret, decryptSecret, maskSecret } from "../../../../lib/crypto";

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
    displayName: p.displayName,
    isActive: p.isActive,
    isDefault: p.isDefault,
    priority: p.priority,
    costPerImage: p.costPerImage,
    config: safeConfig(p.config),
  })));
}

export async function PATCH(req) {
  try {
    const auth = await requireAdmin(req, "root");
    if (auth.response) return auth.response;
    const input = await readJson(req, z.object({ id: z.string().min(1).max(128), isActive: z.boolean().optional(), isDefault: z.boolean().optional(), priority: z.number().int().min(0).max(1000).optional(), displayName: z.string().min(1).max(100).optional(), apiKey: z.string().max(4096).optional(), baseURL: z.string().max(500).optional(), model: z.string().max(128).optional(), reason: z.string().min(3).max(500) }).strict());
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
      if (input.isDefault) await tx.modelProvider.updateMany({ data: { isDefault: false } });
      await tx.modelProvider.update({ where: { id: input.id }, data: { isActive: input.isActive, isDefault: input.isDefault, priority: input.priority, displayName: input.displayName, config: JSON.stringify(cfg) } });
      return { audit: { provider: existing.name, keyChanged: !!input.apiKey, fields: Object.keys(input).filter(key => !["apiKey", "reason"].includes(key)) } };
    }, prisma, "root");
    invalidateProviderConfig();
    return Response.json(result);
  } catch (error) { return errorResponse(error); }
}

/** 测试连接：用指定通道发一张最小成本的 dry-run + 真实 1x1 图（验证 key/baseURL/model 全链路） */
export async function POST(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const { id } = await req.json();
    const provider = await prisma.modelProvider.findUnique({ where: { id } });
    if (!provider) return new NextResponse("Provider not found", { status: 404 });

    const started = Date.now();
    // 最小测试：小尺寸低质量，验证配置真实性
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
  } catch (error) {
    console.error("[ADMIN_PROVIDERS_TEST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
