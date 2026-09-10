import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { buildAuthOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { UserService } from "../../../lib/services/user";
import { buildPrompt, aspectRatioToSize } from "../../../lib/prompt-engine";
import { processBatch } from "../../../lib/generation";
import crypto from "crypto";

const MAX_BATCH_SIZE = 50;

/**
 * 批量生成
 * POST /api/batch
 * body: { images: [dataUrl...], modelPresetId, scenePresetId, garmentType, platformSpec, aspectRatio, provider }
 *
 * GET /api/batch          → 用户的批量任务列表（含进度）
 * GET /api/batch?id=xxx   → 单个任务详情（含 tryons）
 */
export async function POST(req) {
  try {
    const session = await getServerSession(await buildAuthOptions());
    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await req.json();
    const {
      images,           // 服装平铺图数组（data URL，必填，1-50 张）
      modelPresetId,    // 预设模特（必填——批量模式不支持自传模特图）
      scenePresetId,
      garmentType,
      platformSpec,
      aspectRatio,
      provider,
      pose,
      camera,
      lighting,
      name,             // 任务名（可选，默认 "批量 N 张"
    } = body;

    if (!Array.isArray(images) || images.length === 0) {
      return new NextResponse("images array is required", { status: 400 });
    }
    if (images.length > MAX_BATCH_SIZE) {
      return new NextResponse(`Batch size exceeds limit (${MAX_BATCH_SIZE})`, { status: 400 });
    }
    if (!modelPresetId) {
      return new NextResponse("modelPresetId is required for batch generation", { status: 400 });
    }

    const cleanAspectRatio = aspectRatio || "3:4";

    // 批量也走双轨计费：先检查总额度是否够（订阅剩余 + 积分可买张数）
    const usage = await UserService.getUsageSummary(session.user.id);
    const affordable = usage.remaining + Math.floor(usage.credits / 18);
    if (affordable < images.length) {
      return NextResponse.json({ error: "INSUFFICIENT_QUOTA", need: images.length, have: affordable }, { status: 402 });
    }

    // 查预设
    const modelPreset = await prisma.modelPreset.findFirst({
      where: { id: modelPresetId, isActive: true },
    });
    if (!modelPreset) {
      return new NextResponse("Model preset not found", { status: 400 });
    }
    const scenePreset = scenePresetId
      ? await prisma.scenePreset.findFirst({ where: { id: scenePresetId, isActive: true } })
      : null;

    // 统一 prompt
    const prompt = await buildPrompt({
      garmentType,
      modelPreset,
      scenePreset,
      platformSpec,
      userPrompt: body.prompt,
      pose,
      camera,
      lighting,
    });

    // 创建 BatchJob
    const batchJob = await prisma.batchJob.create({
      data: {
        userId: session.user.id,
        name: name || `Batch ${images.length}`,
        totalCount: images.length,
        status: "pending",
        config: JSON.stringify({
          sceneRef: scenePreset?.referenceImage || null,
          size: aspectRatioToSize(cleanAspectRatio),
          platformSpec: platformSpec || null,
          provider: provider || null,
        }),
      },
    });

    // 逐张计费 + 创建 TryOn 记录
    const tryonIds = [];
    for (const image of images) {
      let billing = { billingType: "credits", creditCost: 18 };
      try {
        billing = await UserService.consumeGeneration(session.user.id);
      } catch (err) {
        // 中途额度不足：把已建的标记失败并终止（理论上前面预检过，此处兜底）
        break;
      }

      let tryon;
      try {
        tryon = await prisma.tryOn.create({
          data: {
            userId: session.user.id,
            personImage: modelPreset.referenceImage,
            clothesImage: image,
            prompt,
            aspectRatio: cleanAspectRatio,
            requestId: crypto.randomUUID(),
            status: "processing",
            creditCost: billing.creditCost,
            billingType: billing.billingType,
            modelPresetId: modelPreset.id,
            scenePresetId: scenePresetId || null,
            platformSpec: platformSpec || null,
            pose: pose || "",
            camera: camera || "",
            lighting: lighting || "",
            batchJobId: batchJob.id,
          },
        });
      } catch (createErr) {
        // 创建失败 → 冲销本次孤儿消费，继续下一张
        await UserService.refundByTransaction(billing.txId).catch(() => {});
        throw createErr;
      }
      // 流水关联到生成记录
      await UserService.linkTransaction(session.user.id, tryon.id);
      tryonIds.push(tryon.id);
    }

    if (tryonIds.length === 0) {
      await prisma.batchJob.update({
        where: { id: batchJob.id },
        data: { status: "failed", totalCount: 0 },
      });
      return NextResponse.json({ error: "INSUFFICIENT_CREDITS" }, { status: 402 });
    }

    // 更新实际总数（若中途额度不足）
    if (tryonIds.length < images.length) {
      await prisma.batchJob.update({
        where: { id: batchJob.id },
        data: { totalCount: tryonIds.length },
      });
    }

    // 后台顺序处理（不阻塞响应）
    processBatch(batchJob.id).catch(err =>
      console.error(`[BatchJob ${batchJob.id}] processing error:`, err)
    );

    return NextResponse.json({
      batchJobId: batchJob.id,
      count: tryonIds.length,
      status: "processing",
    });
  } catch (error) {
    console.error("[BATCH_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function GET(req) {
  try {
    const session = await getServerSession(await buildAuthOptions());
    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      const job = await prisma.batchJob.findFirst({
        where: { id, userId: session.user.id },
        include: {
          tryons: {
            select: {
              id: true, status: true, resultImage: true, clothesImage: true,
              qaScore: true, qaFlags: true, aspectRatio: true, provider: true,
              pose: true, camera: true, lighting: true, createTime: true,
            },
            orderBy: { createTime: "asc" },
          },
        },
      });
      if (!job) return new NextResponse("Not Found", { status: 404 });
      return NextResponse.json(job);
    }

    const jobs = await prisma.batchJob.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return NextResponse.json(jobs);
  } catch (error) {
    console.error("[BATCH_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
