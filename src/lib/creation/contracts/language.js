import { z } from "zod";
import { slideDesignSchema, slideComposition, slideDeckContextSchema } from "./slide-design.js";
import { agentLanguageInputSchema, agentPlanSchema, agentReadResultSchema } from "./agent.js";
import { dependencyReferencesSchema } from "./dependency-references.js";
import { validateHtmlLanguageResult } from "../html/language.js";
import { isHtmlDocument } from "../html/document.js";
import { layoutId, layoutDocumentSchema, layoutPageSchema, layoutOperationsSchema, layoutAssetIds } from "./layout.js";
import { applyLayoutOperations } from "../layout-operations.js";
import { nodeIntersectsPage } from "../layout-geometry.js";

export const LANGUAGE_MAX_INPUT_BYTES = 256 * 1024;
export const LANGUAGE_MAX_RESULT_BYTES = 512 * 1024;
export const LANGUAGE_PURPOSES = ["agent.plan", "agent.read", "poster.generate", "poster.edit", "slides.outline", "slides.page", "slides.edit"];
const common = { dependencyRefs: dependencyReferencesSchema.optional(), prompt: z.string().trim().min(1).max(12000), locale: z.enum(["zh", "en"]).default("zh"), assetIds: z.array(layoutId).max(8).default([]), referenceIds: z.array(layoutId).max(8).default([]), sourceFormat: z.literal("html").optional() };
const size = { width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192) };
const edit = { ...common, artifactId: layoutId, baseRevision: z.number().int().positive(), pageId: layoutId,
  nodeIds: z.array(layoutId).max(100).default([]) };
const layoutLanguageInputSchema = z.discriminatedUnion("purpose", [
  z.object({ ...common, ...size, purpose: z.literal("poster.generate"), visualAssetId: layoutId.optional() }).strict(),
  z.object({ ...edit, purpose: z.literal("poster.edit") }).strict(),
  z.object({ ...common, purpose: z.literal("slides.outline"), pageCount: z.number().int().min(1).max(100) }).strict(),
  z.object({ ...common, ...size, ...slideComposition, purpose: z.literal("slides.page"), pageId: layoutId, title: z.string().max(160), brief: z.string().max(4000), theme: layoutDocumentSchema.shape.theme, deck: slideDeckContextSchema.optional(), visualAssetId: layoutId.optional() }).strict(),
  z.object({ ...edit, purpose: z.literal("slides.edit") }).strict(),
]).superRefine((input, ctx) => {
  if (input.width && input.width * input.height > 40_000_000) ctx.addIssue({ code: "custom", message: "CANVAS_TOO_LARGE" });
  if (input.visualAssetId && !input.assetIds.includes(input.visualAssetId)) ctx.addIssue({ code: "custom", message: "LANGUAGE_UNKNOWN_ASSET" });
});
export const languageInputSchema = z.union([agentLanguageInputSchema, layoutLanguageInputSchema]);
export const outlineSchema = z.object({ title: z.string().trim().min(1).max(160), theme: layoutDocumentSchema.shape.theme, design: slideDesignSchema.optional(),
  pages: z.array(z.object({ ...slideComposition, id: layoutId, title: z.string().min(1).max(160), brief: z.string().min(1).max(4000), notes: z.string().max(16000).default("") }).strict()).min(1).max(100),
}).strict().superRefine((value, ctx) => {
  const ids = (value.design?.visuals || []).map(visual => visual.id);
  if (new Set(ids).size !== ids.length || value.pages.some(page => page.visualId && !ids.includes(page.visualId))) ctx.addIssue({ code: "custom", message: "SLIDE_VISUAL_PLAN_INVALID" });
});

export class LanguageResultError extends Error {
  constructor(code) { super(code); this.name = "LanguageResultError"; this.code = code; }
}
const fail = code => { throw new LanguageResultError(code); };

