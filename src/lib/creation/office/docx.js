import { createHash } from "node:crypto";
import { officePackage, officeFail, patchXml, rewriteOfficePackage, xmlEscape } from "./package.js";
import { children, descendants, attribute, textContent, isTag } from "../references/office-xml.js";
import { nativeOfficeArtifactSchema, NATIVE_OFFICE_VERSION } from "../contracts/native-office.js";
import { nativeDocumentAssetSource, safeNativeOfficeLink } from "../native-office-media.js";
import { textProperties, paragraphProperties } from "../exports/native-docx-style.js";
import { officeEqual as same } from "./identity.js";

const child = (n, name) => children(n, "w", name)[0];
const attr = (n, name = "val") => n && attribute(n, name, "w");
const raw = (xml, n) => n ? xml.source.slice(n.start, n.end) : "";
const pre = n => n.qname.includes(":") ? n.qname.split(":")[0] + ":" : "";
const qualify = (value, p) => value.replace(/(<\/?|\s)w:/g, "$1" + p);
const blankBody = () => ({ dataStream: "", textRuns: [], paragraphs: [], sectionBreaks: [], tables: [], customBlocks: [], customRanges: [] });
function readTextStyle(rpr) {
  const style = {};
  if (!rpr) return style;
  const fonts = child(rpr, "rFonts"), size = Number(attr(child(rpr, "sz"))) / 2;
  if (attr(fonts, "ascii")) style.ff = attr(fonts, "ascii");
  if (attr(fonts, "eastAsia")) style.eastAsiaFontFamily = attr(fonts, "eastAsia");
  if (size > 0 && size <= 400) style.fs = size;
  for (const [key, tag] of [["bl", "b"], ["it", "i"]]) if (child(rpr, tag)) style[key] = ["0", "false", "off"].includes(attr(child(rpr, tag))) ? 0 : 1;
  if (child(rpr, "u")) style.ul = { s: attr(child(rpr, "u")) === "none" ? 0 : 1, t: attr(child(rpr, "u")) === "double" ? 10 : 12 };
  if (child(rpr, "strike")) style.st = { s: ["0", "false"].includes(attr(child(rpr, "strike"))) ? 0 : 1 };
  for (const [key, tag, name] of [["cl", "color", "val"], ["bg", "shd", "fill"]]) {
    const value = attr(child(rpr, tag), name); if (/^[0-9a-f]{6}$/i.test(value || "")) style[key] = { rgb: "#" + value };
  }
  return style;
}
function readParagraphStyle(ppr) {
  const style = {}, spacing = child(ppr, "spacing"), ind = child(ppr, "ind");
  const alignment = { left: 1, start: 1, center: 2, right: 3, end: 3, both: 4, distribute: 6 }[attr(child(ppr, "jc"))];
  if (alignment) style.horizontalAlign = alignment;
  for (const [key, name] of [["spaceAbove", "before"], ["spaceBelow", "after"]]) if (attr(spacing, name)) style[key] = { v: Number(attr(spacing, name)) / 20, u: 0 };
  if (attr(spacing, "line")) { style.spacingRule = { atLeast: 1, exact: 2 }[attr(spacing, "lineRule")] || 0; style.lineSpacing = Number(attr(spacing, "line")) / (style.spacingRule ? 20 : 240); }
  for (const [key, name] of [["indentStart", "left"], ["indentEnd", "right"], ["indentFirstLine", "firstLine"], ["hanging", "hanging"]]) if (attr(ind, name)) style[key] = { v: Number(attr(ind, name)) / 20, u: 0 };
  for (const key of ["keepNext", "keepLines", "pageBreakBefore", "widowControl"]) if (child(ppr, key)) style[key] = ["0", "false", "off"].includes(attr(child(ppr, key))) ? 0 : 1;
  return style;
}
function styleResolver(pkg, rels) {
  const path = [...rels.values()].find(r => !r.external && r.type.endsWith("/styles"))?.target;
  const root = path && pkg.xml(path).root, map = new Map(children(root, "w", "style").map(n => [attr(n, "styleId"), n])), cache = new Map();
  const resolve = (id, trail = []) => {
    if (!id || !map.has(id)) return { text: {}, paragraph: {} };
    if (cache.has(id)) return cache.get(id);
    if (trail.length > 32 || trail.includes(id)) officeFail("OFFICE_STYLE_CYCLE");
    const node = map.get(id), parent = resolve(attr(child(node, "basedOn")), [...trail, id]);
    const result = { text: { ...parent.text, ...readTextStyle(child(node, "rPr")) }, paragraph: { ...parent.paragraph, ...readParagraphStyle(child(node, "pPr")) } };
    cache.set(id, result); return result;
  };
  const defaults = child(root, "docDefaults");
  return { resolve, defaultText: readTextStyle(child(child(defaults, "rPrDefault"), "rPr")), defaultParagraph: readParagraphStyle(child(child(defaults, "pPrDefault"), "pPr")) };
}
function numbering(pkg, rels) {
  const path = [...rels.values()].find(r => !r.external && r.type.endsWith("/numbering"))?.target;
  const lists = {}, ids = new Map(); if (!path) return { lists, ids };
  const root = pkg.xml(path).root, abstracts = new Map(children(root, "w", "abstractNum").map(n => [attr(n, "abstractNumId"), n]));
  for (const num of children(root, "w", "num")) {
    const id = attr(num, "numId"), abstract = abstracts.get(attr(child(num, "abstractNumId")));
    if (!abstract) continue;
    const listType = "list" + id, levels = children(abstract, "w", "lvl").slice(0, 9);
    lists[listType] = { listType, nestingLevel: levels.map((lvl, index) => ({
      bulletAlignment: 1, glyphFormat: attr(child(lvl, "lvlText")) || "%" + (index + 1) + ".",
      glyphType: attr(child(lvl, "numFmt")) === "bullet" ? 0 : 2,
      ...(attr(child(lvl, "numFmt")) === "bullet" ? { glyphSymbol: attr(child(lvl, "lvlText")) || "•" } : {}),
      startNumber: Math.max(0, Number(attr(child(lvl, "start")) || 1) - 1),
      paragraphProperties: readParagraphStyle(child(lvl, "pPr")),
    })) };
    ids.set(id, listType);
  }
  return { lists, ids };
}

