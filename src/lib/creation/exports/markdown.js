import JSZip from "jszip";
import { textDocumentSchema, documentAssetIds, documentTextLeaves } from "../contracts/document.js";
import { EXPORT_MAX_BYTES } from "../contracts/exports.js";

const fail = code => { throw new Error(code); };
const validText = value => typeof value === "string" && value.isWellFormed() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(value);
export function validateMarkdownDocument(input) {
  const parsed = textDocumentSchema.safeParse(input);
  if (!parsed.success) fail("EXPORT_SOURCE_FORMAT_UNSUPPORTED");
  const doc = parsed.data;
  for (const section of doc.sections) for (const block of section.blocks) {
    const values = documentTextLeaves(block).flatMap(leaf => leaf.runs.map(run => run.text));
    if (block.type === "image") values.push(block.alt, block.caption);
    if (values.some(value => !validText(value))) fail("EXPORT_DOCUMENT_TEXT_UNSUPPORTED");
  }
  return doc;
}

const escapeHtml = value => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
function text(value, html) {
  let result = value.replace(/\r\n?/g, "\n");
  if (!html) result = result.replace(/[\\`*_{}\[\]()#+.!|~\-]/g, "\\$&");
  result = escapeHtml(result);
  if (!html) result = result.replace(/^[ \t]+/gm, spaces => [...spaces].map(ch => ch === "\t" ? "&#9;" : "&#32;").join(""));
  return result.replace(/\n/g, "<br />\n");
}
function runs(values, html = false) {
  return values.map(run => {
    let value = text(run.text, html);
    if (!value) return "";
    for (const [mark, tag] of [["bold", "strong"], ["italic", "em"], ["underline", "u"], ["strike", "del"]]) if (run.marks[mark]) value = `<${tag}>${value}</${tag}>`;
    // Link protocols/credentials are validated by the document contract.
    if (run.marks.link) value = `<a href="${escapeHtml(run.marks.link)}">${value}</a>`;
    return value;
  }).join("");
}
function list(block) {
  // Build only at most six nesting levels. Synthetic parents represent orphan
  // indentation without displaying an invented bullet or consuming a number.
  const root = [], parents = [root];
  for (const item of block.items) {
    while (parents.length > item.depth + 1) parents.pop();
    while (parents.length <= item.depth) {
      const siblings = parents.at(-1);
      if (!siblings.length) siblings.push({ children: [] });
      parents.push(siblings.at(-1).children);
    }
    parents.at(-1).push({ item, children: [] });
  }
  const render = (items, depth = 0) => {
    const tag = block.ordered ? "ol" : "ul";
    let ordinal = depth === 0 ? block.start : 1;
    return `<${tag}${block.ordered ? ` start="${ordinal}"` : ""}>\n${items.map(node => `<li${node.item ? block.ordered ? ` value="${ordinal++}"` : "" : ' style="list-style-type:none"'}>${node.item ? runs(node.item.runs, true) : ""}${node.children.length ? `\n${render(node.children, depth + 1)}` : ""}</li>`).join("\n")}\n</${tag}>`;
  };
  return render(root);
}

// Deliberately semantic Markdown + static inline HTML. No source HTML, scripts,
// external image URLs, private IDs, API URLs or storage keys enter this archive.
// This module is imported only by the credential-free conversion child.
export async function buildDocumentMarkdown(input, images = new Map(), { maxBytes = EXPORT_MAX_BYTES } = {}) {
  const doc = validateMarkdownDocument(input), zip = new JSZip(), paths = new Map();
  const file = (name, value) => zip.file(name, value, { date: new Date("1980-01-01T00:00:00Z") });
  let totalBytes = 0, totalPixels = 0;
  for (const id of documentAssetIds(doc)) {
    const image = images.get(id);
    if (!image || !Buffer.isBuffer(image.bytes) || !["png", "jpeg"].includes(image.format)
      || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width <= 0 || image.height <= 0) fail("EXPORT_IMAGE_UNSUPPORTED");
    totalPixels += image.width * image.height;
    if (!Number.isSafeInteger(totalPixels) || totalPixels > 16_000_000) fail("EXPORT_IMAGE_PIXELS_EXCEEDED");
    totalBytes += image.bytes.length;
    if (totalBytes > maxBytes) fail("EXPORT_RESULT_TOO_LARGE");
    const path = `images/image-${paths.size + 1}.${image.format === "jpeg" ? "jpg" : "png"}`;
    paths.set(id, path); file(path, image.bytes);
  }
  const blocks = [];
  for (const section of doc.sections) for (const block of section.blocks) {
    if (block.type === "paragraph") blocks.push(runs(block.runs));
    else if (block.type === "heading") blocks.push(`${"#".repeat(block.level)} ${runs(block.runs).replace(/<br \/>\n/g, "<br />")}`);
    else if (block.type === "list") blocks.push(list(block));
    else if (block.type === "table") {
      // HTML preserves zero or multiple header rows; a GFM pipe table would
      // invent a header and cannot faithfully represent both cases.
      blocks.push(`<table>\n${block.rows.map((row, index) => {
        const tag = index < block.headerRows ? "th" : "td";
        return `<tr>${row.cells.map(cell => `<${tag}>${runs(cell.runs, true)}</${tag}>`).join("")}</tr>`;
      }).join("\n")}\n</table>`);
    } else if (block.type === "image") {
      blocks.push(`<img src="${paths.get(block.assetId)}" alt="${escapeHtml(block.alt)}" />${block.caption ? `\n\n${text(block.caption, false)}` : ""}`);
    }
    // Page breaks and section metadata have no Markdown layout equivalent.
  }
  const markdown = `${blocks.join("\n\n")}\n`;
  const manifest = JSON.stringify({ format: "document-markdown-1", entry: "document.md", images: [...paths.values()],
    omitted: ["fonts", "colors", "alignment", "page_geometry", "pagination", "headers", "footers", "page_numbers", "editing_locks"],
    requires: ["inline_html", "relative_images"],
  }, null, 2);
  totalBytes += Buffer.byteLength(markdown) + Buffer.byteLength(manifest);
  if (totalBytes > maxBytes) fail("EXPORT_RESULT_TOO_LARGE");
  file("document.md", markdown); file("export-info.json", manifest);
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } });
  if (output.length > maxBytes) fail("EXPORT_RESULT_TOO_LARGE");
  return output;
}
