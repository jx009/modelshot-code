import JSZip from "jszip";
import { workbookSchema } from "../contracts/sheet.js";
import { calculateWorkbook } from "../sheet-calculation.js";
import { cellPosition, columnName } from "../sheet-formula.js";
import { EXPORT_MAX_BYTES } from "../contracts/exports.js";
const HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const xml = value => { const text = String(value); if (!text.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(text)) throw new Error("EXPORT_SHEET_TEXT_UNSUPPORTED"); return text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]); };
const colNumber = address => cellPosition(address).column;
function cellXml(cell, calculated, styleId) {
  const value = calculated.calculated;
  const attributes = `r="${cell.address}" s="${styleId}"`;
  const formula = cell.formula ? `<f>${xml(cell.formula.slice(1))}</f>` : "";
  if (value && typeof value === "object") return `<c ${attributes} t="e">${formula}<v>${xml(value.error)}</v></c>`;
  if (typeof value === "number") return `<c ${attributes}>${formula}<v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c ${attributes} t="b">${formula}<v>${value ? 1 : 0}</v></c>`;
  if (cell.formula) return `<c ${attributes} t="str">${formula}<v>${xml(value ?? "")}</v></c>`;
  if (value === null) return `<c ${attributes}/>`;
  return `<c ${attributes} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}
function createStyles(workbook) {
  const ids = new Map(), styles = [];
  const key = style => JSON.stringify([!!style.bold, !!style.italic, style.color ?? null, style.background ?? null, style.numberFormat ?? "general"]);
  const id = style => { const value = key(style); if (!ids.has(value)) { ids.set(value, styles.length); styles.push(style); } return ids.get(value); };
  id({}); for (const sheet of workbook.sheets) for (const cell of sheet.cells) id(cell.style);
  // Excel limits unique cell styles; bound output before constructing XML.
  if (styles.length > 4096) throw new Error("EXPORT_SHEET_STYLE_LIMIT");
  const formats = { general: 0, integer: 1, decimal: 2, currency: 164, percent: 10, date: 14 };
  const fonts = styles.map(style => `<font><sz val="11"/><name val="Calibri"/>${style.bold ? "<b/>" : ""}${style.italic ? "<i/>" : ""}${style.color ? `<color rgb="FF${style.color.slice(1).toUpperCase()}"/>` : ""}</font>`).join("");
  const fills = '<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' + styles.map(style => style.background ? `<fill><patternFill patternType="solid"><fgColor rgb="FF${style.background.slice(1).toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill>` : '<fill><patternFill patternType="none"/></fill>').join("");
  const xfs = styles.map((style, index) => `<xf numFmtId="${formats[style.numberFormat ?? "general"]}" fontId="${index}" fillId="${index + 2}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>`).join("");
  return { id, xml: `${HEADER}<styleSheet xmlns="${S}"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;¥&quot;#,##0.00"/></numFmts><fonts count="${styles.length}">${fonts}</fonts><fills count="${styles.length + 2}">${fills}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${styles.length}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` };
}
export async function buildWorkbookXlsx(input, { maxBytes = EXPORT_MAX_BYTES } = {}) {
  const parsed = workbookSchema.safeParse(input); if (!parsed.success) throw new Error("EXPORT_SHEET_INVALID");
  const workbook = parsed.data, calculated = calculateWorkbook(workbook), zip = new JSZip(), styles = createStyles(workbook);
  const file = (name, value) => zip.file(name, value, { date: new Date("1980-01-01T00:00:00Z") });
  const workbookRels = workbook.sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="${R}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("") + `<Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/>`;
  file("xl/styles.xml", styles.xml);
  const sheets = workbook.sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  file("xl/workbook.xml", `${HEADER}<workbook xmlns="${S}" xmlns:r="${R}"><fileVersion appName="ModelShot"/><workbookPr/><sheets>${sheets}</sheets><calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`);
  file("xl/_rels/workbook.xml.rels", `${HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}</Relationships>`);
  workbook.sheets.forEach((sheet, index) => {
    const computed = calculated.sheets[index]; let maxRow = 1, maxCol = 1;
    for (const cell of sheet.cells) { const position = cellPosition(cell.address); maxRow = Math.max(maxRow, position.row); maxCol = Math.max(maxCol, position.column); }
    const byAddress = new Map(computed.cells.map(cell => [cell.address, cell]));
    const rows = new Map(); for (const cell of sheet.cells) { const row = Number(cell.address.match(/[0-9]+/)[0]); if (!rows.has(row)) rows.set(row, []); rows.get(row).push(cell); }
    const body = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([row, cells]) => `<row r="${row}">${cells.sort((a, b) => colNumber(a.address) - colNumber(b.address)).map(cell => cellXml(cell, byAddress.get(cell.address), styles.id(cell.style))).join("")}</row>`).join("");
    const activePane = sheet.freezeRows && sheet.freezeColumns ? "bottomRight" : sheet.freezeRows ? "bottomLeft" : "topRight";
    file(`xl/worksheets/sheet${index + 1}.xml`, `${HEADER}<worksheet xmlns="${S}"><dimension ref="A1:${columnName(maxCol)}${maxRow}"/><sheetViews><sheetView workbookViewId="0">${sheet.freezeRows || sheet.freezeColumns ? `<pane ySplit="${sheet.freezeRows}" xSplit="${sheet.freezeColumns}" topLeftCell="${columnName(sheet.freezeColumns + 1)}${sheet.freezeRows + 1}" activePane="${activePane}" state="frozen"/>` : ""}</sheetView></sheetViews><sheetData>${body}</sheetData></worksheet>`);
  });
  file("[Content_Types].xml", `${HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${workbook.sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  file("_rels/.rels", `${HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } }); if (output.length > maxBytes) throw new Error("EXPORT_RESULT_TOO_LARGE"); return output;
}
