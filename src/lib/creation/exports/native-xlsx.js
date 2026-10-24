import JSZip from "jszip";
import { nativeOfficeArtifactSchema } from "../contracts/native-office.js";
import { EXPORT_MAX_BYTES } from "../contracts/exports.js";
import { columnName, parseSheetFormula } from "../sheet-formula.js";

// Pure, bounded Univer 1.2.0 -> SpreadsheetML codec. Never project through the
// semantic workbook or run a formula engine. Unsupported authored features
// fail closed; UI viewport state and ModelShot identity metadata are not Office
// content. Run only in the credential-free conversion child.
const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const P = "http://schemas.openxmlformats.org/package/2006/relationships";
const fail = (code = "EXPORT_NATIVE_FEATURE_UNSUPPORTED") => { throw new Error(code); };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const empty = value => value == null || record(value) && Object.keys(value).length === 0;
function keys(value, allowed) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key) && value[key] != null)) fail();
}
function number(value, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || integer && !Number.isSafeInteger(value)) fail("EXPORT_NATIVE_SHEET_INVALID");
  return value;
}
const flag = value => value == null ? undefined : number(value, 0, 1, true);
function xml(value) {
  const text = String(value);
  if (!text.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(text)) fail("EXPORT_SHEET_TEXT_UNSUPPORTED");
  return text.replace(/[&<>"'\r\n\t]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;", "\r": "&#13;", "\n": "&#10;", "\t": "&#9;" })[char]);
}
const xstring = value => xml(String(value).replace(/_x[0-9a-f]{4}_/gi, match => `_x005F_${match.slice(1)}`));
const address = (row, col) => `${columnName(col + 1)}${row + 1}`;
function metadata(value, field) {
  if (empty(value)) return;
  keys(value, ["modelshot"]); keys(value.modelshot, [field]);
  if (typeof value.modelshot[field] !== "string") fail();
}
function color(value) {
  keys(value, ["rgb"]);
  if (typeof value.rgb !== "string") fail("EXPORT_NATIVE_STYLE_UNSUPPORTED");
  let rgb = value.rgb;
  const css = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(1(?:\.0+)?))?\s*\)$/i.exec(rgb);
  if (css && css.slice(1, 4).every(part => Number(part) <= 255)) rgb = `#${css.slice(1, 4).map(part => Number(part).toString(16).padStart(2, "0")).join("")}`;
  if (/^#[a-f0-9]{3}$/i.test(rgb)) rgb = `#${[...rgb.slice(1)].map(c => c + c).join("")}`;
  if (!/^#[a-f0-9]{6}$/i.test(rgb)) fail("EXPORT_NATIVE_STYLE_UNSUPPORTED");
  return `FF${rgb.slice(1).toUpperCase()}`;
}
function decoration(value, strike = false) {
  if (value == null) return "";
  keys(value, ["s", "c", "cl", "t"]);
  if (!flag(value.s)) return "";
  if (value.c != null && flag(value.c) !== 1 || value.cl != null && value.c === 0) fail("EXPORT_NATIVE_STYLE_UNSUPPORTED");
  const types = { 10: "double", 11: "none", 12: "single", 18: "singleAccounting", 19: "doubleAccounting" };
  if (strike) { if (value.t != null && value.t !== 12) fail("EXPORT_NATIVE_STYLE_UNSUPPORTED"); return "<strike/>"; }
  if (value.t != null && !Object.hasOwn(types, value.t)) fail("EXPORT_NATIVE_STYLE_UNSUPPORTED");
  return `<u val="${types[value.t ?? 12]}"/>`;
}
const borderTypes = ["none", "thin", "hair", "dotted", "dashed", "dashDot", "dashDotDot", "double", "medium", "mediumDashed", "mediumDashDot", "mediumDashDotDot", "slantDashDot", "thick"];
function border(value) {
  if (value == null) return "<border><left/><right/><top/><bottom/><diagonal/></border>";
  keys(value, ["l", "r", "t", "b"]);
  return `<border>${[["l", "left"], ["r", "right"], ["t", "top"], ["b", "bottom"]].map(([key, name]) => {
    const edge = value[key]; if (edge == null) return `<${name}/>`;
    keys(edge, ["s", "cl"]); const type = borderTypes[number(edge.s, 0, 13, true)];
    return `<${name} style="${type}">${edge.cl == null ? "" : `<color rgb="${color(edge.cl)}"/>`}</${name}>`;
  }).join("")}<diagonal/></border>`;
}
export function nativeSheetStyleParts(style) {
  keys(style, ["ff", "fs", "it", "bl", "ul", "st", "ol", "bbl", "bg", "bd", "cl", "va", "n", "stf", "tr", "td", "ht", "vt", "tb", "pd"]);
  for (const name of ["ol", "bbl"]) if (style[name] != null) {
    keys(style[name], ["s", "c", "cl", "t"]); if (flag(style[name].s) !== 0) fail("EXPORT_NATIVE_STYLE_UNSUPPORTED");
  }
  if (style.pd != null) { keys(style.pd, ["l", "r", "t", "b"]); if (Object.values(style.pd).some(value => value != null && value !== 0)) fail("EXPORT_NATIVE_STYLE_UNSUPPORTED"); }
  const family = style.ff ?? "Arial", size = style.fs ?? 11;
  if (typeof family !== "string" || !family.length || family.length > 128) fail("EXPORT_NATIVE_STYLE_UNSUPPORTED");
  number(size, 1, 409);
  const baseline = style.va == null ? 1 : number(style.va, 1, 3, true);
  const font = `<font><sz val="${size}"/><name val="${xml(family)}"/>${flag(style.bl) ? "<b/>" : ""}${flag(style.it) ? "<i/>" : ""}${decoration(style.ul)}${decoration(style.st, true)}${style.cl ? `<color rgb="${color(style.cl)}"/>` : ""}${baseline > 1 ? `<vertAlign val="${baseline === 2 ? "subscript" : "superscript"}"/>` : ""}</font>`;
  const fill = style.bg ? `<fill><patternFill patternType="solid"><fgColor rgb="${color(style.bg)}"/><bgColor indexed="64"/></patternFill></fill>` : '<fill><patternFill patternType="none"/></fill>';
  const attrs = [];
  if (style.ht != null && style.ht !== 0) attrs.push(`horizontal="${["general", "left", "center", "right", "justify", "justify", "distributed"][number(style.ht, 1, 6, true)]}"`);
  if (style.vt != null && style.vt !== 0) attrs.push(`vertical="${["", "top", "center", "bottom"][number(style.vt, 1, 3, true)]}"`);
  // Excel has no independent CLIP policy; claiming equivalence would be lossy.
  if (style.tb === 2) fail("EXPORT_NATIVE_STYLE_UNSUPPORTED");
  if (style.tb != null) attrs.push(`wrapText="${number(style.tb, 0, 3, true) === 3 ? 1 : 0}"`);
  if (style.stf != null) attrs.push(`shrinkToFit="${flag(style.stf)}"`);
  if (style.td != null) attrs.push(`readingOrder="${number(style.td, 0, 2, true)}"`);
  if (style.tr != null) {
    keys(style.tr, ["a", "v"]); const angle = number(style.tr.a, -90, 90, true);
    // Univer rotates a canvas clockwise; OOXML 0..90 is above the horizon,
    // and 91..180 is below it. Keep the visual direction, not the numeric sign.
    attrs.push(`textRotation="${flag(style.tr.v) ? 255 : angle > 0 ? 90 + angle : -angle}"`);
  }
  let pattern = "General";
  if (style.n != null) { keys(style.n, ["pattern"]); pattern = style.n.pattern; if (typeof pattern !== "string" || !pattern.length || pattern.length > 1024) fail("EXPORT_NATIVE_STYLE_UNSUPPORTED"); }
  return { font, fill, border: border(style.bd), alignment: attrs.length ? `<alignment ${attrs.join(" ")}/>` : "", pattern };
}
function stylesFor(snapshot) {
  const items = [], ids = new Map(), references = new Map();
  const id = reference => {
    if (typeof reference === "string" && references.has(reference)) return references.get(reference);
    if (typeof reference === "string" && !Object.hasOwn(snapshot.styles, reference)) fail("EXPORT_NATIVE_STYLE_UNSUPPORTED");
    const style = typeof reference === "string" ? snapshot.styles[reference] : reference;
    const parts = nativeSheetStyleParts(style ?? {}), key = JSON.stringify(parts);
    if (!ids.has(key)) { if (items.length >= 4096) fail("EXPORT_SHEET_STYLE_LIMIT"); ids.set(key, items.length); items.push(parts); }
    const result = ids.get(key); if (typeof reference === "string") references.set(reference, result);
    return result;
  };
  id(null);
  return { id, xml: () => {
    const nums = new Map(); for (const item of items) if (item.pattern !== "General" && !nums.has(item.pattern)) nums.set(item.pattern, 164 + nums.size);
    return `${H}<styleSheet xmlns="${S}"><numFmts count="${nums.size}">${[...nums].map(([p, n]) => `<numFmt numFmtId="${n}" formatCode="${xml(p)}"/>`).join("")}</numFmts><fonts count="${items.length}">${items.map(item => item.font).join("")}</fonts><fills count="${items.length + 2}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${items.map(item => item.fill).join("")}</fills><borders count="${items.length}">${items.map(item => item.border).join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${items.length}">${items.map((item, i) => `<xf numFmtId="${nums.get(item.pattern) || 0}" fontId="${i}" fillId="${i + 2}" borderId="${i}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1">${item.alignment}</xf>`).join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  } };
}
function formula(cell, budget) {
  if (cell.ft != null && cell.ft !== 0 || cell.fd != null && cell.fd !== 0 || ["si", "ref", "xf"].some(key => cell[key] != null && cell[key] !== "")) fail("EXPORT_NATIVE_FORMULA_UNSUPPORTED");
  if (cell.f == null || cell.f === "") return "";
  if (typeof cell.f !== "string" || cell.f.length > 2000 || /[\[\]]/.test(cell.f)) fail("EXPORT_NATIVE_FORMULA_UNSUPPORTED");
  if (++budget.formulas > 10000 || (budget.formulaCharacters += cell.f.length) > 128000) fail("EXPORT_NATIVE_SHEET_LIMIT");
  // A positive grammar excludes external workbooks, names, DDE and functions
  // with external side effects. No evaluation/cache trust in the export host.
  let ast;
  try { ast = parseSheetFormula(cell.f); } catch { fail("EXPORT_NATIVE_FORMULA_UNSUPPORTED"); }
  const visit = (node, rangeAllowed = false) => {
    if (node.type === "reference") {
      if (node.range && !rangeAllowed || node.sheet != null && !budget.sheetNames.has(node.sheet.toLowerCase())) fail("EXPORT_NATIVE_FORMULA_UNSUPPORTED");
      budget.references += (Math.abs(node.start.row - node.end.row) + 1) * (Math.abs(node.start.column - node.end.column) + 1);
      if (budget.references > 100000) fail("EXPORT_NATIVE_SHEET_LIMIT");
    } else if (node.type === "call") node.args.forEach((arg, index) => visit(arg, node.name !== "IF" && (node.name !== "LOOKUP" || index > 0)));
    else if (node.type === "binary") { visit(node.left); visit(node.right); }
    else if (node.type !== "literal") visit(node.value);
  };
  visit(ast);
  return `<f>${xml(cell.f.slice(1))}</f>`;
}
function cellXml(cell, row, col, styles, budget) {
  if (cell == null) return "";
  keys(cell, ["s", "v", "t", "f", "ft", "fd", "si", "ref", "xf", "custom"]); metadata(cell.custom, "cellId");
  const attrs = `r="${address(row, col)}" s="${styles.id(cell.s)}"`, f = formula(cell, budget);
  if (f) return `<c ${attrs}>${f}</c>`; // cached v/t can be stale; Excel recalculates.
  const value = cell.v;
  if (value == null) return `<c ${attrs}/>`;
  if (cell.t != null && ![1, 2, 3, 4].includes(cell.t)) fail("EXPORT_NATIVE_SHEET_INVALID");
  if ([1, 4].includes(cell.t) && typeof value !== "string") fail("EXPORT_NATIVE_SHEET_INVALID");
  if (cell.t === 3 || typeof value === "boolean") {
    if (typeof value !== "boolean" && value !== 0 && value !== 1) fail("EXPORT_NATIVE_SHEET_INVALID");
    return `<c ${attrs} t="b"><v>${Number(value)}</v></c>`;
  }
  if (cell.t === 2 || typeof value === "number" && cell.t == null) {
    if (typeof value !== "number" || !Number.isFinite(value)) fail("EXPORT_NATIVE_SHEET_INVALID");
    return `<c ${attrs}><v>${value}</v></c>`;
  }
  if (typeof value !== "string" || value.length > 32767) fail("EXPORT_SHEET_TEXT_UNSUPPORTED");
  return `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${xstring(value)}</t></is></c>`;
}
function indexed(data, count) {
  if (data == null) return [];
  if (!record(data)) fail("EXPORT_NATIVE_SHEET_INVALID");
  return Object.entries(data).map(([key, value]) => {
    if (!/^(0|[1-9][0-9]*)$/.test(key)) fail("EXPORT_NATIVE_SHEET_INVALID");
    return [number(Number(key), 0, count - 1, true), value];
  }).sort((a, b) => a[0] - b[0]);
}
function mergeXml(sheet, budget) {
  const ranges = sheet.mergeData ?? [], covered = new Set();
  if (!Array.isArray(ranges)) fail("EXPORT_NATIVE_SHEET_INVALID");
  const refs = ranges.map(range => {
    keys(range, ["startRow", "endRow", "startColumn", "endColumn"]);
    const r0 = number(range.startRow, 0, sheet.rowCount - 1, true), r1 = number(range.endRow, r0, sheet.rowCount - 1, true);
    const c0 = number(range.startColumn, 0, sheet.columnCount - 1, true), c1 = number(range.endColumn, c0, sheet.columnCount - 1, true);
    const area = (r1 - r0 + 1) * (c1 - c0 + 1);
    if (area < 2) fail("EXPORT_NATIVE_SHEET_INVALID");
    if ((budget.mergedCells += area) > 100000) fail("EXPORT_NATIVE_SHEET_LIMIT");
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const key = r * 16384 + c, cell = sheet.cellData[r]?.[c];
      if (covered.has(key) || (r !== r0 || c !== c0) && cell && (cell.v != null && cell.v !== "" || cell.f || cell.p)) fail("EXPORT_NATIVE_MERGE_UNSUPPORTED");
      covered.add(key);
    }
    return `<mergeCell ref="${address(r0, c0)}:${address(r1, c1)}"/>`;
  });
  return refs.length ? `<mergeCells count="${refs.length}">${refs.join("")}</mergeCells>` : "";
}
// Excel's column widths use font metrics rather than px. This conventional
// 7-pixel digit conversion is an approximation, disclosed in export warnings.
const width = pixels => Math.floor(number(pixels, 0, 1785) / 7 * 256) / 256;
function sheetXml(sheet, styles, budget) {
  keys(sheet, ["id", "name", "tabColor", "hidden", "freeze", "rowCount", "columnCount", "zoomRatio", "scrollTop", "scrollLeft", "defaultColumnWidth", "defaultRowHeight", "mergeData", "cellData", "rowData", "columnData", "defaultStyle", "rowHeader", "columnHeader", "showGridlines", "rightToLeft", "custom"]);
  metadata(sheet.custom, "sheetId");
  if (!empty(sheet.defaultStyle)) fail("EXPORT_NATIVE_STYLE_UNSUPPORTED");
  const rowData = new Map(indexed(sheet.rowData, sheet.rowCount));
  const rows = new Map(indexed(sheet.cellData, sheet.rowCount));
  for (const [r] of rowData) if (!rows.has(r)) rows.set(r, {});
  if ((budget.rows += rows.size) > 100000) fail("EXPORT_NATIVE_SHEET_LIMIT");
  const body = [...rows].sort((a, b) => a[0] - b[0]).map(([r, cells]) => {
    const row = rowData.get(r) ?? {}; keys(row, ["h", "ah", "ia", "hd", "s"]);
    if (!empty(row.s)) fail("EXPORT_NATIVE_STYLE_UNSUPPORTED");
    const h = flag(row.ia) ? row.ah ?? row.h : row.h;
    const attrs = `${h == null ? "" : ` ht="${number(h, 0, 546) * 0.75}" customHeight="1"`}${flag(row.hd) ? ' hidden="1"' : ""}`;
    return `<row r="${r + 1}"${attrs}>${indexed(cells, sheet.columnCount).map(([c, cell]) => cellXml(cell, r, c, styles, budget)).join("")}</row>`;
  }).join("");
  const cols = indexed(sheet.columnData, sheet.columnCount).map(([c, col]) => {
    keys(col, ["w", "hd", "s"]); if (!empty(col.s)) fail("EXPORT_NATIVE_STYLE_UNSUPPORTED");
    return `<col min="${c + 1}" max="${c + 1}"${col.w == null ? "" : ` width="${width(col.w)}" customWidth="1"`}${flag(col.hd) ? ' hidden="1"' : ""}/>`;
  });
  const f = sheet.freeze ?? {}; keys(f, ["xSplit", "ySplit", "startRow", "startColumn"]);
  const x = number(f.xSplit ?? 0, 0, sheet.columnCount - 1, true), y = number(f.ySplit ?? 0, 0, sheet.rowCount - 1, true);
  if (f.startRow != null && f.startRow !== (y || -1) || f.startColumn != null && f.startColumn !== (x || -1)) fail("EXPORT_NATIVE_FEATURE_UNSUPPORTED");
  const pane = x || y ? `<pane xSplit="${x}" ySplit="${y}" topLeftCell="${address(y, x)}" activePane="${x && y ? "bottomRight" : y ? "bottomLeft" : "topRight"}" state="frozen"/>` : "";
  if (sheet.rowHeader) keys(sheet.rowHeader, ["width", "hidden"]);
  if (sheet.columnHeader) keys(sheet.columnHeader, ["height", "hidden"]);
  const hideRows = flag(sheet.rowHeader?.hidden) ?? 0, hideCols = flag(sheet.columnHeader?.hidden) ?? 0;
  if (hideRows !== hideCols) fail();
  const zoom = Math.round(number(sheet.zoomRatio ?? 1, 0.1, 4) * 100);
  return `${H}<worksheet xmlns="${S}">${sheet.tabColor ? `<sheetPr><tabColor rgb="${color({ rgb: sheet.tabColor })}"/></sheetPr>` : ""}<sheetViews><sheetView workbookViewId="0" zoomScale="${zoom}" showRowColHeaders="${hideRows ? 0 : 1}" showGridLines="${flag(sheet.showGridlines) ?? 1}" rightToLeft="${flag(sheet.rightToLeft) ?? 0}">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="${number(sheet.defaultRowHeight ?? 20, 1, 546) * 0.75}" defaultColWidth="${width(sheet.defaultColumnWidth ?? 96)}"/>${cols.length ? `<cols>${cols.join("")}</cols>` : ""}<sheetData>${body}</sheetData>${mergeXml(sheet, budget)}</worksheet>`;
}

export async function buildNativeWorkbookXlsx(input, { maxBytes = EXPORT_MAX_BYTES } = {}) {
  const parsed = nativeOfficeArtifactSchema.safeParse(input);
  if (!parsed.success || parsed.data.kind !== "sheet") fail("EXPORT_NATIVE_SHEET_INVALID");
  const content = parsed.data, data = content.snapshot;
  if (content.assetIds.length) fail();
  keys(data, ["id", "rev", "name", "appVersion", "locale", "dateSystem", "calculationSettings", "styles", "sheetOrder", "sheets", "resources", "custom", "defaultStyle"]);
  metadata(data.custom, "adapterVersion"); if (!empty(data.defaultStyle)) fail("EXPORT_NATIVE_STYLE_UNSUPPORTED");
  if (data.dateSystem != null && !["date1900", "date1904"].includes(data.dateSystem)) fail();
  const calculation = data.calculationSettings ?? {};
  keys(calculation, ["iterativeCalculation", "maxIterations", "maxChange"]);
  if (calculation.iterativeCalculation != null && calculation.iterativeCalculation !== false) fail();
  const iterations = number(calculation.maxIterations ?? 100, 1, 10000, true), delta = number(calculation.maxChange ?? 0.001, Number.MIN_VALUE, 1);
  // Empty core plugin resources carry no authored content. Every nonempty
  // plugin payload (including protection, themes and defined names) is rejected.
  const plugins = new Set(["SHEET_RANGE_THEME_MODEL_PLUGIN", "SHEET_WORKSHEET_PROTECTION_PLUGIN", "SHEET_WORKSHEET_PROTECTION_POINT_PLUGIN", "SHEET_RANGE_PROTECTION_PLUGIN", "SHEET_DEFINED_NAME_PLUGIN"]);
  for (const resource of data.resources ?? []) {
    if (resource.name === "SHEET_AuthzIoMockService_PLUGIN" && resource.data?.trim() === "{}") continue;
    if (!plugins.has(resource.name)) fail();
    if (resource.data) { let value; try { value = JSON.parse(resource.data); } catch { fail(); } if (!empty(value)) fail(); }
  }
  const sheets = data.sheetOrder.map(id => data.sheets[id]), names = new Set();
  for (const sheet of sheets) {
    if (/[\\/?*\[\]:]/.test(sheet.name) || sheet.name.startsWith("'") || sheet.name.endsWith("'") || names.has(sheet.name.toLowerCase())) fail("EXPORT_NATIVE_SHEET_INVALID");
    names.add(sheet.name.toLowerCase()); number(sheet.hidden ?? 0, 0, 2, true);
  }
  if (!sheets.some(sheet => !sheet.hidden)) fail("EXPORT_NATIVE_SHEET_INVALID");
  const styles = stylesFor(data), zip = new JSZip(), budget = { formulas: 0, formulaCharacters: 0, references: 0, sheetNames: names, mergedCells: 0, rows: 0 };
  const file = (name, value) => zip.file(name, value, { date: new Date("1980-01-01T00:00:00Z") });
  sheets.forEach((sheet, index) => file(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet, styles, budget)));
  file("xl/styles.xml", styles.xml());
  file("xl/workbook.xml", `${H}<workbook xmlns="${S}" xmlns:r="${R}"><workbookPr date1904="${data.dateSystem === "date1904" ? 1 : 0}"/><bookViews><workbookView activeTab="${sheets.findIndex(sheet => !sheet.hidden)}"/></bookViews><sheets>${sheets.map((sheet, i) => `<sheet name="${xstring(sheet.name)}" sheetId="${i + 1}" state="${["visible", "hidden", "veryHidden"][sheet.hidden ?? 0]}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1" iterate="0" iterateCount="${iterations}" iterateDelta="${delta}"/></workbook>`);
  file("xl/_rels/workbook.xml.rels", `${H}<Relationships xmlns="${P}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/></Relationships>`);
  file("_rels/.rels", `${H}<Relationships xmlns="${P}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  file("[Content_Types].xml", `${H}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } });
  if (output.length > maxBytes) fail("EXPORT_RESULT_TOO_LARGE");
  return output;
}
