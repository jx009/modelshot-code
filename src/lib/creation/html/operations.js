import { z } from "zod";
import { layoutId, layoutThemeSchema } from "../contracts/layout.js";
import { htmlMasterSchema } from "./master.js";
import { htmlPageSchema, HtmlDocumentError, inspectHtml } from "./document.js";

export const htmlOperationsSchema = z.array(z.discriminatedUnion("op", [
  z.object({ op: z.literal("setHtmlTheme"), theme: layoutThemeSchema }).strict(),
  z.object({ op: z.literal("setHtmlMasters"), masters: z.array(htmlMasterSchema).max(20) }).strict(),
  z.object({ op: z.literal("bindHtmlMaster"), pageId: layoutId, masterId: layoutId.nullable() }).strict(),
  z.object({ op: z.literal("setHtmlPage"), pageId: layoutId, html: z.string().min(1).max(160 * 1024) }).strict(),
  z.object({ op: z.literal("setHtmlPageMeta"), pageId: layoutId, changes: z.object({ title: z.string().max(160).optional(), notes: z.string().max(16000).optional(), hidden: z.boolean().optional(), width: z.number().int().min(1).max(8192).optional(), height: z.union([z.number().int().min(1).max(8192), z.literal("auto")]).optional() }).strict() }).strict(),
  z.object({ op: z.literal("insertHtmlPage"), page: htmlPageSchema, index: z.number().int().nonnegative() }).strict(),
  z.object({ op: z.literal("removeHtmlPage"), pageId: layoutId }).strict(),
  z.object({ op: z.literal("reorderHtmlPage"), pageId: layoutId, index: z.number().int().nonnegative() }).strict(),
  z.object({ op: z.literal("setHtmlTitle"), title: z.string().min(1).max(160) }).strict(),
])).min(1).max(200);
export function applyHtmlWithInverse(document, operations) {
  if (!operations.length) return { document, inverse: [] };
  let next = document; const inverse = [];
  for (const op of htmlOperationsSchema.parse(operations)) {
    if (op.op === "setHtmlTheme") { inverse.unshift({ ...op, theme: next.theme }); next = { ...next, theme: op.theme }; continue; }
    if (op.op === "setHtmlMasters") {
      if (new Set(op.masters.map(m => m.id)).size !== op.masters.length || next.pages.some(p => p.masterId && !op.masters.some(m => m.id === p.masterId))) throw new HtmlDocumentError("HTML_MASTER_IN_USE");
      inverse.unshift({ ...op, masters: next.masters || [] }); next = { ...next, masters: op.masters }; continue;
    }
    const pages = [...next.pages], index = pages.findIndex(page => page.id === op.pageId), page = pages[index];
    if (!["insertHtmlPage", "setHtmlTitle"].includes(op.op) && !page) throw new HtmlDocumentError("PAGE_NOT_FOUND");
    if (op.op === "setHtmlTitle") { inverse.unshift({ ...op, title: next.title }); next = { ...next, title: op.title }; continue; }
    if (op.op === "setHtmlPage") { inspectHtml(op.html, { allowEmpty: document.kind === "slides" }); inverse.unshift({ ...op, html: page.html }); pages[index] = { ...page, html: op.html }; }
    if (op.op === "bindHtmlMaster") {
      if (op.masterId && !next.masters?.some(master => master.id === op.masterId)) throw new HtmlDocumentError("HTML_MASTER_NOT_FOUND");
      inverse.unshift({ ...op, masterId: page.masterId || null }); pages[index] = { ...page, masterId: op.masterId };
    }
    if (op.op === "setHtmlPageMeta") { inverse.unshift({ ...op, changes: Object.fromEntries(Object.keys(op.changes).map(key => [key, page[key]])) }); pages[index] = { ...page, ...op.changes }; if (pages[index].height !== "auto" && pages[index].width * pages[index].height > 40_000_000) throw new HtmlDocumentError("CANVAS_TOO_LARGE"); }
    if (op.op === "insertHtmlPage") { inverse.unshift({ op: "removeHtmlPage", pageId: op.page.id }); pages.splice(op.index, 0, op.page); }
    if (op.op === "removeHtmlPage") { inverse.unshift({ op: "insertHtmlPage", page, index }); pages.splice(index, 1); }
    if (op.op === "reorderHtmlPage") { inverse.unshift({ ...op, index }); pages.splice(index, 1); pages.splice(op.index, 0, page); }
    if (!pages.length || pages.length > 100 || next.kind === "poster" && pages.length !== 1 || new Set(pages.map(p => p.id)).size !== pages.length) throw new HtmlDocumentError("HTML_DOCUMENT_MISMATCH");
    next = { ...next, pages };
  }
  // Unchanged pages retain identity and are not reparsed on a single-page edit.
  // Full contract validation is repeated at the server persistence boundary.
  if (new TextEncoder().encode(JSON.stringify(next)).length > 2 * 1024 * 1024) throw new HtmlDocumentError("ARTIFACT_TOO_LARGE");
  return { document: next, inverse };
}
export const applyHtmlOperations = (doc, operations) => applyHtmlWithInverse(doc, operations).document;
