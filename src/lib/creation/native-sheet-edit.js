import { nativeSheetCellsSchema, nativeSheetOperationsSchema, nativeSheetTargetSchema } from "./contracts/native-sheet-edit.js";
import { assertNativeOfficeRuntimeContent } from "./client/native-office-policy.js";
import { nativeOfficeArtifactSchema } from "./contracts/native-office.js";
import { columnName, parseSheetFormula } from "./sheet-formula.js";

export class NativeSheetEditError extends Error {
  constructor(code) { super(code); this.name = "NativeSheetEditError"; this.code = code; }
}
const fail = code => { throw new NativeSheetEditError(code); };
const key = cell => `${cell.row}:${cell.column}`;
const arrayKeys = ["si", "ref", "xf"];

// A scalar-only subset of the existing grammar: ranges are allowed as inputs
// to aggregates/LOOKUP, never returned or used in array arithmetic. No engine
// or evaluator runs on the server. Bound total referenced area before invoking
// a model or loading its result into the browser formula worker.
function checkFormula(formula, snapshot, activeSheet, budget) {
  let ast;
  try { ast = parseSheetFormula(formula); } catch { fail("NATIVE_SHEET_AI_FORMULA_UNSUPPORTED"); }
  budget.characters += formula.length;
  if (budget.characters > 128000) fail("NATIVE_SHEET_AI_FORMULA_LIMIT");
  const visit = (node, rangeAllowed = false) => {
    if (node.type === "reference") {
      const sheet = node.sheet === null ? activeSheet : Object.values(snapshot.sheets).find(sheet => sheet.name.toLowerCase() === node.sheet.toLowerCase());
      if (!sheet || Math.max(node.start.row, node.end.row) > sheet.rowCount || Math.max(node.start.column, node.end.column) > sheet.columnCount
        || node.range && !rangeAllowed) fail("NATIVE_SHEET_AI_FORMULA_UNSUPPORTED");
      budget.cells += (Math.abs(node.start.row - node.end.row) + 1) * (Math.abs(node.start.column - node.end.column) + 1);
      if (budget.cells > 100000) fail("NATIVE_SHEET_AI_FORMULA_LIMIT");
    } else if (node.type === "call") {
      node.args.forEach((arg, index) => visit(arg, node.name !== "IF" && (node.name !== "LOOKUP" || index > 0)));
    } else if (node.type === "binary") { visit(node.left); visit(node.right); }
    else if (node.type !== "literal") visit(node.value);
  };
  visit(ast);
}

function admittedSource(source) {
  if (source?.kind !== "sheet" || source.schemaVersion !== 2) fail("LANGUAGE_SOURCE_MISMATCH");
  const content = assertNativeOfficeRuntimeContent(source), { snapshot } = content;
  // Runtime permissions are plugin-owned. Until their server semantics are
  // implemented, never bypass them, including protection on another worksheet.
  for (const resource of snapshot.resources || []) {
    if (resource.name !== "SHEET_RANGE_THEME_MODEL_PLUGIN" && resource.data && Object.keys(JSON.parse(resource.data)).length) fail("NATIVE_SHEET_AI_PROTECTED");
  }
  const budget = { cells: 0, characters: 0 };
  for (const sheet of Object.values(snapshot.sheets)) for (const row of Object.values(sheet.cellData)) for (const cell of Object.values(row)) {
    // Array/shared formulas can cover blank cells outside their stored anchor.
    if (cell && (arrayKeys.some(field => cell[field] != null && cell[field] !== "") || cell.ft != null && cell.ft !== 0 || cell.fd != null && cell.fd !== 0)) fail("NATIVE_SHEET_AI_FORMULA_UNSUPPORTED");
    if (cell?.f) checkFormula(cell.f, snapshot, sheet, budget);
  }
  return { content, budget };
}

function selection(input, content) {
  const { snapshot } = content, sheet = snapshot.sheets[input.sheetId];
  if (input.unitId !== snapshot.id || !sheet || !snapshot.sheetOrder.includes(input.sheetId)) fail("LANGUAGE_SELECTION_CHANGED");
  const cells = nativeSheetCellsSchema.parse(input.cells);
  let contextBytes = 0;
  for (const { row, column } of cells) {
    if (row >= sheet.rowCount || column >= sheet.columnCount) fail("LANGUAGE_SELECTION_CHANGED");
    // Do not flatten rich-text cells or silently change only the anchor of a
    // merged range. Both need separate commands with dedicated scope rules.
    if (sheet.cellData[row]?.[column]?.p != null) fail("NATIVE_SHEET_AI_RICH_CELL");
    if ((sheet.mergeData || []).some(range => row >= range.startRow && row <= range.endRow && column >= range.startColumn && column <= range.endColumn)) fail("NATIVE_SHEET_AI_MERGED_CELL");
    const cell = sheet.cellData[row]?.[column], value = cell?.f || cell?.v;
    if (value != null && !["string", "number", "boolean"].includes(typeof value)) fail("NATIVE_SHEET_AI_RICH_CELL");
    contextBytes += typeof value === "string" ? new TextEncoder().encode(value).byteLength : 16;
    if (contextBytes > 64000) fail("LANGUAGE_CONTEXT_TOO_LARGE");
  }
  return { sheet, selected: new Set(cells.map(key)), cells };
}

