import { z } from "zod";

export const documentId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const link = z.string().max(2048).refine(value => {
  try { const url = new URL(value); return ["https:", "http:", "mailto:"].includes(url.protocol) && !url.username && !url.password && !/[\u0000-\u0020\u007f]/.test(value); }
  catch { return false; }
}, "UNSAFE_DOCUMENT_LINK");
export const documentMarksSchema = z.object({ bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), strike: z.boolean().optional(),
  color: color.optional(), highlight: color.optional(), link: link.optional(),
}).strict();
export const documentRunsSchema = z.array(z.object({ text: z.string().max(16000), marks: documentMarksSchema.default({}) }).strict()).max(512)
  .refine(runs => runs.reduce((count, run) => count + run.text.length, 0) <= 16000, "DOCUMENT_TEXT_LIMIT");
const paragraphStyle = z.object({ align: z.enum(["left", "center", "right", "justify"]).default("left"),
  lineHeight: z.number().finite().min(.8).max(3).default(1.5), spaceBefore: z.number().finite().min(0).max(96).default(0), spaceAfter: z.number().finite().min(0).max(96).default(8),
}).strict();
const leaf = z.object({ id: documentId, runs: documentRunsSchema }).strict();
const common = { id: documentId, locked: z.boolean().default(false) };
export const documentBlockSchema = z.discriminatedUnion("type", [
  z.object({ ...common, type: z.literal("paragraph"), runs: documentRunsSchema, style: paragraphStyle.prefault({}) }).strict(),
  z.object({ ...common, type: z.literal("heading"), level: z.number().int().min(1).max(6), runs: documentRunsSchema, style: paragraphStyle.prefault({}) }).strict(),
  z.object({ ...common, type: z.literal("list"), ordered: z.boolean().default(false), start: z.number().int().min(1).max(10000).default(1),
    items: z.array(leaf.extend({ depth: z.number().int().min(0).max(5).default(0) }).strict()).min(1).max(200),
  }).strict(),
  z.object({ ...common, type: z.literal("table"), headerRows: z.number().int().min(0).max(2).default(1),
    rows: z.array(z.object({ id: documentId, cells: z.array(leaf).min(1).max(20) }).strict()).min(1).max(200),
  }).strict().superRefine((table, ctx) => {
    if (table.headerRows > table.rows.length || table.rows.some(row => row.cells.length !== table.rows[0].cells.length)) ctx.addIssue({ code: "custom", message: "DOCUMENT_TABLE_SHAPE" });
  }),
  z.object({ ...common, type: z.literal("image"), assetId: documentId, alt: z.string().max(1000).default(""),
    width: z.number().finite().min(1).max(1600), height: z.number().finite().min(1).max(1600), caption: z.string().max(2000).default(""),
  }).strict(),
  z.object({ ...common, type: z.literal("pageBreak") }).strict(),
]);
export const documentSectionSchema = z.object({ id: documentId, title: z.string().max(160), blocks: z.array(documentBlockSchema).min(1).max(300) }).strict();
export const documentPageSchema = z.object({ size: z.enum(["A4", "Letter"]).default("A4"), orientation: z.enum(["portrait", "landscape"]).default("portrait"),
  // Page margins/spacing/font sizes are points; image frames use CSS px at 96
  // DPI. Native editor adapters must convert instead of mixing these units.
  marginTop: z.number().min(12).max(144).default(54), marginBottom: z.number().min(12).max(144).default(54),
  marginLeft: z.number().min(12).max(144).default(54), marginRight: z.number().min(12).max(144).default(54),
  header: z.string().max(500).default(""), footer: z.string().max(500).default(""), pageNumbers: z.boolean().default(true),
}).strict();
export const documentThemeSchema = z.object({ fontFamily: z.enum(["sans", "serif", "mono"]).default("sans"), fontSize: z.number().min(8).max(36).default(12), color: color.default("#202124") }).strict();

export function documentTextLeaves(block) {
  if (block.type === "paragraph" || block.type === "heading") return [{ id: block.id, runs: block.runs }];
  if (block.type === "list") return block.items;
  if (block.type === "table") return block.rows.flatMap(row => row.cells);
  return [];
}
export function validateDocumentStructure(document, ctx) {
  const ids = new Set(); let blocks = 0, characters = 0, leaves = 0;
  const addId = id => { if (ids.has(id)) ctx.addIssue({ code: "custom", message: "DUPLICATE_DOCUMENT_ID" }); ids.add(id); };
  for (const section of document.sections) {
    addId(section.id);
    for (const block of section.blocks) {
      addId(block.id); blocks++;
      if (block.type === "table") block.rows.forEach(row => addId(row.id));
      for (const leaf of documentTextLeaves(block)) {
        if (!["paragraph", "heading"].includes(block.type)) addId(leaf.id);
        leaves++; characters += leaf.runs.reduce((count, run) => count + run.text.length, 0);
      }
      if (block.type === "image") characters += block.caption.length + block.alt.length;
    }
  }
  if (blocks > 2000 || leaves > 10000 || characters > 300000) ctx.addIssue({ code: "custom", message: "DOCUMENT_CONTENT_LIMIT" });
}
export const textDocumentSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal("document"), title: z.string().trim().min(1).max(160),
  locale: z.enum(["zh", "en"]).default("zh"), page: documentPageSchema.prefault({}), theme: documentThemeSchema.prefault({}),
  sections: z.array(documentSectionSchema).min(1).max(50),
}).strict().superRefine(validateDocumentStructure);
const target = { sectionId: documentId, blockId: documentId };
export const documentOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replaceDocumentText"), ...target, leafId: documentId, start: z.number().int().min(0).max(16000), end: z.number().int().min(0).max(16000), expectedText: z.string().max(16000), text: z.string().max(16000) }).strict(),
  z.object({ op: z.literal("replaceDocumentBlock"), ...target, block: documentBlockSchema }).strict(),
  z.object({ op: z.literal("insertDocumentBlock"), sectionId: documentId, block: documentBlockSchema, index: z.number().int().min(0).max(300) }).strict(),
  z.object({ op: z.literal("removeDocumentBlock"), ...target }).strict(),
  z.object({ op: z.literal("moveDocumentBlock"), ...target, index: z.number().int().min(0).max(299) }).strict(),
  z.object({ op: z.literal("setDocumentLock"), ...target, locked: z.boolean() }).strict(),
  z.object({ op: z.literal("setDocumentTitle"), title: z.string().trim().min(1).max(160) }).strict(),
  z.object({ op: z.literal("setDocumentPage"), page: documentPageSchema }).strict(),
  z.object({ op: z.literal("setDocumentTheme"), theme: documentThemeSchema }).strict(),
]);
export const documentOperationsSchema = z.array(documentOperationSchema).min(1).max(100);
export function documentAssetIds(document) { return [...new Set(document.sections.flatMap(section => section.blocks.filter(block => block.type === "image").map(block => block.assetId)))]; }
