import { parse, serialize } from "parse5";
import { walkHtml, HTML_PAGE_BYTES, HtmlDocumentError } from "./document.js";

function withoutCssComments(css) {
  let result = "", quote = null;
  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    if (quote) {
      result += char;
      if (char === "\\" && i + 1 < css.length) result += css[++i];
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") { quote = char; result += char; }
    else if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) throw new HtmlDocumentError("HTML_UNSAFE_STYLE");
      result += " "; i = end + 1;
    } else result += char;
  }
  return result;
}

// Only generated pages have no pre-existing selection/identity contract.
// Normalize harmless model formatting, then run the unchanged safety parser.
// Never apply this to user edits, where node IDs and outside-scope CSS matter.
export function normalizeGeneratedHtml(html) {
  if (typeof html !== "string" || new TextEncoder().encode(html).length > HTML_PAGE_BYTES) return html;
  const tree = parse(html), ids = new Set();
  walkHtml(tree, node => {
    const id = node.attrs?.find(attr => attr.name === "data-node-id");
    if (id) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id.value) || ids.has(id.value)) node.attrs = node.attrs.filter(attr => attr !== id);
      else ids.add(id.value);
    }
    for (const attr of node.attrs || []) if (attr.name === "style") attr.value = withoutCssComments(attr.value);
    if (node.tagName === "style") for (const child of node.childNodes || []) if (child.nodeName === "#text") child.value = withoutCssComments(child.value);
  });
  return serialize(tree);
}
