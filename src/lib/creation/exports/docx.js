import JSZip from "jszip";
import { textDocumentSchema, documentAssetIds } from "../contracts/document.js";
import { EXPORT_MAX_BYTES } from "../contracts/exports.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const fonts = { sans: ["Arial", "Microsoft YaHei"], serif: ["Georgia", "Noto Serif SC"], mono: ["Consolas", "Microsoft YaHei"] };
const twips = points => Math.round(points * 20);
const hex = color => color.slice(1).toUpperCase();
function xml(value) {
  const text = String(value);
  // Refuse unsupported source characters instead of silently changing a user's
  // text. Tabs/newlines are emitted as Word elements by runContent().
  if (!text.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(text)) throw new Error("EXPORT_DOCUMENT_TEXT_UNSUPPORTED");
  return text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
}
function relations(items) {
  return `${HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(({ id, type, target, external }) => `<Relationship Id="${id}" Type="${type}" Target="${xml(target)}"${external ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`;
}
function pageGeometry(page) {
  const size = page.size === "A4" ? [595.2756, 841.8898] : [612, 792]; // pt
  const [width, height] = page.orientation === "landscape" ? size.toReversed() : size;
  return { width, height, contentWidth: width - page.marginLeft - page.marginRight, contentHeight: height - page.marginTop - page.marginBottom };
}
function runContent(text) {
  xml(text);
  return text.split(/(\r\n|\r|\n|\t)/).map(part => part === "\t" ? "<w:tab/>" : /^(\r\n|\r|\n)$/.test(part) ? "<w:br/>" : part ? `<w:t xml:space="preserve">${xml(part)}</w:t>` : "").join("");
}
function markProperties(marks) {
  const onOff = Object.entries({ bold: "b", italic: "i", strike: "strike" }).filter(([key]) => marks[key] !== undefined)
    .map(([key, tag]) => `<w:${tag} w:val="${marks[key] ? 1 : 0}"/>`).join("");
  return `${onOff}${marks.underline !== undefined ? `<w:u w:val="${marks.underline ? "single" : "none"}"/>` : ""}${marks.color ? `<w:color w:val="${hex(marks.color)}"/>` : ""}${marks.highlight ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(marks.highlight)}"/>` : ""}`;
}
function styleXml(document) {
  const [latin, eastAsia] = fonts[document.theme.fontFamily], size = Math.round(document.theme.fontSize * 2);
  const properties = `<w:rFonts w:ascii="${latin}" w:hAnsi="${latin}" w:eastAsia="${eastAsia}" w:cs="${latin}"/><w:color w:val="${hex(document.theme.color)}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="${document.locale === "zh" ? "zh-CN" : "en-US"}" w:eastAsia="zh-CN"/>`;
  const headings = [2, 1.65, 1.4, 1.2, 1.1, 1].map((scale, index) => `<w:style w:type="paragraph" w:styleId="Heading${index + 1}"><w:name w:val="heading ${index + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:outlineLvl w:val="${index}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.round(size * scale)}"/><w:szCs w:val="${Math.round(size * scale)}"/></w:rPr></w:style>`).join("");
  return `${HEADER}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>${properties}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${headings}<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2563EB"/><w:u w:val="single"/></w:rPr></w:style></w:styles>`;
}
function numberingXml(lists) {
  const definitions = lists.map(({ id, block }) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="multilevel"/>${Array.from({ length: 6 }, (_, depth) => `<w:lvl w:ilvl="${depth}"><w:start w:val="${block.ordered ? block.start : 1}"/><w:numFmt w:val="${block.ordered ? "decimal" : "bullet"}"/><w:lvlText w:val="${block.ordered ? `%${depth + 1}.` : "•"}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="${720 * (depth + 1)}"/></w:tabs><w:ind w:left="${720 * (depth + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join("")}</w:abstractNum>`).join("");
  return `${HEADER}<w:numbering xmlns:w="${W}">${definitions}${lists.map(({ id }) => `<w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`).join("")}</w:numbering>`;
}

// Produces native WordprocessingML for our generated semantic document only.
// It is not a converter for arbitrary Univer snapshots or imported DOCX files.
export async function buildDocumentDocx(input, images = new Map(), { maxBytes = EXPORT_MAX_BYTES } = {}) {
  const parsed = textDocumentSchema.safeParse(input);
  if (!parsed.success) throw new Error("EXPORT_DOCUMENT_INVALID");
  const document = parsed.data;
  if (Buffer.byteLength(JSON.stringify(document)) > 2 * 1024 * 1024) throw new Error("EXPORT_INPUT_TOO_LARGE");
  const geometry = pageGeometry(document.page), zip = new JSZip();
  const file = (name, value) => zip.file(name, value, { date: new Date("1980-01-01T00:00:00Z") });
  const rels = [], links = new Map(), media = new Map(), lists = [];
  const relate = (type, target, external = false) => { const id = `rId${rels.length + 1}`; rels.push({ id, type: `${R}/${type}`, target, external }); return id; };
  relate("styles", "styles.xml"); relate("settings", "settings.xml");
  let mediaBytes = 0, drawingId = 0;
  for (const assetId of documentAssetIds(document)) {
    const image = images.get(assetId);
    if (!image || !Buffer.isBuffer(image.bytes) || !["png", "jpeg"].includes(image.format) || !Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0) throw new Error("EXPORT_IMAGE_UNSUPPORTED");
    mediaBytes += image.bytes.length;
    if (media.size >= 100 || mediaBytes > 100 * 1024 * 1024) throw new Error("EXPORT_ASSETS_TOO_LARGE");
    const name = `image${media.size + 1}.${image.format}`;
    file(`word/media/${name}`, image.bytes);
    media.set(assetId, { relId: relate("image", `media/${name}`) });
  }
  const runsXml = runs => runs.map(({ text, marks }) => {
    let linkId;
    if (marks.link) {
      if (!links.has(marks.link)) links.set(marks.link, relate("hyperlink", marks.link, true));
      linkId = links.get(marks.link);
    }
    const properties = `${linkId ? '<w:rStyle w:val="Hyperlink"/>' : ""}${markProperties(marks)}`;
    const run = `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}${runContent(text)}</w:r>`;
    return linkId ? `<w:hyperlink r:id="${linkId}" w:history="1">${run}</w:hyperlink>` : run;
  }).join("");
  const paragraph = (runs, properties = "") => `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}${runsXml(runs)}</w:p>`;
  function blockXml(block) {
    if (["paragraph", "heading"].includes(block.type)) {
      const { style } = block;
      return paragraph(block.runs, `${block.type === "heading" ? `<w:pStyle w:val="Heading${block.level}"/>` : ""}<w:spacing w:before="${twips(style.spaceBefore)}" w:after="${twips(style.spaceAfter)}" w:line="${Math.round(style.lineHeight * 240)}" w:lineRule="auto"/><w:jc w:val="${style.align === "justify" ? "both" : style.align}"/>`);
    }
    if (block.type === "pageBreak") return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    if (block.type === "list") {
      const id = lists.length + 1; lists.push({ id, block });
      return block.items.map(item => paragraph(item.runs, `<w:numPr><w:ilvl w:val="${item.depth}"/><w:numId w:val="${id}"/></w:numPr>`)).join("");
    }
    if (block.type === "table") {
      const width = twips(geometry.contentWidth), count = block.rows[0].cells.length;
      // Allocate the rounding remainder to the last column so the grid exactly
      // matches the declared width even for 3/7/etc. columns.
      const widths = Array.from({ length: count }, (_, index) => Math.floor(width * (index + 1) / count) - Math.floor(width * index / count));
      const borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map(side => `<w:${side} w:val="single" w:sz="4" w:color="D1D5DB"/>`).join("");
      const rows = block.rows.map((row, index) => `<w:tr>${index < block.headerRows ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${row.cells.map((cell, col) => `<w:tc><w:tcPr><w:tcW w:w="${widths[col]}" w:type="dxa"/></w:tcPr>${paragraph(cell.runs)}</w:tc>`).join("")}</w:tr>`).join("");
      // Word requires a terminating paragraph after a table, including inside
      // a document ending with a table. It carries no semantic user content.
      return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${widths.map(value => `<w:gridCol w:w="${value}"/>`).join("")}</w:tblGrid>${rows}</w:tbl><w:p/>`;
    }
    const id = ++drawingId, image = media.get(block.assetId);
    // Image dimensions in the semantic model use CSS pixels. Word page
    // dimensions/margins use points. Fit oversized frames without cropping.
    const scale = Math.min(1, geometry.contentWidth / (block.width * .75), geometry.contentHeight / (block.height * .75));
    const cx = Math.round(block.width * scale * 9525), cy = Math.round(block.height * scale * 9525);
    const drawing = `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Image ${id}" descr="${xml(block.alt)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Image ${id}" descr="${xml(block.alt)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${image.relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    return drawing + (block.caption ? paragraph([{ text: block.caption, marks: {} }], '<w:jc w:val="center"/>') : "");
  }
  const body = document.sections.map(section => section.blocks.map(blockXml).join("")).join("");
  const { page } = document;
  let sectionReferences = "";
  if (page.header) {
    const id = relate("header", "header1.xml"); sectionReferences += `<w:headerReference w:type="default" r:id="${id}"/>`;
    file("word/header1.xml", `${HEADER}<w:hdr xmlns:w="${W}">${paragraph([{ text: page.header, marks: {} }])}</w:hdr>`);
  }
  if (page.footer || page.pageNumbers) {
    const id = relate("footer", "footer1.xml"); sectionReferences += `<w:footerReference w:type="default" r:id="${id}"/>`;
    const content = runsXml([{ text: page.footer + (page.footer && page.pageNumbers ? "  " : ""), marks: {} }]);
    file("word/footer1.xml", `${HEADER}<w:ftr xmlns:w="${W}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${content}${page.pageNumbers ? '<w:fldSimple w:instr=" PAGE " w:dirty="true"><w:r><w:t>1</w:t></w:r></w:fldSimple>' : ""}</w:p></w:ftr>`);
  }
  const sectPr = `<w:sectPr>${sectionReferences}<w:pgSz w:w="${twips(geometry.width)}" w:h="${twips(geometry.height)}" w:orient="${page.orientation}"/><w:pgMar w:top="${twips(page.marginTop)}" w:right="${twips(page.marginRight)}" w:bottom="${twips(page.marginBottom)}" w:left="${twips(page.marginLeft)}" w:header="${twips(Math.min(18, page.marginTop / 2))}" w:footer="${twips(Math.min(18, page.marginBottom / 2))}" w:gutter="0"/></w:sectPr>`;
  file("word/document.xml", `${HEADER}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:a="${A}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}${sectPr}</w:body></w:document>`);
  file("word/styles.xml", styleXml(document));
  file("word/settings.xml", `${HEADER}<w:settings xmlns:w="${W}"><w:updateFields w:val="true"/></w:settings>`);
  if (lists.length) { relate("numbering", "numbering.xml"); file("word/numbering.xml", numberingXml(lists)); }
  file("word/_rels/document.xml.rels", relations(rels));
  file("docProps/core.xml", `${HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(document.title)}</dc:title><dc:creator>ModelShot</dc:creator><dc:language>${document.locale === "zh" ? "zh-CN" : "en-US"}</dc:language></cp:coreProperties>`);
  file("_rels/.rels", relations([{ id: "rId1", type: `${R}/officeDocument`, target: "word/document.xml" }, { id: "rId2", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" }]));
  const parts = [["document", "document.main"], ["styles", "styles"], ["settings", "settings"], ...(lists.length ? [["numbering", "numbering"]] : []), ...(page.header ? [["header1", "header"]] : []), ...(page.footer || page.pageNumbers ? [["footer1", "footer"]] : [])];
  file("[Content_Types].xml", `${HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>${parts.map(([name, type]) => `<Override PartName="/word/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } });
  if (output.length > maxBytes) throw new Error("EXPORT_RESULT_TOO_LARGE");
  return output;
}
