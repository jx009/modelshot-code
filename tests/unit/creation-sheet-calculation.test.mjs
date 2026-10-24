import { expect, it } from "vitest";
import { calculateWorkbook } from "../../src/lib/creation/sheet-calculation.js";
import { workbookSchema } from "../../src/lib/creation/contracts/sheet.js";
import { parseSheetFormula, cellPosition, columnName } from "../../src/lib/creation/sheet-formula.js";
import { applySheetOperations } from "../../src/lib/creation/sheet-operations.js";

const workbook = cells => ({ schemaVersion: 1, kind: "sheet", title: "Test", sheets: [{ id: "s", name: "Data", cells: cells.map((cell, index) => ({ id: `c${index}`, ...cell })) }] });
const value = (formula, cells = []) => calculateWorkbook(workbook([...cells, { address: "Z1", formula }])).sheets[0].cells.at(-1).calculated;

it("evaluates both IF branches correctly and only evaluates the chosen branch", () => {
  expect(value('=IF(2>3,"yes","no")')).toBe("no");
  expect(value('=IF(2<=3,"是","否")')).toBe("是");
  expect(value("=IF(FALSE,1/0,4)")).toBe(4);
  expect(value("=IF(1/0,2,3)")).toEqual({ error: "#DIV/0!" });
  expect(value('=IF(TRUE,"a,b(\"\"中\"\")","other")')).toBe('a,b("中")');
  expect(value("=SUM(2,3*4,50%)")).toBe(14.5);
});
it("propagates error types, rejects nonfinite results, and handles blank and textual cells", () => {
  expect(value("=A1+1", [{ address: "A1", formula: "=1/0" }])).toEqual({ error: "#DIV/0!" });
  expect(value("=SUM(A1:A2)", [{ address: "A1", formula: "=1/0" }])).toEqual({ error: "#DIV/0!" });
  expect(value("=COUNT(A1:A2)", [{ address: "A1", formula: "=1/0" }, { address: "A2", value: 4 }])).toBe(1);
  expect(value("=AVERAGE(A1:A2)")).toEqual({ error: "#DIV/0!" });
  expect(value("=1e308*2")).toEqual({ error: "#NUM!" });
  expect(value('="001"')).toBe("001");
  expect(value('="#REF!"')).toBe("#REF!");
  expect(value("=A1", [{ address: "A1", value: null }])).toBe(0);
  expect(calculateWorkbook(workbook([{ address: "A1", value: null }])).sheets[0].cells[0].display).toBe("");
  expect(value("=SUM(A1:A2)", [{ address: "A1", value: true }, { address: "A2", value: "12" }])).toBe(0);
});
it("handles absolute and multi-letter references with quoted Unicode sheet names", () => {
  expect(value("=sum($AA$1:AB1,1)", [{ address: "AA1", value: 2 }, { address: "AB1", value: 3 }])).toBe(6);
  const book = workbook([{ address: "A1", value: 7 }]); book.sheets[0].name = "中文's";
  book.sheets.push({ id: "s2", name: "Other", cells: [{ id: "c", address: "A1", formula: "='中文''s'!$A$1" }] });
  expect(calculateWorkbook(book).sheets[1].cells[0].calculated).toBe(7);
  expect(cellPosition("XFD1048576")).toMatchObject({ column: 16384, row: 1048576 });
  expect(cellPosition("XFE1")).toBeNull(); expect(cellPosition("A1048577")).toBeNull(); expect(columnName(703)).toBe("AAA");
  expect(() => applySheetOperations(book, [{ op: "renameSheet", sheetId: "s", name: "Renamed" }])).toThrow("SHEET_RENAME_REFERENCED");
});
it("uses approximate LOOKUP on sorted vectors and refuses ambiguous unsorted lookup data", () => {
  const cells = [{ address: "A1", value: 10 }, { address: "A2", value: 20 }, { address: "B1", value: "low" }, { address: "B2", value: "high" }];
  expect(value("=LOOKUP(15,A1:A2,B1:B2)", cells)).toBe("low");
  expect(value("=LOOKUP(5,A1:A2,B1:B2)", cells)).toEqual({ error: "#N/A" });
  expect(value("=LOOKUP(30,A1:A2,B1:B2)", [{ ...cells[0], value: 30 }, ...cells.slice(1)])).toEqual({ error: "#N/A" });
});
it("stops huge ranges, dependency chains and exhausted work budgets before unbounded work", () => {
  expect(() => value("=SUM(A1:XFD1048576)")).toThrow("SHEET_CALCULATION_LIMIT");
  expect(() => calculateWorkbook(workbook([{ address: "A1", formula: "=1+2" }]), { maxOperations: 2 })).toThrow("SHEET_CALCULATION_LIMIT");
  expect(() => calculateWorkbook(workbook(Array.from({ length: 130 }, (_, index) => ({ address: `A${index + 1}`, formula: `=A${index + 2}` }))))).toThrow("SHEET_CALCULATION_LIMIT");
  const cyclic = workbook([{ address: "A1", formula: "=Other!A1" }]);
  cyclic.sheets.push({ id: "other", name: "Other", cells: [{ id: "c", address: "A1", formula: "=Data!A1" }] });
  expect(calculateWorkbook(cyclic).sheets[0].cells[0].calculated).toEqual({ error: "#REF!" });
});
it("rejects scripting, external references, unsupported functions and invalid workbook metadata", () => {
  for (const formula of ["=globalThis.process.exit()", '=IMPORTXML("url")', "=[external]Sheet!A1", "=A1.constructor", "=1;alert(1)", "=SUM(" + "(".repeat(65) + "1" + ")".repeat(66)]) expect(() => parseSheetFormula(formula)).toThrow();
  const book = workbook([{ address: "A1", value: 1 }]);
  for (const name of ["a/b", "x".repeat(32), "'bad", "bad'"]) expect(workbookSchema.safeParse({ ...book, sheets: [{ ...book.sheets[0], name }] }).success).toBe(false);
  expect(workbookSchema.safeParse(workbook([{ address: "A1", value: 1, display: "untrusted" }])).success).toBe(false);
});
