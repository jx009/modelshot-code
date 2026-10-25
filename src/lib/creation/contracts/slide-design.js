import { z } from "zod";
import { layoutId } from "./layout.js";

// Optional for persisted v1 outlines; newly planned decks supply this contract.
export const slideDesignSchema = z.object({
  audience: z.string().min(1).max(600),
  narrative: z.string().min(1).max(2000),
  artDirection: z.string().min(1).max(2000),
  typography: z.string().min(1).max(1000),
  spacing: z.string().min(1).max(1000),
  visuals: z.array(z.object({ id: layoutId, prompt: z.string().min(1).max(2500) }).strict()).max(2).default([]),
}).strict();
export const slideComposition = {
  role: z.string().max(240).optional(),
  layout: z.string().max(1200).optional(),
  visualId: layoutId.optional(),
};
export const slideDeckContextSchema = z.object({
  title: z.string().max(160),
  design: slideDesignSchema.omit({ visuals: true }).optional(),
  pageNumber: z.number().int().min(1).max(100),
  pageCount: z.number().int().min(1).max(100),
  headings: z.array(z.object({ title: z.string().max(160), role: z.string().max(240).optional() }).strict()).max(100),
  previousLayout: z.string().max(1200).optional(),
  nextLayout: z.string().max(1200).optional(),
}).strict();

export function plannedSlideVisuals(outline) {
  const used = new Set(outline.pages?.map(page => page.visualId).filter(Boolean));
  return (outline.design?.visuals || []).filter(visual => used.has(visual.id));
}

export function slideDesignMarkdown(outline) {
  const design = outline.design;
  if (!design) return "";
  return [`# ${outline.title}`, `## Audience\n${design.audience}`, `## Narrative\n${design.narrative}`,
    `## Art direction\n${design.artDirection}`, `## Typography\n${design.typography}`, `## Spacing\n${design.spacing}`,
    ...outline.pages.map((page, index) => `## ${index + 1}. ${page.title}\n${page.role || ""}\n${page.layout || ""}\n${page.brief}${page.visualId ? `\nVisual: ${page.visualId}` : ""}`),
    ...plannedSlideVisuals(outline).map(visual => `## Visual: ${visual.id}\n${visual.prompt}`)].join("\n\n");
}
