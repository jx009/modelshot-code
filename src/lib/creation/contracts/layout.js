import { z } from "zod";

export const layoutId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
const coordinate = z.number().finite().min(-32768).max(32768);
const extent = z.number().finite().min(1).max(8192);
const colorRole = z.enum(["primary", "accent", "background", "custom"]);
const fontRole = z.enum(["theme", "custom"]);
export const layoutThemeSchema = z.object({ name: z.string().max(100), primary: color, accent: color, background: color, fontFamily: z.enum(["sans", "serif", "mono"]) }).strict();
const style = z.object({
  fontFamily: z.enum(["sans", "serif", "mono"]).default("sans"),
  fontSize: z.number().finite().min(6).max(512).default(36),
  fontWeight: z.enum(["normal", "bold"]).default("normal"),
  fontStyle: z.enum(["normal", "italic"]).default("normal"),
  align: z.enum(["left", "center", "right"]).default("left"),
  verticalAlign: z.enum(["top", "middle", "bottom"]).default("top"),
  lineHeight: z.number().min(0.8).max(3).default(1.2),
  letterSpacing: z.number().min(-20).max(100).default(0),
  fill: color.default("#202124"),
  fillRole: colorRole.optional(), fontRole: fontRole.optional(),
}).strict();
export const layoutStyleSchema = style;
// Zod 4 applies defaults inside optional fields; an edit must not reset omitted
// font/color properties back to their defaults.
const stylePatch = z.object({ ...Object.fromEntries(Object.entries(style.shape).filter(([key]) => !["fillRole", "fontRole"].includes(key)).map(([key, schema]) => [key, schema.removeDefault().optional()])), fillRole: colorRole.nullable().optional(), fontRole: fontRole.nullable().optional() }).strict();
const base = {
  id: layoutId, name: z.string().max(160), role: z.string().max(80).optional(),
  x: coordinate, y: coordinate, width: extent, height: extent,
  rotation: z.number().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1), visible: z.boolean().default(true), locked: z.boolean().default(false),
};
export const layoutNodeSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("text"), text: z.string().max(16000), style }).strict(),
  z.object({ ...base, type: z.literal("image"), assetId: layoutId, fit: z.enum(["contain", "cover", "stretch"]).default("cover"), alt: z.string().max(1000).default("") }).strict(),
  z.object({ ...base, type: z.literal("shape"), shape: z.enum(["rectangle", "ellipse", "line"]), fill: color.default("#eeeeee"), stroke: color.default("#00000000"), fillRole: colorRole.optional(), strokeRole: colorRole.optional(), strokeWidth: z.number().min(0).max(64).default(0), radius: z.number().min(0).max(512).default(0) }).strict(),
]);
export const layoutPageSchema = z.object({
  id: layoutId, title: z.string().max(160), width: extent, height: extent,
  background: color.default("#ffffff"), notes: z.string().max(16000).default(""),
  backgroundRole: colorRole.optional(),
  hidden: z.boolean().default(false), nodes: z.array(layoutNodeSchema).max(500),
}).strict();
export const layoutDocumentSchema = z.object({
  schemaVersion: z.literal(1), kind: z.enum(["poster", "slides"]),
  title: z.string().trim().min(1).max(160),
  theme: layoutThemeSchema,
  pages: z.array(layoutPageSchema).min(1).max(100),
}).strict().superRefine((document, ctx) => {
  if (document.kind === "poster" && document.pages.length !== 1) ctx.addIssue({ code: "custom", message: "POSTER_REQUIRES_ONE_PAGE" });
  if (new Set(document.pages.map(page => page.id)).size !== document.pages.length) ctx.addIssue({ code: "custom", message: "DUPLICATE_PAGE_ID" });
  let nodes = 0;
  document.pages.forEach((page, index) => {
    nodes += page.nodes.length;
    if (new Set(page.nodes.map(node => node.id)).size !== page.nodes.length) ctx.addIssue({ code: "custom", path: ["pages", index], message: "DUPLICATE_NODE_ID" });
    if (page.width * page.height > 40_000_000) ctx.addIssue({ code: "custom", path: ["pages", index], message: "CANVAS_TOO_LARGE" });
  });
  if (nodes > 5000) ctx.addIssue({ code: "custom", message: "DOCUMENT_NODE_LIMIT" });
});

