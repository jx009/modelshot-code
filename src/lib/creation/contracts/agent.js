import { z } from "zod";
import { POSTER_IMAGE_SIZES } from "./poster-image.js";
import { contentRunSchema } from "./content-runs.js";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const agentRequestSchema = z.object({
  kind: z.literal("agent"), prompt: z.string().trim().min(1).max(12000), locale: z.enum(["zh", "en"]).default("zh"),
  editRequest: contentRunSchema.optional(),
  maxCredits: z.number().int().min(0).max(200000), assetIds: z.array(id).max(8).default([]), referenceIds: z.array(id).max(8).default([]),
}).strict();
const planInput = agentRequestSchema.omit({ kind: true, maxCredits: true }).extend({ purpose: z.literal("agent.plan"), imageSizes: z.array(z.enum(POSTER_IMAGE_SIZES)).max(16).default([]), allowedKinds: z.array(z.enum(["slides"])).min(1).max(1) }).strict();
export const agentLanguageInputSchema = z.union([planInput, agentRequestSchema.omit({ kind: true, maxCredits: true }).extend({ purpose: z.literal("agent.read") }).strict()]);
export const agentReadResultSchema = z.object({ summary: z.string().min(1).max(8000) }).strict();
const base = { id, explanation: z.string().min(1).max(500), dependsOn: z.array(id).max(16).default([]) };
// Planner output never controls prices, provider identities, permissions or
// arbitrary code. Every content tool enters the existing typed admission path.
const content = z.object({ ...base, tool: z.enum(["content.create", "content.edit"]), request: contentRunSchema }).strict();
const exporting = z.object({ ...base, tool: z.literal("artifact.export"), sourceStepId: id, format: z.enum(["png", "jpeg", "pdf", "pptx", "docx", "markdown", "xlsx", "zip"]) }).strict();
const image = z.object({ ...base, tool: z.literal("image.generate"), prompt: z.string().min(1).max(3500), size: z.enum(POSTER_IMAGE_SIZES) }).strict();
const reading = z.object({ ...base, tool: z.literal("reference.read"), referenceIds: z.array(id).min(1).max(8) }).strict();
export const agentPlanSchema = z.object({ title: z.string().min(1).max(160), steps: z.array(z.union([content, exporting, reading, image])).min(1).max(16) }).strict().superRefine((plan, ctx) => {
  const seen = new Map();
  for (const [index, step] of plan.steps.entries()) {
    const issue = message => ctx.addIssue({ code: "custom", path: ["steps", index], message });
    if (seen.has(step.id) || step.dependsOn.some(key => !seen.has(key)) || new Set(step.dependsOn).size !== step.dependsOn.length) issue("AGENT_PLAN_DEPENDENCY_INVALID");
    if (step.request && step.dependsOn.filter(key => seen.get(key)?.request).length > 8) issue("AGENT_PLAN_DEPENDENCY_LIMIT");
    if (step.request && (step.request.image || step.request.assetIds.length || step.request.referenceIds.length || step.tool === "content.create" && step.request.target || step.tool === "content.edit" && !step.request.target)) issue("AGENT_PLAN_SCOPE_INVALID");
    if (step.tool === "artifact.export" && (!step.dependsOn.includes(step.sourceStepId) || !["content.create", "content.edit"].includes(seen.get(step.sourceStepId)?.tool))) issue("AGENT_EXPORT_SOURCE_INVALID");
    if (step.tool === "artifact.export") {
      const kind = seen.get(step.sourceStepId)?.request?.kind;
      if (!({ poster: ["png", "jpeg", "pdf"], slides: ["pptx", "pdf"], document: ["docx", "markdown", "pdf"], sheet: ["xlsx"], web: ["zip"] })[kind]?.includes(step.format)) issue("AGENT_EXPORT_FORMAT_INVALID");
    }
    seen.set(step.id, step);
  }
});

export const AGENT_TOOLS = Object.freeze({
  "content.edit": { queue: "typed-child-run", writes: true, externalSideEffect: false, timeoutMs: 180000, idempotency: "parent-step-child-transaction", price: "typed-model-quote" },
  "image.generate": { queue: "image", writes: true, externalSideEffect: false, timeoutMs: 180000, idempotency: "step-attempt-ledger", price: "image-size-quote" },
  "reference.read": { queue: "creation-language", writes: false, externalSideEffect: false, timeoutMs: 60000, idempotency: "fixed-reference-checksum", price: "one-language-call" },
  "content.create": { queue: "typed-child-run", writes: true, externalSideEffect: false, timeoutMs: 180000, idempotency: "parent-step-child-transaction", price: "typed-model-quote" },
  "artifact.export": { queue: "creation-export", writes: false, externalSideEffect: false, timeoutMs: 900000, idempotency: "revision-format-exporter", price: "zero" },
});
export const AGENT_PLAN_CONFIRMATION_REQUIRED = "CREATION_AGENT_PLAN_CONFIRMATION_REQUIRED";
export const AGENT_PIPELINE_VERSION = 1;
export const AGENT_SCHEDULER_HEARTBEAT = "creation-agent-worker-v1";
export const AGENT_LANGUAGE_HEARTBEAT = "creation-agent-language-v1";
export function agentPlanCalls(request) {
  return request.target ? 1 : request.kind === "slides" ? request.pageCount + 1 : 1;
}
export const agentPlanningGuide = `Plan a bounded creative workflow. Return JSON {title,steps:[...]} with at most 16 steps in topological order. Every step has unique ASCII id, explanation and dependsOn (earlier step IDs). Use only allowedKinds.
Tools:
image.generate: {id,tool:"image.generate",explanation,dependsOn,prompt,size} using only imageSizes. Subsequent content steps must depend on this step to receive its image. Only generate images when the user needs new artwork.
content.edit uses the same structure as content.create but tool:"content.edit". Allowed only when editRequest is supplied. Copy its kind and target exactly, write the requested changes in prompt. Never invent selections or artifact IDs.
reference.read: {id,tool:"reference.read",explanation,dependsOn,referenceIds:[IDs from request]}. Use this to declare supplied reference reading; extraction occurs in the existing language worker, never invent reference contents.
content.create: {id,tool:"content.create",explanation,dependsOn,request:{kind,prompt,locale,maxCredits:0,assetIds:[],referenceIds:[],...type parameters}}. poster needs width,height,pageCount:1; slides needs width:1280,height:720,pageCount; document needs sectionCount,audience; sheet needs sheetCount (1..5),targetRows (1..500); web needs pageCount (1..20). Never set target or image. Each child prompt must be self-contained, preserve the user's facts and explain how to use prior outputs. Dependent outputs are supplied as fixed revision references, not imaginary files. Slides and documents include outline/page/section/assembly tools and pause for outline review.
artifact.export: {id,tool:"artifact.export",explanation,dependsOn:[sourceStepId],sourceStepId,format}. Valid formats: poster png/jpeg/pdf; slides pptx/pdf; document docx/markdown/pdf; sheet xlsx; web zip. Export only when requested. Never publish externally, overwrite files, run code or invent tools. Do not create unnecessary outputs.`;
