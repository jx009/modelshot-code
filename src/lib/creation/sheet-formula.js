// Deliberately small formula grammar. Never executes JavaScript or external calls.
export const SHEET_FUNCTIONS = new Set(["SUM", "AVERAGE", "MIN", "MAX", "COUNT", "IF", "LOOKUP"]);
export function columnName(column) {
  let result = "";
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
}
export function cellPosition(address) {
  const match = /^\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6})$/i.exec(address);
  if (!match) return null;
  const column = [...match[1].toUpperCase()].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0), row = Number(match[2]);
  return column <= 16384 && row <= 1048576 ? { column, row, address: `${columnName(column)}${row}` } : null;
}
export function parseSheetFormula(formula) {
  const fail = () => { throw new Error("SHEET_FORMULA_UNSUPPORTED"); };
  if (typeof formula !== "string" || !formula.startsWith("=") || formula.length > 2000) fail();
  const tokens = []; let offset = 1;
  while (offset < formula.length) {
    const rest = formula.slice(offset); let match;
    if (/^\s/.test(rest)) { offset++; continue; }
    if ((match = /^(?:"(?:[^"]|"")*"|'(?:[^']|'')*')/.exec(rest))) {
      tokens.push({ type: rest[0] === '"' ? "string" : "sheet", value: match[0].slice(1, -1).replace(rest[0] === '"' ? /""/g : /''/g, rest[0]) });
    } else if ((match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/.exec(rest))) {
      if (!Number.isFinite(Number(match[0]))) fail();
      tokens.push({ type: "number", value: Number(match[0]) });
    } else if ((match = /^\$?[A-Za-z_][A-Za-z0-9_.$]*/.exec(rest))) tokens.push({ type: "name", value: match[0] });
    else if ((match = /^(?:>=|<=|<>|[+\-*/%=<>(),:!])/.exec(rest))) tokens.push({ type: match[0], value: match[0] });
    else fail();
    offset += match[0].length;
    if (tokens.length > 512) fail();
  }
  let cursor = 0, depth = 0;
  const peek = type => tokens[cursor]?.type === type;
  const take = type => { if (!peek(type)) fail(); return tokens[cursor++]; };
  function primary() {
    if (++depth > 64) fail();
    let node;
    if (peek("+") || peek("-")) node = { type: "unary", op: tokens[cursor++].type, value: primary() };
    else if (peek("(")) { cursor++; node = compare(); take(")"); }
    else if (peek("number") || peek("string")) node = { type: "literal", value: tokens[cursor++].value };
    else if (peek("name") || peek("sheet")) {
      const token = tokens[cursor++], name = token.value, upper = name.toUpperCase();
      if (peek("(") && token.type === "name") {
        if (!SHEET_FUNCTIONS.has(upper)) fail();
        cursor++; const args = [];
        if (!peek(")")) { args.push(compare()); while (peek(",")) { cursor++; args.push(compare()); } }
        take(")");
        if (!args.length || ((upper === "IF" || upper === "LOOKUP") && args.length !== 3)) fail();
        node = { type: "call", name: upper, args };
      } else if (!peek("!") && token.type === "name" && ["TRUE", "FALSE"].includes(upper)) node = { type: "literal", value: upper === "TRUE" };
      else {
        let sheet = null, address = name;
        if (peek("!")) { cursor++; sheet = name; address = take("name").value; }
        else if (token.type === "sheet") fail();
        const start = cellPosition(address); if (!start) fail();
        let end = start;
        if (peek(":")) { cursor++; end = cellPosition(take("name").value); if (!end) fail(); }
        node = { type: "reference", sheet, start, end, range: start !== end };
      }
    } else fail();
    while (peek("%")) { cursor++; node = { type: "percent", value: node }; }
    depth--; return node;
  }
  function multiply() { let node = primary(); while (peek("*") || peek("/")) node = { type: "binary", op: tokens[cursor++].type, left: node, right: primary() }; return node; }
  function add() { let node = multiply(); while (peek("+") || peek("-")) node = { type: "binary", op: tokens[cursor++].type, left: node, right: multiply() }; return node; }
  function compare() { let node = add(); while (["=", "<>", "<", ">", "<=", ">="].includes(tokens[cursor]?.type)) node = { type: "binary", op: tokens[cursor++].type, left: node, right: add() }; return node; }
  const ast = compare(); if (cursor !== tokens.length) fail(); return ast;
}