export function importDocument(bytes, { title = "导入文档", unitId = "imported-document", sourceId = "source" } = {}) {
  const pkg = officePackage(bytes), mainPath = "word/document.xml", main = pkg.xml(mainPath), rels = pkg.relationships(mainPath);
  const styles = styleResolver(pkg, rels), numbers = numbering(pkg, rels), warnings = new Set(), mappings = [], media = new Map(), stories = new Map(), drawings = {}, drawingsOrder = [], tableSource = {};
  let sequence = 0; const id = p => p + sequence++;
  const documentStyle = { documentFlavor: 1, pageSize: { width: 794, height: 1123 }, pageOrient: 0, marginTop: 72, marginBottom: 72, marginLeft: 72, marginRight: 72, marginHeader: 24, marginFooter: 24,
    textStyle: { ff: "Arial", fs: 12, ...styles.defaultText }, defaultParagraphStyle: styles.defaultParagraph, pageNumberStart: 1,
    autoHyphenation: 1, consecutiveHyphenLimit: 2, doNotHyphenateCaps: 0, evenAndOddHeaders: 0,
    evenPageFooterId: "", evenPageHeaderId: "", firstPageFooterId: "", firstPageHeaderId: "", useFirstPageHeaderFooter: 0 };
  const bodyNode = child(main.root, "body"); if (!bodyNode) officeFail("OFFICE_DOCUMENT_INVALID");
  const sect = child(bodyNode, "sectPr"), page = child(sect, "pgSz"), margins = child(sect, "pgMar");
  if (page) {
    const width = Number(attr(page, "w")) / 15, height = Number(attr(page, "h")) / 15;
    if (!(width >= 96 && height >= 96 && width <= 2112 && height <= 2112)) officeFail("OFFICE_DOCUMENT_SIZE_UNSUPPORTED");
    documentStyle.pageSize = { width, height }; documentStyle.pageOrient = attr(page, "orient") === "landscape" ? 1 : 0;
  }
  for (const [key, name] of [["marginTop", "top"], ["marginBottom", "bottom"], ["marginLeft", "left"], ["marginRight", "right"], ["marginHeader", "header"], ["marginFooter", "footer"]]) if (attr(margins, name)) documentStyle[key] = Math.max(0, Number(attr(margins, name)) / 15);

  function story(path, segmentId, root) {
    const xml = pkg.xml(path), relationships = pkg.relationships(path), body = blankBody();
    const append = text => { const at = body.dataStream.length; body.dataStream += text; if (body.dataStream.length > 300000) officeFail("OFFICE_DOCUMENT_LIMIT"); return at; };
    const section = () => body.sectionBreaks.push({ sectionId: id("sec"), startIndex: append("\n"), sectionType: 1 });
    function paragraph(node, protectedAncestor = false) {
      const paragraphId = id("p"), start = body.dataStream.length, ppr = child(node, "pPr");
      const inherited = styles.resolve(attr(child(ppr, "pStyle"))), paragraphStyle = { ...inherited.paragraph, ...readParagraphStyle(ppr) };
      let protectedContent = protectedAncestor, reason = protectedAncestor ? "CONTENT_CONTROL_OR_REVISION_PRESERVED" : null;
      const runs = [], protect = code => { protectedContent = true; reason ||= code; warnings.add(code); };
      if (child(ppr, "sectPr")) protect("SECTION_LAYOUT_PRESERVED");
      function inline(container, link = null) {
        for (const n of container.children) {
          if (isTag(n, "w", "pPr") || isTag(n, "w", "rPr")) continue;
          if (isTag(n, "w", "r")) {
            const rpr = child(n, "rPr"), ts = { ...inherited.text, ...styles.resolve(attr(child(rpr, "rStyle"))).text, ...readTextStyle(rpr) };
            const runStart = body.dataStream.length;
            for (const item of n.children) {
              if (isTag(item, "w", "rPr")) continue;
              if (isTag(item, "w", "t")) append(textContent(item));
              else if (isTag(item, "w", "tab")) append("\t");
              else if (isTag(item, "w", "br")) { append(attr(item, "type") === "page" ? "\f" : "\v"); protect("BREAK_PRESERVED"); }
              else if (isTag(item, "w", "drawing")) {
                const blip = descendants(item, "a", "blip")[0], relation = blip && relationships.get(attribute(blip, "embed", "r"));
                if (relation && !relation.external && /\.(png|jpe?g|webp)$/i.test(relation.target)) {
                  const data = pkg.read(relation.target), assetId = "office_" + createHash("sha256").update(sourceId).update(data).digest("hex").slice(0, 40);
                  const imageFormat = /\.png$/i.test(relation.target) ? "png" : /\.webp$/i.test(relation.target) ? "webp" : "jpeg";
                  if (!media.has(assetId)) media.set(assetId, { id: assetId, bytes: data, format: imageFormat });
                  if (media.size > 16 || drawingsOrder.length >= 100) officeFail("OFFICE_DOCUMENT_MEDIA_LIMIT");
                  const search = [item]; let extent;
                  while (search.length) { const el = search.pop(); if (el.local === "extent") { extent = el; break; } search.push(...el.children); }
                  const size = { width: Math.min(1600, Math.max(1, Number(extent && attribute(extent, "cx") || 1905000) / 9525)), height: Math.min(1600, Math.max(1, Number(extent && attribute(extent, "cy") || 1905000) / 9525)) };
                  const drawingId = id("image");
                  drawings[drawingId] = { drawingId, unitId, subUnitId: unitId, drawingType: 0, imageSourceType: "URL", source: nativeDocumentAssetSource(assetId),
                    layoutType: 0, transform: { ...size, angle: 0 }, docTransform: { size, angle: 0, positionH: { relativeFrom: 2, posOffset: 0 }, positionV: { relativeFrom: 2, posOffset: 0 } } };
                  drawingsOrder.push(drawingId); body.customBlocks.push({ startIndex: append("\b"), blockId: drawingId });
                } else { append("[原件中的绘图]"); warnings.add("UNSUPPORTED_DRAWING_PRESERVED"); }
                protect("DRAWING_PARAGRAPH_PRESERVED");
              } else { protect("FIELD_OR_UNKNOWN_INLINE_PRESERVED"); if (isTag(item, "w", "delText")) append(textContent(item)); }
            }
            const end = body.dataStream.length;
            if (end > runStart) { body.textRuns.push({ st: runStart, ed: end, ts }); runs.push({ start: runStart - start, end: end - start, ts, node: n, rpr, link }); }
          } else if (isTag(n, "w", "hyperlink")) {
            const relation = relationships.get(attribute(n, "id", "r")), url = relation?.external && safeNativeOfficeLink(relation.target) ? relation.target : null;
            if (url) {
              const at = append("\x1f"); inline(n, n);
              body.customRanges.push({ startIndex: at, endIndex: append("\x1e"), rangeId: id("link"), rangeType: 0, wholeEntity: false, properties: { url } });
            } else { inline(n, n); protect("INTERNAL_LINK_PRESERVED"); }
          } else if (["bookmarkStart", "bookmarkEnd", "proofErr"].includes(n.local)) { protect("ANNOTATION_ANCHOR_PRESERVED"); }
          else { protect("CONTENT_CONTROL_OR_REVISION_PRESERVED"); inline(n); }
        }
      }
      inline(node);
      const num = child(ppr, "numPr"), numId = attr(child(num, "numId")), listType = numbers.ids.get(numId), level = Number(attr(child(num, "ilvl")) || 0);
      const bullet = listType && level < numbers.lists[listType].nestingLevel.length ? { listType, listId: "num" + numId, nestingLevel: level } : null;
      if (num && !bullet) protect("NUMBERING_PRESERVED");
      body.paragraphs.push({ paragraphId, startIndex: append("\r"), paragraphStyle, ...(bullet ? { bullet } : {}) });
      mappings.push({ paragraphId, segmentId, path, node, ppr, start, runs, protectedContent, reason });
    }
    function blocks(container, depth = 0, protectedAncestor = false) {
      if (depth > 8) officeFail("OFFICE_TABLE_DEPTH_LIMIT");
      for (const n of container.children) {
        if (isTag(n, "w", "sectPr")) continue;
        if (isTag(n, "w", "p")) paragraph(n, protectedAncestor);
        else if (isTag(n, "w", "tbl")) {
          const rows = children(n, "w", "tr"), tableId = id("table"), startIndex = append("\x1a");
          const columns = children(child(n, "tblGrid"), "w", "gridCol");
          const totalWidth = documentStyle.pageSize.width - documentStyle.marginLeft - documentStyle.marginRight;
          const size = { type: 1, width: { v: totalWidth, u: 3 } };
          tableSource[tableId] = { tableId, align: 0, indent: { v: 0, u: 0 }, textWrap: 0, layout: 1,
            position: { positionH: { relativeFrom: 0, posOffset: 0 }, positionV: { relativeFrom: 0, posOffset: 0 } },
            dist: { distT: 0, distR: 0, distB: 0, distL: 0 }, size,
            tableColumns: (columns.length ? columns : children(rows[0], "w", "tc")).map(col => ({ size: { type: 1, width: { v: Number(attr(col, "w") || totalWidth * 15 / Math.max(1, columns.length)) / 15, u: 3 } } })), tableRows: [] };
          for (const row of rows) {
            append("\x1b"); const cells = children(row, "w", "tc"), tableCells = [];
            for (const cell of cells) {
              const tcpr = child(cell, "tcPr"), merged = Boolean(child(tcpr, "gridSpan") || child(tcpr, "vMerge"));
              if (merged) warnings.add("MERGED_TABLE_LAYOUT_PRESERVED");
              append("\x1c"); blocks(cell, depth + 1, protectedAncestor || merged);
              if (!body.dataStream.endsWith("\r")) paragraph({ children: [] }, true);
              section(); append("\x1d");
              tableCells.push({ size: { type: 1, width: { v: totalWidth / Math.max(1, cells.length), u: 3 } }, margin: { start: { v: 4, u: 0 }, end: { v: 4, u: 0 }, top: { v: 3, u: 0 }, bottom: { v: 3, u: 0 } } });
            }
            append("\x0e"); tableSource[tableId].tableRows.push({ trHeight: { val: { v: 0, u: 3 }, hRule: 0 }, repeatHeaderRow: child(child(row, "trPr"), "tblHeader") ? 1 : 0, tableCells });
          }
          append("\x0f"); body.tables.push({ tableId, startIndex, endIndex: body.dataStream.length });
        } else { warnings.add("CONTENT_CONTROL_OR_REVISION_PRESERVED"); blocks(n, depth + 1, true); }
      }
    }
    blocks(root);
    if (!body.dataStream.endsWith("\r")) paragraph({ children: [] }, true);
    section(); stories.set(segmentId, { path, xml, body });
    return body;
  }
  const body = story(mainPath, "", bodyNode), headers = {}, footers = {};
  for (const [type, target, keys] of [["header", headers, { default: "defaultHeaderId", first: "firstPageHeaderId", even: "evenPageHeaderId" }], ["footer", footers, { default: "defaultFooterId", first: "firstPageFooterId", even: "evenPageFooterId" }]]) {
    for (const ref of children(sect, "w", type + "Reference")) {
      const relation = rels.get(attribute(ref, "id", "r")), key = keys[attr(ref, "type") || "default"];
      if (!relation || relation.external || !key) continue;
      const segmentId = id(type), content = story(relation.target, segmentId, pkg.xml(relation.target).root);
      target[segmentId] = { [type + "Id"]: segmentId, body: content }; documentStyle[key] = segmentId;
    }
  }
  if (child(sect, "titlePg")) documentStyle.useFirstPageHeaderFooter = 1;
  const protection = mappings.filter(m => m.protectedContent).map(m => ({ segmentId: m.segmentId, paragraphId: m.paragraphId, reason: m.reason }));
  const content = nativeOfficeArtifactSchema.parse({ schemaVersion: 2, kind: "document", title, engine: "univer", engineVersion: NATIVE_OFFICE_VERSION, assetIds: [...media.keys()],
    snapshot: { id: unitId, title, locale: "zhCN", body, documentStyle, lists: numbers.lists, tableSource, drawings, drawingsOrder, headers, footers, resources: [],
      custom: { modelshot: { adapterVersion: "ooxml-document-1", officeImport: { sourceId, format: "docx", warnings: [...warnings], protection } } } } });
  return { content, pkg, mappings, stories, media: [...media.values()] };
}

