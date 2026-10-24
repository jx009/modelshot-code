import { parse, serialize } from "parse5";
import { z } from "zod";
import { layoutId, layoutThemeSchema } from "../contracts/layout.js";
import { htmlChartSchema } from "./chart.js";

export const HTML_SCHEMA_VERSION = 3;
export const HTML_PAGE_BYTES = 160 * 1024;
const encoder = new TextEncoder();
const forbidden = new Set("script iframe frame frameset object embed base link form input textarea select option template audio video source track portal animate animateMotion animateTransform set foreignObject".split(" "));
const urlAttributes = new Set(["src", "href", "xlink:href", "poster", "background", "action", "formaction", "srcset"]);
export class HtmlDocumentError extends Error {
  constructor(code) { super(code); this.name = "HtmlDocumentError"; this.code = code; }
}
const fail = code => { throw new HtmlDocumentError(code); };
export function attr(node, name) { return node.attrs?.find(item => item.name === name)?.value; }
export function walkHtml(root, visit) {
  const stack = [[root, 0]]; let count = 0;
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (++count > 12000 || depth > 80) fail("HTML_COMPLEXITY_LIMIT");
    visit(node);
    for (const child of [...(node.childNodes || [])].reverse()) stack.push([child, depth + 1]);
  }
}
function cssAssets(css, assets) {
  // Reject ambiguous escaped/commented resource syntax; CSP is a second boundary.
  if (/@import|@font-face|expression\s*\(|-moz-binding|behavior\s*:|\\|\/\*/i.test(css)) fail("HTML_UNSAFE_STYLE");
  css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (_match, a, b, c) => {
    const value = (a ?? b ?? c).trim();
    if (!/^asset:[a-zA-Z0-9_-]{1,128}$/.test(value)) fail("HTML_RESOURCE_UNSUPPORTED");
    assets.add(value.slice(6)); return "";
  });
}
export function inspectHtml(html, { assignIds = false, allowEmpty = false } = {}) {
  if (typeof html !== "string" || !html.trim() || encoder.encode(html).length > HTML_PAGE_BYTES) fail("HTML_PAGE_TOO_LARGE");
  const tree = parse(html), assets = new Set(), ids = new Map(); let counter = 0, visible = false;
  walkHtml(tree, node => {
    if (!node.tagName) { if (node.nodeName === "#text" && node.value.trim() && !["style", "title"].includes(node.parentNode?.tagName)) visible = true; return; }
    if (forbidden.has(node.tagName)) fail("HTML_UNSAFE_ELEMENT");
    if (node.tagName === "meta" && attr(node, "http-equiv")) fail("HTML_UNSAFE_ELEMENT");
    for (const item of node.attrs || []) {
      if (item.name === "data-chart") { try { htmlChartSchema.parse(JSON.parse(item.value)); visible = true; } catch { fail("HTML_CHART_DATA_INVALID"); } }
      if (/^on/i.test(item.name) || ["srcdoc", "contenteditable", "autofocus", "is"].includes(item.name) || item.name.startsWith("data-cw-")) fail("HTML_UNSAFE_ATTRIBUTE");
      if (item.name === "style") cssAssets(item.value, assets);
      if (urlAttributes.has(item.name)) {
        if (item.name === "src" && node.tagName === "img" && /^asset:[a-zA-Z0-9_-]{1,128}$/.test(item.value)) assets.add(item.value.slice(6));
        else if (item.name === "href" && /^#[a-zA-Z0-9_-]*$/.test(item.value)) { /* local anchor */ }
        else fail("HTML_RESOURCE_UNSUPPORTED");
      }
    }
    if (node.tagName === "style") cssAssets((node.childNodes || []).map(child => child.value || "").join(""), assets);
    if (["img", "svg", "table"].includes(node.tagName)) visible = true;
    const id = attr(node, "data-node-id");
    if (id) { if (!layoutId.safeParse(id).success || ids.has(id)) fail("HTML_DUPLICATE_NODE_ID"); ids.set(id, node); }
  });
  if (!visible && !allowEmpty) fail("HTML_EMPTY_DOCUMENT");
  if (assets.size > 20) fail("HTML_ASSET_LIMIT");
  if (assignIds) walkHtml(tree, node => {
    if (!node.tagName || ["html", "head", "body", "style", "title", "meta"].includes(node.tagName) || attr(node, "data-node-id")) return;
    let id; do { id = `node_${++counter}`; } while (ids.has(id));
    node.attrs.push({ name: "data-node-id", value: id }); ids.set(id, node);
  });
  return { tree, assets: [...assets], ids, html: serialize(tree) };
}
const htmlString = z.string().min(1).superRefine((value, ctx) => {
  try { inspectHtml(value); } catch (error) { ctx.addIssue({ code: "custom", message: error.code || "HTML_INVALID" }); }
});
const htmlPageString = z.string().superRefine((value, ctx) => {
  try { inspectHtml(value, { allowEmpty: true }); } catch (error) { ctx.addIssue({ code: "custom", message: error.code || "HTML_INVALID" }); }
});
export const htmlMasterSchema = z.object({
  id: layoutId, name: z.string().min(1).max(80), version: z.number().int().positive(), css: z.string().max(16000), html: z.string().max(16000),
}).strict().superRefine((master, ctx) => {
  try { inspectHtml(`<html><head><style>${master.css}</style></head><body>${master.html}<span>master</span></body></html>`); }
  catch { ctx.addIssue({ code: "custom", message: "HTML_MASTER_INVALID" }); }
});
export const htmlPageSchema = z.object({
  id: layoutId, html: htmlPageString, title: z.string().max(160).default(""),
  width: z.number().int().min(1).max(8192), height: z.union([z.number().int().min(1).max(8192), z.literal("auto")]),
  notes: z.string().max(16000).default(""), hidden: z.boolean().default(false), masterId: layoutId.nullable().optional(),
}).passthrough().superRefine((page, ctx) => { if (page.height !== "auto" && page.width * page.height > 40_000_000) ctx.addIssue({ code: "custom", message: "CANVAS_TOO_LARGE" }); });
export const htmlDocumentSchema = z.object({
  schemaVersion: z.literal(HTML_SCHEMA_VERSION), format: z.enum(["html-poster", "html-slides"]), kind: z.enum(["poster", "slides"]),
  title: z.string().min(1).max(160), theme: layoutThemeSchema,
  pages: z.array(htmlPageSchema).min(1).max(100), metadata: z.record(z.string(), z.unknown()).default({}),
  templates: z.array(z.unknown()).max(100).default([]), mind_flow: z.unknown().optional(),
  masters: z.array(htmlMasterSchema).max(20).optional(),
}).passthrough().superRefine((doc, ctx) => {
  for (const [index, page] of doc.pages.entries()) {
    try { inspectHtml(page.html, { allowEmpty: doc.kind === "slides" }); }
    catch (error) { ctx.addIssue({ code: "custom", message: error.code || "HTML_INVALID", path: ["pages", index, "html"] }); }
  }
  if (new Set(doc.masters?.map(m => m.id)).size !== (doc.masters?.length || 0) || doc.pages.some(p => p.masterId && !doc.masters?.some(m => m.id === p.masterId))) ctx.addIssue({ code: "custom", message: "HTML_MASTER_NOT_FOUND" });
  if (doc.format !== `html-${doc.kind}` || doc.kind === "poster" && doc.pages.length !== 1 || new Set(doc.pages.map(page => page.id)).size !== doc.pages.length) ctx.addIssue({ code: "custom", message: "HTML_DOCUMENT_MISMATCH" });
  if (encoder.encode(JSON.stringify(doc)).length > 2 * 1024 * 1024) ctx.addIssue({ code: "custom", message: "ARTIFACT_TOO_LARGE" });
});
export const isHtmlDocument = doc => doc?.schemaVersion === HTML_SCHEMA_VERSION && ["html-poster", "html-slides"].includes(doc.format);
export function htmlAssetIds(doc) { return [...new Set([...doc.pages.flatMap(page => inspectHtml(page.html).assets), ...(doc.masters || []).flatMap(m => inspectHtml(`<style>${m.css}</style>${m.html}<span>master</span>`).assets)])]; }
export function validateHtmlSelection(target, doc) {
  const page = doc.pages.find(item => item.id === target.pageId);
  if (!page) fail("LANGUAGE_SELECTION_CHANGED");
  const parsed = inspectHtml(page.html);
  for (const id of target.nodeIds || []) if (!parsed.ids.has(id)) fail("LANGUAGE_SELECTION_CHANGED");
  return { page, ...parsed };
}
export function assertHtmlEditScope(before, after, nodeIds = []) {
  if (!nodeIds.length) return;
  const left = inspectHtml(before), right = inspectHtml(after), selected = new Set(nodeIds);
  for (const id of selected) if (!left.ids.has(id) || !right.ids.has(id)) fail("LANGUAGE_SELECTION_CHANGED");
  // Replacing selected subtrees with identical sentinels compares EVERYTHING
  // outside scope, including ancestor attributes and shared CSS rules.
  function masked(tree) {
    function copy(node) {
      if (selected.has(attr(node, "data-node-id"))) return ["selection", attr(node, "data-node-id")];
      return [node.nodeName, node.value ?? node.data ?? null, (node.attrs || []).map(a => [a.name, a.value]).sort(), (node.childNodes || []).map(copy)];
    }
    return JSON.stringify(copy(tree));
  }
  if (masked(left.tree) !== masked(right.tree)) fail("LANGUAGE_EDIT_OUTSIDE_SCOPE");
}
