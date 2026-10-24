const fail = () => { throw new Error("WEB_REFERENCE_CSS_UNSUPPORTED"); };
const whitespace = character => /[\t\n\r\f ]/.test(character || "");
function escape(source, start) {
  let end = start + 1;
  if (end >= source.length) fail();
  if (source[end] === "\n" || source[end] === "\f") return { value: "", end: end + 1 };
  if (source[end] === "\r") return { value: "", end: end + (source[end + 1] === "\n" ? 2 : 1) };
  if (/[a-fA-F0-9]/.test(source[end])) {
    const begin = end;
    while (end < source.length && end - begin < 6 && /[a-fA-F0-9]/.test(source[end])) end++;
    const point = parseInt(source.slice(begin, end), 16);
    if (whitespace(source[end])) { if (source[end] === "\r" && source[end + 1] === "\n") end++; end++; }
    return { value: point === 0 || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff ? "\ufffd" : String.fromCodePoint(point), end };
  }
  return { value: source[end], end: end + 1 };
}
function string(source, start) {
  const quote = source[start]; let end = start + 1, value = "";
  while (end < source.length && source[end] !== quote) {
    if (/[\n\r\f]/.test(source[end])) fail();
    if (source[end] === "\\") { const escaped = escape(source, end); value += escaped.value; end = escaped.end; }
    else value += source[end++];
  }
  if (source[end] !== quote) fail();
  return { value, end: end + 1 };
}
function trivia(source, start) {
  let end = start;
  while (end < source.length) {
    if (whitespace(source[end])) { end++; continue; }
    if (source.startsWith("/*", end)) { const close = source.indexOf("*/", end + 2); if (close < 0) fail(); end = close + 2; continue; }
    break;
  }
  return end;
}
const quote = value => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/</g, "\\3c ")}"`;
export function replaceSourceRanges(source, changes) {
  const parts = []; let position = 0;
  for (const change of changes.sort((a, b) => a.start - b.start)) {
    if (change.start < position || change.end > source.length || change.end < change.start) throw new Error("WEB_REFERENCE_RANGE_INVALID");
    parts.push(source.slice(position, change.start), change.value); position = change.end;
  }
  parts.push(source.slice(position)); return parts.join("");
}
// A bounded CSS token walk distinguishes URLs from ordinary quoted strings
// and comments. It never evaluates CSS or attaches it to a document.
export function rewriteCssReferences(source, rewrite) {
  const changes = [], stack = []; let position = 0;
  while (position < source.length) {
    const next = trivia(source, position);
    if (next !== position) { position = next; continue; }
    const char = source[position];
    if (char === '"' || char === "'") {
      const token = string(source, position);
      if (["image-set", "-webkit-image-set"].includes(stack.at(-1))) {
        const value = rewrite(token.value);
        if (value !== token.value) changes.push({ start: position, end: token.end, value: quote(value) });
      }
      position = token.end; continue;
    }
    if (/[-_a-zA-Z0-9\\\u0080-\uffff]/.test(char)) {
      let name = "", end = position;
      while (end < source.length && /[-_a-zA-Z0-9\\\u0080-\uffff]/.test(source[end])) {
        if (source[end] === "\\") { const escaped = escape(source, end); name += escaped.value; end = escaped.end; }
        else name += source[end++];
      }
      if (source[end] !== "(") { position = end; continue; }
      name = name.toLowerCase();
      if (name !== "url") { stack.push(name); if (stack.length > 100) fail(); position = end + 1; continue; }
      let cursor = end + 1, value = "";
      while (whitespace(source[cursor])) cursor++;
      if (source[cursor] === '"' || source[cursor] === "'") {
        const token = string(source, cursor); value = token.value; cursor = trivia(source, token.end);
      } else {
        while (cursor < source.length && source[cursor] !== ")" && !whitespace(source[cursor])) {
          if (source[cursor] === "\\") { const escaped = escape(source, cursor); value += escaped.value; cursor = escaped.end; }
          else { if (/[('"\x00-\x1f\x7f]/.test(source[cursor])) fail(); value += source[cursor++]; }
        }
        while (whitespace(source[cursor])) cursor++;
      }
      if (source[cursor] !== ")") fail();
      const replacement = rewrite(value);
      if (replacement !== value) changes.push({ start: position, end: cursor + 1, value: `url(${quote(replacement)})` });
      position = cursor + 1; continue;
    }
    if (char === "(") { stack.push(""); if (stack.length > 100) fail(); }
    else if (char === ")") stack.pop();
    position++;
  }
  return replaceSourceRanges(source, changes);
}
