import { z } from "zod";
import { dependencyReferencesSchema } from "./dependency-references.js";
import { documentId, documentSectionSchema, documentOperationsSchema, textDocumentSchema, documentAssetIds, documentTextLeaves, documentPageSchema, documentThemeSchema } from "./document.js";
import { applyDocumentOperations, replaceDocumentText } from "../document-operations.js";

const common = { dependencyRefs: dependencyReferencesSchema.optional(), prompt: z.string().trim().min(1).max(12000), locale: z.enum(["zh", "en"]).default("zh"), assetIds: z.array(documentId).max(8).default([]), referenceIds: z.array(documentId).max(8).default([]) };
export const documentDesignSchema = z.object({
  purpose: z.string().max(800), tone: z.string().max(600), narrative: z.string().max(1600), terminology: z.string().max(1200),
  page: documentPageSchema, theme: documentThemeSchema,
}).strict();
export const documentOutlineSchema = z.object({ title: z.string().trim().min(1).max(160),
  design: documentDesignSchema.optional(),
  sections: z.array(z.object({ id: documentId, title: z.string().trim().min(1).max(160), brief: z.string().trim().min(1).max(4000) }).strict()).min(1).max(50),
}).strict().refine(value => new Set(value.sections.map(section => section.id)).size === value.sections.length, "DUPLICATE_DOCUMENT_ID");
export const documentLanguageInputSchema = z.discriminatedUnion("purpose", [
  z.object({ ...common, purpose: z.literal("document.outline"), sectionCount: z.number().int().min(1).max(50), audience: z.string().max(500).default("") }).strict(),
  z.object({ ...common, purpose: z.literal("document.section"), sectionId: documentId, title: z.string().min(1).max(160), brief: z.string().min(1).max(4000),
    documentTitle: z.string().min(1).max(160), audience: z.string().max(500).default(""), headings: z.array(z.object({ id: documentId, title: z.string().min(1).max(160) }).strict()).min(1).max(50),
    design: documentDesignSchema.optional(),
  }).strict(),
  z.object({ ...common, purpose: z.literal("document.edit"), artifactId: documentId, baseRevision: z.number().int().positive(), sectionId: documentId,
    blockIds: z.array(documentId).min(1).max(100),
    range: z.object({ blockId: documentId, leafId: documentId, start: z.number().int().min(0).max(16000), end: z.number().int().min(0).max(16000), expectedText: z.string().max(16000) }).strict().optional(),
  }).strict(),
]);
const fail = code => { const error = new Error(code); error.name = "LanguageResultError"; error.code = code; throw error; };
export function validateDocumentSelection(input, source) {
  if (source?.kind !== "document") fail("LANGUAGE_SOURCE_MISMATCH");
  const section = source.sections.find(section => section.id === input.sectionId);
  if (!section || new Set(input.blockIds).size !== input.blockIds.length || input.blockIds.some(id => !section.blocks.some(block => block.id === id && !block.locked))) fail("LANGUAGE_SELECTION_CHANGED");
  if (input.range) {
    const range = input.range, block = section.blocks.find(block => block.id === range.blockId);
    const leaf = block && documentTextLeaves(block).find(leaf => leaf.id === range.leafId);
    if (!input.blockIds.includes(range.blockId) || !leaf) fail("LANGUAGE_SELECTION_CHANGED");
    // Validate the range before any paid call, using a no-op replacement.
    replaceDocumentText(leaf.runs, { ...range, text: range.expectedText });
  }
  return section;
}
export function validateDocumentLanguageResult(input, raw, source) {
  if (input.purpose === "document.outline") {
    const result = documentOutlineSchema.parse(raw);
    if (result.sections.length !== input.sectionCount) fail("LANGUAGE_OUTLINE_MISMATCH");
    return result;
  }
  if (input.purpose === "document.section") {
    const result = documentSectionSchema.parse(raw), approved = input.headings.find(section => section.id === input.sectionId);
    if (!approved || approved.title !== input.title || new Set(input.headings.map(section => section.id)).size !== input.headings.length || result.id !== input.sectionId || result.title !== input.title) fail("LANGUAGE_DOCUMENT_MISMATCH");
    const checked = textDocumentSchema.parse({ schemaVersion: 1, kind: "document", title: input.documentTitle, sections: [result] });
    if (documentAssetIds(checked).some(id => !input.assetIds.includes(id))) fail("LANGUAGE_UNKNOWN_ASSET");
    if (!result.blocks.some(block => block.type === "image" || documentTextLeaves(block).some(leaf => leaf.runs.some(run => run.text.trim())))) fail("LANGUAGE_EMPTY_DOCUMENT");
    if (result.blocks.some(block => block.locked)) fail("AI_CANNOT_CHANGE_LOCK");
    return result;
  }
  if (input.purpose !== "document.edit" || source?.kind !== "document") fail("LANGUAGE_SOURCE_MISMATCH");
  validateDocumentSelection(input, source);
  const { operations } = z.object({ operations: documentOperationsSchema }).strict().parse(raw);
  for (const op of operations) {
    if (!["replaceDocumentBlock", "replaceDocumentText"].includes(op.op) || op.sectionId !== input.sectionId || !input.blockIds.includes(op.blockId)) fail("LANGUAGE_EDIT_OUTSIDE_SCOPE");
    if (input.range) {
      const range = input.range;
      // A text selection is one exact splice. Multiple sequential splices could
      // shift offsets and escape the originally selected range.
      if (operations.length !== 1 || op.op !== "replaceDocumentText" || range.blockId !== op.blockId || range.leafId !== op.leafId || range.start !== op.start || range.end !== op.end || range.expectedText !== op.expectedText) fail("LANGUAGE_EDIT_OUTSIDE_SCOPE");
    }
  }
  const next = textDocumentSchema.parse(applyDocumentOperations(source, operations));
  const allowed = new Set([...input.assetIds, ...documentAssetIds(source)]);
  if (documentAssetIds(next).some(id => !allowed.has(id))) fail("LANGUAGE_UNKNOWN_ASSET");
  return { operations };
}
