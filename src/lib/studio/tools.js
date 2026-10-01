import { z } from "zod";
import { commerceSchema } from "../commerce/schema.js";
import { TOOLS, getTool } from "./tool-catalog.js";

export { TOOLS, getTool } from "./tool-catalog.js";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const positive = z.number().int().min(1).max(8192);
const edgePadding = z.number().int().min(0).max(1024);
const boundsSchema = z.object({ left: z.number().int().min(0).max(8192), top: z.number().int().min(0).max(8192), width: positive, height: positive }).strict();
export const paramsSchema = z.object({
  prompt: z.string().trim().max(4000).default(""),
  size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).default("1024x1024"),
  scale: z.union([z.literal(2), z.literal(4)]).default(2),
  rect: z.object({ left: z.number().int().min(0).max(8192), top: z.number().int().min(0).max(8192), width: positive, height: positive }).strict().optional(),
  cropShape: z.enum(["rectangle", "ellipse", "triangle", "heart", "grid"]).default("rectangle"),
  cropGrid: z.object({ x: z.array(z.number().min(.01).max(.99)).max(4), y: z.array(z.number().min(.01).max(.99)).max(4) }).strict().refine(grid => [grid.x, grid.y].every(cuts => cuts.every((value, index) => !index || value > cuts[index - 1])), "INVALID_CROP_GRID").optional(),
  padding: z.union([
    z.number().int().min(32).max(1024),
    z.object({ left: edgePadding, right: edgePadding, top: edgePadding, bottom: edgePadding }).strict()
      .refine(value => value.left + value.right + value.top + value.bottom >= 32, "EXPANSION_REQUIRED"),
  ]).default(256),
  dx: z.number().int().min(-8192).max(8192).default(100),
  dy: z.number().int().min(-8192).max(8192).default(0),
  moveSource: boundsSchema.extend({ rotation: z.number().min(-360).max(360).default(0) }).optional(),
  moveTarget: boundsSchema.extend({ rotation: z.number().min(-360).max(360).default(0) }).optional(),
  selectionMode: z.enum(["mask", "object", "region"]).default("mask"),
  editPadding: z.number().min(0.05).max(0.5).default(0.25),
  duration: z.union([z.literal(5), z.literal(10)]).default(5),
  numLayers: z.number().int().min(2).max(8).default(4),
}).strict();
export const jobSchema = z.object({ tool: z.enum(TOOLS.map(tool => tool.id)), provider: id.optional(), documentId: id, documentVersion: z.number().int().positive(), targetId: id.optional(), assetId: id.optional(), maskId: id.optional(), moveBundle: z.object({ objectAssetId: id, holeAssetId: id, bounds: boundsSchema }).strict().optional(), referenceAssetIds: z.array(id).max(2).optional(), sectionId: id.optional(), sectionAttempt: z.number().int().min(0).max(50).optional(), params: paramsSchema.prefault({}) }).strict().superRefine((data, ctx) => {
  const tool = getTool(data.tool);
  if (data.moveBundle && data.tool !== "move") ctx.addIssue({ code: "custom", message: "INVALID_MOVE_BUNDLE" });
  if (tool.source && !data.assetId) ctx.addIssue({ code: "custom", message: "SOURCE_REQUIRED", path: ["assetId"] });
  if (data.params.selectionMode === "region" && (data.tool !== "move" || !data.params.moveSource || !data.params.moveTarget)) ctx.addIssue({ code: "custom", message: "MOVE_REGIONS_REQUIRED" });
  if (data.params.selectionMode === "region" && data.params.moveSource && data.params.moveTarget && JSON.stringify(data.params.moveSource) === JSON.stringify(data.params.moveTarget)) ctx.addIssue({ code: "custom", message: "MOVE_DESTINATION_REQUIRED" });
  if (tool.mask && !data.maskId && !(data.tool === "move" && data.params.selectionMode === "region")) ctx.addIssue({ code: "custom", message: "MASK_REQUIRED", path: ["maskId"] });
  if (data.tool === "crop" && !data.params.rect) ctx.addIssue({ code: "custom", message: "CROP_REQUIRED", path: ["params"] });
  if (["generate", "edit", "inpaint", "video"].includes(data.tool) && !data.params.prompt) ctx.addIssue({ code: "custom", message: "PROMPT_REQUIRED", path: ["params", "prompt"] });
});

const layer = z.object({
  id, type: z.enum(["image", "text", "video"]), name: z.string().max(160), assetId: id.optional(),
  x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000), width: z.number().min(1).max(8192), height: z.number().min(1).max(8192),
  rotation: z.number().finite().min(-360).max(360).default(0), visible: z.boolean().default(true), opacity: z.number().min(0).max(1).default(1),
  pixelWidth: positive.optional(), pixelHeight: positive.optional(), text: z.string().max(4000).optional(), fontSize: z.number().min(8).max(512).optional(), fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), sourceJobId: id.optional(),
  groupId: id.optional(), layerRole: z.enum(["background", "object", "decomposed"]).optional(), repairJobId: id.optional(),
}).strict();
export const contentSchema = z.object({
  schemaVersion: z.literal(1), layers: z.array(layer).max(1000),
  commerce: commerceSchema.optional(),
  composer: z.object({ text: z.string().max(4000).default(""), fixedPrompt: z.string().max(2000).default(""), referenceIds: z.array(id).max(3).default([]), outputCount: z.number().int().min(1).max(4).default(1) }).strict().optional(),
  messages: z.array(z.object({ id, role: z.enum(["user", "assistant"]), text: z.string().max(8000), assetId: id.optional() }).strict()).max(20000),
  jobs: z.array(id).max(100),
  appliedJobs: z.array(id).max(20000).default([]),
  plan: z.object({ id, summary: z.string().max(1000), steps: z.array(z.object({ tool: z.enum(TOOLS.map(t => t.id)), params: paramsSchema, explanation: z.string().max(500) }).strict()).min(1).max(4), credits: z.number().int().nonnegative(), attempt: z.number().int().min(0).max(100).default(0), index: z.number().int().min(0).max(4), targetId: id.nullable(), activeJob: id.nullable(), status: z.enum(["ready", "running", "paused", "complete"]) }).strict().nullable().optional(),
}).strict().superRefine((content, ctx) => {
  if (new Set(content.layers.map(l => l.id)).size !== content.layers.length) ctx.addIssue({ code: "custom", message: "DUPLICATE_LAYER" });
  for (const l of content.layers) if (l.type !== "text" && !l.assetId) ctx.addIssue({ code: "custom", message: "ASSET_REQUIRED" });
});
export const documentSchema = z.object({ copyFromId: id.optional(), id: id.optional(), version: z.number().int().positive().optional(), createKey: id.optional(), nameSource: z.enum(["manual", "prompt", "upload", "fallback"]).optional(), name: z.string().trim().min(1).max(100), content: contentSchema }).strict();
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
