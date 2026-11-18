import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { RUN_ACTIVE, RUN_WAITING } from "../../creation/contracts/runs.js";
import { assertCreationAccess, getCreationEnv } from "../../creation/access.js";
import { digestJson } from "../generation/contracts.js";
import { lockUser } from "../billing/ledger.js";
import { studioConfig, capabilities } from "../studio/providers.js";
import { imageCreditCost } from "../../studio/image-pricing.js";
import { videoInputError } from "../../video/model-protocols.js";
import { selectVideoVariant } from "../../video/variants.js";
import { defaultResolution, videoJobCost } from "../../video/pricing.js";
import { motionAssetIds } from "../../video/schema.js";
import { inspectVideoResult } from "../studio/video-result-media.js";
import { saveDocument } from "../studio/documents.js";
import { presentRun } from "./runs.js";
import { appendRunEvent, enqueueRun } from "./events.js";

// 分镜成片：一次运行包含所选镜头的首帧图、视频片段、旁白配音，以及最后的成片导出。
// 计划由服务端依据已保存的分镜工程生成；客户端只提交镜头 ID 与报价总额。
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const storyboardRunSchema = z.object({
  documentId: id, documentVersion: z.number().int().positive(),
  sceneIds: z.array(id).min(1).max(12).refine(ids => new Set(ids).size === ids.length, "DUPLICATE_SCENE"),
  provider: id.optional(), imageProvider: id.optional(),
  maxCredits: z.number().int().min(0).max(200000), expectedTotal: z.number().int().min(0).max(200000),
}).strict();
export const storyboardQuoteSchema = storyboardRunSchema.pick({ documentId: true, sceneIds: true, provider: true, imageProvider: true });

const FRAME_SIZES = { "16:9": "1536x1024", "9:16": "1024x1536", "1:1": "1024x1024", "4:5": "1024x1536" };
const GENERATED_MEDIA = /_studio_(?:\d+|video|voice)$/;
const NEEDS_FRAME = new Set(["ai-image-video", "ai-image"]), NEEDS_CLIP = new Set(["ai-image-video", "ai-video"]);

function shotText(scene) {
  const visual = scene.visual.trim() || [scene.title, scene.subtitle].filter(Boolean).join("，");
  if (!visual) throw new AppError("STORYBOARD_SHOT_EMPTY", 422);
  return visual;
}
const framePrompt = (scene, ratio) => `${shotText(scene)}。画面比例 ${ratio}，电影感构图，主体清晰，光影自然，画面中不要出现文字、字幕或水印。`;
const clipPrompt = scene => `${shotText(scene)}${scene.camera ? `。镜头运动：${scene.camera}` : ""}`;
const nearestDuration = (allowed, wanted) => [...allowed].sort((a, b) => a - b).find(value => value >= wanted) ?? Math.max(...allowed);

