import { textDocumentSchema } from "../contracts/document.js";
import { toNativeDocumentArtifact } from "../native-document-adapter.js";
import { nativeDocumentAssetId } from "../native-office-media.js";
import { parseNativeDocumentForDocx, docxKeys as keys, docxNumber as number } from "./native-docx-model.js";
import { textProperties, paragraphProperties, rgb, unitTwips, namedText, namedSpacing } from "./native-docx-style.js";

const fail = () => { throw new Error("EXPORT_DOCUMENT_PDF_UNSUPPORTED"); };
const pt = value => unitTwips(value) / 20;
const color = value => `#${rgb(value)}`;
const zero = value => value == null || value === 0 || value === false;
const empty = value => value == null || typeof value === "object" && !Object.keys(value).length;
const headerKeys = ["defaultHeaderId", "defaultFooterId", "firstPageHeaderId", "firstPageFooterId", "evenPageHeaderId", "evenPageFooterId", "useFirstPageHeaderFooter", "evenAndOddHeaders"];
const geometryKeys = ["pageSize", "pageOrient", "marginTop", "marginBottom", "marginLeft", "marginRight", "marginHeader", "marginFooter", "pageNumberStart", "documentFlavor"];

function textStyle(value) {
  textProperties(value);
  if (value.smallCaps || value.hidden || !zero(value.va) && value.va !== 1 || !zero(value.kerning)) fail();
  if (value.ul?.t != null && value.ul.t !== 12 || value.ul?.c === 0 && value.ul.cl) fail();
  const family = /serif|georgia|times|宋|明朝/i.test(value.ff || "") && !/sans/i.test(value.ff || "") ? "serif"
    : /mono|consolas|courier/i.test(value.ff || "") ? "mono" : "sans";
  return { family, size: number(value.fs ?? 12, 1, 200), bold: value.bl === 1, italic: value.it === 1,
    underline: value.ul?.s === 1, strike: value.st?.s === 1, color: value.cl ? color(value.cl) : "#171717", highlight: value.bg ? color(value.bg) : null, caps: value.caps === true };
}