// Provider output is untrusted data. Web markup requires an isolated preview. All edits
// are checked against a fixed revision and server-owned selection scope.
export function validateLanguageResult(input, raw, source) {
  if (input.purpose === "agent.read") return agentReadResultSchema.parse(raw);
  if (input.purpose === "agent.plan") {
    const plan = agentPlanSchema.parse(raw);
    if (plan.steps.some(step => step.request && !input.allowedKinds.includes(step.request.kind) || step.referenceIds?.some(id => !input.referenceIds.includes(id)) || step.tool === "image.generate" && !input.imageSizes.includes(step.size) || step.tool === "content.edit" && (step.request.kind !== input.editRequest?.kind || JSON.stringify(step.request.target) !== JSON.stringify(input.editRequest?.target)))) fail("AGENT_PLAN_SCOPE_INVALID");
    return plan;
  }
  if (input.purpose !== "slides.outline" && (input.sourceFormat === "html" || isHtmlDocument(source))) return validateHtmlLanguageResult(input, raw, source);
  let result;
  if (input.purpose === "poster.generate") {
    result = layoutDocumentSchema.parse(raw);
    if (result.kind !== "poster" || result.pages[0].width !== input.width || result.pages[0].height !== input.height) fail("LANGUAGE_LAYOUT_MISMATCH");
    if (input.visualAssetId && !result.pages[0].nodes.some(node => node.type === "image" && node.assetId === input.visualAssetId && node.visible !== false && node.opacity > 0 && nodeIntersectsPage(node, result.pages[0]))) fail("LANGUAGE_VISUAL_ASSET_MISSING");
  } else if (input.purpose === "slides.outline") {
    result = outlineSchema.parse(raw);
    if (result.pages.length !== input.pageCount || new Set(result.pages.map(page => page.id)).size !== result.pages.length) fail("LANGUAGE_OUTLINE_MISMATCH");
    return result;
  } else if (input.purpose === "slides.page") {
    const page = layoutPageSchema.parse(raw);
    if (page.id !== input.pageId || page.width !== input.width || page.height !== input.height) fail("LANGUAGE_LAYOUT_MISMATCH");
    layoutDocumentSchema.parse({ schemaVersion: 1, kind: "slides", title: input.title || "Slides", theme: input.theme, pages: [page] });
    result = page;
  } else {
    if (!source || source.kind !== (input.purpose === "poster.edit" ? "poster" : "slides")) fail("LANGUAGE_SOURCE_MISMATCH");
    const page = source.pages.find(page => page.id === input.pageId);
    if (!page || input.nodeIds.some(id => !page.nodes.some(node => node.id === id))) fail("LANGUAGE_SELECTION_CHANGED");
    const operations = z.object({ operations: layoutOperationsSchema }).strict().parse(raw).operations;
    for (const op of operations) {
      if (op.pageId !== input.pageId || ["insertPage", "removePage", "reorderPage", "setTitle", "replacePageLayout"].includes(op.op)) fail("LANGUAGE_EDIT_OUTSIDE_SCOPE");
      if (op.op === "setNode" && op.changes.locked !== undefined) fail("AI_CANNOT_CHANGE_LOCK");
      if (input.nodeIds.length && (!op.nodeId || !input.nodeIds.includes(op.nodeId) || op.op === "reorderNode")) fail("LANGUAGE_EDIT_OUTSIDE_SCOPE");
      // A page resize would move/clip locked content indirectly.
      if (op.op === "setPage" && (op.changes.width !== undefined || op.changes.height !== undefined) && page.nodes.some(node => node.locked)) fail("NODE_LOCKED");
    }
    const next = layoutDocumentSchema.parse(applyLayoutOperations(source, operations));
    const permitted = new Set([...input.assetIds, ...layoutAssetIds(source)]);
    if (layoutAssetIds(next).some(id => !permitted.has(id))) fail("LANGUAGE_UNKNOWN_ASSET");
    return { operations };
  }
  const pages = input.purpose === "slides.page" ? [result] : result.pages;
  if (pages.some(page => !page.nodes.some(node => node.visible))) fail("LANGUAGE_EMPTY_LAYOUT");
  const permitted = new Set(input.assetIds);
  if (layoutAssetIds({ pages }).some(id => !permitted.has(id))) fail("LANGUAGE_UNKNOWN_ASSET");
  return result;
}
