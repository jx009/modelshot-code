import { z } from "zod";
import { layoutId } from "./layout.js";

export const NATIVE_DOCUMENT_EDIT_FORMAT = "univer-document-1";
const offset = z.number().int().min(0).max(300000);
const plain = z.string().max(16000).refine(text => text.isWellFormed() && !/[\u0000-\u001f\ufffe\uffff]/.test(text), "NATIVE_DOCUMENT_TEXT_UNSUPPORTED");
export const nativeDocumentSpanSchema = z.object({ start: offset, end: offset, expectedText: plain.min(1) }).strict()
  .refine(span => span.end > span.start && span.expectedText.length === span.end - span.start, "LANGUAGE_SELECTION_CHANGED");
export const nativeDocumentSpansSchema = z.array(nativeDocumentSpanSchema).min(1).max(64).superRefine((spans, ctx) => {
  if (spans.reduce((sum, span) => sum + span.expectedText.length, 0) > 12000 || spans.some((span, index) => index && span.start < spans[index - 1].end)) ctx.addIssue({ code: "custom", message: "NATIVE_DOCUMENT_AI_SELECTION_LIMIT" });
});
export const nativeDocumentTargetSchema = z.object({
  format: z.literal(NATIVE_DOCUMENT_EDIT_FORMAT), artifactId: layoutId, baseRevision: z.number().int().positive(),
  unitId: layoutId, segmentId: z.union([z.literal(""), layoutId]), spans: nativeDocumentSpansSchema,
}).strict();
export const nativeDocumentOperationsSchema = z.array(nativeDocumentSpanSchema.safeExtend({
  op: z.literal("replaceNativeText"), segmentId: z.union([z.literal(""), layoutId]), text: plain,
})).min(1).max(64).superRefine((operations, ctx) => {
  if (operations.reduce((sum, operation) => sum + operation.text.length, 0) > 24000) ctx.addIssue({ code: "custom", message: "NATIVE_DOCUMENT_AI_SELECTION_LIMIT" });
});
