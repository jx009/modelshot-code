import { SaxesParser } from "saxes";

export const OFFICE_NS = {
  w: ["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"],
  s: ["http://schemas.openxmlformats.org/spreadsheetml/2006/main", "http://purl.oclc.org/ooxml/spreadsheetml/main"],
  p: ["http://schemas.openxmlformats.org/presentationml/2006/main", "http://purl.oclc.org/ooxml/presentationml/main"],
  a: ["http://schemas.openxmlformats.org/drawingml/2006/main", "http://purl.oclc.org/ooxml/drawingml/main"],
  c: ["http://schemas.openxmlformats.org/drawingml/2006/chart", "http://purl.oclc.org/ooxml/drawingml/chart"],
  r: ["http://schemas.openxmlformats.org/officeDocument/2006/relationships", "http://purl.oclc.org/ooxml/officeDocument/relationships"],
  rel: ["http://schemas.openxmlformats.org/package/2006/relationships"],
  ct: ["http://schemas.openxmlformats.org/package/2006/content-types"],
};
export const isTag = (node, ns, local) => node && OFFICE_NS[ns]?.includes(node.uri) && node.local === local;
export const children = (node, ns, local) => (node?.children || []).filter(child => isTag(child, ns, local));
export const attribute = (node, local, ns) => Object.values(node.attrs).find(value => value.local === local && (ns ? OFFICE_NS[ns]?.includes(value.uri) : !value.uri))?.value;
export function descendants(node, ns, local) {
  const found = [], pending = [node];
  while (pending.length) { const item = pending.pop(); if (isTag(item, ns, local)) found.push(item); for (let i = (item.children?.length || 0) - 1; i >= 0; i--) pending.push(item.children[i]); }
  return found;
}
export const textContent = node => node.parts.map(part => typeof part === "string" ? part : textContent(part)).join("");

export function readOfficeXml(bytes, budget) {
  const fail = () => { throw new Error("CREATION_REFERENCE_XML_INVALID"); };
  let xml;
  try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail(); }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || /<\?xml[^?]*encoding\s*=\s*["'](?!utf-8["'])/i.test(xml)) fail();
  const stack = []; let root;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", fail); parser.on("error", fail);
  parser.on("opentag", tag => {
    if (++budget.nodes > 200000 || stack.length >= 64 || Object.keys(tag.attributes).length > 64) throw new Error("CREATION_REFERENCE_EXTRACT_LIMIT");
    const node = { local: tag.local, uri: tag.uri, attrs: tag.attributes, children: [], parts: [] };
    const parent = stack.at(-1);
    if (parent) { parent.children.push(node); parent.parts.push(node); } else root = node;
    stack.push(node);
  });
  const text = value => { if (stack.length) stack.at(-1).parts.push(value); else if (value.trim()) fail(); };
  parser.on("text", text); parser.on("cdata", text); parser.on("closetag", () => stack.pop());
  for (let i = 0; i < xml.length; i += 32768) parser.write(xml.slice(i, i + 32768));
  parser.close();
  if (!root || stack.length) fail();
  return root;
}
