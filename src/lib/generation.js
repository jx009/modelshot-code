import { prisma } from "./prisma";
import { invokeModel } from "./ai/runner";
import { runQA } from "./qa-pipeline";
import { injectMetadata } from "./compliance";
import { saveImage } from "./storage";

/**
 * 单张生成流程（单张 API 和批量任务共用）
 * invokeModel（带 fallback）→ 存图 → 合规元数据注入 → 自动 QA → 更新记录
 *
 * @param {string} tryOnId - TryOn 记录 ID
 * @param {Object} params  - invokeModel 参数（garmentImage/modelRef/sceneRef/prompt/size/quality/provider/adapterConfig）
 * @returns {Promise<"completed"|"needs_review"|"failed">}
 */
export async function generateOne(tryOnId, params) {
  const startedAt = Date.now();
  try {
    const result = await invokeModel(params);
    if (!result.success) throw new Error(result.error);

    // 保存图片到本地
    const imageUrl = await saveImage(result.imageBase64 || result.imageUrl, tryOnId);

    // 合规元数据注入（EXIF/IPTC 声明 AI 生成 + C2PA 可选，原地覆写）
    await injectMetadata(imageUrl, {
      provider: result.provider,
      prompt: params.prompt,
    });

    // 自动 QA 检测（失败不阻塞）
    const qa = await runQA(imageUrl, params.garmentImage);

    const status = qa.pass ? "completed" : "needs_review";
    await prisma.tryOn.update({
      where: { id: tryOnId },
      data: {
        resultImage: imageUrl,
        status,
        provider: result.provider,
        costUsd: result.costUsd,
        qaScore: qa.score,
        qaFlags: JSON.stringify(qa.flags),
        durationMs: Date.now() - startedAt,
      },
    });
    return status;
  } catch (error) {
    console.error(`[TryOn ${tryOnId}] Generation failed:`, error.message);
    await prisma.tryOn.update({
      where: { id: tryOnId },
      data: { status: "failed", durationMs: Date.now() - startedAt },
    }).catch(() => {});
    // 失败退款：credits 退积分 / subscription 释放额度（幂等，无流水则跳过）
    const { UserService } = await import("./services/user.js");
    const tryon = await prisma.tryOn.findUnique({
      where: { id: tryOnId },
      select: { userId: true },
    }).catch(() => null);
    if (tryon) {
      await UserService.refundGeneration(tryon.userId, tryOnId).catch(err =>
        console.error(`[TryOn ${tryOnId}] Refund failed:`, err.message)
      );
    }
    return "failed";
  }
}

/**
 * 僵尸任务清理：把超时的 processing 记录标记失败并退款
 * （进程内批处理的兜底——Serverless 进程被回收时任务可能永久卡在 processing）
 * 由 tryons 列表查询时惰性触发，无需额外调度
 */
const STALE_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟未完成视为超时

export async function sweepStaleTryOns(userId) {
  const stale = await prisma.tryOn.findMany({
    where: {
      userId,
      status: "processing",
      updateTime: { lt: new Date(Date.now() - STALE_TIMEOUT_MS) },
    },
    select: { id: true },
  });

  const { UserService } = await import("./services/user.js");
  for (const t of stale) {
    await prisma.tryOn.update({
      where: { id: t.id },
      data: { status: "failed" },
    }).catch(() => {});
    await UserService.refundGeneration(userId, t.id).catch(() => {});
    console.log(`[Sweep] Marked stale tryOn ${t.id} as failed + refunded`);
  }
  return stale.length;
}

/**
 * 批量任务处理：顺序逐张生成（避免并发打爆 API 限流），实时更新计数
 *
 * @param {string} batchJobId - BatchJob ID
 */
export async function processBatch(batchJobId) {
  const job = await prisma.batchJob.findUnique({
    where: { id: batchJobId },
    include: { tryons: { orderBy: { createTime: "asc" } } },
  });
  if (!job || job.status !== "pending") return;

  await prisma.batchJob.update({
    where: { id: batchJobId },
    data: { status: "processing" },
  });

  const config = JSON.parse(job.config || "{}");

  for (const tryon of job.tryons) {
    if (tryon.status !== "processing") continue; // 已处理的跳过（重试场景）

    const status = await generateOne(tryon.id, {
      garmentImage: tryon.clothesImage,
      modelRef: tryon.personImage || null,
      sceneRef: config.sceneRef || null,
      prompt: tryon.prompt,
      size: config.size || "1024x1536",
      quality: "high",
    });

    // 更新计数
    await prisma.batchJob.update({
      where: { id: batchJobId },
      data:
        status === "failed"
          ? { failedCount: { increment: 1 } }
          : { completedCount: { increment: 1 } },
    }).catch(() => {});
  }

  await prisma.batchJob.update({
    where: { id: batchJobId },
    data: { status: "completed" },
  });
  console.log(`[BatchJob ${batchJobId}] done`);
}
