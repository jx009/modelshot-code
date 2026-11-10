import { z } from "zod";
import { VIDEO_DURATIONS } from "./model-protocols.js";

export const videoDurationSchema = z.union(VIDEO_DURATIONS.map(value => z.literal(value)));

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const videoRatios = ["16:9", "9:16", "1:1", "4:5"];
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
}).strict();
export const motionSchema = z.object({
  version: z.literal(1), ratio: z.enum(videoRatios), fps: z.literal(24),
  scenes: z.array(motionSceneSchema).min(1).max(40),
  audio: z.object({ assetId: id, volume: z.number().min(0).max(1), trimStart: z.number().min(0).max(1800) }).strict().nullable().default(null),
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
  videoFields: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/), z.string().max(1000)).refine(value => Object.keys(value).length <= 12).optional(),
  mode: z.enum(["video", "motion"]), media: z.array(videoMediaSchema).max(50).default([]),
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
export function motionAssetIds(composition) {
  return [...new Set([...(composition?.scenes || []).map(scene => scene.assetId), composition?.audio?.assetId].filter(Boolean))];
}
export function videoAssetIds(video) { return [...new Set([...(video?.media || []).map(media => media.id), ...motionAssetIds(video?.composition), video?.canvasOrigin?.assetId, video?.sceneOrigin?.assetId].filter(Boolean))]; }
