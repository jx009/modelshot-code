import { expect, it } from "vitest";
import { pendingSheetCellSnapshot, pendingSheetCellOperations } from "../../src/lib/creation/client/pending-sheet-cell.js";
import { applySheetOperations } from "../../src/lib/creation/sheet-operations.js";

const source = () => ({ kind: "sheet", sheets: [{ id: "sales", cells: [{ id: "price", address: "B2", value: 10, style: { bold: true } }, { id: "other", address: "C2", value: 20 }] }] });
const draft = (text = "15") => ({ kind: "sheet-cell", sheetId: "sales", address: "B2", cellId: "price", original: { id: "price", value: 10 }, text, composing: false });
it("keeps unfinished input as a bounded draft but rejects it before mutating the workbook", () => {
  expect(pendingSheetCellSnapshot(draft("=SUM("))).toMatchObject({ text: "=SUM(" });
  expect(() => pendingSheetCellOperations(source(), draft("=SUM("))).toThrow("SHEET_CELL_INPUT_INVALID");
  expect(() => pendingSheetCellSnapshot(draft("x".repeat(16001)))).toThrow("SHEET_CELL_DRAFT_INVALID");
  expect(() => pendingSheetCellSnapshot({ ...draft(), address: "XFE1" })).toThrow("SHEET_CELL_DRAFT_INVALID");
});
it("generates a typed cell edit preserving style and unrelated cell identity", () => {
  const original = source(), operations = pendingSheetCellOperations(original, draft()), next = applySheetOperations(original, operations);
  expect(operations).toEqual([{ op: "setCell", sheetId: "sales", address: "B2", id: "price", value: 15, expectedValue: 10 }]);
  expect(next.sheets[0].cells[0].style).toEqual({ bold: true });
  expect(next.sheets[0].cells[1]).toBe(original.sheets[0].cells[1]);
  expect(pendingSheetCellOperations(next, draft())).toEqual([]);
});
it("rejects a stale cell, identity change and an active composition", () => {
  const changed = source(); changed.sheets[0].cells[0].value = 11;
  expect(() => pendingSheetCellOperations(changed, draft())).toThrow("SHEET_CELL_CHANGED");
  changed.sheets[0].cells[0] = { id: "replacement", address: "B2", value: 15 };
  expect(() => pendingSheetCellOperations(changed, draft())).toThrow("SHEET_CELL_CHANGED");
  expect(() => pendingSheetCellOperations(source(), { ...draft(), composing: true })).toThrow("TEXT_COMPOSITION_ACTIVE");
});
it("keeps leading-zero identifiers as text and parses only supported formulas", () => {
  expect(pendingSheetCellOperations(source(), draft("0015"))[0].value).toBe("0015");
  expect(pendingSheetCellOperations(source(), draft("=C2*2"))[0].formula).toBe("=C2*2");
  expect(() => pendingSheetCellOperations(source(), draft('=WEBSERVICE("https://example.test")'))).toThrow("SHEET_CELL_INPUT_INVALID");
});
it("does not create blank cells or overwrite a concurrently filled empty target", () => {
  const empty = { ...draft(""), address: "A1", cellId: "newcell", original: null };
  expect(pendingSheetCellOperations(source(), empty)).toEqual([]);
  const original = source(); original.sheets[0].cells.push({ id: "othernew", address: "A1", value: "data" });
  expect(() => pendingSheetCellOperations(original, { ...empty, text: "new" })).toThrow("SHEET_CELL_CHANGED");
});
