import { textDocumentSchema, documentAssetIds } from "./contracts/document.js";
import { nativeOfficeArtifactSchema, NATIVE_OFFICE_VERSION } from "./contracts/native-office.js";
import { nativeDocumentAssetSource } from "./native-office-media.js";

const px = points => points * 4 / 3;
const alignments = { left: 1, center: 2, right: 3, justify: 4 };
const fonts = { sans: "Arial", serif: "Georgia", mono: "Consolas" };
const headingScale = [2, 1.65, 1.4, 1.2, 1.1, 1];
function plain(value) {
  if (!value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(value)) throw new Error("NATIVE_DOCUMENT_TEXT_UNSUPPORTED");
  return value;
}
function marksStyle(marks) {
  const style = {};
  if (marks.bold !== undefined) style.bl = Number(marks.bold);
  if (marks.italic !== undefined) style.it = Number(marks.italic);
  if (marks.underline !== undefined) style.ul = { s: Number(marks.underline) };
  if (marks.strike !== undefined) style.st = { s: Number(marks.strike) };
  if (marks.color) style.cl = { rgb: marks.color };
  if (marks.highlight) style.bg = { rgb: marks.highlight };
  return style;
}
const paragraphStyle = style => ({ horizontalAlign: alignments[style.align], lineSpacing: style.lineHeight, spacingRule: 0,
  spaceAbove: { v: style.spaceBefore, u: 0 }, spaceBelow: { v: style.spaceAfter, u: 0 } });

