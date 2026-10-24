import { sheetSchema, workbookSchema } from "./contracts/sheet.js";
import { columnName, parseSheetFormula } from "./sheet-formula.js";

// Server-side subset for validation/export caches, not a complete Excel engine.
const error = code => ({ error: code });
const isError = value => value !== null && typeof value === "object" && typeof value.error === "string";
const numeric = value => {
  if (isError(value)) return value;
  if (value === null || value === "") return 0;
  const result = Number(value);
  return Number.isFinite(result) ? result : error("#VALUE!");
};
const finite = value => Number.isFinite(value) ? value : error("#NUM!");
const compareValues = (a, b) => {
  const rank = value => typeof value === "boolean" ? 2 : typeof value === "string" ? 1 : 0;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  const left = typeof a === "string" ? a.toLowerCase() : (a ?? 0), right = typeof b === "string" ? b.toLowerCase() : (b ?? 0);
  return left === right ? 0 : left < right ? -1 : 1;
};

export function calculateWorkbook(input, { maxOperations = 200000, maxRangeCells = 10000, maxDependencyDepth = 128 } = {}) {
  const workbook = workbookSchema.parse(input);
  let operations = 0;
  const spend = (amount = 1) => { operations += amount; if (operations > maxOperations) throw new Error("SHEET_CALCULATION_LIMIT"); };
  const states = workbook.sheets.map(sheet => ({ sheet, cells: new Map(sheet.cells.map(cell => [cell.address, cell])), cache: new Map(), active: new Set() }));
  const names = new Map(states.map((state, index) => [state.sheet.name.toLowerCase(), index]));
  function reference(node, index, depth) {
    const target = node.sheet === null ? index : names.get(node.sheet.toLowerCase());
    if (target === undefined) return error("#REF!");
    const left = Math.min(node.start.column, node.end.column), right = Math.max(node.start.column, node.end.column);
    const top = Math.min(node.start.row, node.end.row), bottom = Math.max(node.start.row, node.end.row);
    const size = (right - left + 1) * (bottom - top + 1);
    if (size > maxRangeCells) throw new Error("SHEET_CALCULATION_LIMIT");
    if (!node.range) return resolve(target, node.start.address, depth);
    const values = [];
    for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++) values.push(resolve(target, `${columnName(column)}${row}`, depth));
    return { range: values, rows: bottom - top + 1, columns: right - left + 1 };
  }
  const scalar = value => value?.range ? error("#VALUE!") : value;
  function evaluate(node, index, depth) {
    spend();
    if (node.type === "literal") return node.value;
    if (node.type === "reference") return reference(node, index, depth);
    if (node.type === "unary" || node.type === "percent") {
      const value = numeric(scalar(evaluate(node.value, index, depth)));
      return isError(value) ? value : finite(node.type === "percent" ? value / 100 : node.op === "-" ? -value : value);
    }
    if (node.type === "binary") {
      const a = scalar(evaluate(node.left, index, depth)), b = scalar(evaluate(node.right, index, depth));
      if (isError(a) || isError(b)) return isError(a) ? a : b;
      if (["=", "<>", ">", "<", ">=", "<="].includes(node.op)) {
        const comparison = compareValues(a, b);
        return { "=": comparison === 0, "<>": comparison !== 0, ">": comparison > 0, "<": comparison < 0, ">=": comparison >= 0, "<=": comparison <= 0 }[node.op];
      }
      const left = numeric(a), right = numeric(b);
      if (isError(left) || isError(right)) return isError(left) ? left : right;
      if (node.op === "/" && right === 0) return error("#DIV/0!");
      return finite(node.op === "+" ? left + right : node.op === "-" ? left - right : node.op === "*" ? left * right : left / right);
    }
    if (node.name === "IF") {
      const condition = numeric(scalar(evaluate(node.args[0], index, depth)));
      return isError(condition) ? condition : evaluate(node.args[condition ? 1 : 2], index, depth);
    }
    if (node.name === "LOOKUP") {
      const key = scalar(evaluate(node.args[0], index, depth)), keys = evaluate(node.args[1], index, depth), values = evaluate(node.args[2], index, depth);
      if (isError(key) || isError(keys) || isError(values)) return [key, keys, values].find(isError);
      if (!keys?.range || !values?.range || (keys.rows > 1 && keys.columns > 1) || (values.rows > 1 && values.columns > 1) || keys.range.length !== values.range.length) return error("#N/A");
      let chosen = -1;
      for (let i = 0; i < keys.range.length; i++) {
        spend(); const current = keys.range[i];
        if (isError(current) || (i && compareValues(keys.range[i - 1], current) > 0)) return error("#N/A");
        if (typeof current === typeof key && compareValues(current, key) <= 0) chosen = i;
      }
      return chosen < 0 ? error("#N/A") : values.range[chosen];
    }
    const numbers = [];
    for (const arg of node.args) {
      const result = evaluate(arg, index, depth), referenced = arg.type === "reference";
      for (const value of result?.range ?? [result]) {
        spend();
        if (isError(value)) { if (node.name !== "COUNT") return value; continue; }
        if (typeof value === "number") numbers.push(value);
        else if (!referenced && value !== null) {
          const converted = numeric(value);
          if (!isError(converted)) numbers.push(converted);
          else if (node.name !== "COUNT") return converted;
        }
      }
    }
    if (node.name === "COUNT") return numbers.length;
    if (node.name === "AVERAGE" && !numbers.length) return error("#DIV/0!");
    if (!numbers.length) return 0;
    if (node.name === "MIN") return numbers.reduce((a, b) => Math.min(a, b));
    if (node.name === "MAX") return numbers.reduce((a, b) => Math.max(a, b));
    const sum = numbers.reduce((a, b) => a + b, 0);
    return finite(node.name === "AVERAGE" ? sum / numbers.length : sum);
  }
  function resolve(index, address, depth = 0) {
    spend(); const state = states[index];
    if (state.cache.has(address)) return state.cache.get(address);
    if (state.active.has(address)) return error("#REF!");
    if (depth >= maxDependencyDepth) throw new Error("SHEET_CALCULATION_LIMIT");
    const cell = state.cells.get(address); if (!cell) return null;
    state.active.add(address);
    try {
      const result = cell.formula ? scalar(evaluate(parseSheetFormula(cell.formula), index, depth + 1)) : cell.value;
      // Excel evaluates a formula pointing to an empty cell as numeric zero.
      const value = cell.formula && result === null ? 0 : result;
      state.cache.set(address, value); return value;
    } finally { state.active.delete(address); }
  }
  return { ...workbook, sheets: states.map((state, index) => ({ ...state.sheet, cells: state.sheet.cells.map(cell => {
    const calculated = resolve(index, cell.address);
    return { ...cell, calculated, display: isError(calculated) ? calculated.error : calculated === null ? "" : String(calculated) };
  }) })) };
}
export function calculateSheet(input) {
  const sheet = sheetSchema.parse(input);
  return calculateWorkbook({ schemaVersion: 1, kind: "sheet", title: sheet.name, sheets: [sheet] }).sheets[0];
}
