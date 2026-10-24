import JSZip from "jszip";
import { EXPORT_MAX_BYTES } from "../contracts/exports.js";
import { nativeDocumentAssetId } from "../native-office-media.js";
import { parseNativeDocumentForDocx, docxFail as fail, docxNumber as number } from "./native-docx-model.js";

const escape = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// Inline HTML preserves native style boundaries, tables and explicit numbering.
// Only serializer-owned tags are emitted. Snapshot strings are always escaped.
export async function buildNativeDocumentMarkdown(input, images = new Map(), { maxBytes = EXPORT_MAX_BYTES } = {}) {
  const { content, snapshot, stories } = parseNativeDocumentForDocx(input);
  if (snapshot.styles && Object.keys(snapshot.styles).length) fail();
  const zip = new JSZip(), paths = new Map();
  const file = (path, bytes) => zip.file(path, bytes, { date: new Date("1980-01-01T00:00:00Z") });
  let bytes = 0, pixels = 0;
  const main = stories.get("").nodes;
  function image(node) {
    const drawing = snapshot.drawings?.[node.blockId];
    if (!drawing || drawing.drawingType !== 0 || drawing.imageSourceType !== "URL") fail();
    const id = nativeDocumentAssetId(drawing.source);
    if (!id || !content.assetIds.includes(id)) fail("EXPORT_IMAGE_UNSUPPORTED");
    let path = paths.get(id);
    if (!path) {
      const asset = images.get(id);
      if (!asset || !Buffer.isBuffer(asset.bytes) || !["png", "jpeg"].includes(asset.format)) fail("EXPORT_IMAGE_UNSUPPORTED");
      number(asset.width, 1, 40000000, true); number(asset.height, 1, 40000000, true);
      pixels += asset.width * asset.height;
      if (!Number.isSafeInteger(pixels) || pixels > 16_000_000) fail("EXPORT_IMAGE_PIXELS_EXCEEDED");
      bytes += asset.bytes.length;
      if (bytes > maxBytes) fail("EXPORT_RESULT_TOO_LARGE");
      path = `images/image-${paths.size + 1}.${asset.format === "jpeg" ? "jpg" : "png"}`;
      paths.set(id, path); file(path, asset.bytes);
    }
    return `<img src="${path}" alt="${escape(drawing.description || drawing.title || "")}" />`;
  }
  function inline(nodes, base = {}) {
    return nodes.map(node => {
      if (node.type === "link") return `<a href="${escape(node.range.properties.url)}">${inline(node.children, base)}</a>`;
      // Fields in the body retain their visible cached text; no invented page
      // number calculation after removing pagination.
      if (node.type === "field") return inline(node.children, base);
      if (node.sId != null) fail();
      if (node.type === "image") return image(node);
      if (node.type === "tab") return "&#9;";
      if (["pageBreak", "softPageBreak", "columnBreak"].includes(node.type)) return "";
      if (node.type !== "text") fail();
      let value = escape(node.text), style = { ...base, ...node.ts };
      for (const [key, tag] of [["bl", "strong"], ["it", "em"]]) if (style[key] === 1) value = `<${tag}>${value}</${tag}>`;
      for (const [key, tag] of [["ul", "u"], ["st", "del"]]) if (style[key]?.s === 1) value = `<${tag}>${value}</${tag}>`;
      return value;
    }).join("");
  }
  function sequence(nodes) {
    const result = [], ordinals = new Map();
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (node.type === "section") continue;
      if (node.type === "table") {
        const table = snapshot.tableSource?.[node.tableId];
        if (!table || table.tableRows?.length !== node.rows.length) fail();
        result.push(`<table>\n${node.rows.map((row, r) => {
          const meta = table.tableRows[r];
          if (meta.tableCells?.length !== row.length) fail();
          const tag = meta.repeatHeaderRow === 1 ? "th" : "td";
          return `<tr>${row.map((cell, c) => {
            const props = meta.tableCells[c];
            // The current native editor does not author merged cells. Refuse
            // them instead of flattening their hidden contents on export.
            if (props.columnSpan > 1 || props.rowSpan > 1 || props.vMerge) fail();
            return `<${tag}>${sequence(cell).join("\n")}</${tag}>`;
          }).join("")}</tr>`;
        }).join("\n")}\n</table>`);
        continue;
      }
      if (node.type !== "paragraph") fail();
      const style = node.meta.paragraphStyle || {}, named = style.namedStyleType;
      const body = inline(node.children, { ...snapshot.documentStyle?.textStyle, ...style.textStyle });
      if (!node.meta.bullet) {
        const level = Number.isInteger(style.outlineLevel) ? style.outlineLevel + 1 : named >= 4 && named <= 8 ? named - 3 : null;
        const tag = level && level <= 6 ? `h${level}` : "p";
        result.push(`<${tag}>${body}</${tag}>`);
        continue;
      }
      const bullet = node.meta.bullet, depth = number(bullet.nestingLevel, 0, 8, true), definition = snapshot.lists?.[bullet.listType]?.nestingLevel?.[depth];
      if (!definition || typeof bullet.listId !== "string") fail();
      const ordered = definition.glyphType === 2;
      if (!ordered && definition.glyphType !== 0) fail();
      const key = `${bullet.listId}:${depth}`;
      if (bullet.startNumber != null || !ordinals.has(key)) ordinals.set(key, number(bullet.startNumber ?? definition.startNumber ?? 0, 0, 1000000, true) + 1);
      const ordinal = ordinals.get(key); ordinals.set(key, ordinal + 1);
      const tag = ordered ? "ol" : "ul";
      // Single-item lists retain list identity/numbering across intervening
      // blocks; wrapping parents express indentation without invented items.
      let item = `<${tag}${ordered ? ` start="${ordinal}"` : ""}><li>${body}</li></${tag}>`;
      for (let d = 0; d < depth; d++) item = `<ul><li style="list-style-type:none">${item}</li></ul>`;
      result.push(item);
    }
    return result;
  }
  const markdown = `${sequence(main).join("\n\n")}\n`;
  const manifest = JSON.stringify({ format: "univer-document-markdown-1", entry: "document.md", images: [...paths.values()],
    requires: ["inline_html", "relative_images"], omitted: ["fonts", "colors", "alignment", "page_geometry", "pagination", "headers", "footers", "editing_locks", "fields_use_cached_text"],
  }, null, 2);
  bytes += Buffer.byteLength(markdown) + Buffer.byteLength(manifest);
  if (bytes > maxBytes) fail("EXPORT_RESULT_TOO_LARGE");
  file("document.md", markdown); file("export-info.json", manifest);
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } });
  if (output.length > maxBytes) fail("EXPORT_RESULT_TOO_LARGE");
  return output;
}
