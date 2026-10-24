import { z } from "zod";
import { outlineSchema } from "./language.js";
import { documentOutlineSchema } from "./document-language.js";

export const confirmOutlineSchema = z.object({
  saveKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
  expectedSequence: z.number().int().nonnegative(),
  expectedUnitCost: z.number().int().min(0).max(200000),
  maxCredits: z.number().int().min(0).max(200000),
  outline: z.union([outlineSchema, documentOutlineSchema]),
}).strict().superRefine((value, ctx) => {
  if (value.outline.sections) return;
  if (new Set(value.outline.pages.map(page => page.id)).size !== value.outline.pages.length) ctx.addIssue({ code: "custom", message: "DUPLICATE_PAGE_ID" });
  if (value.outline.pages.some(page => !page.title.trim() || !page.brief.trim())) ctx.addIssue({ code: "custom", message: "OUTLINE_CONTENT_REQUIRED" });
});
