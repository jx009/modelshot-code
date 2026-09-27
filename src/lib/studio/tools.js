import { z } from "zod";
import { commerceSchema } from "../commerce/schema.js";

export const TOOLS = [
  { id: "generate", zh: "生成图片", en: "Generate image", dependency: "image", cost: 18, source: false },
  { id: "edit", zh: "参考图编辑", en: "Edit image", dependency: "image", cost: 18, source: true },
  { id: "expand", zh: "AI 扩图", en: "AI expand", dependency: "image", cost: 18, source: true },
  { id: "upscale", zh: "AI 超清放大", en: "AI upscale", dependency: "upscale", cost: 4, source: true },
  { id: "describe", zh: "反推提示词", en: "Reverse prompt", dependency: "vision", cost: 1, source: true },
  { id: "erase", zh: "AI 智能消除", en: "AI erase", dependency: "image", cost: 18, source: true, mask: true },
  { id: "inpaint", zh: "局部修改", en: "Local edit", dependency: "image", cost: 18, source: true, mask: true },
  { id: "split", zh: "图层拆分", en: "Split layers", dependency: "split", cost: 20, source: true },
  { id: "move", zh: "物体移动", en: "Move object", dependency: "image", cost: 18, source: true, mask: true },
  { id: "ocr", zh: "文字识别", en: "Recognize text", dependency: "ocr", cost: 1, source: true },
  { id: "remove-bg", zh: "一键抠图", en: "Remove background", dependency: "remove-bg", cost: 2, source: true },
  { id: "crop", zh: "图片裁剪", en: "Crop image", dependency: "local", cost: 0, source: true },
  { id: "video", zh: "生成视频", en: "Generate video", dependency: "video", cost: 60, source: true },
];
export const getTool = id => TOOLS.find(tool => tool.id === id);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const positive = z.number().int().min(1).max(8192);
const edgePadding = z.number().int().min(0).max(1024);
export const paramsSchema = z.object({
  prompt: z.string().trim().max(4000).default(""),
  size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).default("1024x1024"),
  scale: z.union([z.literal(2), z.literal(4)]).default(2),
  rect: z.object({ left: z.number().int().min(0).max(8192), top: z.number().int().min(0).max(8192), width: positive, height: positive }).strict().optional(),
  padding: z.union([
    z.number().int().min(32).max(1024),
    z.object({ left: edgePadding, right: edgePadding, top: edgePadding, bottom: edgePadding }).strict()
      .refine(value => value.left + value.right + value.top + value.bottom >= 32, "EXPANSION_REQUIRED"),
  ]).default(256),
  dx: z.number().int().min(-8192).max(8192).default(100),
  dy: z.number().int().min(-8192).max(8192).default(0),
  duration: z.union([z.literal(5), z.literal(10)]).default(5),
}).strict();
export const jobSchema = z.object({ tool: z.enum(TOOLS.map(tool => tool.id)), provider: id.optional(), documentId: id, documentVersion: z.number().int().positive(), targetId: id.optional(), assetId: id.optional(), maskId: id.optional(), referenceAssetIds: z.array(id).max(2).optional(), sectionId: id.optional(), sectionAttempt: z.number().int().min(0).max(50).optional(), params: paramsSchema.prefault({}) }).strict().superRefine((data, ctx) => {
  const tool = getTool(data.tool);
  if (tool.source && !data.assetId) ctx.addIssue({ code: "custom", message: "SOURCE_REQUIRED", path: ["assetId"] });
  if (tool.mask && !data.maskId) ctx.addIssue({ code: "custom", message: "MASK_REQUIRED", path: ["maskId"] });
  if (data.tool === "crop" && !data.params.rect) ctx.addIssue({ code: "custom", message: "CROP_REQUIRED", path: ["params"] });
  if (["generate", "edit", "inpaint", "video"].includes(data.tool) && !data.params.prompt) ctx.addIssue({ code: "custom", message: "PROMPT_REQUIRED", path: ["params", "prompt"] });
});

const layer = z.object({
  id, type: z.enum(["image", "text", "video"]), name: z.string().max(160), assetId: id.optional(),
  x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000), width: z.number().min(1).max(8192), height: z.number().min(1).max(8192),
  rotation: z.number().finite().min(-360).max(360).default(0), visible: z.boolean().default(true), opacity: z.number().min(0).max(1).default(1),
  pixelWidth: positive.optional(), pixelHeight: positive.optional(), text: z.string().max(4000).optional(), fontSize: z.number().min(8).max(512).optional(), fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), sourceJobId: id.optional(),
}).strict();
export const contentSchema = z.object({
  schemaVersion: z.literal(1), layers: z.array(layer).max(150),
  commerce: commerceSchema.optional(),
  messages: z.array(z.object({ id, role: z.enum(["user", "assistant"]), text: z.string().max(8000), assetId: id.optional() }).strict()).max(100),
  jobs: z.array(id).max(100),
  appliedJobs: z.array(id).max(100).default([]),
  plan: z.object({ id, summary: z.string().max(1000), steps: z.array(z.object({ tool: z.enum(TOOLS.map(t => t.id)), params: paramsSchema, explanation: z.string().max(500) }).strict()).min(1).max(4), credits: z.number().int().nonnegative(), attempt: z.number().int().min(0).max(100).default(0), index: z.number().int().min(0).max(4), targetId: id.nullable(), activeJob: id.nullable(), status: z.enum(["ready", "running", "paused", "complete"]) }).strict().nullable().optional(),
}).strict().superRefine((content, ctx) => {
  if (new Set(content.layers.map(l => l.id)).size !== content.layers.length) ctx.addIssue({ code: "custom", message: "DUPLICATE_LAYER" });
  for (const l of content.layers) if (l.type !== "text" && !l.assetId) ctx.addIssue({ code: "custom", message: "ASSET_REQUIRED" });
});
export const documentSchema = z.object({ id: id.optional(), version: z.number().int().positive().optional(), name: z.string().trim().min(1).max(100), content: contentSchema }).strict();
export const planSchema = z.object({ summary: z.string().max(1000), steps: z.array(z.object({ tool: z.enum(["generate", "edit", "expand", "upscale", "describe", "split", "remove-bg", "ocr", "video"]), params: paramsSchema, explanation: z.string().max(500) }).strict()).min(1).max(4) }).strict();

export function validatePlan(value, available, hasImage, costs = {}) {
  const plan = planSchema.parse(value);
  for (const [index, step] of plan.steps.entries()) {
    const tool = getTool(step.tool);
    if (!available.includes(step.tool) || tool.source && !hasImage || ["generate", "edit", "video"].includes(step.tool) && !step.params.prompt) throw new Error("INVALID_AGENT_PLAN");
    if (["describe", "ocr", "video"].includes(step.tool) && index !== plan.steps.length - 1) throw new Error("INVALID_AGENT_PLAN");
    if (!["describe", "ocr", "video"].includes(step.tool)) hasImage = true;
  }
  return { ...plan, credits: plan.steps.reduce((sum, step) => sum + (costs[step.tool] ?? getTool(step.tool).cost), 0) };
}
