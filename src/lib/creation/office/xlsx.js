import { officePackage, officeFail, xmlEscape, patchXml, replaceChildren, rewriteOfficePackage } from "./package.js";
import { children, descendants, attribute, textContent } from "../references/office-xml.js";
import { nativeOfficeArtifactSchema, NATIVE_OFFICE_VERSION } from "../contracts/native-office.js";
import { nativeSheetStyleParts } from "../exports/native-xlsx.js";
import { officeEqual as same } from "./identity.js";

const child = (n, name) => children(n, "s", name)[0];
const val = n => n ? textContent(n) : "";
const attr = (n, key) => n ? attribute(n, key) : undefined;
const prefix = node => node.qname.includes(":") ? node.qname.split(":")[0] + ":" : "";
const qualified = (xml, pre) => xml.replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)/g, "<$1" + pre + "$2");
const unescapeString = value => value.replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
const safeFormula = f => f.length <= 2000 && !/\[|(?:https?|file|javascript):|\b(?:WEBSERVICE|IMAGE|HYPERLINK|IMPORTXML|IMPORTDATA|IMPORTRANGE)\s*\(/i.test(f);
const basicFormats = { 0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00", 14: "m/d/yy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yy h:mm", 49: "@" };

export function officeCellPosition(address) {
  const m = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(address || "");
  if (!m) officeFail("OFFICE_CELL_INVALID");
  let column = 0; for (const c of m[1]) column = column * 26 + c.charCodeAt(0) - 64;
  const row = Number(m[2]) - 1; column--;
  if (row >= 100000 || column >= 1024) officeFail("OFFICE_SHEET_RUNTIME_LIMIT");
  return { row, column };
}
function address(row, column) {
  let label = ""; for (let i = column + 1; i; i = Math.floor((i - 1) / 26)) label = String.fromCharCode(65 + (i - 1) % 26) + label;
  return label + (row + 1);
}
function range(text) {
  const [start, end = start] = text.split(":"), a = officeCellPosition(start), b = officeCellPosition(end);
  if (a.row > b.row || a.column > b.column) officeFail("OFFICE_CELL_INVALID");
  return { startRow: a.row, endRow: b.row, startColumn: a.column, endColumn: b.column };
}
function color(node) {
  const rgb = attr(node, "rgb");
  return /^[a-fA-F0-9]{6,8}$/.test(rgb || "") ? { rgb: "#" + rgb.slice(-6) } : undefined;
}
function readStyles(pkg, path) {
  if (!path) return { styles: { original0: {} }, path: null };
  const xml = pkg.xml(path), fonts = children(child(xml.root, "fonts"), "s", "font"), fills = children(child(xml.root, "fills"), "s", "fill");
  const numbers = { ...basicFormats };
  for (const n of children(child(xml.root, "numFmts"), "s", "numFmt")) numbers[attr(n, "numFmtId")] = attr(n, "formatCode");
  const styles = {};
  for (const [index, xf] of children(child(xml.root, "cellXfs"), "s", "xf").entries()) {
    const font = fonts[Number(attr(xf, "fontId") || 0)], fill = fills[Number(attr(xf, "fillId") || 0)], style = {};
    const name = attr(child(font, "name"), "val"), size = Number(attr(child(font, "sz"), "val"));
    if (name) style.ff = name;
    if (size > 0) style.fs = size;
    for (const [key, tag] of [["bl", "b"], ["it", "i"]]) if (child(font, tag)) style[key] = attr(child(font, tag), "val") === "0" ? 0 : 1;
    if (child(font, "u")) style.ul = { s: 1, t: attr(child(font, "u"), "val") === "double" ? 10 : 12 };
    if (child(font, "strike")) style.st = { s: 1 };
    const foreground = color(child(font, "color")), background = color(child(child(fill, "patternFill"), "fgColor"));
    if (foreground) style.cl = foreground;
    if (background) style.bg = background;
    const format = numbers[attr(xf, "numFmtId") || "0"];
    if (format) style.n = { pattern: format };
    const alignment = child(xf, "alignment");
    if (alignment) {
      const h = { left: 1, center: 2, right: 3, justify: 4, distributed: 6 }[attr(alignment, "horizontal")];
      const v = { top: 1, center: 2, bottom: 3 }[attr(alignment, "vertical")];
      if (h) style.ht = h; if (v) style.vt = v;
      if (attr(alignment, "wrapText") === "1") style.tb = 3;
    }
    styles["original" + index] = style;
  }
  if (!Object.keys(styles).length) styles.original0 = {};
  return { styles, path };
}

// The source package is retained separately. custom contains identities and a
// bounded compatibility report, never executable names, external connections,
// OOXML bytes or a duplicate of the entire workbook.
export function importWorkbook(bytes, { title = "导入表格", unitId = "imported-workbook", sourceId = "source" } = {}) {
  const pkg = officePackage(bytes), workbookPath = "xl/workbook.xml", workbook = pkg.xml(workbookPath);
  const rels = pkg.relationships(workbookPath), byType = suffix => [...rels.values()].find(r => !r.external && r.type.endsWith("/" + suffix))?.target;
  const sharedPath = byType("sharedStrings"), shared = sharedPath ? children(pkg.xml(sharedPath).root, "s", "si") : [];
  const styleInfo = readStyles(pkg, byType("styles")), sheets = {}, sheetOrder = [], sheetMaps = {}, warnings = new Set();
  let totalCells = 0, totalFormulaChars = 0, totalFormulas = 0;
  for (const item of children(child(workbook.root, "sheets"), "s", "sheet")) {
    if (sheetOrder.length >= 20) officeFail("OFFICE_SHEET_RUNTIME_LIMIT");
    const relation = rels.get(attribute(item, "id", "r"));
    if (!relation || relation.external || !relation.type.endsWith("/worksheet")) officeFail("OFFICE_WORKSHEET_INVALID");
    const id = "sheet" + sheetOrder.length, xml = pkg.xml(relation.target), sheetData = child(xml.root, "sheetData");
    if (!sheetData) officeFail("OFFICE_WORKSHEET_INVALID");
    const cellData = {}, protectedCells = [], rowData = {}, columnData = {}, cells = new Map(), rows = new Map();
    let rowCount = 200, columnCount = 26;
    const protectedSheet = Boolean(child(xml.root, "sheetProtection"));
    if (protectedSheet) warnings.add("SHEET_PROTECTION_PRESERVED_READ_ONLY");
    for (const row of children(sheetData, "s", "row")) {
      const rowIndex = Number(attr(row, "r")) - 1;
      if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= 100000 || rows.has(rowIndex)) officeFail("OFFICE_CELL_INVALID");
      rows.set(rowIndex, row); rowCount = Math.max(rowCount, rowIndex + 1);
      const height = Number(attr(row, "ht")), hidden = attr(row, "hidden") === "1";
      if (height > 0 || hidden) rowData[rowIndex] = { ...(height > 0 ? { h: height * 96 / 72 } : {}), ...(hidden ? { hd: 1 } : {}) };
      for (const c of children(row, "s", "c")) {
        if (++totalCells > 100000) officeFail("OFFICE_SHEET_RUNTIME_LIMIT");
        const ref = attr(c, "r"), pos = officeCellPosition(ref);
        if (pos.row !== rowIndex || cells.has(ref)) officeFail("OFFICE_CELL_INVALID");
        cells.set(ref, c); columnCount = Math.max(columnCount, pos.column + 1);
        const type = attr(c, "t"), valueNode = child(c, "v"), formula = child(c, "f"), text = val(valueNode);
        const native = { s: "original" + (attr(c, "s") || "0") };
        if (!Object.hasOwn(styleInfo.styles, native.s)) officeFail("OFFICE_STYLE_INVALID");
        let rich = false;
        if (type === "s" || type === "inlineStr") {
          const stringNode = type === "s" ? shared[Number(text)] : child(c, "is");
          if (!stringNode) officeFail("OFFICE_STRING_INVALID");
          native.v = unescapeString(descendants(stringNode, "s", "t").map(textContent).join("")); native.t = 1;
          rich = children(stringNode, "s", "r").length > 0;
        } else if (type === "b") { native.v = text === "1"; native.t = 3; }
        else if (["str", "e", "d"].includes(type)) { native.v = text; native.t = 1; }
        else if (text !== "") { native.v = Number(text); native.t = 2; if (!Number.isFinite(native.v)) officeFail("OFFICE_CELL_INVALID"); }
        if (typeof native.v === "string" && native.v.length > 32767) officeFail("OFFICE_STRING_INVALID");
        let protectedCell = rich || ["e", "d"].includes(type) || c.children.some(n => !["v", "f", "is"].includes(n.local));
        if (formula) {
          const f = "=" + val(formula), special = Object.values(formula.attrs).some(a => ["t", "ref", "si"].includes(a.local));
          if (special || !safeFormula(f) || ++totalFormulas > 10000 || (totalFormulaChars += f.length) > 128000) {
            protectedCell = true; warnings.add("COMPLEX_FORMULA_PRESERVED_CACHED_VALUE");
          } else native.f = f;
        }
        if (rich) warnings.add("RICH_TEXT_PRESERVED_READ_ONLY");
        if (protectedCell) protectedCells.push(ref);
        cellData[pos.row] ??= {}; cellData[pos.row][pos.column] = native;
      }
    }
    for (const col of children(child(xml.root, "cols"), "s", "col")) {
      const min = Number(attr(col, "min")), max = Number(attr(col, "max"));
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 1024) officeFail("OFFICE_SHEET_RUNTIME_LIMIT");
      columnCount = Math.max(columnCount, max);
      for (let c = min - 1; c < max; c++) columnData[c] = { ...(attr(col, "width") ? { w: Number(attr(col, "width")) * 7 + 5 } : {}), ...(attr(col, "hidden") === "1" ? { hd: 1 } : {}) };
    }
    const mergeData = children(child(xml.root, "mergeCells"), "s", "mergeCell").map(n => range(attr(n, "ref")));
    for (const r of mergeData) { rowCount = Math.max(rowCount, r.endRow + 1); columnCount = Math.max(columnCount, r.endColumn + 1); }
    const pane = descendants(xml.root, "s", "pane")[0], frozen = attr(pane, "state")?.startsWith("frozen"), xSplit = frozen ? Number(attr(pane, "xSplit") || 0) : 0, ySplit = frozen ? Number(attr(pane, "ySplit") || 0) : 0;
    if (child(xml.root, "drawing")) warnings.add("CHARTS_DRAWINGS_PRESERVED_IN_ORIGINAL");
    if (child(xml.root, "autoFilter")) warnings.add("FILTER_DEFINITION_PRESERVED");
    sheets[id] = { id, name: attr(item, "name"), cellData, rowCount, columnCount, rowData, columnData, mergeData,
      freeze: { xSplit, ySplit, startRow: ySplit || -1, startColumn: xSplit || -1 }, hidden: attr(item, "state") === "hidden" || attr(item, "state") === "veryHidden" ? 1 : 0,
      tabColor: "", zoomRatio: 1, scrollTop: 0, scrollLeft: 0, defaultColumnWidth: 96, defaultRowHeight: 24,
      rowHeader: { width: 46 }, columnHeader: { height: 24 }, showGridlines: 1, rightToLeft: 0,
      custom: { modelshot: { sheetId: attr(item, "sheetId") } } };
    sheetMaps[id] = { xml, path: relation.target, item, sheetData, cells, rows, protectedCells, protectedSheet };
    sheetOrder.push(id);
  }
  if (child(workbook.root, "definedNames")) warnings.add("DEFINED_NAMES_PRESERVED_NOT_EXECUTED");
  if (child(workbook.root, "externalReferences")) warnings.add("EXTERNAL_LINKS_PRESERVED_NOT_EXECUTED");
  const protection = Object.fromEntries(Object.entries(sheetMaps).map(([id, m]) => [id, { readOnly: m.protectedSheet, cells: m.protectedCells }]));
  const content = nativeOfficeArtifactSchema.parse({ schemaVersion: 2, kind: "sheet", title, engine: "univer", engineVersion: NATIVE_OFFICE_VERSION, assetIds: [],
    snapshot: { id: unitId, name: title, appVersion: NATIVE_OFFICE_VERSION, locale: "zhCN", styles: styleInfo.styles, sheets, sheetOrder, resources: [],
      ...(attr(child(workbook.root, "workbookPr"), "date1904") === "1" ? { dateSystem: "date1904" } : {}),
      custom: { modelshot: { adapterVersion: "ooxml-sheet-1", officeImport: { sourceId, format: "xlsx", warnings: [...warnings], protection } } } } });
  return { content, pkg, sheetMaps, styleInfo, workbook, workbookPath };
}

const semanticCell = cell => cell == null ? null : Object.fromEntries(Object.entries(cell).filter(([k, v]) => !["custom", "v", "t"].includes(k) && v != null || ["v", "t"].includes(k) && !cell.f && v != null));
function styleAppender(original, snapshot) {
  const { pkg, styleInfo } = original, replacements = new Map(), added = [], ids = new Map();
  const x = styleInfo.path && pkg.xml(styleInfo.path), xfGroup = x && child(x.root, "cellXfs");
  const oldCount = xfGroup ? children(xfGroup, "s", "xf").length : 1;
  const idFor = ref => {
    const style = typeof ref === "string" ? snapshot.styles[ref] : ref || {};
    if (!style) officeFail("OFFICE_STYLE_INVALID");
    for (const [key, value] of Object.entries(styleInfo.styles)) if (same(style, value)) return Number(key.slice(8));
    if (!x) officeFail("OFFICE_STYLE_PART_MISSING");
    const parts = nativeSheetStyleParts(style), key = JSON.stringify(parts);
    if (!ids.has(key)) { if (added.length >= 4096) officeFail("OFFICE_STYLE_LIMIT"); ids.set(key, oldCount + added.length); added.push(parts); }
    return ids.get(key);
  };
  const finish = () => {
    if (!added.length) return replacements;
    const pre = prefix(x.root), patches = [], groups = ["fonts", "fills", "borders", "cellXfs", "numFmts"];
    const nodes = Object.fromEntries(groups.map(g => [g, child(x.root, g)]));
    const count = g => nodes[g]?.children.length || 0;
    const numIds = descendants(x.root, "s", "numFmt").map(n => Number(attr(n, "numFmtId")));
    const startNumber = Math.max(164, ...numIds.map(n => n + 1));
    const append = (group, values) => {
      const node = nodes[group], text = qualified(values.join(""), pre);
      if (!node) {
        const at = group === "numFmts" ? x.root.openEnd : x.root.closeStart;
        patches.push({ start: at, end: at, text: "<" + pre + group + ' count="' + values.length + '">' + text + "</" + pre + group + ">" });
      } else {
        const body = node.selfClosing ? "" : x.source.slice(node.openEnd, node.closeStart);
        const opening = x.source.slice(node.start, node.openEnd).replace(/\s+count\s*=\s*(?:"[^"]*"|'[^']*')/, "").replace(/\/?>$/, ' count="' + (count(group) + values.length) + '">');
        patches.push({ start: node.start, end: node.end, text: opening + body + text + "</" + node.qname + ">" });
      }
    };
    append("fonts", added.map(p => p.font)); append("fills", added.map(p => p.fill)); append("borders", added.map(p => p.border));
    append("numFmts", added.map((p, i) => '<numFmt numFmtId="' + (startNumber + i) + '" formatCode="' + xmlEscape(p.pattern) + '"/>'));
    append("cellXfs", added.map((p, i) => '<xf fontId="' + (count("fonts") + i) + '" fillId="' + (count("fills") + i) + '" borderId="' + (count("borders") + i) + '" numFmtId="' + (startNumber + i) + '" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1">' + p.alignment + "</xf>"));
    replacements.set(styleInfo.path, patchXml(x.source, patches)); return replacements;
  };
  return { idFor, finish };
}
function cellXml(cell, ref, styleId, pre, original) {
  if (!cell) return "";
  if (Object.keys(cell).some(k => !["v", "t", "f", "s", "custom"].includes(k) && cell[k] != null)) officeFail("OFFICE_CELL_FEATURE_PROTECTED");
  let content = "", type = "";
  if (cell.f) {
    if (typeof cell.f !== "string" || !cell.f.startsWith("=") || !safeFormula(cell.f)) officeFail("OFFICE_FORMULA_UNSUPPORTED");
    content = "<f>" + xmlEscape(cell.f.slice(1)) + "</f>";
  } else if (cell.v != null) {
    if (typeof cell.v === "number") { if (!Number.isFinite(cell.v)) officeFail("OFFICE_CELL_INVALID"); content = "<v>" + cell.v + "</v>"; }
    else if (typeof cell.v === "boolean" || cell.t === 3) { type = ' t="b"'; content = "<v>" + (cell.v ? 1 : 0) + "</v>"; }
    else {
      if (typeof cell.v !== "string" || cell.v.length > 32767 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(cell.v)) officeFail("OFFICE_CELL_INVALID");
      type = ' t="inlineStr"'; content = '<is><t xml:space="preserve">' + xmlEscape(cell.v.replace(/_x[0-9a-f]{4}_/gi, m => "_x005F_" + m.slice(1))) + "</t></is>";
    }
  }
  // Unknown cell attributes such as metadata indices survive value/style edits.
  const extra = original ? Object.values(original.attrs).filter(a => !["r", "s", "t"].includes(a.local) || a.uri).map(a => " " + a.name + '="' + xmlEscape(a.value) + '"').join("") : "";
  return "<" + pre + 'c r="' + ref + '" s="' + styleId + '"' + type + extra + ">" + qualified(content, pre) + "</" + pre + "c>";
}

export async function patchWorkbook(bytes, input) {
  const next = nativeOfficeArtifactSchema.parse(input), meta = next.snapshot.custom?.modelshot?.officeImport;
  if (next.kind !== "sheet" || meta?.format !== "xlsx") officeFail("OFFICE_IMPORT_IDENTITY_CHANGED");
  const original = importWorkbook(bytes, { title: next.title, unitId: next.snapshot.id, sourceId: meta.sourceId }), baseline = original.content.snapshot, snapshot = next.snapshot;
  if (!same(meta, baseline.custom.modelshot.officeImport) || !same(snapshot.sheetOrder, baseline.sheetOrder)) officeFail("OFFICE_IMPORT_STRUCTURE_PROTECTED");
  const styles = styleAppender(original, snapshot), replacements = new Map(), workbookPatches = [];
  let formulasChanged = false;
  for (const id of snapshot.sheetOrder) {
    const sheet = snapshot.sheets[id], before = baseline.sheets[id], map = original.sheetMaps[id], patches = [], newRows = [];
    if (map.protectedSheet && !same({ ...sheet, zoomRatio: 1, scrollTop: 0, scrollLeft: 0 }, { ...before, zoomRatio: 1, scrollTop: 0, scrollLeft: 0 })) officeFail("OFFICE_SHEET_PROTECTED");
    for (const key of ["mergeData", "freeze", "rowData", "columnData", "hidden"]) if (!same(sheet[key], before[key])) officeFail("OFFICE_IMPORT_STRUCTURE_PROTECTED");
    if (sheet.name !== before.name) officeFail("OFFICE_SHEET_RENAME_PROTECTED"); // names can be referenced by opaque formula/chart parts
    const rowIndices = new Set([...Object.keys(before.cellData), ...Object.keys(sheet.cellData)].map(Number));
    const protectedCells = new Set(map.protectedCells), pre = prefix(map.xml.root);
    for (const r of [...rowIndices].sort((a, b) => a - b)) {
      const oldRow = before.cellData[r] || {}, nextRow = sheet.cellData[r] || {}, additions = [];
      for (const c of [...new Set([...Object.keys(oldRow), ...Object.keys(nextRow)].map(Number))].sort((a, b) => a - b)) {
        const prev = oldRow[c], cell = nextRow[c], ref = address(r, c), node = map.cells.get(ref);
        const oldStyle = typeof prev?.s === "string" ? baseline.styles[prev.s] : prev?.s || {}, nextStyle = typeof cell?.s === "string" ? snapshot.styles[cell.s] : cell?.s || {};
        const equivalent = same({ ...semanticCell(prev), s: undefined }, { ...semanticCell(cell), s: undefined }) && same(oldStyle, nextStyle);
        if (equivalent) continue;
        if (protectedCells.has(ref) || map.protectedSheet) officeFail("OFFICE_CELL_PROTECTED");
        if (prev?.f || cell?.f || prev?.v !== cell?.v) formulasChanged = true;
        const text = cellXml(cell, ref, styles.idFor(cell?.s), pre, node);
        if (node) patches.push({ start: node.start, end: node.end, text });
        else if (text) additions.push({ c, text });
      }
      if (additions.length) {
        const row = map.rows.get(r);
        if (row) {
          if (row.selfClosing) patches.push(replaceChildren(map.xml.source, row, additions.map(a => a.text).join("")));
          else {
            const grouped = new Map();
            for (const a of additions) {
              const following = children(row, "s", "c").find(n => officeCellPosition(attr(n, "r")).column > a.c);
              const at = following?.start ?? row.closeStart; grouped.set(at, (grouped.get(at) || "") + a.text);
            }
            for (const [at, text] of grouped) patches.push({ start: at, end: at, text });
          }
        } else newRows.push({ r, text: "<" + pre + 'row r="' + (r + 1) + '">' + additions.map(a => a.text).join("") + "</" + pre + "row>" });
      }
    }
    if (newRows.length) {
      if (map.sheetData.selfClosing) patches.push(replaceChildren(map.xml.source, map.sheetData, newRows.map(r => r.text).join("")));
      else {
        const grouped = new Map();
        for (const row of newRows) {
          const following = [...map.rows].find(([r]) => r > row.r)?.[1], at = following?.start ?? map.sheetData.closeStart;
          grouped.set(at, (grouped.get(at) || "") + row.text);
        }
        for (const [at, text] of grouped) patches.push({ start: at, end: at, text });
      }
    }
    if (patches.length) {
      // Dimension is only a cache; omit it so readers infer newly added cells.
      const dimension = child(map.xml.root, "dimension"); if (dimension) patches.push({ start: dimension.start, end: dimension.end, text: "" });
      replacements.set(map.path, patchXml(map.xml.source, patches));
    }
  }
  for (const [name, data] of styles.finish()) replacements.set(name, data);
  if (formulasChanged) {
    const x = original.workbook, calc = child(x.root, "calcPr"), pre = prefix(x.root), text = "<" + pre + 'calcPr fullCalcOnLoad="1" forceFullCalc="1"/>';
    workbookPatches.push({ start: calc?.start ?? x.root.closeStart, end: calc?.end ?? x.root.closeStart, text });
  }
  if (workbookPatches.length) replacements.set(original.workbookPath, patchXml(original.workbook.source, workbookPatches));
  return rewriteOfficePackage(original.pkg, replacements);
}
