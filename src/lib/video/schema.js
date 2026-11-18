import { z } from "zod";
import { VIDEO_DURATIONS } from "./model-protocols.js";
import { RESOLUTIONS } from "./pricing.js";

export const videoDurationSchema = z.union(VIDEO_DURATIONS.map(value => z.literal(value)));

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const videoRatios = ["16:9", "9:16", "1:1", "4:5"];
// ai-image-video：先生成首帧再用视频模型；ai-video：直接文生视频；ai-image：只生图并做推拉镜头；
// media：使用用户素材；text：纯文字 / 色块。
export const MOTION_SCENE_SOURCES = ["ai-image-video", "ai-video", "ai-image", "media", "text"];
export const MOTION_SCENARIOS = ["product", "story", "explainer"];
export const videoMediaSchema = z.object({
  id, name: z.string().max(160), type: z.enum(["image", "video", "audio"]),
  duration: z.number().finite().min(0).max(1800).default(0),
  role: z.enum(["first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"]).optional(),
  proof: z.string().max(2048).optional(),
}).strict();
export const motionSceneSchema = z.object({
  id, name: z.string().max(100), duration: z.number().finite().min(1).max(30),
  title: z.string().max(160), subtitle: z.string().max(320).default(""),
  background: color.default("#111827"), color: color.default("#ffffff"), accent: color.default("#818cf8"),
  fontSize: z.number().int().min(24).max(120).default(64),
  align: z.enum(["left", "center", "right"]).default("center"),
  position: z.enum(["top", "center", "bottom"]).default("center"),
  animation: z.enum(["none", "fade", "rise", "zoom"]).default("rise"),
  assetId: id.nullable().default(null), trimStart: z.number().finite().min(0).max(1800).default(0),
  volume: z.number().min(0).max(1).default(0),
  // 分镜成片：画面描述、运镜、画面来源、旁白与转场。旧工程缺省为纯文字镜头，行为不变。
  visual: z.string().max(1000).default(""),
  camera: z.string().max(80).default(""),
  source: z.enum(MOTION_SCENE_SOURCES).default("text"),
  narration: z.string().max(400).default(""),
  narrationAssetId: id.nullable().default(null),
  frameAssetId: id.nullable().default(null),
  transition: z.enum(["cut", "fade"]).default("cut"),
  status: z.enum(["draft", "ready", "failed"]).default("draft"),
}).strict();
export const motionSchema = z.object({
  version: z.literal(1), ratio: z.enum(videoRatios), fps: z.literal(24),
  scenes: z.array(motionSceneSchema).min(1).max(40),
  audio: z.object({ assetId: id, volume: z.number().min(0).max(1), trimStart: z.number().min(0).max(1800), libraryTrackId: id.optional() }).strict().nullable().default(null),
  subtitles: z.boolean().default(true),
  voice: z.object({ provider: id, voice: z.string().regex(/^[a-zA-Z0-9_.:-]{1,64}$/) }).strict().nullable().default(null),
  scenario: z.enum(MOTION_SCENARIOS).nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.scenes.map(scene => scene.id)).size !== value.scenes.length) ctx.addIssue({ code: "custom", message: "DUPLICATE_SCENE" });
  if (value.scenes.reduce((sum, scene) => sum + scene.duration, 0) > 180) ctx.addIssue({ code: "custom", message: "VIDEO_TOO_LONG" });
});
export const videoDocumentSchema = z.object({
  prompt: z.string().max(4000).default(""),
  canvasOrigin: z.object({ documentId: id, layerId: id, assetId: id }).strict().optional(),
  sceneOrigin: z.object({ documentId: id, sceneId: id, assetId: id.nullable(), sourceJobId: id.optional(), sourceType: z.enum(["image", "video"]).optional() }).strict().optional(),
  shotRunId: id.optional(),
  provider: id.optional(),
  videoVariant: id.optional(),
  // 用户选择的输出清晰度；按秒计费的模型据此报价与扣费。
  resolution: z.enum(RESOLUTIONS).optional(),
  videoFields: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/), z.string().max(1000)).refine(value => Object.keys(value).length <= 12).optional(),
  mode: z.enum(["video", "motion"]), media: z.array(videoMediaSchema).max(50).default([]),
  scenario: z.enum(MOTION_SCENARIOS).nullable().default(null),
  composition: motionSchema.nullable().default(null), ratio: z.enum(videoRatios).default("16:9"),
  confirmed: z.boolean().default(false),
  duration: videoDurationSchema.default(5),
}).strict().superRefine((value, ctx) => {
  if (value.mode === "video" && value.composition || value.mode === "motion" && value.media.length > 40) ctx.addIssue({ code: "custom", message: "VIDEO_MEDIA_LIMIT" });
  if ((value.canvasOrigin || value.sceneOrigin) && value.mode !== "video" || value.canvasOrigin && value.sceneOrigin) ctx.addIssue({ code: "custom", message: "VIDEO_ORIGIN_CHANGED" });
  if (new Set(value.media.map(item => item.id)).size !== value.media.length) ctx.addIssue({ code: "custom", message: "DUPLICATE_MEDIA" });
  const ids = new Set(value.media.map(item => item.id));
  if (motionAssetIds(value.composition).some(assetId => !ids.has(assetId))) ctx.addIssue({ code: "custom", message: "MOTION_MEDIA_INVALID" });
});
// 工程内引用的用户素材（必须出现在 media 中）。曲库配乐属于平台素材，单独由 motionLibraryAssetId 处理。
export function motionAssetIds(composition) {
  const scenes = composition?.scenes || [];
  return [...new Set([...scenes.map(scene => scene.assetId), ...scenes.map(scene => scene.narrationAssetId), composition?.audio && !composition.audio.libraryTrackId ? composition.audio.assetId : null].filter(Boolean))];
}
export function motionLibraryAssetId(composition) { return composition?.audio?.libraryTrackId ? composition.audio.assetId : null; }
export function videoAssetIds(video) { return [...new Set([...(video?.media || []).map(media => media.id), ...motionAssetIds(video?.composition), video?.canvasOrigin?.assetId, video?.sceneOrigin?.assetId].filter(Boolean))]; }