export function officeDocumentParagraphs(snapshot, segmentId = "") {
  const body = segmentId ? snapshot.headers?.[segmentId]?.body || snapshot.footers?.[segmentId]?.body : snapshot.body;
  if (!body) officeFail("OFFICE_IMPORT_STRUCTURE_PROTECTED");
  const map = new Map(); let previous = 0;
  for (const p of body.paragraphs || []) {
    if (!p.paragraphId || map.has(p.paragraphId) || p.startIndex < previous || body.dataStream[p.startIndex] !== "\r") officeFail("OFFICE_IMPORT_STRUCTURE_PROTECTED");
    // Table/section sentinels precede a paragraph but do not belong to its text.
    while (previous < p.startIndex && /[\n\x1a\x1b\x1c\x1d\x0e\x0f]/.test(body.dataStream[previous])) previous++;
    const start = previous, end = p.startIndex;
    const runs = (body.textRuns || []).filter(r => r.st < end && r.ed > start).map(r => ({ st: Math.max(r.st, start) - start, ed: Math.min(r.ed, end) - start, ts: r.ts || {} }));
    const ranges = (body.customRanges || []).filter(r => r.startIndex >= start && r.endIndex < end).map(r => ({ ...r, startIndex: r.startIndex - start, endIndex: r.endIndex - start }));
    map.set(p.paragraphId, { text: body.dataStream.slice(start, end), runs, ranges, style: p.paragraphStyle || {}, bullet: p.bullet || null });
    previous = end + 1;
  }
  return map;
}
function paragraphXml(value, mapping, xml) {
  if (mapping.protectedContent || !mapping.node.qname) officeFail("OFFICE_DOCUMENT_RANGE_PROTECTED");
  const p = pre(mapping.node), text = value.text, boundaries = new Set([0, text.length]);
  for (const r of value.runs) { boundaries.add(r.st); boundaries.add(r.ed); }
  for (const r of value.ranges) { boundaries.add(r.startIndex); boundaries.add(r.startIndex + 1); boundaries.add(r.endIndex); boundaries.add(r.endIndex + 1); }
  const indices = [...boundaries].sort((a, b) => a - b), chunks = [];
  let activeLink = null;
  for (let i = 1; i < indices.length; i++) {
    const start = indices[i - 1], end = indices[i], part = text.slice(start, end);
    if (/^[\x1f\x1e]+$/.test(part)) continue;
    if (/[\u0000-\u0008\u000b-\u001f]/.test(part)) officeFail("OFFICE_DOCUMENT_STRUCTURE_PROTECTED");
    const style = value.runs.find(r => r.st <= start && r.ed >= end)?.ts || {};
    // Position matters: equal visible styles may have different extensions.
    const priorRun = mapping.runs.find(r => r.start <= start && r.end > start) || mapping.runs.find(r => same(r.ts, style));
    const managed = new Set(["rFonts", "sz", "szCs", "b", "bCs", "i", "iCs", "u", "strike", "color", "shd", "vertAlign", "highlight", "spacing"]);
    const keep = (priorRun?.rpr?.children || []).filter(n => !managed.has(n.local)).map(n => raw(xml, n)).join("");
    const props = priorRun && same(priorRun.ts, style) ? raw(xml, priorRun.rpr) : "<" + p + "rPr>" + keep + qualify(textProperties(style), p) + "</" + p + "rPr>";
    const range = value.ranges.find(r => start > r.startIndex && end <= r.endIndex);
    let linkNode = null;
    if (range) {
      if (range.rangeType !== 0) officeFail("OFFICE_DOCUMENT_RANGE_PROTECTED");
      const prior = mapping.runs.find(r => r.link && mapping.rangeUrls?.get(r.link) === range.properties?.url);
      linkNode = prior?.link; if (!linkNode) officeFail("OFFICE_DOCUMENT_LINK_PROTECTED");
    }
    if (activeLink !== linkNode) {
      if (activeLink) chunks.push("</" + activeLink.qname + ">");
      if (linkNode) chunks.push(xml.source.slice(linkNode.start, linkNode.openEnd));
      activeLink = linkNode;
    }
    chunks.push("<" + p + "r>" + props + part.split("\t").map(t => "<" + p + 't xml:space="preserve">' + xmlEscape(t) + "</" + p + "t>").join("<" + p + "tab/>") + "</" + p + "r>");
  }
  if (activeLink) chunks.push("</" + activeLink.qname + ">");
  return chunks.join("");
}

