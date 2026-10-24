import { workbookSchema } from "./contracts/sheet.js";
import { nativeOfficeArtifactSchema, NATIVE_OFFICE_VERSION } from "./contracts/native-office.js";
import { cellPosition } from "./sheet-formula.js";

const patterns = Object.freeze({ general: "General", integer: "0", decimal: "0.00", currency: '"¥"#,##0.00', percent: "0.00%", date: "m/d/yy" });
// Numeric flags below follow Univer 1.2.0's public CellValueType/BooleanNumber
// contract. This pure adapter imports no engine, React, canvas or formula UI.
export function toNativeSheetArtifact(input, unitId) {
  const source = workbookSchema.parse(input), styles = {}, styleIds = new Map(), sheets = {};
  const styleId = style => {
    const key = JSON.stringify([style.bold ?? null, style.italic ?? null, style.color ?? null, style.background ?? null, style.numberFormat ?? null]);
    if (styleIds.has(key)) return styleIds.get(key);
    const id = `style${styleIds.size}`, result = {};
    if (style.bold !== undefined) result.bl = Number(style.bold);
    if (style.italic !== undefined) result.it = Number(style.italic);
    if (style.color) result.cl = { rgb: style.color };
    if (style.background) result.bg = { rgb: style.background };
    if (style.numberFormat) result.n = { pattern: patterns[style.numberFormat] };
    styleIds.set(key, id); styles[id] = result;
    return id;
  };
  const sheetOrder = [];
  for (const sheet of source.sheets) {
    // Native IDs remain within the existing 128-character contract; worksheet
    // objects use safe generated keys, with the original ID retained in custom.
    const id = `sheet${sheetOrder.length}`, cellData = {};
    let maxRow = Math.max(200, sheet.freezeRows + 1), maxColumn = Math.max(26, sheet.freezeColumns + 1);
    for (const cell of sheet.cells) {
      const { row, column } = cellPosition(cell.address);
      maxRow = Math.max(maxRow, row); maxColumn = Math.max(maxColumn, column);
      const native = { s: styleId(cell.style), custom: { modelshot: { cellId: cell.id } } };
      if (cell.formula !== undefined) native.f = cell.formula;
      else {
        native.v = cell.value;
        if (typeof cell.value === "string") native.t = 1;
        else if (typeof cell.value === "number") native.t = 2;
        else if (typeof cell.value === "boolean") native.t = 3;
      }
      cellData[row - 1] ??= {}; cellData[row - 1][column - 1] = native;
    }
    sheetOrder.push(id);
    sheets[id] = { id, name: sheet.name, cellData, rowCount: maxRow, columnCount: maxColumn,
      freeze: { xSplit: sheet.freezeColumns, ySplit: sheet.freezeRows, startRow: sheet.freezeRows || -1, startColumn: sheet.freezeColumns || -1 },
      hidden: 0, tabColor: "", zoomRatio: 1, scrollTop: 0, scrollLeft: 0, defaultColumnWidth: 96, defaultRowHeight: 24,
      rowData: {}, columnData: {}, mergeData: [], rowHeader: { width: 46 }, columnHeader: { height: 24 }, showGridlines: 1, rightToLeft: 0,
      custom: { modelshot: { sheetId: sheet.id } },
    };
  }
  return nativeOfficeArtifactSchema.parse({ schemaVersion: 2, kind: "sheet", title: source.title,
    engine: "univer", engineVersion: NATIVE_OFFICE_VERSION, assetIds: [],
    snapshot: { id: unitId, name: source.title, appVersion: NATIVE_OFFICE_VERSION, locale: source.locale === "zh" ? "zhCN" : "enUS",
      styles, sheetOrder, sheets, resources: [], custom: { modelshot: { adapterVersion: "semantic-sheet-1" } },
    },
  });
}
