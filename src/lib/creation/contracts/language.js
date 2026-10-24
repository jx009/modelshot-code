import { z } from "zod";
import { validateHtmlLanguageResult } from "../html/language.js";
import { isHtmlDocument } from "../html/document.js";
import { layoutId, layoutDocumentSchema, layoutPageSchema, layoutOperationsSchema, layoutAssetIds } from "./layout.js";
import { applyLayoutOperations } from "../layout-operations.js";
import { nodeIntersectsPage } from "../layout-geometry.js";
import { documentLanguageInputSchema, validateDocumentLanguageResult } from "./document-language.js";
import { sheetId, workbookSchema, sheetOperationSchema, sheetAddressesSchema } from "./sheet.js";
import { applySheetOperations } from "../sheet-operations.js";
import { validateSheetSelection } from "../sheet-selection.js";
import { cellPosition } from "../sheet-formula.js";
import { webId, webSchema, webOperationsSchema } from "./web.js";
import { applyWebOperations } from "../web-operations.js";
import { validateWebSelection } from "../web-selection.js";
import { nativeSheetTargetSchema, nativeSheetOperationsSchema } from "./native-sheet-edit.js";
import { applyNativeSheetOperations } from "../native-sheet-edit.js";
import { nativeDocumentTargetSchema, nativeDocumentOperationsSchema } from "./native-document-edit.js";
import { applyNativeDocumentOperations } from "../native-document-edit.js";

export const LANGUAGE_MAX_INPUT_BYTES = 256 * 1024;
export const LANGUAGE_MAX_RESULT_BYTES = 512 * 1024;
export const LANGUAGE_PURPOSES = ["poster.generate", "poster.edit", "slides.outline", "slides.page", "slides.edit", "document.outline", "document.section", "document.edit", "document.native.edit", "sheet.generate", "sheet.edit", "sheet.native.edit", "web.generate", "web.edit"];
const common = { prompt: z.string().trim().min(1).max(12000), locale: z.enum(["zh", "en"]).default("zh"), assetIds: z.array(layoutId).max(8).default([]), referenceIds: z.array(layoutId).max(8).default([]), sourceFormat: z.literal("html").optional() };
const size = { width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192) };
const edit = { ...common, artifactId: layoutId, baseRevision: z.number().int().positive(), pageId: layoutId,
  nodeIds: z.array(layoutId).max(100).default([]) };
const layoutLanguageInputSchema = z.discriminatedUnion("purpose", [
  z.object({ ...common, ...size, purpose: z.literal("poster.generate"), visualAssetId: layoutId.optional() }).strict(),
  z.object({ ...edit, purpose: z.literal("poster.edit") }).strict(),
  z.object({ ...common, purpose: z.literal("slides.outline"), pageCount: z.number().int().min(1).max(100) }).strict(),
  z.object({ ...common, ...size, purpose: z.literal("slides.page"), pageId: layoutId, title: z.string().max(160), brief: z.string().max(4000), theme: layoutDocumentSchema.shape.theme }).strict(),
  z.object({ ...edit, purpose: z.literal("slides.edit") }).strict(),
]).superRefine((input, ctx) => {
  if (input.width && input.width * input.height > 40_000_000) ctx.addIssue({ code: "custom", message: "CANVAS_TOO_LARGE" });
  if (input.visualAssetId && !input.assetIds.includes(input.visualAssetId)) ctx.addIssue({ code: "custom", message: "LANGUAGE_UNKNOWN_ASSET" });
});
const sheetLanguageInputSchema = z.discriminatedUnion("purpose", [
  z.object({ ...common, purpose: z.literal("sheet.generate"), sheetCount: z.number().int().min(1).max(5).default(1), targetRows: z.number().int().min(1).max(100).default(20) }).strict(),
  z.object({ ...common, purpose: z.literal("sheet.edit"), artifactId: sheetId, baseRevision: z.number().int().positive(), sheetId, addresses: sheetAddressesSchema }).strict(),
  nativeSheetTargetSchema.extend({ ...common, purpose: z.literal("sheet.native.edit") }),
]);
const webLanguageInputSchema = z.discriminatedUnion("purpose", [
  z.object({ ...common, purpose: z.literal("web.generate"), pageCount: z.number().int().min(1).max(20).default(1) }).strict(),
  z.object({ ...common, purpose: z.literal("web.edit"), artifactId: webId, baseRevision: z.number().int().positive(), fileIds: z.array(webId).min(1).max(20), paths: z.array(z.string().min(1).max(240)).min(1).max(20) }).strict(),
]);
export const languageInputSchema = z.union([layoutLanguageInputSchema, documentLanguageInputSchema, nativeDocumentTargetSchema.extend({ ...common, purpose: z.literal("document.native.edit") }), sheetLanguageInputSchema, webLanguageInputSchema]);
export const outlineSchema = z.object({ title: z.string().trim().min(1).max(160), theme: layoutDocumentSchema.shape.theme,
  pages: z.array(z.object({ id: layoutId, title: z.string().min(1).max(160), brief: z.string().min(1).max(4000), notes: z.string().max(16000).default("") }).strict()).min(1).max(100),
}).strict();