const ref = { pageId: layoutId, nodeId: layoutId };
const nodeChanges = z.object({ name: z.string().max(160).optional(), x: coordinate.optional(), y: coordinate.optional(), width: extent.optional(), height: extent.optional(),
  rotation: z.number().min(-360).max(360).optional(), opacity: z.number().min(0).max(1).optional(), visible: z.boolean().optional(), locked: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0, "EMPTY_CHANGE");
// Compact, revision-relative style patches. Null means untouched. Indices are
// valid only at the operation's position in the CAS-protected revision journal.
const themeNodePatch = z.tuple([z.number().int().min(0).max(499), color.nullable(), color.nullable(), z.enum(["sans", "serif", "mono"]).nullable()]);
const themePagePatch = z.object({ index: z.number().int().min(0).max(99), background: color.optional(), nodes: z.array(themeNodePatch).max(500) }).strict();
export const layoutOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replacePageLayout"), pageId: layoutId, nodes: z.array(layoutNodeSchema).max(500), background: color, backgroundRole: colorRole.nullable().optional() }).strict(),
  z.object({ op: z.literal("setTheme"), theme: layoutThemeSchema, pages: z.array(themePagePatch).max(100) }).strict(),
  z.object({ op: z.literal("setText"), ...ref, text: z.string().max(16000) }).strict(),
  z.object({ op: z.literal("setTextStyle"), ...ref, style: stylePatch }).strict(),
  z.object({ op: z.literal("setNode"), ...ref, changes: nodeChanges }).strict(),
  z.object({ op: z.literal("replaceImage"), ...ref, assetId: layoutId, alt: z.string().max(1000).optional() }).strict(),
  z.object({ op: z.literal("setImageStyle"), ...ref, changes: z.object({ fit: z.enum(["contain", "cover", "stretch"]) }).strict() }).strict(),
  z.object({ op: z.literal("setShapeStyle"), ...ref, changes: z.object({ fill: color.optional(), stroke: color.optional(), fillRole: colorRole.nullable().optional(), strokeRole: colorRole.nullable().optional(), strokeWidth: z.number().min(0).max(64).optional(), radius: z.number().min(0).max(512).optional() }).strict() }).strict(),
  z.object({ op: z.literal("insertNode"), pageId: layoutId, node: layoutNodeSchema, index: z.number().int().min(0).max(500).optional() }).strict(),
  z.object({ op: z.literal("removeNode"), ...ref }).strict(),
  z.object({ op: z.literal("reorderNode"), ...ref, index: z.number().int().min(0).max(499) }).strict(),
  z.object({ op: z.literal("setPage"), pageId: layoutId, changes: z.object({ title: z.string().max(160).optional(), width: extent.optional(), height: extent.optional(), background: color.optional(), backgroundRole: colorRole.nullable().optional(), notes: z.string().max(16000).optional(), hidden: z.boolean().optional() }).strict() }).strict(),
  z.object({ op: z.literal("insertPage"), page: layoutPageSchema, index: z.number().int().min(0).max(100).optional() }).strict(),
  z.object({ op: z.literal("removePage"), pageId: layoutId }).strict(),
  z.object({ op: z.literal("reorderPage"), pageId: layoutId, index: z.number().int().min(0).max(99) }).strict(),
  z.object({ op: z.literal("setTitle"), title: z.string().trim().min(1).max(160) }).strict(),
]);
export const layoutOperationsSchema = z.array(layoutOperationSchema).min(1).max(200);

export function layoutAssetIds(document) {
  return [...new Set(document.pages.flatMap(page => page.nodes.filter(node => node.type === "image").map(node => node.assetId)))];
}
