import { rewriteModuleReferences } from "./web-modules.js";
import { parse } from "parse5";
import { rewriteCssReferences, replaceSourceRanges } from "./web-reference-css.js";

const fail = code => { throw new Error(code); };
const escapeAttribute = value => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function srcset(value, rewrite) {
  const changes = []; let position = 0;
  while (position < value.length) {
    while (position < value.length && /[\t\n\r\f ,]/.test(value[position])) position++;
    const start = position;
    while (position < value.length && !/[\t\n\r\f ]/.test(value[position])) position++;
    let end = position;
    while (end > start && value[end - 1] === ",") end--;
    const url = value.slice(start, end), replacement = rewrite(url);
    if (url !== replacement) changes.push({ start, end, value: replacement });
    if (end < position) continue;
    let parentheses = 0;
    while (position < value.length) {
      const char = value[position++];
      if (char === "(") parentheses++;
      else if (char === ")") parentheses--;
      else if (char === "," && !parentheses) break;
    }
  }
  return replaceSourceRanges(value, changes);
}
export function rewriteHtmlReferences(source, rewrite, budget = { nodes: 0 }, rewriteModule) {
  let invalid = false;
  const tree = parse(source, { sourceCodeLocationInfo: true, scriptingEnabled: false, onParseError: error => { if (error.code !== "missing-doctype") invalid = true; } });
  if (invalid) fail("WEB_VISUAL_MARKUP_INVALID");
  const changes = []; let count = 0;
  function walk(node, depth = 0) {
    if (++count > 20000 || ++budget.nodes > 100000 || depth > 100) fail("WEB_PREVIEW_COMPLEXITY_LIMIT");
    const location = node.sourceCodeLocation;
    for (const attr of node.attrs || []) {
      const name = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name;
      let value = attr.value;
      if (["href", "src", "poster", "action", "formaction", "xlink:href"].includes(name)) value = rewrite(value);
      else if (name === "srcset" || name === "imagesrcset") value = srcset(value, rewrite);
      else if (name === "style") value = rewriteCssReferences(value, rewrite);
      if (value !== attr.value) {
        const range = location?.attrs?.[name]; if (!range) fail("WEB_REFERENCE_RANGE_INVALID");
        changes.push({ start: range.startOffset, end: range.endOffset, value: `${name}="${escapeAttribute(value)}"` });
      }
    }
    if (rewriteModule && node.tagName === "script" && node.attrs?.some(attr => attr.name === "type" && attr.value === "module") && !node.attrs.some(attr => attr.name === "src")) {
      if (!location?.startTag || !location?.endTag) fail("WEB_REFERENCE_RANGE_INVALID");
      const start = location.startTag.endOffset, end = location.endTag.startOffset;
      const next = rewriteModuleReferences(source.slice(start, end), rewriteModule);
      if (next !== source.slice(start, end)) changes.push({ start, end, value: next.replace(/<\/script/gi, match => `<\\${match.slice(1)}`) });
    }
    if (node.tagName === "style") {
      if (!location?.startTag || !location?.endTag) fail("WEB_REFERENCE_RANGE_INVALID");
      const start = location.startTag.endOffset, end = location.endTag.startOffset, css = source.slice(start, end), next = rewriteCssReferences(css, rewrite);
      if (next !== css) changes.push({ start, end, value: next });
    }
    for (const child of node.childNodes || []) walk(child, depth + 1);
    if (node.content) walk(node.content, depth + 1);
  }
  walk(tree); return replaceSourceRanges(source, changes);
}
