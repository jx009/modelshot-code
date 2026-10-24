import { parseSheetFormula } from "./sheet-formula.js";
export class SheetOperationError extends Error { constructor(code) { super(code); this.name = "SheetOperationError"; this.code = code; } }
const fail = code => { throw new SheetOperationError(code); };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function sheetFor(book, id) { const index = book.sheets.findIndex(sheet => sheet.id === id); if (index < 0) fail("SHEET_NOT_FOUND"); return [index, book.sheets[index]]; }
function current(sheet, address) { return sheet.cells.find(cell => cell.address === address); }
function assertExpected(cell, op) {
  if (op.expectedValue !== undefined && !same(cell?.value, op.expectedValue)) fail("SHEET_CELL_CHANGED");
  if (op.expectedFormula !== undefined && cell?.formula !== op.expectedFormula) fail("SHEET_CELL_CHANGED");
}
function referencesSheet(node, name) {
  if (node.type === "reference") return node.sheet?.toLowerCase() === name;
  if (node.type === "call") return node.args.some(arg => referencesSheet(arg, name));
  if (node.type === "binary") return referencesSheet(node.left, name) || referencesSheet(node.right, name);
  return node.value && typeof node.value === "object" ? referencesSheet(node.value, name) : false;
}
export function applySheetOperation(book, op) {
  if (op.op === "renameSheet") {
    const [index, source] = sheetFor(book, op.sheetId);
    if (book.sheets.some((sheet, i) => i !== index && sheet.name.toLowerCase() === op.name.toLowerCase())) fail("SHEET_DUPLICATE_SHEET");
    // Native editor will rewrite references. Until then refuse a rename that
    // would break formulas rather than persisting silently corrupted references.
    if (source.name.toLowerCase() !== op.name.toLowerCase() && book.sheets.some(sheet => sheet.cells.some(cell => cell.formula && referencesSheet(parseSheetFormula(cell.formula), source.name.toLowerCase())))) fail("SHEET_RENAME_REFERENCED");
    const sheets = [...book.sheets]; sheets[index] = { ...source, name: op.name }; return { ...book, sheets };
  }
  const [index, source] = sheetFor(book, op.sheetId);
  if (op.op === "setFreeze") { const sheets = [...book.sheets]; sheets[index] = { ...source, freezeRows: op.freezeRows, freezeColumns: op.freezeColumns }; return { ...book, sheets }; }
  const existing = current(source, op.address), cells = [...source.cells];
  if (op.op === "setCellStyle") { if (!existing) fail("SHEET_CELL_NOT_FOUND"); const position = cells.indexOf(existing); cells[position] = { ...existing, style: op.style }; }
  else if (op.op === "clearCell") { assertExpected(existing, op); if (!existing) fail("SHEET_CELL_NOT_FOUND"); cells.splice(cells.indexOf(existing), 1); }
  else if (op.op === "setCell") {
    assertExpected(existing, op);
    if (source.cells.some(cell => cell.id === op.id && cell.address !== op.address)) fail("SHEET_DUPLICATE_CELL");
    if (existing && existing.id !== op.id) fail("SHEET_CELL_IDENTITY_CHANGED");
    const next = { id: op.id, address: op.address, ...(op.value !== undefined ? { value: op.value } : { formula: op.formula }), style: op.style ?? existing?.style ?? {} };
    if (existing) cells[cells.indexOf(existing)] = next;
    else { if (book.sheets.reduce((sum, sheet) => sum + sheet.cells.length, 0) >= 100000) fail("SHEET_CELL_LIMIT"); cells.push(next); }
  } else fail("UNKNOWN_SHEET_OPERATION");
  // Full schema validation belongs at the storage/result boundary, not once
  // per keystroke/operation. Untouched sheets and cells retain their identity.
  const sheets = [...book.sheets]; sheets[index] = { ...source, cells }; return { ...book, sheets };
}
export function applySheetOperations(book, operations) { return operations.reduce(applySheetOperation, book); }
export function applySheetWithInverse(book, operations) {
  let currentBook = book, inverse = [];
  for (const op of operations) {
    const [, sheet] = sheetFor(currentBook, op.sheetId); const old = op.address ? current(sheet, op.address) : null;
    currentBook = applySheetOperation(currentBook, op);
    if (op.op === "renameSheet") inverse.unshift({ op: "renameSheet", sheetId: op.sheetId, name: sheet.name });
    else if (op.op === "setFreeze") inverse.unshift({ op: "setFreeze", sheetId: op.sheetId, freezeRows: sheet.freezeRows, freezeColumns: sheet.freezeColumns });
    else if (op.op === "setCellStyle") inverse.unshift(old ? { op: "setCellStyle", sheetId: op.sheetId, address: op.address, style: old.style } : { op: "clearCell", sheetId: op.sheetId, address: op.address });
    else if (op.op === "clearCell") inverse.unshift(old ? { op: "setCell", sheetId: op.sheetId, address: op.address, id: old.id, ...(old.formula ? { formula: old.formula } : { value: old.value }), style: old.style } : op);
    else inverse.unshift(old ? { op: "setCell", sheetId: op.sheetId, address: op.address, id: old.id, ...(old.formula ? { formula: old.formula } : { value: old.value }), style: old.style } : { op: "clearCell", sheetId: op.sheetId, address: op.address });
  }
  return { workbook: currentBook, inverse };
}
