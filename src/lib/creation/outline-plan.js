import { randomUUID } from "node:crypto";
import { outlineSchema, languageInputSchema } from "./contracts/language.js";
import { documentOutlineSchema } from "./contracts/document-language.js";

export function outlineForKind(kind) {
  if (kind === "slides") return { schema: outlineSchema, items: "pages", count: "pageCount", child: "slides.page", assemble: "layout.assemble" };
  if (kind === "document") return { schema: documentOutlineSchema, items: "sections", count: "sectionCount", child: "document.section", assemble: "document.assemble" };
  throw new Error("CREATION_KIND_UNSUPPORTED");
}
export function outlineChildren(run, value, cost) {
  const spec = outlineForKind(run.kind), outline = spec.schema.parse(value), source = languageInputSchema.parse(run.steps[0].params);
  if (source.purpose !== `${run.kind}.outline`) throw new Error("CREATION_OUTLINE_CHANGED");
  const common = { ...(source.dependencyRefs ? { dependencyRefs: source.dependencyRefs } : {}), prompt: source.prompt, locale: source.locale, assetIds: source.assetIds, referenceIds: source.referenceIds, ...(source.sourceFormat ? { sourceFormat: source.sourceFormat } : {}) };
  // Copy only heading metadata, never every section's full brief or result.
  const headings = run.kind === "document" ? outline.sections.map(({ id, title }) => ({ id, title })) : null;
  const ids = outline[spec.items].map(() => randomUUID());
  return outline[spec.items].map((item, index) => ({ id: ids[index], runId: run.id, position: index + 1, dependsOn: index ? [ids[index - 1]] : [run.steps[0].id], tool: spec.child, expectedCost: cost, status: index ? "blocked" : "ready",
    explanation: `${index + 1}. ${item.title}`.slice(0, 500), params: languageInputSchema.parse(run.kind === "document"
      ? { ...common, purpose: "document.section", sectionId: item.id, title: item.title, brief: item.brief, documentTitle: outline.title, audience: source.audience, headings }
      : { ...common, purpose: "slides.page", pageId: item.id, title: item.title, brief: item.brief, theme: outline.theme, width: run.input.width, height: run.input.height }),
  }));
}
