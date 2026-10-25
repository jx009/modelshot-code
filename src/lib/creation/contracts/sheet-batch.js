import { z } from "zod";
import { sheetId, sheetSchema, sheetCellSchema } from "./sheet.js";
import { cellPosition } from "../sheet-formula.js";
export { SHEET_CHUNK_ROWS, sheetGenerationCalls } from "../sheet-generation-policy.js";
export const sheetOutlineSchema = z.object({ title: z.string().min(1).max(160), sheets: z.array(z.object({
  id: sheetId, name: sheetSchema.shape.name, columns: z.array(z.string().min(1).max(120)).min(1).max(20), brief: z.string().min(1).max(2000),
}).strict()).min(1).max(5) }).strict().superRefine((value, ctx) => {
  if (new Set(value.sheets.map(sheet => sheet.id)).size !== value.sheets.length || new Set(value.sheets.map(sheet => sheet.name.toLowerCase())).size !== value.sheets.length) ctx.addIssue({ code: "custom", message: "SHEET_DUPLICATE_SHEET" });
});
export const sheetChunkSchema = z.object({ sheetId, cells: z.array(sheetCellSchema).max(500) }).strict();
export function validateSheetChunk(input, raw) {
  const result = sheetChunkSchema.parse(raw), seen = new Set();
  for (const cell of result.cells) {
    const position = cellPosition(cell.address);
    if (result.sheetId !== input.sheetId || seen.has(cell.address) || position.row < input.startRow || position.row > input.endRow || position.column > input.columns.length) throw new Error("LANGUAGE_SHEET_CHUNK_MISMATCH");
    seen.add(cell.address);
  }
  if (result.sheetId !== input.sheetId || !result.cells.length) throw new Error("LANGUAGE_SHEET_CHUNK_MISMATCH");
  return { sheetId: result.sheetId, cells: result.cells.map(cell => ({ ...cell, id: `${result.sheetId}_${cell.address}` })) };
}
