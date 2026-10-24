import { expect, it } from "vitest";
import { Univer, UniverInstanceType } from "@univerjs/core";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";
import { applyNativeSheetOperations, nativeSheetCellsFromRange, nativeSheetTargetFromReference, validateNativeSheetSelection } from "../../src/lib/creation/native-sheet-edit.js";
import { languageInputSchema, validateLanguageResult } from "../../src/lib/creation/contracts/language.js";
import { creationLanguageMessages } from "../../src/lib/domain/creation/language-provider.js";

const book = () => toNativeSheetArtifact({ schemaVersion: 1, kind: "sheet", title: "Costs", sheets: [{ id: "s", name: "Costs", cells: [
  { id: "first", address: "A1", value: 10, style: { bold: true } }, { id: "other", address: "B1", value: "private-unselected", style: { bold: true } },
] }, { id: "s2", name: "Other", cells: [{ id: "last", address: "A1", value: 90 }] }] }, "unit");
const target = () => ({ format: "univer-sheet-1", artifactId: "artifact", baseRevision: 1, unitId: "unit", sheetId: "sheet0", cells: [{ row: 0, column: 0 }] });
const input = () => languageInputSchema.parse({ ...target(), purpose: "sheet.native.edit", prompt: "Change selected amount", locale: "en" });
const op = extra => ({ op: "setNativeCell", sheetId: "sheet0", row: 0, column: 0, value: 20, ...extra });

it("changes only selected cell values and local styles while preserving the complete native snapshot", () => {
  const source = book(), sheet = source.snapshot.sheets.sheet0;
  sheet.mergeData.push({ startRow: 5, endRow: 6, startColumn: 0, endColumn: 1 });
  source.snapshot.custom.future = { values: [1, "retained"] };
  source.snapshot.resources.push({ name: "SHEET_RANGE_THEME_MODEL_PLUGIN", data: '{"opaque":true}' });
  const original = structuredClone(source), styleId = sheet.cellData[0][0].s;
  const operations = [op(), { op: "styleNativeCell", sheetId: "sheet0", row: 0, column: 0, style: { bold: false, color: "#112233" } }];
  const result = applyNativeSheetOperations(source, operations, target());
  expect(source).toEqual(original); expect(result.snapshot.styles).toEqual(original.snapshot.styles);
  expect(result.snapshot.sheets.sheet0.cellData[0][0]).toEqual({ v: 20, t: 2, s: { ...original.snapshot.styles[styleId], bl: 0, cl: { rgb: "#112233" } }, custom: original.snapshot.sheets.sheet0.cellData[0][0].custom });
  const restored = structuredClone(result); restored.snapshot.sheets.sheet0.cellData[0][0] = original.snapshot.sheets.sheet0.cellData[0][0];
  expect(restored).toEqual(original);
  const engine = new Univer();
  try {
    const unit = engine.createUnit(UniverInstanceType.UNIVER_SHEET, structuredClone(result.snapshot));
    expect(unit.getSheetBySheetId("sheet0").getCell(0, 0).v).toBe(20);
    expect(unit.getSnapshot().sheets.sheet0.mergeData).toEqual(sheet.mergeData);
  } finally { engine.dispose(); }
});

it("rejects scope expansion, unit changes, duplicates and rich/merged cells without mutating the source", () => {
  const source = book();
  expect(() => validateLanguageResult(input(), { operations: [op({ column: 1 })] }, source)).toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
  expect(() => validateLanguageResult(input(), { operations: [op({ sheetId: "sheet1" })] }, source)).toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
  expect(() => applyNativeSheetOperations(source, [op(), op()], target())).toThrow("NATIVE_SHEET_DUPLICATE_OPERATION");
  expect(() => validateNativeSheetSelection({ ...target(), unitId: "other" }, source)).toThrow("LANGUAGE_SELECTION_CHANGED");
  source.snapshot.sheets.sheet0.cellData[0][0].p = { body: { dataStream: "Rich\r\n" } };
  expect(() => applyNativeSheetOperations(source, [op()])).toThrow("NATIVE_SHEET_AI_RICH_CELL");
  delete source.snapshot.sheets.sheet0.cellData[0][0].p;
  source.snapshot.sheets.sheet0.mergeData.push({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 });
  expect(() => applyNativeSheetOperations(source, [op()])).toThrow("NATIVE_SHEET_AI_MERGED_CELL");
  expect(source.snapshot.sheets.sheet0.cellData[0][0].v).toBe(10);
});

it("preserves formula text as a plain string and removes stale values when writing a scalar formula", () => {
  let source = book();
  source = applyNativeSheetOperations(source, [op({ value: '=IMAGE("https://example.test")' })]);
  expect(source.snapshot.sheets.sheet0.cellData[0][0]).toMatchObject({ t: 1, v: '=IMAGE("https://example.test")' });
  const formulaOp = { op: "setNativeCell", sheetId: "sheet0", row: 0, column: 0, formula: "=SUM(A2:A10)+IF(B2>0,2,3)" };
  source = applyNativeSheetOperations(source, [formulaOp]);
  const cell = source.snapshot.sheets.sheet0.cellData[0][0];
  expect(cell.f).toBe(formulaOp.formula); expect(cell).not.toHaveProperty("v"); expect(cell).not.toHaveProperty("t");
  source = applyNativeSheetOperations(source, [op({ value: null })]);
  expect(source.snapshot.sheets.sheet0.cellData[0][0].v).toBeNull(); expect(source.snapshot.sheets.sheet0.cellData[0][0]).not.toHaveProperty("f");
});

