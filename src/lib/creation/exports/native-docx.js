import JSZip from "jszip";
import { EXPORT_MAX_BYTES } from "../contracts/exports.js";
import { nativeDocumentAssetId } from "../native-office-media.js";
import { parseNativeDocumentForDocx, docxFail as fail, docxKeys as keys, docxNumber as number } from "./native-docx-model.js";
import { W, R, H, xml, rgb, bool, pxTwips, unitTwips, textProperties, paragraphProperties, namedText, namedSpacing } from "./native-docx-style.js";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS = `xmlns:w="${W}" xmlns:r="${R}" xmlns:a="${A}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;
const empty = value => value == null || typeof value === "object" && Object.keys(value).length === 0;
const relXml = rels => `${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map(r => `<Relationship Id="${r.id}" Type="${r.type.startsWith("http:") ? r.type : `${R}/${r.type}`}" Target="${xml(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`;
const headerKeys = ["defaultHeaderId", "defaultFooterId", "firstPageHeaderId", "firstPageFooterId", "evenPageHeaderId", "evenPageFooterId", "useFirstPageHeaderFooter", "evenAndOddHeaders"];
const geometryKeys = ["pageSize", "pageOrient", "marginTop", "marginBottom", "marginLeft", "marginRight", "marginHeader", "marginFooter", "pageNumberStart", "documentFlavor"];
function geometry(style) {
  if (style.documentFlavor != null && style.documentFlavor !== 1) fail();
  keys(style.pageSize, ["width", "height"]);
  const width = pxTwips(style.pageSize.width), height = pxTwips(style.pageSize.height);
  if (width < 1440 || height < 1440 || width > 31680 || height > 31680) fail();
  const left = pxTwips(style.marginLeft ?? 72), right = pxTwips(style.marginRight ?? 72), top = pxTwips(style.marginTop ?? 72), bottom = pxTwips(style.marginBottom ?? 72);
  if (left + right >= width || top + bottom >= height) fail();
  if (style.pageOrient != null) bool(style.pageOrient);
  return { width, height, left, right, top, bottom, header: pxTwips(style.marginHeader ?? 24), footer: pxTwips(style.marginFooter ?? 24) };
}
function margins(value) {
  if (value == null) return ""; keys(value, ["start", "end", "top", "bottom"]);
  return Object.entries(value).map(([name, size]) => `<w:${name} w:w="${unitTwips(size)}" w:type="dxa"/>`).join("");
}
function tableWidth(value) {
  keys(value, ["type", "width"]); if (value.type !== 1) fail(); return unitTwips(value.width);
}
function border(value, name) {
  keys(value, ["color", "width", "dashStyle"]);
  const width = value.width == null ? 4 : Math.round(unitTwips(value.width) * 0.4);
  if (width > 96) fail();
  return `<w:${name} w:val="${width === 0 ? "nil" : ["single", "single", "dotted", "dashed"][number(value.dashStyle ?? 1, 0, 3, true)]}" w:sz="${width}" w:color="${rgb(value.color)}"/>`;
}

// Direct native snapshot serializer. All conversion/ZIP/image work belongs to
// the isolated child; no engine, browser, model call or network fetch is used.
export async function buildNativeDocumentDocx(input, images = new Map(), { maxBytes = EXPORT_MAX_BYTES } = {}) {
  const { content, snapshot: data, stories } = parseNativeDocumentForDocx(input), doc = data.documentStyle;
  keys(doc, [...geometryKeys, ...headerKeys, "textStyle", "defaultParagraphStyle", "defaultTabStop", "autoHyphenation", "doNotHyphenateCaps", "consecutiveHyphenLimit", "hyphenationZone"]);
  if (!empty(data.styles)) fail(); // Named-style inheritance needs a separate codec.
  geometry(doc); textProperties(doc.textStyle); paragraphProperties(doc.defaultParagraphStyle);
  const zip = new JSZip(), parts = [], mainRels = [], media = new Map(), storyFiles = new Map(), usedStories = new Set(), usedDrawings = new Set(), usedTables = new Set();
  const file = (name, value) => zip.file(name, value, { date: new Date("1980-01-01T00:00:00Z") });
  const relationMaps = new WeakMap();
  const relate = (rels, type, target, external = false) => {
    if (!relationMaps.has(rels)) relationMaps.set(rels, new Map()); const map = relationMaps.get(rels), key = JSON.stringify([type, target, external]);
    if (map.has(key)) return map.get(key);
    if (rels.length >= 10000) fail("EXPORT_NATIVE_DOCUMENT_LIMIT");
    const id = `rId${rels.length + 1}`; rels.push({ id, type, target, external }); map.set(key, id); return id;
  };
  let imageBytes = 0, drawingNumber = 0;
  for (const assetId of content.assetIds) {
    const image = images.get(assetId);
    if (!image || !Buffer.isBuffer(image.bytes) || !["png", "jpeg"].includes(image.format)) fail("EXPORT_IMAGE_UNSUPPORTED");
    number(image.width, 1, 40000000); number(image.height, 1, 40000000);
    imageBytes += image.bytes.length; if (imageBytes > 100 * 1024 * 1024) fail("EXPORT_ASSETS_TOO_LARGE");
    const path = `media/image${media.size + 1}.${image.format}`; media.set(assetId, path); file(`word/${path}`, image.bytes);
  }
  let headerCount = 0, footerCount = 0;
  for (const [id, story] of stories) if (id) storyFiles.set(id, `${story.kind}${story.kind === "header" ? ++headerCount : ++footerCount}.xml`);
  const lists = new Map(), abstractLists = new Map();
  function bulletXml(bullet) {
    keys(bullet, ["listType", "listId", "nestingLevel", "startNumber"]);
    if (typeof bullet.listId !== "string" || typeof bullet.listType !== "string") fail();
    const definition = data.lists?.[bullet.listType]; keys(definition, ["listType", "nestingLevel"]);
    if (definition.listType !== bullet.listType || !Array.isArray(definition.nestingLevel) || !definition.nestingLevel.length || definition.nestingLevel.length > 9) fail();
    const depth = number(bullet.nestingLevel, 0, definition.nestingLevel.length - 1, true);
    if (!abstractLists.has(bullet.listType)) {
      if (abstractLists.size >= 200) fail("EXPORT_NATIVE_DOCUMENT_LIMIT");
      abstractLists.set(bullet.listType, { id: abstractLists.size, definition });
    }
    let list = lists.get(bullet.listId);
    if (!list) { if (lists.size >= 1000) fail("EXPORT_NATIVE_DOCUMENT_LIMIT"); list = { id: lists.size + 1, type: bullet.listType, starts: new Map(), seen: new Set() }; lists.set(bullet.listId, list); }
    if (list.type !== bullet.listType) fail();
    if (bullet.startNumber != null) {
      if (list.seen.has(depth)) fail(); // mid-sequence restart needs a distinct num instance
      list.starts.set(depth, number(bullet.startNumber, 0, 1000000, true) + 1);
    }
    list.seen.add(depth);
    return `<w:numPr><w:ilvl w:val="${depth}"/><w:numId w:val="${list.id}"/></w:numPr>`;
  }
  function imageXml(id, rels) {
    const d = data.drawings?.[id]; keys(d, ["drawingId", "unitId", "subUnitId", "drawingType", "imageSourceType", "source", "title", "description", "layoutType", "transform", "docTransform"]);
    if (d.drawingId !== id || d.drawingType !== 0 || d.imageSourceType !== "URL" || d.layoutType !== 0 || usedDrawings.has(id)) fail();
    const asset = nativeDocumentAssetId(d.source); if (!asset || !media.has(asset)) fail("EXPORT_IMAGE_UNSUPPORTED");
    const t = d.docTransform; keys(t, ["size", "angle", "positionH", "positionV"]); keys(t.size, ["width", "height"]);
    if (t.angle != null && t.angle !== 0) fail();
    for (const p of [t.positionH, t.positionV]) if (p != null) { keys(p, ["relativeFrom", "posOffset"]); if (p.posOffset !== 0) fail(); }
    if (d.transform != null) {
      keys(d.transform, ["width", "height", "angle"]);
      if (d.transform.angle && d.transform.angle !== 0 || d.transform.width !== t.size.width || d.transform.height !== t.size.height) fail();
    }
    usedDrawings.add(id);
    if (usedDrawings.size > 100) fail("EXPORT_ASSETS_TOO_LARGE");
    const cx = Math.round(number(t.size.width, 1, 1600) * 9525), cy = Math.round(number(t.size.height, 1, 1600) * 9525), n = ++drawingNumber;
    const rel = relate(rels, "image", media.get(asset));
    return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="${xml(d.title || `Image ${n}`)}" descr="${xml(d.description || "")}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${xml(d.title || `Image ${n}`)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
  }
  let xmlWork = 0;
  const boundedXml = value => { xmlWork += Buffer.byteLength(value); if (xmlWork > 32 * 1024 * 1024) fail("EXPORT_NATIVE_DOCUMENT_LIMIT"); return value; };
  function inline(nodes, base, rels, inLink = false, overlay = {}) {
    return nodes.map(node => {
      if (node.type === "link") {
        if (inLink) fail();
        const id = relate(rels, "hyperlink", node.range.properties.url, true);
        const p = node.range.properties, linkStyle = p.textStyleMode === "text" ? {} : { ul: { s: 1 }, ...(p.textColorMode === "text" ? {} : { cl: { rgb: "#2563EB" } }) };
        return `<w:hyperlink r:id="${id}" w:history="1">${inline(node.children, base, rels, true, { ...overlay, ...linkStyle })}</w:hyperlink>`;
      }
      if (node.type === "field") return `<w:fldSimple w:instr=" ${node.range.properties.fieldType} " w:dirty="true">${inline(node.children, base, rels, inLink, overlay)}</w:fldSimple>`;
      if (node.sId != null) fail();
      const style = textProperties({ ...base, ...node.ts, ...overlay });
      const value = node.type === "text" ? `<w:t xml:space="preserve">${xml(node.text)}</w:t>` : node.type === "tab" ? "<w:tab/>" : node.type === "image" ? imageXml(node.blockId, rels)
        : node.type === "softPageBreak" ? "<w:lastRenderedPageBreak/>" : `<w:br w:type="${node.type === "columnBreak" ? "column" : "page"}"/>`;
      return boundedXml(`<w:r>${style ? `<w:rPr>${style}</w:rPr>` : ""}${value}</w:r>`);
    }).join("");
  }
  const sectionCache = new WeakMap(); let sectionCount = 0, previousSection = { ...doc };
  function sectionXml(meta) {
    if (sectionCache.has(meta)) return sectionCache.get(meta);
    keys(meta, ["sectionId", "startIndex", "sectionType", ...geometryKeys, ...headerKeys]);
    for (const key of headerKeys.filter(key => key.endsWith("Id"))) if (meta[key] === "" && previousSection[key]) fail();
    const style = { ...previousSection, ...meta }, g = geometry(style), refs = [];
    for (const [key, type] of [["defaultHeaderId", "default"], ["defaultFooterId", "default"], ["evenPageHeaderId", "even"], ["evenPageFooterId", "even"], ["firstPageHeaderId", "first"], ["firstPageFooterId", "first"]]) if (style[key]) {
      const id = style[key], kind = key.includes("Header") ? "header" : "footer";
      if (!storyFiles.has(id) || stories.get(id).kind !== kind) fail(); usedStories.add(id);
      refs.push(`<w:${kind}Reference w:type="${type}" r:id="${relate(mainRels, kind, storyFiles.get(id))}"/>`);
    }
    if (meta.evenAndOddHeaders != null && meta.evenAndOddHeaders !== doc.evenAndOddHeaders) fail();
    const type = ["continuous", "continuous", "nextColumn", "nextPage", "evenPage", "oddPage"][number(style.sectionType ?? 1, 0, 5, true)];
    const start = sectionCount++ === 0 ? style.pageNumberStart : meta.pageNumberStart;
    const result = `<w:sectPr>${refs.join("")}<w:type w:val="${type}"/><w:pgSz w:w="${g.width}" w:h="${g.height}" w:orient="${style.pageOrient === 1 ? "landscape" : "portrait"}"/><w:pgMar w:top="${g.top}" w:right="${g.right}" w:bottom="${g.bottom}" w:left="${g.left}" w:header="${g.header}" w:footer="${g.footer}" w:gutter="0"/>${start == null ? "" : `<w:pgNumType w:start="${number(start, 1, 1000000, true)}"/>`}${style.useFirstPageHeaderFooter != null && bool(style.useFirstPageHeaderFooter) ? "<w:titlePg/>" : ""}</w:sectPr>`;
    previousSection = { ...style }; delete previousSection.sectionType;
    sectionCache.set(meta, result); return result;
  }
  function paragraph(node, rels, section = "") {
    const meta = node.meta; keys(meta, ["startIndex", "paragraphId", "paragraphStyle", "bullet"]);
    const direct = meta.paragraphStyle ?? {}, named = direct.namedStyleType ?? 0; number(named, 0, 8, true);
    const style = { widowControl: 1, ...doc.defaultParagraphStyle, ...namedSpacing[named], ...direct };
    const base = { ...doc.textStyle, ...namedText[named], ...direct.textStyle };
    const mark = textProperties({ ...base, ...node.markStyle.ts, ...direct.paragraphMarkTextStyle }); if (node.markStyle.sId != null) fail();
    const list = meta.bullet ? bulletXml(meta.bullet) : "";
    if (meta.bullet && !empty(data.lists[meta.bullet.listType].nestingLevel[0]?.paragraphProperties?.textStyle)) fail();
    const properties = paragraphProperties(style, [named > 1 ? `<w:pStyle w:val="NativeStyle${named}"/>` : "", list]);
    return `<w:p><w:pPr>${properties}${mark ? `<w:rPr>${mark}</w:rPr>` : ""}${section}</w:pPr>${inline(node.children, base, rels)}</w:p>`;
  }
  function table(node, rels, depth) {
    const table = data.tableSource?.[node.tableId]; keys(table, ["tableId", "align", "indent", "textWrap", "position", "dist", "size", "tableColumns", "tableRows", "cellMargin", "layout", "description"]);
    if (usedTables.has(node.tableId) || table.tableId !== node.tableId || table.textWrap !== 0 || !Array.isArray(table.tableRows) || table.tableRows.length !== node.rows.length || !Array.isArray(table.tableColumns) || !table.tableColumns.length || table.tableColumns.length > 63) fail();
    usedTables.add(node.tableId);
    if (table.position != null) { keys(table.position, ["positionH", "positionV"]); for (const pos of Object.values(table.position)) { keys(pos, ["relativeFrom", "posOffset"]); if (pos.posOffset !== 0) fail(); } }
    if (table.dist != null) { keys(table.dist, ["distT", "distR", "distB", "distL"]); if (Object.values(table.dist).some(v => v !== 0)) fail(); }
    const widths = table.tableColumns.map(col => { keys(col, ["size"]); return tableWidth(col.size); });
    const rows = node.rows.map((cells, r) => {
      const row = table.tableRows[r]; keys(row, ["tableCells", "trHeight", "cantSplit", "repeatHeaderRow"]);
      if (!Array.isArray(row.tableCells) || row.tableCells.length !== cells.length || cells.length !== widths.length) fail();
      let props = "";
      if (row.cantSplit != null) props += `<w:cantSplit w:val="${bool(row.cantSplit)}"/>`;
      if (row.trHeight != null) { keys(row.trHeight, ["val", "hRule"]); props += `<w:trHeight w:val="${unitTwips(row.trHeight.val)}" w:hRule="${["auto", "atLeast", "exact"][number(row.trHeight.hRule, 0, 2, true)]}"/>`; }
      if (row.repeatHeaderRow != null) props += `<w:tblHeader w:val="${bool(row.repeatHeaderRow)}"/>`;
      return `<w:tr><w:trPr>${props}</w:trPr>${cells.map((children, c) => {
        const cell = row.tableCells[c]; keys(cell, ["size", "margin", "rowSpan", "columnSpan", "backgroundColor", "borderTop", "borderBottom", "borderLeft", "borderRight", "vAlign", "tcFitText", "tcHideMark", "textDirection"]);
        if (cell.rowSpan != null && cell.rowSpan !== 1 || cell.columnSpan != null && cell.columnSpan !== 1) fail();
        const borders = ["Top", "Left", "Bottom", "Right"].filter(side => cell[`border${side}`]).map(side => border(cell[`border${side}`], side.toLowerCase())).join("");
        const margin = margins(cell.margin);
        const valign = cell.vAlign == null ? "" : `<w:vAlign w:val="${["top", "both", "top", "center", "bottom"][number(cell.vAlign, 0, 4, true)]}"/>`;
        if (cell.textDirection != null && !["lrTb", "tbRl", "btLr", "lrTbV", "tbRlV", "tbLrV"].includes(cell.textDirection)) fail();
        const options = `${cell.tcFitText == null ? "" : `<w:tcFitText w:val="${bool(cell.tcFitText)}"/>`}${valign}${cell.tcHideMark == null ? "" : `<w:hideMark w:val="${bool(cell.tcHideMark)}"/>`}`;
        return `<w:tc><w:tcPr><w:tcW w:w="${cell.size ? tableWidth(cell.size) : widths[c]}" w:type="dxa"/>${borders ? `<w:tcBorders>${borders}</w:tcBorders>` : ""}${cell.backgroundColor ? `<w:shd w:val="clear" w:fill="${rgb(cell.backgroundColor)}"/>` : ""}${margin ? `<w:tcMar>${margin}</w:tcMar>` : ""}${cell.textDirection ? `<w:textDirection w:val="${cell.textDirection}"/>` : ""}${options}</w:tcPr>${sequence(children, rels, "cell", depth + 1)}</w:tc>`;
      }).join("")}</w:tr>`;
    }).join("");
    const margin = margins(table.cellMargin);
    return `<w:tbl><w:tblPr><w:tblW w:w="${tableWidth(table.size)}" w:type="dxa"/><w:jc w:val="${["left", "center", "right"][number(table.align ?? 0, 0, 2, true)]}"/>${table.indent ? `<w:tblInd w:w="${unitTwips(table.indent, true)}" w:type="dxa"/>` : ""}<w:tblLayout w:type="${number(table.layout ?? 0, 0, 1, true) ? "fixed" : "autofit"}"/>${margin ? `<w:tblCellMar>${margin}</w:tblCellMar>` : ""}${table.description ? `<w:tblDescription w:val="${xml(table.description)}"/>` : ""}</w:tblPr><w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows}</w:tbl>`;
  }
  function sequence(nodes, rels, kind, depth = 0) {
    if (depth > 8) fail("EXPORT_NATIVE_DOCUMENT_LIMIT");
    const output = []; let lastType, finalSection = "";
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.type === "section") {
        if (kind !== "main") { keys(node.meta, ["sectionId", "startIndex", "sectionType"]); if (![undefined, 0, 1].includes(node.meta.sectionType)) fail(); }
        else {
          const section = sectionXml(node.meta);
          if (i === nodes.length - 1) finalSection = section;
          else if (lastType !== "paragraph") fail(); // section must terminate a paragraph
        }
      } else if (node.type === "paragraph") {
        const next = nodes[i + 1], section = kind === "main" && next?.type === "section" && i + 1 < nodes.length - 1 ? sectionXml(next.meta) : "";
        output.push(paragraph(node, rels, section)); lastType = "paragraph";
      } else { output.push(table(node, rels, depth)); lastType = "table"; }
    }
    if (lastType !== "paragraph") output.push("<w:p/>");
    if (kind === "main") { if (!finalSection) fail(); output.push(finalSection); }
    return output.join("");
  }
  relate(mainRels, "styles", "styles.xml"); relate(mainRels, "settings", "settings.xml");
  const body = sequence(stories.get("").nodes, mainRels, "main");
  file("word/document.xml", `${H}<w:document ${NS}><w:body>${body}</w:body></w:document>`); parts.push(["document.xml", "document.main"]);
  if (usedStories.size !== storyFiles.size) fail();
  for (const id of usedStories) {
    const story = stories.get(id), rels = [], tag = story.kind === "header" ? "hdr" : "ftr", filename = storyFiles.get(id);
    file(`word/${filename}`, `${H}<w:${tag} ${NS}>${sequence(story.nodes, rels, story.kind)}</w:${tag}>`);
    if (rels.length) file(`word/_rels/${filename}.rels`, relXml(rels)); parts.push([filename, story.kind]);
  }
  if (Object.keys(data.drawings ?? {}).length !== usedDrawings.size || Object.keys(data.tableSource ?? {}).length !== usedTables.size) fail();
  for (const order of [data.drawingsOrder, data.headerFooterDrawingsOrder]) if (order != null && (!Array.isArray(order) || new Set(order).size !== order.length || order.some(id => !usedDrawings.has(id)))) fail();
  if (lists.size) {
    const definitions = [...abstractLists.values()].map(({ id, definition }) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="multilevel"/>${definition.nestingLevel.map((level, depth) => {
      keys(level, ["bulletAlignment", "glyphFormat", "glyphType", "glyphSymbol", "startNumber", "paragraphProperties", "textStyle", "isLegal"]);
      const glyph = number(level.glyphType ?? 0, 0, 7, true), format = ["bullet", "none", "decimal", "decimalZero", "upperLetter", "lowerLetter", "upperRoman", "lowerRoman"][glyph];
      if (typeof level.glyphFormat !== "string" || level.glyphFormat.length > 256 || level.isLegal != null && typeof level.isLegal !== "boolean") fail();
      const text = glyph === 0 ? level.glyphFormat.replace(/%[1-9]/g, level.glyphSymbol ?? "•") : glyph === 1 ? "" : level.glyphFormat;
      const p = paragraphProperties(level.paragraphProperties), t = textProperties(level.textStyle);
      return `<w:lvl w:ilvl="${depth}"><w:start w:val="${number(level.startNumber ?? 0, 0, 1000000, true) + 1}"/><w:numFmt w:val="${format}"/>${level.isLegal ? "<w:isLgl/>" : ""}<w:lvlText w:val="${xml(text)}"/><w:lvlJc w:val="${["left", "left", "center", "right", "left"][number(level.bulletAlignment ?? 1, 0, 4, true)]}"/>${p ? `<w:pPr>${p}</w:pPr>` : ""}${t ? `<w:rPr>${t}</w:rPr>` : ""}</w:lvl>`;
    }).join("")}</w:abstractNum>`).join("");
    const instances = [...lists.values()].map(list => `<w:num w:numId="${list.id}"><w:abstractNumId w:val="${abstractLists.get(list.type).id}"/>${[...list.starts].map(([depth, start]) => `<w:lvlOverride w:ilvl="${depth}"><w:startOverride w:val="${start}"/></w:lvlOverride>`).join("")}</w:num>`).join("");
    file("word/numbering.xml", `${H}<w:numbering xmlns:w="${W}">${definitions}${instances}</w:numbering>`); parts.push(["numbering.xml", "numbering"]); relate(mainRels, "numbering", "numbering.xml");
  }
  const builtins = namedText.slice(2).map((style, index) => {
    const n = index + 2, name = n === 2 ? "Title" : n === 3 ? "Subtitle" : `heading ${n - 3}`;
    return `<w:style w:type="paragraph" w:styleId="NativeStyle${n}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${paragraphProperties({ ...namedSpacing[n], ...(n >= 4 ? { outlineLevel: n - 4 } : {}) })}</w:pPr><w:rPr>${textProperties(style)}</w:rPr></w:style>`;
  }).join("");
  file("word/styles.xml", `${H}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>${textProperties(doc.textStyle)}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>${paragraphProperties({ widowControl: 1, ...doc.defaultParagraphStyle })}</w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${builtins}</w:styles>`); parts.push(["styles.xml", "styles"]);
  const hyphenation = `${doc.autoHyphenation == null ? "" : `<w:autoHyphenation w:val="${bool(doc.autoHyphenation)}"/>`}${doc.consecutiveHyphenLimit == null ? "" : `<w:consecutiveHyphenLimit w:val="${number(doc.consecutiveHyphenLimit, 0, 1000, true)}"/>`}${doc.hyphenationZone == null ? "" : `<w:hyphenationZone w:val="${pxTwips(doc.hyphenationZone)}"/>`}${doc.doNotHyphenateCaps == null ? "" : `<w:doNotHyphenateCaps w:val="${bool(doc.doNotHyphenateCaps)}"/>`}`;
  file("word/settings.xml", `${H}<w:settings xmlns:w="${W}">${doc.defaultTabStop == null ? "" : `<w:defaultTabStop w:val="${Math.round(number(doc.defaultTabStop, 1, 3000) * 20)}"/>`}${hyphenation}${doc.evenAndOddHeaders != null && bool(doc.evenAndOddHeaders) ? "<w:evenAndOddHeaders/>" : ""}<w:updateFields w:val="true"/></w:settings>`); parts.push(["settings.xml", "settings"]);
  file("docProps/core.xml", `${H}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(content.title)}</dc:title><dc:creator>ModelShot</dc:creator></cp:coreProperties>`);
  file("word/_rels/document.xml.rels", relXml(mainRels)); file("_rels/.rels", relXml([{ id: "rId1", type: "officeDocument", target: "word/document.xml" }, { id: "rId2", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" }]));
  file("[Content_Types].xml", `${H}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>${parts.map(([name, type]) => `<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  const result = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } });
  if (result.length > maxBytes) fail("EXPORT_RESULT_TOO_LARGE"); return result;
}