export function validateNativeSheetSelection(input, source) {
  const { content } = admittedSource(source);
  return selection(input, content);
}

export function nativeSheetPromptSource(input, source) {
  const { sheet, cells } = validateNativeSheetSelection(input, source);
  return { title: source.title, sheetId: sheet.id, sheetName: sheet.name, cells: cells.map(({ row, column }) => {
    const cell = sheet.cellData[row]?.[column];
    return { row, column, address: `${columnName(column + 1)}${row + 1}`, ...(cell?.f ? { formula: cell.f } : { value: cell?.v ?? null }) };
  }) };
}

export function applyNativeSheetOperations(source, rawOperations, scope) {
  const { content, budget } = admittedSource(source), operations = nativeSheetOperationsSchema.parse(rawOperations);
  const selected = scope ? selection(scope, content).selected : null;
  const seen = new Set();
  for (const op of operations) {
    if (scope && (op.sheetId !== scope.sheetId || !selected.has(key(op)))) fail("LANGUAGE_EDIT_OUTSIDE_SCOPE");
    const commandKey = `${op.sheetId}:${key(op)}:${op.op}`;
    if (seen.has(commandKey)) fail("NATIVE_SHEET_DUPLICATE_OPERATION");
    seen.add(commandKey);
    // Check every modified cell even for internal callers without a scope.
    const { sheet } = selection({ unitId: content.snapshot.id, sheetId: op.sheetId, cells: [{ row: op.row, column: op.column }] }, content);
    if (op.formula !== undefined) checkFormula(op.formula, content.snapshot, sheet, budget);
    if (op.op === "styleNativeCell") {
      const style = sheet.cellData[op.row]?.[op.column]?.s;
      if (typeof style === "string" && !Object.hasOwn(content.snapshot.styles, style)) fail("NATIVE_SHEET_AI_STYLE_UNSUPPORTED");
      const resolved = typeof style === "string" ? content.snapshot.styles[style] : style ?? {};
      if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) fail("NATIVE_SHEET_AI_STYLE_UNSUPPORTED");
    }
  }
  const next = structuredClone(content);
  for (const op of operations) {
    const sheet = next.snapshot.sheets[op.sheetId];
    sheet.cellData[op.row] ??= {};
    const cell = sheet.cellData[op.row][op.column] ??= {};
    if (op.op === "setNativeCell") {
      // Keep cell styles/custom metadata. Rich text and array metadata were
      // rejected above; cached formula values must not survive a new formula.
      delete cell.f; delete cell.v; delete cell.t;
      if (op.formula !== undefined) cell.f = op.formula;
      else { cell.v = op.value; if (op.value !== null) cell.t = typeof op.value === "string" ? 1 : typeof op.value === "number" ? 2 : 3; }
    } else {
      // Copy the resolved style onto this cell, never mutate a shared style ID.
      const style = structuredClone(typeof cell.s === "string" ? next.snapshot.styles[cell.s] : cell.s || {});
      if (op.style.bold !== undefined) style.bl = Number(op.style.bold);
      if (op.style.italic !== undefined) style.it = Number(op.style.italic);
      if (op.style.color !== undefined) style.cl = { rgb: op.style.color };
      if (op.style.background !== undefined) style.bg = { rgb: op.style.background };
      cell.s = style;
    }
  }
  return nativeOfficeArtifactSchema.parse(next);
}

export function nativeSheetCellsFromRange(range) {
  if (!range || ![range.startRow, range.endRow, range.startColumn, range.endColumn].every(Number.isSafeInteger)
    || range.startRow < 0 || range.startColumn < 0 || range.endRow < range.startRow || range.endColumn < range.startColumn
    || range.endRow >= 100000 || range.endColumn >= 1024
    || (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1) > 100) fail("NATIVE_SHEET_AI_SELECTION_LIMIT");
  const cells = [];
  for (let row = range.startRow; row <= range.endRow; row++) for (let column = range.startColumn; column <= range.endColumn; column++) cells.push({ row, column });
  return cells;
}

export function nativeSheetTargetFromReference(reference, saved, artifactId) {
  // Row/column coordinates are not stable through inserts, sorts and deletes.
  // Require a new explicit reference after any revision change; never guess.
  if (reference.artifactId !== artifactId || reference.baseRevision !== saved.revision) fail("LANGUAGE_SELECTION_CHANGED");
  const { format, unitId, sheetId, cells } = reference;
  const target = nativeSheetTargetSchema.parse({ format, unitId, sheetId, cells, artifactId, baseRevision: saved.revision });
  validateNativeSheetSelection(target, saved.content);
  return target;
}