it("rejects protected data and spill/shared formula workbooks even when only a blank destination is selected", () => {
  for (const field of ["si", "ref", "ft", "fd", "xf"]) {
    const source = book(); source.snapshot.sheets.sheet1.cellData[0][0][field] = "array";
    expect(() => validateNativeSheetSelection({ ...target(), cells: [{ row: 2, column: 2 }] }, source)).toThrow("NATIVE_SHEET_AI_FORMULA_UNSUPPORTED");
  }
  const source = book(); source.snapshot.resources.push({ name: "SHEET_RANGE_PROTECTION_PLUGIN", data: '{"sheet1":{"rules":[1]}}' });
  expect(() => applyNativeSheetOperations(source, [op()])).toThrow("NATIVE_SHEET_AI_PROTECTED");
});

it("bounds scalar formula work and rejects dynamic arrays, full-grid ranges, external functions and formula expansion", () => {
  const source = book(); source.snapshot.sheets.sheet0.rowCount = 100000;
  for (const formula of ["=A1:A3", "=IF(TRUE,A1:A3,1)", "=SUM(A1:A3*2)", "=SEQUENCE(100000)", '=WEBSERVICE("https://x")', "=SUM(A1:B100000)", "=Missing!A1"]) {
    const operation = { op: "setNativeCell", sheetId: "sheet0", row: 0, column: 0, formula };
    expect(() => applyNativeSheetOperations(source, [operation])).toThrow();
  }
  source.snapshot.sheets.sheet1.cellData[0][0].f = "=A1:A3";
  expect(() => applyNativeSheetOperations(source, [op()])).toThrow("NATIVE_SHEET_AI_FORMULA_UNSUPPORTED");
});

it("projects only selected cell content and rejects oversized selections before paid submission", () => {
  const source = book(); source.snapshot.custom.privateData = "private-custom-data";
  const messages = creationLanguageMessages({ input: input(), source, assets: [] });
  const payload = JSON.parse(messages[1].content);
  expect(payload.source.cells).toEqual([{ row: 0, column: 0, address: "A1", value: 10 }]);
  expect(messages[1].content).not.toContain("private-unselected"); expect(messages[1].content).not.toContain("private-custom-data");
  expect(messages[0].content).toContain("setNativeCell"); expect(messages[0].content).toContain("untrusted data");
  source.snapshot.sheets.sheet0.cellData[0][0].v = "中".repeat(22000);
  expect(() => validateNativeSheetSelection(target(), source)).toThrow("LANGUAGE_CONTEXT_TOO_LARGE");
});

it("bounds range enumeration before allocating cells and rejects stale coordinate references", () => {
  expect(nativeSheetCellsFromRange({ startRow: 1, endRow: 2, startColumn: 3, endColumn: 4 })).toEqual([{ row: 1, column: 3 }, { row: 1, column: 4 }, { row: 2, column: 3 }, { row: 2, column: 4 }]);
  for (const range of [{ startRow: 0, endRow: 100000000, startColumn: 0, endColumn: 10000000 }, { startRow: 0, endRow: 100, startColumn: 0, endColumn: 0 }, { startRow: -1, endRow: 0, startColumn: 0, endColumn: 0 }]) expect(() => nativeSheetCellsFromRange(range)).toThrow("NATIVE_SHEET_AI_SELECTION_LIMIT");
  const reference = { ...target(), label: "Costs" }, saved = { revision: 1, content: book() };
  expect(nativeSheetTargetFromReference(reference, saved, "artifact")).toEqual(target());
  expect(() => nativeSheetTargetFromReference(reference, { ...saved, revision: 2 }, "artifact")).toThrow("LANGUAGE_SELECTION_CHANGED");
  expect(() => nativeSheetTargetFromReference(reference, saved, "another")).toThrow("LANGUAGE_SELECTION_CHANGED");
});

it("rejects corrupt shared style definitions without changing any cell or shared definition", () => {
  const operation = { op: "styleNativeCell", sheetId: "sheet0", row: 0, column: 0, style: { bold: false } };
  for (const malformed of [null, 17, "style-other", []]) {
    const source = book(), styleId = source.snapshot.sheets.sheet0.cellData[0][0].s;
    source.snapshot.styles[styleId] = malformed;
    expect(() => applyNativeSheetOperations(source, [operation], target())).toThrow("NATIVE_SHEET_AI_STYLE_UNSUPPORTED");
    expect(source.snapshot.sheets.sheet0.cellData[0][0].s).toBe(styleId);
  }
});