// Both codecs converge on a checked PDF flow model. Native snapshots are read
// directly: they are never projected back into the narrower semantic schema.
export function documentPdfModel(input) {
  if (input?.schemaVersion === 1) {
    const source = textDocumentSchema.parse(input);
    for (const section of source.sections) for (const block of section.blocks) block.locked = false; // export does not carry editing permissions
    input = toNativeDocumentArtifact(source, "document-pdf-export");
  }
  const { content, snapshot, stories } = parseNativeDocumentForDocx(input);
  const doc = snapshot.documentStyle;
  keys(doc, [...geometryKeys, ...headerKeys, "textStyle", "defaultParagraphStyle", "defaultTabStop", "autoHyphenation", "doNotHyphenateCaps", "consecutiveHyphenLimit", "hyphenationZone"]);
  for (const key of ["autoHyphenation", "doNotHyphenateCaps"]) if (doc[key] != null) number(doc[key], 0, 1, true);
  if (doc.consecutiveHyphenLimit != null) number(doc.consecutiveHyphenLimit, 0, 100, true);
  if (doc.hyphenationZone != null) pt(doc.hyphenationZone);
  if (!empty(snapshot.styles) || doc.documentFlavor != null && doc.documentFlavor !== 1 || headerKeys.slice(2).some(key => !zero(doc[key]) && doc[key] !== "")) fail();
  keys(doc.pageSize, ["width", "height"]);
  const page = { width: number(doc.pageSize.width, 192, 2112) * .75, height: number(doc.pageSize.height, 192, 2112) * .75,
    top: number(doc.marginTop ?? 72, 0, 1000) * .75, bottom: number(doc.marginBottom ?? 72, 0, 1000) * .75,
    left: number(doc.marginLeft ?? 72, 0, 1000) * .75, right: number(doc.marginRight ?? 72, 0, 1000) * .75,
    header: number(doc.marginHeader ?? 24, 0, 1000) * .75, footer: number(doc.marginFooter ?? 24, 0, 1000) * .75,
    numberStart: number(doc.pageNumberStart ?? 1, 1, 1000000, true) };
  if (page.width - page.left - page.right < 36 || page.height - page.top - page.bottom < 36) fail();
  const ordinals = new Map(), usedDrawings = new Set(), usedTables = new Set(); let characters = 0;
  function inlines(nodes, base, overlay = {}) {
    return nodes.flatMap(node => {
      if (node.type === "link") return inlines(node.children, base, { ...overlay,
        ...(node.range.properties.textStyleMode === "text" ? {} : { ul: { s: 1 }, ...(node.range.properties.textColorMode === "text" ? {} : { cl: { rgb: "#2563EB" } }) }) });
      if (node.type === "field") {
        if (!node.children.length || node.children.some(child => child.type !== "text" || child.sId != null)) fail();
        const styles = node.children.map(child => textStyle({ ...base, ...child.ts, ...overlay }));
        if (styles.some(style => JSON.stringify(style) !== JSON.stringify(styles[0]))) fail();
        return [{ type: "field", field: node.range.properties.fieldType, style: styles[0] }];
      }
      if (node.sId != null) fail();
      const style = textStyle({ ...base, ...node.ts, ...overlay });
      if (node.type === "text") {
        characters += node.text.length; if (characters > 300000) throw new Error("EXPORT_DOCUMENT_PDF_LIMIT");
        return [{ type: "text", text: style.caps ? node.text.toUpperCase() : node.text, style }];
      }
      if (node.type === "softPageBreak") return []; // cached pagination from another renderer
      if (node.type === "pageBreak") return [{ type: "break" }];
      if (node.type === "tab") return [{ type: "tab", style }];
      if (node.type !== "image") fail();
      const drawing = snapshot.drawings?.[node.blockId];
      usedDrawings.add(node.blockId);
      keys(drawing, ["drawingId", "unitId", "subUnitId", "drawingType", "imageSourceType", "source", "title", "description", "layoutType", "transform", "docTransform"]);
      if (drawing.drawingId !== node.blockId || drawing.layoutType !== 0 || drawing.drawingType !== 0 || drawing.imageSourceType !== "URL") fail();
      const transform = drawing.docTransform;
      keys(transform, ["size", "angle", "positionH", "positionV"]); keys(transform.size, ["width", "height"]);
      if (!zero(transform.angle)) fail();
      for (const position of [transform.positionH, transform.positionV]) if (position != null) { keys(position, ["relativeFrom", "posOffset"]); if (!zero(position.posOffset)) fail(); }
      if (drawing.transform != null) {
        keys(drawing.transform, ["width", "height", "angle"]);
        if (!zero(drawing.transform.angle) || drawing.transform.width !== transform.size.width || drawing.transform.height !== transform.size.height) fail();
      }
      const assetId = nativeDocumentAssetId(drawing.source);
      if (!assetId || !content.assetIds.includes(assetId)) fail();
      return [{ type: "image", assetId, width: number(transform.size.width, 1, 1600) * .75, height: number(transform.size.height, 1, 1600) * .75 }];
    });
  }
  function paragraph(node) {
    keys(node.meta, ["startIndex", "paragraphId", "paragraphStyle", "bullet"]);
    if (node.markStyle.sId != null) fail();
    const direct = node.meta.paragraphStyle || {}, named = number(direct.namedStyleType ?? 0, 0, 8, true);
    const p = { ...doc.defaultParagraphStyle, ...namedSpacing[named], ...direct };
    paragraphProperties(p);
    if (p.direction === 2 || p.spacingRule && p.spacingRule !== 0 || p.tabStops?.length || p.shading || p.contextualSpacing || p.beforeAutoSpacing || p.afterAutoSpacing || p.wordWrap === 0) fail();
    let left = p.indentStart ? pt(p.indentStart) : 0, first = p.indentFirstLine ? pt(p.indentFirstLine) : -(p.hanging ? pt(p.hanging) : 0), prefix = "";
    if (node.meta.bullet) {
      const bullet = node.meta.bullet; keys(bullet, ["listType", "listId", "nestingLevel", "startNumber"]);
      const depth = number(bullet.nestingLevel, 0, 8, true), definition = snapshot.lists?.[bullet.listType]?.nestingLevel?.[depth];
      if (!definition || ![0, 2].includes(definition.glyphType) || typeof bullet.listId !== "string") fail();
      keys(definition, ["bulletAlignment", "glyphFormat", "glyphType", "glyphSymbol", "startNumber", "paragraphProperties", "textStyle"]);
      if (!empty(definition.textStyle) || definition.glyphType === 2 && definition.glyphFormat && definition.glyphFormat !== `%${depth + 1}.`) fail();
      const key = `${bullet.listId}:${depth}`;
      if (!ordinals.has(key) || bullet.startNumber != null) ordinals.set(key, number(bullet.startNumber ?? definition.startNumber ?? 0, 0, 1000000, true) + 1);
      prefix = definition.glyphType === 2 ? `${ordinals.get(key)}. ` : `${definition.glyphSymbol || "•"} `;
      ordinals.set(key, ordinals.get(key) + 1);
      const listStyle = definition.paragraphProperties || {}; keys(listStyle, ["indentStart", "hanging"]);
      left = listStyle.indentStart ? pt(listStyle.indentStart) : 18 * (depth + 1); first = -(listStyle.hanging ? pt(listStyle.hanging) : 18);
    }
    const base = { ...doc.textStyle, ...namedText[named], ...direct.textStyle }, style = textStyle(base);
    const children = inlines(node.children, base);
    if (prefix) children.unshift({ type: "text", text: prefix, style });
    return { type: "paragraph", children, style, align: ["left", "left", "center", "right", "justify", "justify", "justify"][p.horizontalAlign ?? 1],
      lineHeight: number(p.lineSpacing ?? 1.4, .8, 3), before: p.spaceAbove ? pt(p.spaceAbove) : 0, after: p.spaceBelow ? pt(p.spaceBelow) : 0,
      left, right: p.indentEnd ? pt(p.indentEnd) : 0, first, keepNext: p.keepNext === 1, keepLines: p.keepLines === 1, breakBefore: p.pageBreakBefore === 1 };
  }
  const tableWidth = value => { keys(value, ["type", "width"]); if (value.type !== 1) fail(); return pt(value.width); };
  function sequence(nodes, depth = 0) {
    if (depth > 1) fail();
    return nodes.flatMap(node => {
      if (node.type === "paragraph") return [paragraph(node)];
      if (node.type === "section") {
        keys(node.meta, ["sectionId", "startIndex", "sectionType", ...geometryKeys, ...headerKeys]);
        if (![undefined, 0, 1].includes(node.meta.sectionType) || [...geometryKeys, ...headerKeys].some(key => node.meta[key] != null && JSON.stringify(node.meta[key]) !== JSON.stringify(doc[key]))) fail();
        return [];
      }
      if (node.type !== "table" || depth) fail();
      const t = snapshot.tableSource?.[node.tableId];
      usedTables.add(node.tableId);
      keys(t, ["tableId", "align", "indent", "textWrap", "position", "dist", "size", "tableColumns", "tableRows", "cellMargin", "layout", "description"]);
      if (t.tableId !== node.tableId || t.textWrap !== 0 || t.indent && pt(t.indent) !== 0 || ![undefined, 0].includes(t.align) || t.tableRows?.length !== node.rows.length || !Array.isArray(t.tableColumns) || !t.tableColumns.length || t.tableColumns.length > 20) fail();
      if (t.position) { keys(t.position, ["positionH", "positionV"]); for (const p of Object.values(t.position)) { keys(p, ["relativeFrom", "posOffset"]); if (!zero(p.posOffset)) fail(); } }
      if (t.dist && Object.values(t.dist).some(v => !zero(v))) fail();
      const widths = t.tableColumns.map(col => { keys(col, ["size"]); return tableWidth(col.size); });
      if (widths.some(w => w < 10) || Math.abs(widths.reduce((s, w) => s + w, 0) - tableWidth(t.size)) > 2) fail();
      let bodySeen = false;
      return [{ type: "table", widths, rows: node.rows.map((row, index) => {
        const meta = t.tableRows[index]; keys(meta, ["tableCells", "trHeight", "cantSplit", "repeatHeaderRow"]);
        if (row.length !== widths.length || meta.tableCells?.length !== row.length || meta.trHeight?.hRule === 2) fail();
        const header = meta.repeatHeaderRow === 1; if (header && bodySeen) fail(); if (!header) bodySeen = true;
        if (meta.trHeight) keys(meta.trHeight, ["val", "hRule"]);
        return { header, minHeight: meta.trHeight?.val ? pt(meta.trHeight.val) : 0, cells: row.map((cell, c) => {
          const props = meta.tableCells[c]; keys(props, ["size", "margin", "rowSpan", "columnSpan", "backgroundColor", "borderTop", "borderBottom", "borderLeft", "borderRight", "vAlign", "tcFitText", "tcHideMark", "textDirection"]);
          if (![undefined, 1].includes(props.rowSpan) || ![undefined, 1].includes(props.columnSpan) || props.tcFitText || props.tcHideMark || props.textDirection && props.textDirection !== "lrTb" || ![undefined, 0, 2, 3, 4].includes(props.vAlign)) fail();
          if (props.size && Math.abs(tableWidth(props.size) - widths[c]) > 2) fail();
          const margin = props.margin || t.cellMargin || {}; keys(margin, ["start", "end", "top", "bottom"]);
          const borders = {};
          for (const side of ["Top", "Bottom", "Left", "Right"]) if (props[`border${side}`]) {
            const b = props[`border${side}`]; keys(b, ["color", "width", "dashStyle"]); if (![undefined, 0, 1].includes(b.dashStyle)) fail();
            borders[side] = { width: b.width ? pt(b.width) : .5, color: b.color ? color(b.color) : "#d1d5db" };
          }
          return { children: sequence(cell, depth + 1), vertical: props.vAlign ?? 0, background: props.backgroundColor ? color(props.backgroundColor) : null, borders,
            left: margin.start ? pt(margin.start) : 5, right: margin.end ? pt(margin.end) : 5, top: margin.top ? pt(margin.top) : 4, bottom: margin.bottom ? pt(margin.bottom) : 4 };
        }) };
      }) }];
    });
  }
  function story(id, kind) {
    if (!id) return [];
    if (stories.get(id)?.kind !== kind) fail();
    const result = sequence(stories.get(id).nodes);
    if (result.some(node => node.type !== "paragraph" || node.children.some(child => ["image", "break"].includes(child.type)))) fail();
    return result;
  }
  const model = { page, blocks: sequence(stories.get("").nodes), header: story(doc.defaultHeaderId, "header"), footer: story(doc.defaultFooterId, "footer"),
    tabStop: number(doc.defaultTabStop ?? 36, 1, 3000), assetIds: content.assetIds };
  if (Object.keys(snapshot.drawings || {}).some(id => !usedDrawings.has(id)) || Object.keys(snapshot.tableSource || {}).some(id => !usedTables.has(id))) fail();
  for (const order of [snapshot.drawingsOrder, snapshot.headerFooterDrawingsOrder]) if (order != null && (!Array.isArray(order) || new Set(order).size !== order.length || order.some(id => !usedDrawings.has(id)))) fail();
  for (const id of stories.keys()) if (id && id !== doc.defaultHeaderId && id !== doc.defaultFooterId) fail();
  return model;
}
