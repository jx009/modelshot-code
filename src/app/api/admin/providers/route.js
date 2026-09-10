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
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  try {
    const { id, isActive, isDefault, priority, displayName, apiKey, baseURL, model } = await req.json();
    if (!id) return new NextResponse("Missing provider id", { status: 400 });

    const existing = await prisma.modelProvider.findUnique({ where: { id } });
    if (!existing) return new NextResponse("Provider not found", { status: 404 });

    // 基础字段
    if (isDefault) {
      await prisma.modelProvider.updateMany({ data: { isDefault: false } });
    }
    const baseData = {
      ...(isActive !== undefined && { isActive }),
      ...(isDefault !== undefined && { isDefault }),
      ...(priority !== undefined && { priority }),
      ...(displayName !== undefined && { displayName }),
    };

    // config 字段（key/baseURL/model）——apiKey 留空 = 不变更
    let configData = {};
    let configChanged = false;
    if (apiKey !== undefined || baseURL !== undefined || model !== undefined) {
      let cfg = {};
      try { cfg = existing.config ? JSON.parse(existing.config) : {}; } catch { cfg = {}; }
      if (apiKey && apiKey.trim()) {
        cfg.apiKeyEnc = encryptSecret(apiKey.trim());
        configChanged = true;
      }
      if (baseURL !== undefined) {
        if (baseURL.trim()) cfg.baseURL = baseURL.trim();
        else delete cfg.baseURL;
        configChanged = true;
      }
      if (model !== undefined) {
        if (model.trim()) cfg.model = model.trim();
        else delete cfg.model;
        configChanged = true;
      }
      configData = configChanged ? { config: JSON.stringify(cfg) } : {};
    }

    const updated = await prisma.modelProvider.update({
      where: { id },
      data: { ...baseData, ...configData },
    });

    // 审计（key 只记更新动作，不记内容）
    if (apiKey && apiKey.trim()) {
      await auditLog(auth.user.id, "UPDATE_PROVIDER_KEY", null, { provider: existing.name });
    }
    if (configChanged && !(apiKey && apiKey.trim())) {
      await auditLog(auth.user.id, "UPDATE_PROVIDER_CONFIG", null, { provider: existing.name, baseURL, model });
    }
    if (Object.keys(baseData).length > 0) {
      await auditLog(auth.user.id, "UPDATE_PROVIDER", null, { provider: existing.name, ...baseData });
    }

    invalidateProviderConfig();
    return NextResponse.json({
      ok: true,
      config: safeConfig(updated.config),
    });
  } catch (error) {
    console.error("[ADMIN_PROVIDERS_PATCH]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
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
      garmentImage: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", // 1x1 px
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
