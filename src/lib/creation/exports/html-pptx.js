import JSZip from "jszip";
import { buildLayoutPptx } from "./pptx.js";
import { buildWorkbookXlsx } from "./xlsx.js";
import { htmlChartSchema } from "../html/chart.js";
import { columnName } from "../sheet-formula.js";
const xml = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const emu = n => Math.round(n * 9525), R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const text = (value, style = {}) => `<a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${{ center: "ctr", right: "r" }[style.align] || "l"}"/><a:r><a:rPr lang="zh-CN" sz="${Math.round((style.fontSize || 18) * 75)}" b="${style.fontWeight === "bold" ? 1 : 0}"><a:solidFill><a:srgbClr val="${(style.fill || "#222222").slice(1, 7)}"/></a:solidFill></a:rPr><a:t xml:space="preserve">${xml(value)}</a:t></a:r></a:p></a:txBody>`;
const frame = (node, id, data) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${xml(node.name)}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(node.x)}" y="${emu(node.y)}"/><a:ext cx="${emu(node.width)}" cy="${emu(node.height)}"/></p:xfrm><a:graphic>${data}</a:graphic></p:graphicFrame>`;
function tableXml(table, id) {
  const xs = [...new Set(table.rows.flatMap(row => row.cells.flatMap(cell => [Math.round(cell.x), Math.round(cell.x + cell.width)])))].sort((a, b) => a - b);
  if (xs.length < 2 || xs.length > 65 || table.rows.length > 200) throw new Error("EXPORT_TABLE_LIMIT");
  const grid = Array.from({ length: table.rows.length }, () => Array(xs.length - 1).fill(null));
  table.rows.forEach((row, r) => row.cells.forEach(cell => {
    const c = xs.indexOf(Math.round(cell.x)), end = xs.indexOf(Math.round(cell.x + cell.width)), span = end - c;
    if (c < 0 || span < 1 || r + cell.rowSpan > grid.length) throw new Error("EXPORT_TABLE_MERGE_UNSUPPORTED");
    for (let y = r; y < r + cell.rowSpan; y++) for (let x = c; x < end; x++) {
      if (grid[y][x]) throw new Error("EXPORT_TABLE_MERGE_UNSUPPORTED");
      grid[y][x] = { cell, origin: x === c && y === r, h: x !== c, v: y !== r, span };
    }
  }));
  const rows = table.rows.map((row, r) => `<a:tr h="${emu(Math.max(1, row.height))}">${grid[r].map(item => {
    const { cell, origin, h, v, span } = item || { cell: { text: "", style: {} }, origin: true, span: 1 };
    const attrs = `${origin && span > 1 ? ` gridSpan="${span}"` : ""}${origin && cell.rowSpan > 1 ? ` rowSpan="${cell.rowSpan}"` : ""}${h ? ' hMerge="1"' : ""}${v ? ' vMerge="1"' : ""}`;
    return `<a:tc${attrs}>${text(origin ? cell.text : "", cell.style)}<a:tcPr marL="38100" marR="38100" marT="19050" marB="19050">${cell.background?.length === 7 ? `<a:solidFill><a:srgbClr val="${cell.background.slice(1)}"/></a:solidFill>` : "<a:noFill/>"}</a:tcPr></a:tc>`;
  }).join("")}</a:tr>`).join("");
  return frame(table, id, `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="0"/><a:tblGrid>${xs.slice(1).map((x, index) => `<a:gridCol w="${emu(x - xs[index])}"/>`).join("")}</a:tblGrid>${rows}</a:tbl></a:graphicData>`);
}
const cache = (values, type) => `<c:${type}Cache>${type === "num" ? "<c:formatCode>General</c:formatCode>" : ""}<c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${xml(v)}</c:v></c:pt>`).join("")}</c:${type}Cache>`;
async function chartParts(node) {
  const chart = htmlChartSchema.parse(node.data), cells = [{ id: "a1", address: "A1", value: "Category" }];
  chart.labels.forEach((label, i) => cells.push({ id: `a${i + 2}`, address: `A${i + 2}`, value: label }));
  chart.series.forEach((series, i) => { const col = columnName(i + 2); cells.push({ id: `${col}1`, address: `${col}1`, value: series.name }); series.values.forEach((value, r) => cells.push({ id: `${col}${r + 2}`, address: `${col}${r + 2}`, value })); });
  const workbook = await buildWorkbookXlsx({ schemaVersion: 1, kind: "sheet", title: chart.title || "Chart data", sheets: [{ id: "data", name: "Sheet1", cells }] });
  const series = chart.series.map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${xml(s.name)}</c:v></c:tx><c:spPr>${chart.type === "line" ? `<a:ln w="28575"><a:solidFill><a:srgbClr val="${s.color.slice(1)}"/></a:solidFill></a:ln>` : `<a:solidFill><a:srgbClr val="${s.color.slice(1)}"/></a:solidFill>`}</c:spPr><c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${chart.labels.length + 1}</c:f>${cache(chart.labels, "str")}</c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$${columnName(i + 2)}$2:$${columnName(i + 2)}$${chart.labels.length + 1}</c:f>${cache(s.values, "num")}</c:numRef></c:val></c:ser>`).join("");
  const axes = chart.type === "pie" ? "" : '<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="1"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>';
  const kind = `${chart.type}Chart`, options = chart.type === "bar" ? '<c:barDir val="col"/><c:grouping val="clustered"/>' : chart.type === "line" ? '<c:grouping val="standard"/>' : '<c:varyColors val="1"/>';
  const source = `<?xml version="1.0" encoding="UTF-8"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R}"><c:lang val="zh-CN"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/><c:${kind}>${options}${series}${chart.type === "pie" ? "" : '<c:axId val="1"/><c:axId val="2"/>'}</c:${kind}>${axes}</c:plotArea><c:legend><c:legendPos val="b"/><c:layout/></c:legend><c:plotVisOnly val="1"/></c:chart><c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
  return { source, workbook };
}
export async function buildMeasuredHtmlPptx(document, measured, images) {
  const layout = { schemaVersion: 1, kind: "slides", title: document.title, theme: document.theme, pages: document.pages.map((page, index) => ({ id: page.id, title: page.title, notes: page.notes, hidden: page.hidden, width: page.width, height: page.height, background: measured[index].background === "#00000000" ? document.theme.background : measured[index].background, nodes: measured[index].nodes })) };
  const zip = await JSZip.loadAsync(await buildLayoutPptx(layout, images));
  let types = await zip.file("[Content_Types].xml").async("string"), chartNumber = 0;
  const warnings = [];
  for (let i = 0; i < measured.length; i++) {
    const slide = measured[i], n = i + 1; warnings.push({ page: n, warnings: slide.warnings });
    let markup = await zip.file(`ppt/slides/slide${n}.xml`).async("string"), rels = await zip.file(`ppt/slides/_rels/slide${n}.xml.rels`).async("string"), shapes = "";
    let id = 10000;
    for (const table of slide.tables) shapes += tableXml(table, id++);
    for (const chart of slide.charts) {
      const index = ++chartNumber, parts = await chartParts(chart), rel = `rIdHtmlChart${index}`;
      zip.file(`ppt/charts/chart${index}.xml`, parts.source);
      zip.file(`ppt/embeddings/chart${index}.xlsx`, parts.workbook);
      zip.file(`ppt/charts/_rels/chart${index}.xml.rels`, `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/package" Target="../embeddings/chart${index}.xlsx"/></Relationships>`);
      types = types.replace("</Types>", `<Override PartName="/ppt/charts/chart${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/ppt/embeddings/chart${index}.xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/></Types>`);
      rels = rels.replace("</Relationships>", `<Relationship Id="${rel}" Type="${R}/chart" Target="../charts/chart${index}.xml"/></Relationships>`);
      shapes += frame(chart, id++, `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${R}" r:id="${rel}"/></a:graphicData>`);
    }
    markup = markup.replace("</p:spTree>", `${shapes}</p:spTree>`); zip.file(`ppt/slides/slide${n}.xml`, markup); zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, rels);
  }
  zip.file("docProps/custom.xml", `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="ModelShotConversionReport"><vt:lpwstr>${xml(JSON.stringify({ source: "html", warnings }))}</vt:lpwstr></property></Properties>`);
  types = types.replace("</Types>", '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>'); zip.file("[Content_Types].xml", types);
  const rootRels = await zip.file("_rels/.rels").async("string"); zip.file("_rels/.rels", rootRels.replace("</Relationships>", `<Relationship Id="rIdHtmlReport" Type="${R}/custom-properties" Target="docProps/custom.xml"/></Relationships>`));
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } });
  if (output.length > 64 * 1024 * 1024) throw new Error("EXPORT_RESULT_TOO_LARGE");
  return output;
}