export class LanguageResultError extends Error {
  constructor(code) { super(code); this.name = "LanguageResultError"; this.code = code; }
}
const fail = code => { throw new LanguageResultError(code); };

// Provider output is untrusted data. Web markup requires an isolated preview. All edits
// are checked against a fixed revision and server-owned selection scope.
export function validateLanguageResult(input, raw, source) {
  if (input.purpose !== "slides.outline" && (input.sourceFormat === "html" || isHtmlDocument(source))) return validateHtmlLanguageResult(input, raw, source);
  if (input.purpose === "document.native.edit") {
    const result = z.object({ operations: nativeDocumentOperationsSchema }).strict().parse(raw);
    applyNativeDocumentOperations(source, result.operations, input);
    return result;
  }
  if (input.purpose === "sheet.native.edit") {
    const result = z.object({ operations: nativeSheetOperationsSchema }).strict().parse(raw);
    applyNativeSheetOperations(source, result.operations, input);
    return result;
  }
  if (input.purpose.startsWith("document.")) return validateDocumentLanguageResult(input, raw, source);
  if (input.purpose === "sheet.generate") {
    const result = workbookSchema.parse(raw);
    if (result.sheets.length !== input.sheetCount || result.sheets.reduce((sum, sheet) => sum + sheet.cells.length, 0) > 500 || result.sheets.some(sheet => sheet.cells.some(cell => { const position = cellPosition(cell.address); return position.row > input.targetRows || position.column > 20; }))) fail("LANGUAGE_SHEET_MISMATCH");
    return result;
  }
  if (input.purpose === "sheet.edit") {
    const { selected } = validateSheetSelection(input, source);
    const operations = z.object({ operations: sheetOperationSchema }).strict().parse(raw).operations;
    for (const op of operations) { if (op.op !== "setCell" && op.op !== "clearCell" && op.op !== "setCellStyle") fail("LANGUAGE_EDIT_OUTSIDE_SCOPE"); if (op.sheetId !== input.sheetId || !selected.has(op.address)) fail("LANGUAGE_EDIT_OUTSIDE_SCOPE"); }
    workbookSchema.parse(applySheetOperations(source, operations));
    return { operations };
  }
  if (input.purpose === "web.generate") {
    const result = webSchema.parse(raw);
    if (result.files.filter(file => file.kind === "html").length !== input.pageCount) fail("LANGUAGE_WEB_MISMATCH");
    if (result.assetIds.some(id => !input.assetIds.includes(id))) fail("LANGUAGE_UNKNOWN_ASSET");
    return result;
  }
  if (input.purpose === "web.edit") {
    const { byId } = validateWebSelection(input, source);
    const operations = z.object({ operations: webOperationsSchema }).strict().parse(raw).operations;
    for (const operation of operations) {
      if (operation.op !== "setFile" || byId.get(operation.fileId)?.path !== operation.path) fail("LANGUAGE_EDIT_OUTSIDE_SCOPE");
      if (operation.op === "setFile" && operation.kind === "js") fail("WEB_AGENT_JS_EDIT_DISABLED");
    }
    webSchema.parse(applyWebOperations(source, operations)); return { operations };
  }
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
