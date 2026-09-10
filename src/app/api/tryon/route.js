import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { buildAuthOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { UserService } from "../../../lib/services/user";
import { buildPrompt, aspectRatioToSize } from "../../../lib/prompt-engine";
import { generateOne } from "../../../lib/generation";
import crypto from "crypto";

const VALID_VARIANTS = [1, 2, 4];

export async function POST(req) {
  try {
    // 1. 鉴权
    const session = await getServerSession(await buildAuthOptions());
    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // 2. 解析参数（兼容旧字段 + 新增可选字段）
    const body = await req.json();
    const {
      personImage,       // 兼容旧前端：用户自传模特参考图（可空，如果用预设模特）
      clothesImage,      // 服装平铺图（必填）
      aspectRatio,
      prompt,            // 用户自定义 prompt（可空）
      modelPresetId,     // 预设模特 ID
      scenePresetId,     // 预设场景 ID
      platformSpec,      // 目标平台：amazon | tiktok | taobao | shein
      garmentType,       // 服装类型：top | bottom | dress | outerwear | swimwear
      provider,          // 指定模型提供商（可选）
      pose,              // 姿态（可选）
      camera,            // 相机（可选）
      lighting,          // 光线（可选）
      variants,          // 变体数 1|2|4（可选，默认 1；N 张 = N 次计费）
    } = body;

    if (!clothesImage) {
      return new NextResponse("Garment image (clothesImage) is required", { status: 400 });
    }
    if (!personImage && !modelPresetId) {
      return new NextResponse("Either personImage or modelPresetId is required", { status: 400 });
    }

    const variantCount = VALID_VARIANTS.includes(variants) ? variants : 1;
    const cleanAspectRatio = aspectRatio || "auto";

    // 3. 计费（双轨：订阅额度优先，超出走积分；自带 key 免费；N 变体 = N 次）
    //    先预检总额度（避免中途失败回滚复杂度），再逐张扣费
    const headerApiKey = req.headers.get("x-custom-api-key");
    const customApiKey = headerApiKey || body.customApiKey || session.user.customApiKey || null;
    const isUsingCustomKey = Boolean(customApiKey && customApiKey.trim().length > 0);

    const billings = [];
    if (!isUsingCustomKey) {
      const usage = await UserService.getUsageSummary(session.user.id);
      const affordable = usage.remaining + Math.floor(usage.credits / 18);
      if (affordable < variantCount) {
        return NextResponse.json(
          { error: "INSUFFICIENT_QUOTA", need: variantCount, have: affordable },
          { status: 402 }
        );
      }
      for (let i = 0; i < variantCount; i++) {
        try {
          billings.push(await UserService.consumeGeneration(session.user.id));
        } catch (err) {
          return NextResponse.json({ error: "INSUFFICIENT_CREDITS" }, { status: 402 });
        }
      }
    }

    // 4. 查预设
    const modelPreset = modelPresetId
      ? await prisma.modelPreset.findFirst({ where: { id: modelPresetId, isActive: true } })
      : null;
    const scenePreset = scenePresetId
      ? await prisma.scenePreset.findFirst({ where: { id: scenePresetId, isActive: true } })
      : null;

    // 5. 组装 Prompt（模板引擎，用户 prompt 优先；变体间仅 prompt 一致——多样性来自模型采样）
    const finalPrompt = await buildPrompt({
      garmentType,
      modelPreset,
      scenePreset,
      platformSpec,
      userPrompt: prompt,
      pose,
      camera,
      lighting,
    });

    // 6. 创建 N 条记录（共享 variantGroupId，前端按组渲染变体网格）
    //    任一创建失败 → 冲销全部孤儿消费（计费已发生但无记录，绝不白扣）
    const variantGroupId = variantCount > 1 ? crypto.randomUUID() : "";
    const tryonIds = [];
    try {
      for (let i = 0; i < variantCount; i++) {
        const billing = isUsingCustomKey
          ? { billingType: "custom_key", creditCost: 0 }
          : billings[i];
        const tryon = await prisma.tryOn.create({
          data: {
            userId: session.user.id,
            personImage: personImage || modelPreset?.referenceImage || "",
            clothesImage,
            prompt: finalPrompt,
            aspectRatio: cleanAspectRatio,
            requestId: crypto.randomUUID(),
            status: "processing",
            creditCost: billing.creditCost,
            billingType: billing.billingType,
            modelPresetId: modelPresetId || null,
            scenePresetId: scenePresetId || null,
            platformSpec: platformSpec || null,
            pose: pose || "",
            camera: camera || "",
            lighting: lighting || "",
            variantGroupId,
          },
        });
        tryonIds.push(tryon.id);
        if (!isUsingCustomKey) {
          await UserService.linkTransaction(session.user.id, tryon.id);
        }
      }
    } catch (createErr) {
      console.error("[TRYON_POST] create failed, refunding orphan consumptions:", createErr);
      for (const b of billings) {
        await UserService.refundByTransaction(b.txId).catch(() => {});
      }
      for (const id of tryonIds) {
        await UserService.refundGeneration(session.user.id, id).catch(() => {});
        await prisma.tryOn.update({ where: { id }, data: { status: "failed" } }).catch(() => {});
      }
      throw createErr;
    }

    // 7. 后台顺序生成（不阻塞响应；逐张避免限流，失败自动退款）
    const genParams = {
      garmentImage: clothesImage,
      modelRef: personImage || modelPreset?.referenceImage || null,
      sceneRef: scenePreset?.referenceImage || null,
      prompt: finalPrompt,
      size: aspectRatioToSize(cleanAspectRatio),
      quality: "high",
      provider,
      adapterConfig: isUsingCustomKey ? { apiKey: customApiKey.trim() } : undefined,
    };
    (async () => {
      for (const id of tryonIds) {
        await generateOne(id, genParams).catch(err =>
          console.error(`[TryOn ${id}] async error:`, err)
        );
      }
    })();

    return NextResponse.json({
      tryonId: tryonIds[0],
      tryonIds,
      variantGroupId,
      variantCount,
      status: "processing",
    });
  } catch (error) {
    console.error("[TRYON_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