// 依据工程生成步骤并逐步报价。返回的步骤可直接写入 CreationStep（id、依赖与价格已就绪）。
export async function planStoryboard(video, sceneIds, { provider, imageProvider, db = prisma } = {}) {
  const composition = video?.composition;
  if (!composition) throw new AppError("MOTION_COMPOSITION_REQUIRED", 409);
  const scenes = sceneIds.map(sceneId => composition.scenes.find(scene => scene.id === sceneId));
  if (scenes.some(scene => !scene)) throw new AppError("MOTION_SCENE_CHANGED", 409);
  const cache = new Map();
  const load = async (key, capability, tool, name, options) => {
    if (!cache.has(key)) { const config = await studioConfig(db, name, capability, tool, options); cache.set(key, { config, caps: await capabilities(db, config) }); }
    return cache.get(key);
  };
  const toolOf = (caps, toolId) => {
    const tool = caps.tools.find(item => item.id === toolId);
    if (!tool?.available) throw new AppError(tool?.reason || "TOOL_UNAVAILABLE", 503);
    return tool;
  };
  const steps = [], lines = [];
  const add = (step, line) => { const stepId = randomUUID(); steps.push({ id: stepId, ...step }); lines.push({ ...line, tool: step.tool, cost: step.expectedCost }); return stepId; };
  for (const scene of scenes) {
    const label = scene.name || scene.title || "镜头";
    let frameStep = null;
    let clip = NEEDS_CLIP.has(scene.source) ? await load(`video:${provider || ""}`, "video", "video", provider) : null;
    // 只支持文生视频的模型不接收首帧：首帧图生视频自动降级为文生视频，避免白白生成首帧。
    const textOnly = clip && clip.config.videoOptions?.inputMode === "text";
    if (NEEDS_FRAME.has(scene.source) && !(scene.source === "ai-image-video" && textOnly)) {
      const image = await load(`image:${imageProvider || ""}`, "image", "generate", imageProvider, { pinned: Boolean(imageProvider), skipPreview: true });
      const size = FRAME_SIZES[composition.ratio];
      const cost = imageCreditCost(toolOf(image.caps, "generate"), size, 0);
      frameStep = add({ tool: "generate", params: { sceneId: scene.id, ...(image.config.imageProvider ? { provider: image.config.imageProvider } : {}), params: { prompt: framePrompt(scene, composition.ratio), size } }, expectedCost: cost, explanation: `${label} · 首帧` }, { sceneId: scene.id, label: `${label} · 首帧图` });
    }
    if (clip) {
      const tool = toolOf(clip.caps, "video"), options = clip.config.videoOptions;
      const duration = nearestDuration(options?.durations?.length ? options.durations : [5], scene.duration);
      // 配置了规格（清晰度 / 声音组合）的模型必须选一个：取第一个支持该时长与比例的规格。
      const variantId = options?.variants?.find(row => row.durations.includes(duration) && row.ratios.includes(composition.ratio))?.id;
      // 按秒计费的通道：每个镜头按最低清晰度报价，与扣费口径保持一致。
      const resolution = clip.config.videoPricing ? defaultResolution(clip.config.videoPricing) : undefined;
      const params = { prompt: clipPrompt(scene), ratio: composition.ratio, duration, ...(variantId ? { videoVariant: variantId } : {}), ...(resolution ? { resolution } : {}) };
      const selection = selectVideoVariant(options, variantId);
      if (selection.error) throw new AppError(selection.error, 422);
      const error = videoInputError(selection.options || options, { ...params, hasImage: Boolean(frameStep) });
      if (error) throw new AppError(error, 422);
      const expectedCost = clip.config.videoPricing ? videoJobCost(clip.config.videoPricing, selection.variant?.creditCost ?? tool.cost, duration, resolution) : selection.variant?.creditCost ?? tool.cost;
      add({ tool: "video", params: { sceneId: scene.id, ...(clip.config.videoProvider ? { provider: clip.config.videoProvider } : {}), params }, expectedCost, explanation: `${label} · 视频`, dependsOn: frameStep ? [frameStep] : [] }, { sceneId: scene.id, label: `${label} · 视频 ${duration} 秒` });
    }
    if (scene.narration.trim() && composition.voice) {
      const voice = await load(`voice:${composition.voice.provider}`, "voice", "tts", composition.voice.provider, { pinned: true });
      if (!voice.config.voiceChannel?.voiceOptions?.voices?.some(item => item.id === composition.voice.voice)) throw new AppError("VOICE_UNSUPPORTED", 422);
      add({ tool: "tts", params: { sceneId: scene.id, provider: voice.config.voiceChannel.name, params: { prompt: scene.narration.trim(), voice: composition.voice.voice } }, expectedCost: toolOf(voice.caps, "tts").cost, explanation: `${label} · 旁白` }, { sceneId: scene.id, label: `${label} · 旁白配音` });
    }
  }
  const render = await load("render", "image", "motion-render", undefined, { skipPreview: true });
  const renderTool = toolOf(render.caps, "motion-render");
  add({ tool: "motion-render", params: { role: "render" }, expectedCost: renderTool.cost, explanation: "合成成片", dependsOn: steps.map(step => step.id) }, { sceneId: null, label: "合成成片（转场、字幕、配乐）" });
  return { steps: steps.map((step, index) => ({ ...step, position: index, dependsOn: step.dependsOn || [], status: index ? "blocked" : "ready", result: step.tool === "video" ? { sourceAssetId: null } : {} })), lines, total: lines.reduce((sum, line) => sum + line.cost, 0) };
}

