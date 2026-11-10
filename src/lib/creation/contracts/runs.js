import { z } from "zod";
import { paramsSchema, getTool } from "../../studio/tools.js";
import { IMAGE_REFERENCE_ROLES } from "../../studio/image-references.js";

export const RUN_TERMINAL = ["succeeded", "failed", "cancelled"];
export const RUN_ACTIVE = ["queued", "running", "cancelling"];
export const RUN_WAITING = ["awaiting_budget", "awaiting_input"];
export const IMAGE_PLAN_TOOLS = ["generate", "edit", "expand", "upscale", "describe", "split", "remove-bg", "ocr", "video"];
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const imageRunSchema = z.object({
  kind: z.literal("image"),
  documentId: identifier,
  documentVersion: z.number().int().positive(),
  provider: identifier.optional(),
  source: z.object({ targetId: identifier, assetId: identifier }).strict().optional(),
  referenceAssetIds: z.array(identifier).max(2).optional(),
  referenceRoles: z.array(z.enum(IMAGE_REFERENCE_ROLES)).max(3).optional(),
  summary: z.string().max(1000),
  maxCredits: z.number().int().min(0).max(200000),
  expectedCosts: z.array(z.number().int().min(0).max(200000)).min(1).max(24).optional(),
  steps: z.array(z.object({
    tool: z.enum(IMAGE_PLAN_TOOLS), params: paramsSchema,
    explanation: z.string().max(500),
  }).strict()).min(1).max(24),
}).strict().superRefine((value, ctx) => {
  if (value.expectedCosts && value.expectedCosts.length !== value.steps.length) ctx.addIssue({ code: "custom", message: "PLAN_QUOTE_INVALID" });
  const refs = [value.source?.assetId, ...(value.referenceAssetIds || [])].filter(Boolean);
  if (new Set(refs).size !== refs.length || value.referenceAssetIds?.length && !value.source || value.referenceRoles && value.referenceRoles.length !== refs.length) ctx.addIssue({ code: "custom", message: "IMAGE_REFERENCE_ROLES_INVALID" });
  let image = Boolean(value.source);
  value.steps.forEach((step, index) => {
    if (getTool(step.tool).source && !image) ctx.addIssue({ code: "custom", path: ["steps", index], message: "SOURCE_REQUIRED" });
    if (["generate", "edit", "video"].includes(step.tool) && !step.params.prompt) ctx.addIssue({ code: "custom", path: ["steps", index], message: "PROMPT_REQUIRED" });
    const terminal = ["describe", "ocr", "video"].includes(step.tool);
    if (terminal && index !== value.steps.length - 1) ctx.addIssue({ code: "custom", path: ["steps", index], message: "NON_IMAGE_OUTPUT_MUST_BE_LAST" });
    if (step.params.selectionMode !== "mask") ctx.addIssue({ code: "custom", path: ["steps", index], message: "INTERACTIVE_SELECTION_UNSUPPORTED" });
    if (!terminal) image = true;
  });
});

export const resumeRunSchema = z.object({
  expectedSequence: z.number().int().positive(),
  maxCredits: z.number().int().min(0).max(200000),
  retryFailed: z.boolean().default(false),
}).strict();

// Scheduler wakes never carry a model prompt or mutable editor document.
export function isRunTerminal(status) { return RUN_TERMINAL.includes(status); }
export function nextImageSource(run, previousStep, previousJob) {
  if (!previousStep) return run.input.source || null;
  const asset = previousJob?.resultData?.assets?.[0];
  if (!asset?.id || !asset.contentType?.startsWith("image/")) return null;
  return { assetId: asset.id, targetId: `${previousJob.id}-0` };
}

export function imageRunStepInputs(run, step) {
  if (getTool(step.tool).dependency !== "image") return { params: step.params };
  return { params: { ...step.params, ...(run.input.referenceRoles?.length ? { referenceRoles: run.input.referenceRoles } : {}) },
    ...(run.input.referenceAssetIds?.length ? { referenceAssetIds: run.input.referenceAssetIds } : {}) };
}
