import { z } from "zod";
import { cellPosition, parseSheetFormula } from "../sheet-formula.js";

export const sheetId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const address = z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/).refine(value => cellPosition(value) !== null, "SHEET_ADDRESS_INVALID");
export const sheetAddressesSchema = z.array(address).min(1).max(100).refine(value => new Set(value).size === value.length, "SHEET_DUPLICATE_SELECTION");
const sheetName = z.string().trim().min(1).max(31).refine(value => !/[\\/?*\[\]:\u0000-\u001f]/.test(value) && !value.startsWith("'") && !value.endsWith("'"), "SHEET_NAME_INVALID");
const cellValue = z.union([z.string().max(16000), z.number().finite(), z.boolean(), z.null()]);
// Formula text is still parsed by the bounded evaluator; this allows the
// supported arithmetic/function surface without accepting arbitrary script.
const formula = z.string().max(2000).refine(value => { try { parseSheetFormula(value); return true; } catch { return false; } }, "SHEET_FORMULA_UNSUPPORTED");
const style = z.object({
  bold: z.boolean().optional(), italic: z.boolean().optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), numberFormat: z.enum(["general", "integer", "decimal", "currency", "percent", "date"]).optional(),
}).strict();
export const sheetCellSchema = z.object({ id: sheetId, address, value: cellValue.optional(), formula: formula.optional(), style: style.default({}) }).strict()
  .refine(cell => cell.formula === undefined || cell.value === undefined, "SHEET_FORMULA_VALUE_EXCLUSIVE")
  .refine(cell => cell.value !== undefined || cell.formula !== undefined, "SHEET_CELL_EMPTY");
export const sheetSchema = z.object({ id: sheetId, name: sheetName, cells: z.array(sheetCellSchema).max(100000), freezeRows: z.number().int().min(0).max(1000).default(0), freezeColumns: z.number().int().min(0).max(1000).default(0) }).strict()
  .superRefine((sheet, ctx) => { const ids = new Set(), addresses = new Set(); for (const cell of sheet.cells) { if (ids.has(cell.id) || addresses.has(cell.address)) ctx.addIssue({ code: "custom", message: "SHEET_DUPLICATE_CELL" }); ids.add(cell.id); addresses.add(cell.address); } });
export const workbookSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal("sheet"), title: z.string().trim().min(1).max(160), locale: z.enum(["zh", "en"]).default("zh"), sheets: z.array(sheetSchema).min(1).max(5) }).strict()
  .superRefine((book, ctx) => { const ids = new Set(), names = new Set(); let cells = 0; for (const sheet of book.sheets) { if (ids.has(sheet.id) || names.has(sheet.name.toLocaleLowerCase())) ctx.addIssue({ code: "custom", message: "SHEET_DUPLICATE_SHEET" }); ids.add(sheet.id); names.add(sheet.name.toLocaleLowerCase()); cells += sheet.cells.length; } if (cells > 100000) ctx.addIssue({ code: "custom", message: "SHEET_CELL_LIMIT" }); });
const target = { sheetId, address };
export const sheetOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("setCell"), ...target, id: sheetId, value: cellValue.optional(), formula: formula.optional(), expectedValue: cellValue.optional(), expectedFormula: formula.optional(), style: style.optional() }).strict().refine(value => (value.value !== undefined) !== (value.formula !== undefined), "SHEET_CELL_VALUE_REQUIRED"),
  z.object({ op: z.literal("clearCell"), ...target, expectedValue: cellValue.optional(), expectedFormula: formula.optional() }).strict(),
  z.object({ op: z.literal("setCellStyle"), ...target, style }).strict(),
  z.object({ op: z.literal("renameSheet"), sheetId, name: sheetName }).strict(),
  z.object({ op: z.literal("setFreeze"), sheetId, freezeRows: z.number().int().min(0).max(1000), freezeColumns: z.number().int().min(0).max(1000) }).strict(),
]).array().min(1).max(100);
export const sheetAssetIds = () => [];
export function cellKey(sheetIdValue, addressValue) { return `${sheetIdValue}:${addressValue}`; }
