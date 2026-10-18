import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { getTool } from "../../studio/tool-catalog.js";

// Audit payloads contain creative inputs and execution data, never channel credentials.
export function auditData(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(auditData);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/api.?key|secret|password|token|authorization|objectKey|providerBaseURL/i.test(key))
    .map(([key, item]) => [key, auditData(item)]));
  return value;
}

export function auditMedia(row) {
  const snapshot = row.snapshot || {}, result = row.resultData || {};
  const inputs = [], outputs = [];
  function add(list, id, label, url, contentType) {
    if (url?.startsWith("/api/assets/")) { id = url.slice("/api/assets/".length).split(/[/?#]/)[0]; url = null; }
    if (id) url = `/api/admin/assets/${encodeURIComponent(id)}`;
    if (!url || !/^(\/(?!\/)|https?:\/\/|data:image\/(png|jpeg|webp|gif);base64,)/i.test(url)) return;
    const existing = list.find(item => item.url === url);
    if (existing) { if (contentType) existing.contentType = contentType; return; }
    list.push({ id: id || null, label, url, contentType: contentType || "image/png" });
  }
  add(inputs, snapshot.assetId || snapshot.garment?.id, "原始输入图", row.clothesImage);
  add(inputs, snapshot.person?.id, "人物参考图", row.personImage);
  add(inputs, snapshot.maskId, "编辑蒙版");
  (snapshot.referenceAssetIds || []).forEach((id, index) => add(inputs, id, `参考图 ${index + 1}`));
  (snapshot.references || []).forEach(ref => add(inputs, ref.id, `参考图 · ${ref.role || "reference"}`));
  add(inputs, snapshot.input?.assetId || snapshot.input?.productAssetId, "原始输入图");
  add(inputs, snapshot.input?.referenceAssetId, "风格参考图");
  add(inputs, snapshot.moveBundle?.objectAssetId, "移动主体");
  add(inputs, snapshot.moveBundle?.holeAssetId, "移动背景");
  add(inputs, null, "预设模特", snapshot.modelPreset?.referenceImage);
  add(inputs, null, "预设场景", snapshot.scenePreset?.referenceImage);
  add(outputs, row.deliveryAssetId, "交付结果");
  add(outputs, row.originalAssetId, "原始生成结果");
  (result.assets || []).forEach((asset, index) => add(outputs, asset.id, asset.label || `生成结果 ${index + 1}`, null, asset.contentType));
  add(outputs, null, "生成结果", row.resultImage);
  for (const reference of row.auditReferences || []) {
    const list = reference.kind === "generation_output" ? outputs : inputs;
    add(list, reference.assetId, list === outputs ? "生成附件" : "输入附件");
  }
  return { inputs, outputs };
}

export function auditSummary(row) {
  const snapshot = row.snapshot || {}, media = auditMedia(row);
  const tool = getTool(snapshot.tool);
  return {
    id: row.id, userId: row.userId, userEmail: row.User?.email, userName: row.User?.name,
    kind: snapshot.kind || "commerce", tool: snapshot.tool || snapshot.purpose || snapshot.task?.mode || "generate",
    toolLabel: tool?.zh || ({ "studio-plan": "创作规划", "commerce-agent": "电商 Agent", "studio-optimize": "提示词优化", "focus-identify": "主体识别" }[snapshot.purpose]) || snapshot.task?.title || snapshot.workflow?.title || snapshot.purpose || "商品生图",
    prompt: row.prompt || "", userPrompt: snapshot.input?.prompt ?? snapshot.input?.message ?? snapshot.config?.prompt ?? snapshot.params?.prompt ?? row.prompt ?? "",
    resultImage: media.outputs.find(item => item.contentType.startsWith("image/"))?.url || null,
    clothesImage: media.inputs[0]?.url || null, inputs: media.inputs, outputs: media.outputs,
    status: row.status, qaStatus: row.qaStatus, provider: row.provider,
    model: snapshot.model || (snapshot.tool === "video" ? snapshot.videoModel : snapshot.tool === "describe" ? snapshot.chatModel : snapshot.imageModel),
    costUsd: row.costUsd, creditCost: row.creditCost, qaScore: row.qaScore, qaFlags: row.qaFlags,
    platformSpec: row.platformSpec, pose: row.pose, camera: row.camera, lighting: row.lighting,
    durationMs: row.durationMs, createTime: row.createTime, errorCode: row.errorCode,
  };
}

export async function generationAuditDetail(id, adminId, db = prisma) {
  const row = await db.tryOn.findUnique({ where: { id }, include: {
    User: { select: { email: true, name: true } },
    attempts: { orderBy: { startedAt: "asc" } },
  } });
  if (!row) throw new AppError("JOB_NOT_FOUND", 404);
  const [references, steps] = await Promise.all([
    db.assetReference.findMany({ where: { entityId: id, kind: { in: ["generation_input", "generation_output"] } }, select: { assetId: true, kind: true } }),
    db.processingStep.findMany({ where: { entityId: id }, orderBy: { updatedAt: "asc" }, select: { kind: true, state: true, errorCode: true, report: true, updatedAt: true } }),
  ]);
  const snapshot = row.snapshot || {};
  const summary = auditSummary({ ...row, auditReferences: references });
  const media = [...summary.inputs, ...summary.outputs];
  const assets = await db.asset.findMany({ where: { id: { in: [...new Set(media.map(item => item.id).filter(Boolean))] }, userId: row.userId },
    select: { id: true, contentType: true, width: true, height: true, bytes: true, status: true } });
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  const enrich = item => item.id ? { ...item, ...byId.get(item.id), unavailable: !byId.has(item.id) || byId.get(item.id).status !== "active" } : item;
  await db.adminAuditLog.create({ data: { adminId, action: "READ_GENERATION", targetUserId: row.userId, detail: JSON.stringify({ jobId: id, reason: "generation_audit" }) } });
  return {
    ...summary, inputs: summary.inputs.map(enrich), outputs: summary.outputs.map(enrich),
    requestId: row.requestId, projectId: row.projectId, documentId: snapshot.documentId || snapshot.input?.documentId,
    targetId: snapshot.targetId, batchJobId: row.batchJobId, retryOfId: row.retryOfId, updateTime: row.updateTime,
    aspectRatio: row.aspectRatio, billingType: row.billingType, reviewDecision: row.reviewDecision,
    params: auditData(snapshot.params || snapshot.input || snapshot.config || {}),
    snapshot: auditData(snapshot), resultData: auditData(row.resultData),
    attempts: (row.attempts || []).map(attempt => ({ id: attempt.id, provider: attempt.provider, requestId: attempt.requestId, state: attempt.state, errorCode: attempt.errorCode, startedAt: attempt.startedAt, endedAt: attempt.endedAt })),
    steps: auditData(steps),
    inputNotRecorded: snapshot.kind === "language" && !snapshot.input,
  };
}
