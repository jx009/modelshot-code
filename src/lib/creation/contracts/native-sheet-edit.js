import { z } from "zod";
import { sheetId } from "./sheet.js";

export const NATIVE_SHEET_EDIT_FORMAT = "univer-sheet-1";
const position = { row: z.number().int().min(0).max(99999), column: z.number().int().min(0).max(1023) };
export const nativeSheetCellsSchema = z.array(z.object(position).strict()).min(1).max(100)
  .refine(cells => new Set(cells.map(cell => `${cell.row}:${cell.column}`)).size === cells.length, "SHEET_DUPLICATE_SELECTION");
export const nativeSheetTargetSchema = z.object({
  format: z.literal(NATIVE_SHEET_EDIT_FORMAT), artifactId: sheetId, baseRevision: z.number().int().positive(),
  unitId: sheetId, sheetId, cells: nativeSheetCellsSchema,
}).strict();
const style = z.object({
  bold: z.boolean().optional(), italic: z.boolean().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
}).strict().refine(value => Object.keys(value).length > 0, "NATIVE_SHEET_EMPTY_STYLE");
export const nativeSheetOperationsSchema = z.array(z.discriminatedUnion("op", [
  z.object({ op: z.literal("setNativeCell"), sheetId, ...position,
    value: z.union([z.string().max(16000), z.number().finite(), z.boolean(), z.null()]).optional(),
    formula: z.string().min(2).max(2000).optional(),
  }).strict().refine(value => (value.value !== undefined) !== (value.formula !== undefined), "SHEET_CELL_VALUE_REQUIRED"),
  z.object({ op: z.literal("styleNativeCell"), sheetId, ...position, style }).strict(),
])).min(1).max(100);