export async function patchDocument(bytes, input) {
  const next = nativeOfficeArtifactSchema.parse(input), meta = next.snapshot.custom?.modelshot?.officeImport;
  if (next.kind !== "document" || meta?.format !== "docx") officeFail("OFFICE_IMPORT_IDENTITY_CHANGED");
  const original = importDocument(bytes, { title: next.title, unitId: next.snapshot.id, sourceId: meta.sourceId }), base = original.content.snapshot, snapshot = next.snapshot;
  if (!same(meta, base.custom.modelshot.officeImport) || !same(next.assetIds, original.content.assetIds)) officeFail("OFFICE_IMPORT_IDENTITY_CHANGED");
  for (const key of ["documentStyle", "lists", "tableSource", "drawings", "drawingsOrder"]) if (!same(snapshot[key], base[key])) officeFail("OFFICE_IMPORT_STRUCTURE_PROTECTED");
  if (!same(Object.keys(snapshot.headers || {}), Object.keys(base.headers)) || !same(Object.keys(snapshot.footers || {}), Object.keys(base.footers))) officeFail("OFFICE_IMPORT_STRUCTURE_PROTECTED");
  const replacements = new Map();
  for (const [segmentId, story] of original.stories) {
    const before = officeDocumentParagraphs(base, segmentId), after = officeDocumentParagraphs(snapshot, segmentId);
    if (!same([...before.keys()], [...after.keys()])) officeFail("OFFICE_DOCUMENT_STRUCTURE_PROTECTED");
    const patches = [];
    for (const m of original.mappings.filter(m => m.segmentId === segmentId)) {
      const a = before.get(m.paragraphId), b = after.get(m.paragraphId);
      if (same(a, b)) continue;
      if (!same(a.bullet, b.bullet) || !same(a.ranges.map(r => r.properties), b.ranges.map(r => r.properties))) officeFail("OFFICE_DOCUMENT_STRUCTURE_PROTECTED");
      const rels = original.pkg.relationships(m.path);
      m.rangeUrls = new Map(m.runs.filter(r => r.link).map(r => [r.link, rels.get(attribute(r.link, "id", "r"))?.target]));
      const inner = paragraphXml(b, m, story.xml), p = pre(m.node);
      let props = raw(story.xml, m.ppr);
      if (!same(a.style, b.style)) {
        // Retain numbering, named style, section properties and unknown pPr
        // children; replace only the paragraph properties exposed to the editor.
        const names = new Set(["jc", "spacing", "ind", "keepNext", "keepLines", "pageBreakBefore", "widowControl", "shd", "tabs", "bidi", "outlineLvl"]);
        const keep = (m.ppr?.children || []).filter(n => !names.has(n.local)).map(n => raw(story.xml, n)).join("");
        props = "<" + p + "pPr>" + keep + qualify(paragraphProperties(b.style), p) + "</" + p + "pPr>";
      }
      patches.push({ start: m.node.start, end: m.node.end, text: story.xml.source.slice(m.node.start, m.node.openEnd).replace(/\/>$/, ">") + props + inner + "</" + m.node.qname + ">" });
    }
    if (patches.length) replacements.set(story.path, patchXml(story.xml.source, patches));
  }
  return rewriteOfficePackage(original.pkg, replacements);
}
