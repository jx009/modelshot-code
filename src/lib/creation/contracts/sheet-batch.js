import { z } from "zod";
import { sheetId, sheetSchema, sheetCellSchema } from "./sheet.js";
import { cellPosition, columnName } from "../sheet-formula.js";
export { SHEET_CHUNK_ROWS, sheetGenerationCalls } from "../sheet-generation-policy.js";
export const sheetPlanSchema = z.object({
  rowCount: z.number().int().min(1).max(500),
  columnFormats: z.array(z.enum(["general", "integer", "decimal", "currency", "percent", "date"])).min(1).max(20),
  rows: z.array(z.object({ startRow: z.number().int().min(2).max(500), endRow: z.number().int().min(2).max(500), brief: z.string().min(1).max(600) }).strict()).max(50),
  totals: z.array(z.object({ column: z.number().int().min(2).max(20), operation: z.enum(["SUM", "AVERAGE", "MIN", "MAX", "COUNT"]) }).strict()).max(19).default([]),
}).strict().superRefine((plan, ctx) => {
  let next = 2;
  const end = plan.rowCount - (plan.totals.length ? 1 : 0);
  for (const range of plan.rows) {
    if (range.startRow !== next || range.endRow < range.startRow || range.endRow > end) ctx.addIssue({ code: "custom", message: "SHEET_ROW_PLAN_INVALID" });
    next = range.endRow + 1;
  }
  if (next !== end + 1 || plan.totals.length && plan.rowCount < 3) ctx.addIssue({ code: "custom", message: "SHEET_ROW_PLAN_INVALID" });
  if (new Set(plan.totals.map(total => total.column)).size !== plan.totals.length || plan.totals.some(total => total.column > plan.columnFormats.length)) ctx.addIssue({ code: "custom", message: "SHEET_TOTAL_PLAN_INVALID" });
});
export const sheetOutlineSchema = z.object({ title: z.string().min(1).max(160), sheets: z.array(z.object({
  id: sheetId, name: sheetSchema.shape.name, columns: z.array(z.string().min(1).max(120)).min(1).max(20), brief: z.string().min(1).max(2000),
  plan: sheetPlanSchema.optional(),
}).strict()).min(1).max(5) }).strict().superRefine((value, ctx) => {
  if (new Set(value.sheets.map(sheet => sheet.id)).size !== value.sheets.length || new Set(value.sheets.map(sheet => sheet.name.toLowerCase())).size !== value.sheets.length) ctx.addIssue({ code: "custom", message: "SHEET_DUPLICATE_SHEET" });
  if (value.sheets.some(sheet => sheet.plan && sheet.plan.columnFormats.length !== sheet.columns.length)) ctx.addIssue({ code: "custom", message: "SHEET_COLUMN_PLAN_INVALID" });
});
export const sheetChunkSchema = z.object({ sheetId, cells: z.array(sheetCellSchema).max(500) }).strict();
export function validateSheetChunk(input, raw) {
  const result = sheetChunkSchema.parse(raw), seen = new Set();
  for (const cell of result.cells) {
    const position = cellPosition(cell.address);
    if (result.sheetId !== input.sheetId || seen.has(cell.address) || position.row < input.startRow || position.row > input.endRow || position.column > input.columns.length) throw new Error("LANGUAGE_SHEET_CHUNK_MISMATCH");
    seen.add(cell.address);
  }
  const onlyStructuralRows = input.plan && (input.startRow === 1 && input.endRow === 1 || input.plan.totals.length && input.startRow === input.plan.rowCount && input.endRow === input.plan.rowCount);
  if (result.sheetId !== input.sheetId || !result.cells.length && !onlyStructuralRows) throw new Error("LANGUAGE_SHEET_CHUNK_MISMATCH");
  let cells = result.cells.map(cell => ({ ...cell, id: `${result.sheetId}_${cell.address}` }));
  if (input.plan) {
    const plan = sheetPlanSchema.parse(input.plan), totalsRow = plan.totals.length ? plan.rowCount : null;
    if (plan.columnFormats.length !== input.columns.length || input.endRow > plan.rowCount) throw new Error("LANGUAGE_SHEET_CHUNK_MISMATCH");
    // Headers and total formulas are deterministic across independent chunks.
    // Preserve supplied data/formulas; only normalize presentation metadata.
    cells = cells.filter(cell => { const { row } = cellPosition(cell.address); return row !== 1 && row !== totalsRow; }).map(cell => ({ ...cell,
      style: { ...cell.style, numberFormat: plan.columnFormats[cellPosition(cell.address).column - 1] },
    }));
    if (input.startRow === 1) cells.unshift(...input.columns.map((value, index) => {
      const address = `${columnName(index + 1)}1`;
      return { id: `${input.sheetId}_${address}`, address, value, style: { bold: true, color: "#FFFFFF", background: "#222B45", numberFormat: "general" } };
    }));
    if (totalsRow && input.startRow <= totalsRow && input.endRow >= totalsRow) {
      cells.push({ id: `${input.sheetId}_A${totalsRow}`, address: `A${totalsRow}`, value: input.locale === "en" ? "Summary" : "汇总", style: { bold: true } });
      for (const total of plan.totals) {
        const col = columnName(total.column), address = `${col}${totalsRow}`;
        const range = `${col}2:${col}${totalsRow - 1}`;
        cells.push({ id: `${input.sheetId}_${address}`, address, formula: total.operation === "COUNT" ? `=COUNT(${range})` : `=IF(COUNT(${range})=0,"",${total.operation}(${range}))`,
          style: { bold: true, numberFormat: total.operation === "COUNT" ? "integer" : plan.columnFormats[total.column - 1] } });
      }
    }
    cells.sort((a, b) => { const left = cellPosition(a.address), right = cellPosition(b.address); return left.row - right.row || left.column - right.column; });
  }
  return { sheetId: result.sheetId, cells };
}
