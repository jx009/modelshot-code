import { parseFragment, serialize } from "parse5";
import { inspectHtml, walkHtml, attr } from "./document.js";
import { chartSvg } from "./chart.js";
import { htmlMasterSchema, themeStyles } from "./master.js";

export const HTML_EDIT_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const raster = value => typeof value === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
// Projection is disposable. Always save the source, never this resolved document.
export function projectHtml(page, images = new Map(), { theme, master } = {}) {
  // The slide schema permits intentionally blank pages. Keep all HTML/CSS
  // safety validation while allowing those pages to render as blank canvases.
  const { tree } = inspectHtml(page.html, { assignIds: true, allowEmpty: true });
  if (master) htmlMasterSchema.parse(master);
  const replace = value => value.replace(/asset:([a-zA-Z0-9_-]{1,128})/g, (_match, id) => {
    const image = images.get(id); return raster(image) ? image : "data:,";
  });
  let head, body;
  walkHtml(tree, node => {
    if (node.tagName === "head") head = node;
    if (node.tagName === "body") body = node;
    if (attr(node, "data-chart")) { node.childNodes = parseFragment(chartSvg(JSON.parse(attr(node, "data-chart")))).childNodes; for (const child of node.childNodes) child.parentNode = node; }
    for (const item of node.attrs || []) if (["src", "style"].includes(item.name)) item.value = replace(item.value);
    if (node.tagName === "style") for (const child of node.childNodes || []) if (child.value) child.value = replace(child.value);
  });
  const style = `${theme ? themeStyles(theme) : ""}${master?.css || ""}`;
  if (style) {
    const fragment = parseFragment(`<style>${replace(style).replace(/<\/style/gi, "</blocked-style")}</style>`);
    for (const node of fragment.childNodes) { node.parentNode = head; head.childNodes.unshift(node); }
  }
  if (master?.html) {
    const fragment = parseFragment(`<div data-cw-master="true" style="display:contents">${master.html}</div>`);
    for (const node of fragment.childNodes) { node.parentNode = body; body.childNodes.unshift(node); }
    walkHtml(fragment, node => { for (const item of node.attrs || []) if (["src", "style"].includes(item.name)) item.value = replace(item.value); });
  }
  head.childNodes.unshift({ nodeName: "meta", tagName: "meta", namespaceURI: "http://www.w3.org/1999/xhtml", attrs: [{ name: "http-equiv", value: "Content-Security-Policy" }, { name: "content", value: HTML_EDIT_CSP }], childNodes: [], parentNode: head });
  return serialize(tree);
}
