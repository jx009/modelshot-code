import { z } from "zod";
import { layoutId } from "./layout.js";

const byteLength = value => typeof Buffer === "undefined" ? new TextEncoder().encode(value).byteLength : Buffer.byteLength(value);

export const webId = layoutId;
const path = z.string().regex(/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/).max(240).refine(value => !value.startsWith(".") && !value.includes(".."), "WEB_PATH_INVALID");
const text = z.string().max(512 * 1024);
const html = text.refine(value => !/<(?:iframe|object|embed|base)\b/i.test(value) && !/\son[a-z]+\s*=/i.test(value) && !/javascript\s*:/i.test(value), "WEB_HTML_UNSAFE");
const css = text.refine(value => !/@import\b/i.test(value) && !/url\s*\(\s*["']?https?:/i.test(value), "WEB_CSS_EXTERNAL");
const script = text.refine(value => !/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|eval|Function|import\s*\(|document\.cookie|localStorage|sessionStorage|top\.|parent\.|window\.open|javascript\s*:)/i.test(value), "WEB_SCRIPT_UNSAFE");
export const webFileSchema = z.object({ id: webId, path, kind: z.enum(["html", "css", "js", "asset"]), content: z.string().max(512 * 1024).optional(), assetId: layoutId.optional() }).strict()
  .superRefine((file, ctx) => {
    if (file.kind === "asset" ? (!file.assetId || file.content !== undefined) : (file.content === undefined || !file.content.length)) ctx.addIssue({ code: "custom", message: "WEB_FILE_CONTENT_INVALID" });
    if (file.kind !== "asset" && file.assetId !== undefined) ctx.addIssue({ code: "custom", message: "WEB_FILE_CONTENT_INVALID" });
    if (file.kind === "html" && file.content !== undefined && (!html.safeParse(file.content).success || /<script\b[^>]*\bsrc\s*=\s*["']?(?:[a-z]+:|\/\/)/i.test(file.content))) ctx.addIssue({ code: "custom", message: "WEB_HTML_UNSAFE" });
    if (file.kind === "css" && file.content !== undefined && !css.safeParse(file.content).success) ctx.addIssue({ code: "custom", message: "WEB_CSS_EXTERNAL" });
    if (file.kind === "js" && file.content !== undefined && !script.safeParse(file.content).success) ctx.addIssue({ code: "custom", message: "WEB_SCRIPT_UNSAFE" });
  });
const theme = z.object({ primary: z.string().regex(/^#[0-9a-fA-F]{6}$/), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/), background: z.string().regex(/^#[0-9a-fA-F]{6}$/), fontFamily: z.enum(["sans", "serif", "mono"]) }).strict();
const design = z.object({ audience: z.string().max(1200), concept: z.string().max(1200), typography: z.string().max(1200), layout: z.string().max(1200), interactions: z.string().max(1200) }).strict();
export const webSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal("web"), title: z.string().trim().min(1).max(160), theme, design: design.optional(), entryPath: path, files: z.array(webFileSchema).min(1).max(100), viewport: z.object({ desktop: z.number().int().min(320).max(3840).default(1440), mobile: z.number().int().min(240).max(1600).default(390) }).strict().prefault({}), assetIds: z.array(layoutId).max(100).default([]) }).strict()
  .superRefine((site, ctx) => {
    const ids = new Set(), paths = new Set(); let bytes = 0, htmlCount = 0;
    for (const file of site.files) { if (ids.has(file.id) || paths.has(file.path)) ctx.addIssue({ code: "custom", message: "WEB_DUPLICATE_FILE" }); ids.add(file.id); paths.add(file.path); bytes += byteLength(file.content || ""); if (file.kind === "html") htmlCount++; if (file.assetId && !site.assetIds.includes(file.assetId)) ctx.addIssue({ code: "custom", message: "WEB_UNKNOWN_ASSET" }); }
    if (!paths.has(site.entryPath) || site.files.find(file => file.path === site.entryPath)?.kind !== "html") ctx.addIssue({ code: "custom", message: "WEB_ENTRY_INVALID" });
    if (htmlCount > 20 || bytes > 5 * 1024 * 1024) ctx.addIssue({ code: "custom", message: "WEB_SITE_TOO_LARGE" });
  });

const target = { fileId: webId, path };
export const webOperationsSchema = z.array(z.discriminatedUnion("op", [
  z.object({ op: z.literal("setFile"), ...target, kind: z.enum(["html", "css", "js"]), content: text }).strict(),
  z.object({ op: z.literal("replaceAsset"), ...target, expectedAssetId: layoutId, assetId: layoutId, assetIds: z.array(layoutId).max(100).optional() }).strict(),
  z.object({ op: z.literal("insertFile"), file: webFileSchema, index: z.number().int().min(0).max(100).optional() }).strict(),
  z.object({ op: z.literal("removeFile"), ...target }).strict(),
  z.object({ op: z.literal("renameFile"), ...target, nextPath: path, updates: z.array(z.object({ ...target, kind: z.enum(["html", "css", "js"]), content: text }).strict()).min(1).max(100).optional() }).strict(),
  z.object({ op: z.literal("setEntry"), path }).strict(),
  z.object({ op: z.literal("setTheme"), theme }).strict(),
  z.object({ op: z.literal("setAssetIds"), assetIds: z.array(layoutId).max(100) }).strict(),
])).min(1).max(100);
export const webAssetIds = site => site.assetIds;
