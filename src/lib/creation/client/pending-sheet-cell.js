import { cellPosition } from "../sheet-formula.js";
import { sheetOperationSchema } from "../contracts/sheet.js";

const id = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
export const sheetCellText = cell => cell?.formula ?? (cell?.value == null ? "" : String(cell.value));
export const sheetCellSource = cell => cell ? { id: cell.id, ...(cell.formula !== undefined ? { formula: cell.formula } : { value: cell.value }) } : null;

export function pendingSheetCellSnapshot(value) {
  if (value == null) return null;
  if (value.kind !== "sheet-cell" || !id(value.sheetId) || !id(value.cellId) || typeof value.address !== "string" || !/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(value.address) || !cellPosition(value.address)
    || typeof value.text !== "string" || value.text.length > 16000) throw new Error("SHEET_CELL_DRAFT_INVALID");
  const source = value.original;
  if (source !== null && (!source || source.id !== value.cellId || (source.formula !== undefined ? typeof source.formula !== "string" || source.formula.length > 2000 || source.value !== undefined
    : !(source.value === null || typeof source.value === "boolean" || typeof source.value === "string" && source.value.length <= 16000 || typeof source.value === "number" && Number.isFinite(source.value))))) throw new Error("SHEET_CELL_DRAFT_INVALID");
  return { kind: "sheet-cell", sheetId: value.sheetId, address: value.address, cellId: value.cellId, original: sheetCellSource(source), text: value.text, composing: Boolean(value.composing) };
}

export function pendingSheetCellOperations(content, input) {
  const draft = pendingSheetCellSnapshot(input);
  if (!draft) return [];
  if (draft.composing) throw new Error("TEXT_COMPOSITION_ACTIVE");
  const sheet = content?.kind === "sheet" && content.sheets.find(sheet => sheet.id === draft.sheetId);
  if (!sheet) throw new Error("SHEET_CELL_CHANGED");
  const current = sheet.cells.find(cell => cell.address === draft.address);
  // A successful operation followed by a failed draft-clear is safe to retry.
  if (current?.id === draft.cellId && sheetCellText(current) === draft.text) return [];
  if (JSON.stringify(sheetCellSource(current)) !== JSON.stringify(draft.original)) throw new Error("SHEET_CELL_CHANGED");
  if (sheetCellText(current) === draft.text) return [];
  let next = { value: draft.text };
  if (draft.text.startsWith("=")) next = { formula: draft.text };
  else if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(draft.text.trim()) && Number.isFinite(Number(draft.text))) next = { value: Number(draft.text) };
  const expected = current?.formula !== undefined ? { expectedFormula: current.formula } : current ? { expectedValue: current.value } : {};
  try { return sheetOperationSchema.parse([{ op: "setCell", sheetId: sheet.id, address: draft.address, id: draft.cellId, ...next, ...expected }]); }
  catch { throw new Error("SHEET_CELL_INPUT_INVALID"); }
}