// One-way, versioned adaptation of our complete authored block vocabulary.
// No engine/UI import and no reverse projection of rich snapshots into schema 1.
export function toNativeDocumentArtifact(input, unitId) {
  const source = textDocumentSchema.parse(input);
  if (source.sections.some(section => section.blocks.some(block => block.locked))) throw new Error("NATIVE_DOCUMENT_LOCKED_CONTENT");
  let counter = 0;
  const id = prefix => `${prefix}${counter++}`;
  const mappings = [], lists = {}, tableSource = {}, drawings = {}, drawingsOrder = [];
  const points = source.page.size === "Letter" ? [612, 792] : [595.2755905511812, 841.8897637795277];
  if (source.page.orientation === "landscape") points.reverse();
  const width = px(points[0]), height = px(points[1]);
  const contentWidth = width - px(source.page.marginLeft + source.page.marginRight), contentHeight = height - px(source.page.marginTop + source.page.marginBottom);
  function writer() {
    const body = { dataStream: "", textRuns: [], paragraphs: [], sectionBreaks: [], tables: [], customBlocks: [], customRanges: [] };
    const append = text => { const start = body.dataStream.length; body.dataStream += text; return start; };
    const section = () => { const sectionId = id("sec"); body.sectionBreaks.push({ sectionId, startIndex: append("\n"), sectionType: 1 }); return sectionId; };
    function paragraph(runs, style, { bullet, mapping, prefix = "", suffix = "", field = false } = {}) {
      const paragraphIds = [], base = style || { lineSpacing: 1.5, spaceAbove: { v: 0, u: 0 }, spaceBelow: { v: 8, u: 0 } };
      let first = true;
      append(prefix);
      const end = final => {
        const paragraphId = id("p"); paragraphIds.push(paragraphId);
        body.paragraphs.push({ paragraphId, startIndex: append("\r"), paragraphStyle: { ...base,
          ...(!first ? { spaceAbove: { v: 0, u: 0 } } : {}), ...(!final ? { spaceBelow: { v: 0, u: 0 } } : {}) },
          ...(first && bullet ? { bullet } : {}),
        });
        first = false;
      };
      for (const run of runs) {
        const pieces = plain(run.text).split(/(\r\n|\r|\n)/);
        for (const piece of pieces) {
          if (/^(\r\n|\r|\n)$/.test(piece)) { end(false); continue; }
          if (!piece) continue;
          const rangeStart = run.marks.link || field ? append("\x1f") : null;
          const st = append(piece), ed = body.dataStream.length, ts = marksStyle(run.marks);
          if (Object.keys(ts).length) body.textRuns.push({ st, ed, ts });
          if (rangeStart !== null) body.customRanges.push({ startIndex: rangeStart, endIndex: append("\x1e"), rangeId: id("range"),
            rangeType: field ? 1 : 0, wholeEntity: false,
            properties: field ? { instruction: "PAGE", fieldType: "PAGE", cachedResult: "1" } : { url: run.marks.link },
          });
        }
      }
      append(suffix); end(true);
      if (mapping) mappings.push({ ...mapping, paragraphIds });
      return paragraphIds;
    }
    return { body, append, paragraph, section };
  }
  const main = writer(), sections = [];
  for (const section of source.sections) {
    const sectionMapping = { sourceId: section.id, title: section.title, sectionId: null };
    for (const block of section.blocks) {
      const mapping = { sectionId: section.id, blockId: block.id, type: block.type };
      if (["paragraph", "heading"].includes(block.type)) {
        const style = paragraphStyle(block.style);
        if (block.type === "heading") Object.assign(style, { namedStyleType: block.level < 6 ? block.level + 3 : 1,
          outlineLevel: block.level - 1, keepNext: 1, keepLines: 1, textStyle: { bl: 1, fs: source.theme.fontSize * headingScale[block.level - 1] } });
        main.paragraph(block.runs, style, { mapping: { ...mapping, leafId: block.id } });
      } else if (block.type === "list") {
        const listType = id("listType"), listId = id("list");
        lists[listType] = { listType, nestingLevel: Array.from({ length: 6 }, (_, depth) => ({
          bulletAlignment: 1, glyphFormat: `%${depth + 1}${block.ordered ? "." : ""}`, glyphType: block.ordered ? 2 : 0,
          ...(block.ordered ? {} : { glyphSymbol: "•" }), startNumber: block.start - 1,
          paragraphProperties: { hanging: { v: 18, u: 0 }, indentStart: { v: 18 * (depth + 1), u: 0 } },
        })) };
        const started = new Set();
        for (const item of block.items) {
          const startNumber = started.has(item.depth) ? {} : { startNumber: block.start - 1 }; started.add(item.depth);
          main.paragraph(item.runs, undefined, { mapping: { ...mapping, leafId: item.id }, bullet: { listType, listId, nestingLevel: item.depth, ...startNumber } });
        }
      } else if (block.type === "table") {
        const tableId = id("table"), startIndex = main.append("\x1a"), columns = block.rows[0].cells.length;
        const size = { type: 1, width: { v: contentWidth / columns, u: 3 } };
        const border = { color: { rgb: "#D1D5DB" }, width: { v: .5, u: 0 }, dashStyle: 1 };
        tableSource[tableId] = { tableId, align: 0, indent: { v: 0, u: 0 }, textWrap: 0, layout: 1,
          position: { positionH: { relativeFrom: 0, posOffset: 0 }, positionV: { relativeFrom: 0, posOffset: 0 } },
          dist: { distT: 0, distR: 0, distB: 0, distL: 0 }, size: { type: 1, width: { v: contentWidth, u: 3 } },
          tableColumns: Array.from({ length: columns }, () => ({ size: structuredClone(size) })), tableRows: [],
        };
        for (const [index, row] of block.rows.entries()) {
          main.append("\x1b");
          const header = index < block.headerRows;
          tableSource[tableId].tableRows.push({ trHeight: { val: { v: 0, u: 3 }, hRule: 0 }, repeatHeaderRow: Number(header),
            tableCells: row.cells.map(() => ({ size: structuredClone(size),
              margin: { start: { v: 5, u: 0 }, end: { v: 5, u: 0 }, top: { v: 4, u: 0 }, bottom: { v: 4, u: 0 } },
              borderTop: structuredClone(border), borderRight: structuredClone(border), borderBottom: structuredClone(border), borderLeft: structuredClone(border),
              ...(header ? { backgroundColor: { rgb: "#F3F4F6" } } : {}),
            })),
          });
          for (const cell of row.cells) {
            main.append("\x1c");
            main.paragraph(cell.runs, { lineSpacing: 1.5, spaceAbove: { v: 0, u: 0 }, spaceBelow: { v: 0, u: 0 }, ...(header ? { textStyle: { bl: 1 } } : {}) },
              { mapping: { ...mapping, leafId: cell.id, rowId: row.id, tableId } });
            main.section(); main.append("\x1d");
          }
          // 1.2.0's executable enum uses 0E/0F for table ends. The prose
          // IDocumentBody comment still lists the old, hyperlink-colliding bytes.
          main.append("\x0e");
        }
        main.append("\x0f"); main.body.tables.push({ tableId, startIndex, endIndex: main.body.dataStream.length });
        // A root paragraph after a table is required for subsequent block editing.
        main.paragraph([], { spaceAbove: { v: 0, u: 0 }, spaceBelow: { v: 0, u: 0 } });
      } else if (block.type === "image") {
        const drawingId = id("image"), scale = Math.min(1, contentWidth / block.width, contentHeight / block.height);
        const size = { width: block.width * scale, height: block.height * scale };
        drawings[drawingId] = { drawingId, unitId, subUnitId: unitId, drawingType: 0, imageSourceType: "URL", source: nativeDocumentAssetSource(block.assetId),
          title: block.alt, description: block.alt, layoutType: 0, transform: { ...size, angle: 0 },
          docTransform: { size, angle: 0, positionH: { relativeFrom: 2, posOffset: 0 }, positionV: { relativeFrom: 2, posOffset: 0 } },
        };
        drawingsOrder.push(drawingId);
        const startIndex = main.body.dataStream.length;
        main.paragraph([], { horizontalAlign: 2 }, { prefix: "\b", mapping: { ...mapping, drawingId, assetId: block.assetId } });
        main.body.customBlocks.push({ startIndex, blockId: drawingId });
        if (block.caption) main.paragraph([{ text: block.caption, marks: {} }], { horizontalAlign: 2, textStyle: { fs: Math.max(8, source.theme.fontSize - 2) } });
      } else if (block.type === "pageBreak") main.paragraph([], undefined, { prefix: "\f", mapping });
    }
    sectionMapping.sectionId = main.section(); sections.push(sectionMapping);
  }
  const documentStyle = { documentFlavor: 1, pageSize: { width, height }, pageOrient: source.page.orientation === "landscape" ? 1 : 0,
    marginTop: px(source.page.marginTop), marginBottom: px(source.page.marginBottom), marginLeft: px(source.page.marginLeft), marginRight: px(source.page.marginRight),
    marginHeader: px(Math.min(18, source.page.marginTop / 2)), marginFooter: px(Math.min(18, source.page.marginBottom / 2)),
    textStyle: { ff: fonts[source.theme.fontFamily], fs: source.theme.fontSize, cl: { rgb: source.theme.color } }, pageNumberStart: 1,
  };
  const headers = {}, footers = {};
  if (source.page.header) {
    const headerId = id("header"), header = writer(); header.paragraph([{ text: source.page.header, marks: {} }]); header.section();
    headers[headerId] = { headerId, body: header.body }; documentStyle.defaultHeaderId = headerId;
  }
  if (source.page.footer || source.page.pageNumbers) {
    const footerId = id("footer"), footer = writer();
    if (source.page.footer) footer.paragraph([{ text: source.page.footer, marks: {} }]);
    if (source.page.pageNumbers) footer.paragraph([{ text: "1", marks: {} }], { horizontalAlign: 2 }, { field: true });
    footer.section(); footers[footerId] = { footerId, body: footer.body }; documentStyle.defaultFooterId = footerId;
  }
  return nativeOfficeArtifactSchema.parse({ schemaVersion: 2, kind: "document", title: source.title, engine: "univer", engineVersion: NATIVE_OFFICE_VERSION,
    assetIds: documentAssetIds(source), snapshot: { id: unitId, title: source.title, locale: source.locale === "zh" ? "zhCN" : "enUS",
      body: main.body, documentStyle, lists, tableSource, drawings, drawingsOrder, headers, footers, resources: [],
      custom: { modelshot: { adapterVersion: "semantic-document-1", sections, mappings } },
    },
  });
}
