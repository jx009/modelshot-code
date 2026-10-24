import path from "node:path";
import JSZip from "jszip";
import { openOfficeZip } from "../references/office-zip.js";
import { readOfficeXml, children, attribute } from "../references/office-xml.js";

export const officeFail = (code = "OFFICE_IMPORT_UNSUPPORTED") => { throw new Error(code); };
export const xmlEscape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

// Parse with the namespace-aware, bounded XML reader first. The second walk
// attaches source spans; untouched XML is never reserialized.
export function sourceXml(bytes, budget = { nodes: 0 }) {
  const root = readOfficeXml(bytes, budget), source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const nodes = [], pending = [root];
  while (pending.length) { const n = pending.pop(); nodes.push(n); for (let i = n.children.length - 1; i >= 0; i--) pending.push(n.children[i]); }
  let cursor = 0, index = 0;
  const stack = [];
  while ((cursor = source.indexOf("<", cursor)) !== -1) {
    const start = cursor;
    if (source.startsWith("<!--", start)) { cursor = source.indexOf("-->", start) + 3; continue; }
    if (source.startsWith("<![CDATA[", start)) { cursor = source.indexOf("]]>", start) + 3; continue; }
    if (source.startsWith("<?", start)) { cursor = source.indexOf("?>", start) + 2; continue; }
    let quote = null, end = start + 1;
    for (; end < source.length; end++) {
      const c = source[end];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (end >= source.length) officeFail("OFFICE_XML_SPAN_INVALID");
    cursor = end + 1;
    if (source[start + 1] === "/") {
      const node = stack.pop(); if (!node) officeFail("OFFICE_XML_SPAN_INVALID");
      node.closeStart = start; node.end = cursor;
    } else {
      const node = nodes[index++]; if (!node) officeFail("OFFICE_XML_SPAN_INVALID");
      node.qname = source.slice(start + 1, end).match(/^[^\s/>]+/)?.[0];
      node.start = start; node.openEnd = cursor; node.selfClosing = /\/\s*$/.test(source.slice(start, end));
      if (node.selfClosing) { node.closeStart = end - 1; node.end = cursor; } else stack.push(node);
    }
  }
  if (stack.length || index !== nodes.length) officeFail("OFFICE_XML_SPAN_INVALID");
  return { root, source };
}

export function patchXml(source, patches) {
  let boundary = source.length;
  for (const { start, end, text } of [...patches].sort((a, b) => b.start - a.start || b.end - a.end)) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > boundary || typeof text !== "string") officeFail("OFFICE_XML_PATCH_INVALID");
    source = source.slice(0, start) + text + source.slice(end); boundary = start;
  }
  return source;
}

export function replaceChildren(source, node, content) {
  if (node.selfClosing) return { start: node.start, end: node.end, text: source.slice(node.start, node.openEnd).replace(/\/\s*>$/, ">") + content + "</" + node.qname + ">" };
  return { start: node.openEnd, end: node.closeStart, text: content };
}

export function officePackage(bytes) {
  const zip = openOfficeZip(bytes), cache = new Map(), budget = { nodes: 0 };
  if (zip.names.some(name => /(?:^|\/)(?:vbaProject\.bin|activeX)(?:\/|$)/i.test(name))) officeFail("OFFICE_MACROS_UNSUPPORTED");
  const xml = name => {
    if (!cache.has(name)) cache.set(name, sourceXml(zip.read(name), budget));
    return cache.get(name);
  };
  const relationships = part => {
    const relPath = path.posix.join(path.posix.dirname(part), "_rels", path.posix.basename(part) + ".rels");
    if (!zip.has(relPath)) return new Map();
    const map = new Map();
    for (const node of children(xml(relPath).root, "rel", "Relationship")) {
      const id = attribute(node, "Id"), target = attribute(node, "Target"), type = attribute(node, "Type");
      if (!id || !target || map.has(id)) officeFail("OFFICE_RELATIONSHIP_INVALID");
      if (attribute(node, "TargetMode") === "External") { map.set(id, { target, type, external: true }); continue; }
      if (/[\\:%?#\u0000-\u001f]/.test(target)) officeFail("OFFICE_RELATIONSHIP_INVALID");
      const resolved = path.posix.normalize(target.startsWith("/") ? target.slice(1) : path.posix.join(path.posix.dirname(part), target));
      if (resolved.startsWith("../") || resolved === ".." || !zip.has(resolved)) officeFail("OFFICE_RELATIONSHIP_INVALID");
      map.set(id, { target: resolved, type, external: false });
    }
    return map;
  };
  return { ...zip, xml, relationships };
}

export async function rewriteOfficePackage(pkg, replacements) {
  const zip = new JSZip();
  for (const name of pkg.names) zip.file(name, replacements.has(name) ? replacements.get(name) : pkg.read(name));
  for (const [name, bytes] of replacements) if (!pkg.has(name)) zip.file(name, bytes);
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } });
  if (output.length > 64 * 1024 * 1024) officeFail("OFFICE_EXPORT_TOO_LARGE");
  return output;
}
