import { parse } from "parse5";
import { webResourcePath } from "../web-resource-path.js";
import { rewriteCssReferences, replaceSourceRanges } from "../web-reference-css.js";
import { validateNewWebPath } from "./web-files.js";

const fail = code => { throw new Error(code); };
const escapeAttribute = value => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function relativePath(from, destination) {
  const base = from.split("/").slice(0, -1), target = destination.split("/");
  let shared = 0;
  while (shared < base.length && shared < target.length && base[shared] === target[shared]) shared++;
  return [...base.slice(shared).map(() => ".."), ...target.slice(shared)].join("/") || "./";
}
export function webReferenceRewrite(reference, from, nextFrom, oldPath, nextPath) {
  const value = reference.trim();
  if (!value || value.startsWith("#") || value.startsWith("?") || value === "/" || value.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return reference;
  const suffixAt = value.search(/[?#]/), pathname = suffixAt < 0 ? value : value.slice(0, suffixAt), suffix = suffixAt < 0 ? "" : value.slice(suffixAt);
  if (pathname === "/") return reference;
  // Only URL-encoded unreserved characters can name our portable files. Do
  // not reinterpret encoded slashes, backslashes or arbitrary URL syntax.
  let decoded = pathname;
  try { decoded = pathname.replace(/%([a-fA-F0-9]{2})/g, (_match, hex) => { const char = String.fromCharCode(parseInt(hex, 16)); if (!/[a-zA-Z0-9_.-]/.test(char)) fail("WEB_REFERENCE_PATH_UNSUPPORTED"); return char; }); }
  catch { fail("WEB_REFERENCE_PATH_UNSUPPORTED"); }
  const destination = webResourcePath(decoded, from);
  if (!destination) fail("WEB_REFERENCE_PATH_UNSUPPORTED");
  const nextDestination = destination === oldPath ? nextPath : destination;
  const sameDirectory = from.split("/").slice(0, -1).join("/") === nextFrom.split("/").slice(0, -1).join("/");
  if (nextDestination === destination && (sameDirectory || pathname.startsWith("/"))) return reference;
  let next = pathname.startsWith("/") ? `/${nextDestination}` : relativePath(nextFrom, nextDestination);
  if (pathname.endsWith("/") && !next.endsWith("/")) next += "/";
  return reference.replace(value, next + suffix);
}
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
function htmlReferences(source, rewrite, budget) {
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
// Parse only on explicit rename. Yield between files so unrelated app work
// can run; never rebuild this plan on every filename keystroke.
export async function prepareWebRename(content, request, { signal, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const check = () => { if (signal?.aborted) fail("ARTIFACT_CLOSED"); };
  check();
  const file = content.files.find(file => file.id === request.fileId && file.path === request.path);
  if (!file) fail("WEB_FILE_NOT_FOUND");
  const nextPath = request.nextPath;
  if (nextPath === file.path) return { operations: [], selectedId: file.id };
  validateNewWebPath({ ...content, files: content.files.filter(item => item.id !== file.id) }, nextPath, file.kind);
  const updates = [], budget = { nodes: 0 }; let characters = 0;
  for (const source of content.files) {
    if (!["html", "css"].includes(source.kind)) continue;
    await yieldControl(); check();
    characters += source.content.length;
    if (source.content.length > 512 * 1024 || characters > 5 * 1024 * 1024) fail("WEB_REFERENCE_SOURCE_LIMIT");
    const rewrite = value => webReferenceRewrite(value, source.path, source.id === file.id ? nextPath : source.path, file.path, nextPath);
    const next = source.kind === "html" ? htmlReferences(source.content, rewrite, budget) : rewriteCssReferences(source.content, rewrite);
    if (next !== source.content) updates.push({ fileId: source.id, path: source.path, kind: source.kind, content: next });
  }
  check();
  return { operations: [{ op: "renameFile", fileId: file.id, path: file.path, nextPath, ...(updates.length ? { updates } : {}) }], selectedId: file.id };
}