async function readMotionDocument(userId, documentId, db) {
  const document = await db.studioDocument.findFirst({ where: { id: documentId, userId, kind: "motion", deletedAt: null } });
  if (!document) throw new AppError("DOCUMENT_NOT_FOUND", 404);
  return document;
}

export async function quoteStoryboard(userId, input, db = prisma) {
  assertCreationAccess(await getCreationEnv(userId, { db }), { kind: "motion" });
  const data = storyboardQuoteSchema.parse(input);
  const document = await readMotionDocument(userId, data.documentId, db);
  const plan = await planStoryboard(document.content.video, data.sceneIds, { ...data, db });
  return { documentVersion: document.version, lines: plan.lines, total: plan.total };
}

export async function createStoryboardRun(userId, input, key, db = prisma, env) {
  assertCreationAccess(env || await getCreationEnv(userId, { db }), { kind: "motion", runs: true });
  const data = storyboardRunSchema.parse(input);
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key || "")) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  const requestId = createHash("sha256").update(`storyboard:${userId}:${key}`).digest("hex"), digest = digestJson({ ...data, documentVersion: undefined });
  const include = { steps: { orderBy: { position: "asc" } } };
  const replay = await db.creationRun.findUnique({ where: { requestId }, include });
  if (replay) {
    if (replay.userId !== userId || replay.digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
    return presentRun(replay);
  }
  const heartbeats = await db.serviceHeartbeat.findMany({ where: { id: { in: ["worker", "creation-worker"] }, updatedAt: { gt: new Date(Date.now() - 90000) } }, select: { id: true } });
  if (heartbeats.length !== 2) throw new AppError("CREATION_WORKER_UNAVAILABLE", 503);
  const document = await readMotionDocument(userId, data.documentId, db);
  if (document.version !== data.documentVersion) throw new AppError("DOCUMENT_VERSION_CONFLICT", 409);
  const plan = await planStoryboard(document.content.video, data.sceneIds, { ...data, db });
  if (plan.total !== data.expectedTotal) throw new AppError("PRICE_CHANGED", 409);
  if (plan.total > data.maxCredits) throw new AppError("CREATION_BUDGET_EXCEEDED", 409);
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const old = await tx.creationRun.findUnique({ where: { requestId }, include });
    if (old) { if (old.digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT", 409); return presentRun(old); }
    const current = await tx.studioDocument.findFirst({ where: { id: data.documentId, userId, kind: "motion", deletedAt: null }, select: { version: true } });
    if (current?.version !== data.documentVersion) throw new AppError("DOCUMENT_VERSION_CONFLICT", 409);
    if (await tx.creationRun.count({ where: { userId, status: { in: [...RUN_ACTIVE, ...RUN_WAITING] } } })) throw new AppError("CREATION_USER_QUEUE_FULL", 429);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('creation-admission', 0))::text`;
    if (await tx.creationRun.count({ where: { status: { in: RUN_ACTIVE } } }) >= 1000) throw new AppError("CREATION_QUEUE_FULL", 503);
    const run = await tx.creationRun.create({ data: { userId, documentId: data.documentId, requestId, digest, kind: "storyboard", maxCredits: data.maxCredits,
      input: { summary: `分镜成片 · ${data.sceneIds.length} 个镜头`, clientKey: key, sceneIds: data.sceneIds }, steps: { create: plan.steps } }, include });
    const updated = await appendRunEvent(tx, run.id, "run.created", { stepCount: plan.steps.length, maxCredits: data.maxCredits });
    await enqueueRun(tx, run.id, "initial");
    return presentRun({ ...updated, steps: run.steps });
  }, { maxWait: 10000, timeout: 15000 });
}

// 继续 / 重试时按当前价格重新报价剩余步骤（与 priceVideoShots 的返回结构一致）。
export async function priceStoryboardSteps(steps, _provider, db = prisma) {
  const costs = [];
  for (const step of steps) {
    if (step.tool === "motion-render") { costs.push(0); continue; }
    const capability = step.tool === "generate" ? "image" : step.tool === "tts" ? "voice" : "video";
    const config = await studioConfig(db, step.params.provider, capability, step.tool, { pinned: step.tool !== "video" && Boolean(step.params.provider), skipPreview: true });
    const tool = (await capabilities(db, config)).tools.find(item => item.id === step.tool);
    if (!tool?.available) throw new AppError(tool?.reason || "TOOL_UNAVAILABLE", 503);
    const variant = step.tool === "video" ? selectVideoVariant(config.videoOptions, step.params.params.videoVariant).variant : null;
    costs.push(step.tool === "generate" ? imageCreditCost(tool, step.params.params.size, 0) : config.videoPricing ? videoJobCost(config.videoPricing, variant?.creditCost ?? tool.cost, step.params.params.duration, step.params.params.resolution || defaultResolution(config.videoPricing)) : variant?.creditCost ?? tool.cost);
  }
  return { costs, providers: [] };
}

const rounded = value => Math.round(value * 10) / 10;

// 在导出前把各步骤产物写回分镜工程：首帧、视频片段、旁白与新时长。已写回的运行直接跳过。
export async function applyStoryboardResults(run, { db = prisma, inspect = inspectVideoResult } = {}) {
  const document = await readMotionDocument(run.userId, run.documentId, db);
  const video = document.content.video;
  if (video.shotRunId === run.id && video.confirmed) return document;
  const jobIds = run.steps.filter(step => step.jobId && step.tool !== "motion-render").map(step => step.jobId);
  const jobs = new Map((await db.tryOn.findMany({ where: { id: { in: jobIds }, userId: run.userId, status: "succeeded" }, select: { id: true, resultData: true } })).map(job => [job.id, job]));
  const media = [...video.media];
  const keep = item => { if (!media.some(row => row.id === item.id)) media.push(item); };
  const scenes = [];
  let total = video.composition.scenes.reduce((sum, scene) => sum + scene.duration, 0);
  for (const scene of video.composition.scenes) {
    const steps = run.steps.filter(step => step.params?.sceneId === scene.id);
    if (!steps.length) { scenes.push(scene); continue; }
    const next = { ...scene, status: "ready" };
    for (const step of steps) {
      const asset = jobs.get(step.jobId)?.resultData?.assets?.[0];
      if (!asset) { next.status = "failed"; continue; }
      if (step.tool === "generate") {
        keep({ id: asset.id, name: `${scene.name || "镜头"}首帧.png`.slice(0, 160), type: "image", duration: 0 });
        next.frameAssetId = asset.id;
        if (scene.source === "ai-image") { next.assetId = asset.id; next.trimStart = 0; }
      } else if (step.tool === "video") {
        const info = await inspect(run.userId, asset.id, { db });
        keep({ id: info.id, name: `${scene.name || "镜头"}.mp4`.slice(0, 160), type: "video", duration: info.duration, proof: info.proof });
        const duration = Math.max(1, Math.min(next.duration, Math.floor(info.duration * 10) / 10));
        total += duration - next.duration;
        Object.assign(next, { assetId: info.id, trimStart: 0, duration });
      } else if (step.tool === "tts") {
        keep({ id: asset.id, name: `${scene.name || "镜头"}旁白.mp3`.slice(0, 160), type: "audio", duration: asset.duration, proof: asset.proof });
        next.narrationAssetId = asset.id;
      }
    }
    // 静态画面镜头随旁白延长，视频镜头保持片段时长（旁白超出部分在导出时截断）。
    const narration = media.find(item => item.id === next.narrationAssetId);
    const isClip = media.find(item => item.id === next.assetId)?.type === "video";
    if (narration && !isClip && narration.duration + .3 > next.duration) {
      const extended = Math.min(30, rounded(narration.duration + .4));
      if (total + extended - next.duration <= 180) { total += extended - next.duration; next.duration = extended; }
    }
    scenes.push(next);
  }
  const composition = { ...video.composition, scenes };
  const used = new Set(motionAssetIds(composition).concat(scenes.map(scene => scene.frameAssetId).filter(Boolean)));
  const pruned = media.filter(item => used.has(item.id) || !GENERATED_MEDIA.test(item.id));
  if (pruned.length > 40) throw new AppError("VIDEO_MEDIA_LIMIT", 422);
  return saveDocument(run.userId, { id: document.id, version: document.version, name: document.name,
    content: { ...document.content, video: { ...video, media: pruned, composition, confirmed: true, shotRunId: run.id } } }, db);
}
